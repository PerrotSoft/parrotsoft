#include "../include/drivers/Network.h"
#include <Library/UefiLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Library/BaseMemoryLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/PrintLib.h>
#include <Protocol/Tcp4.h>
#include <Protocol/ServiceBinding.h>
#include <Protocol/Dns4.h>

static EFI_HANDLE mTcpHandle = NULL;
static EFI_TCP4_PROTOCOL *mTcp4 = NULL;
static EFI_HANDLE mSelectedNic = NULL;

static EFI_STATUS SafeWaitForEvent(EFI_EVENT Event, UINTN TimeoutMs) {
    UINTN Polls = TimeoutMs;
    while (Polls > 0) {
        EFI_STATUS Status = gBS->CheckEvent(Event);
        if (Status != EFI_NOT_READY) return Status; 
        gBS->Stall(1000);
        Polls--;
    }
    return EFI_TIMEOUT;
}

static EFI_STATUS ParseIp4(CHAR16 *Str, EFI_IPv4_ADDRESS *Ip) {
    UINTN i = 0, ByteIndex = 0, Val = 0;
    SetMem(Ip, sizeof(EFI_IPv4_ADDRESS), 0);
    while (Str[i] != 0 && ByteIndex < 4) {
        if (Str[i] >= L'0' && Str[i] <= L'9') {
            Val = Val * 10 + (Str[i] - L'0');
        } else if (Str[i] == L'.') {
            Ip->Addr[ByteIndex++] = (UINT8)Val;
            Val = 0;
        } else return EFI_INVALID_PARAMETER;
        i++;
    }
    Ip->Addr[ByteIndex] = (UINT8)Val;
    return (ByteIndex == 3) ? EFI_SUCCESS : EFI_INVALID_PARAMETER;
}

static EFI_STATUS CreateServiceChild(EFI_GUID *ServiceGuid, EFI_GUID *ProtoGuid, EFI_HANDLE *ChildHandle, VOID **Interface) {
    if (!mSelectedNic) return EFI_NOT_READY;
    EFI_SERVICE_BINDING_PROTOCOL *Sb = NULL;
    EFI_STATUS Status = gBS->HandleProtocol(mSelectedNic, ServiceGuid, (VOID**)&Sb);
    if (EFI_ERROR(Status)) return Status;
    Status = Sb->CreateChild(Sb, ChildHandle);
    if (EFI_ERROR(Status)) return Status;
    return gBS->OpenProtocol(*ChildHandle, ProtoGuid, Interface, gImageHandle, NULL, EFI_OPEN_PROTOCOL_BY_HANDLE_PROTOCOL);
}

EFI_STATUS Net_Init(EFI_SYSTEM_TABLE *SystemTable, CHAR16 *NicName, CHAR16 *Password) {
    UINTN HandleCount = 0;
    EFI_HANDLE *Handles = NULL;
    gBS->LocateHandleBuffer(ByProtocol, &gEfiTcp4ServiceBindingProtocolGuid, NULL, &HandleCount, &Handles);
    if (HandleCount == 0) return EFI_NOT_FOUND;
    if (NicName != NULL && StrStr(NicName, L"1") != NULL && HandleCount > 1) {
        mSelectedNic = Handles[1];
    } else {
        mSelectedNic = Handles[0];
    }

    if (Handles) FreePool(Handles);
    return (mSelectedNic) ? EFI_SUCCESS : EFI_NOT_FOUND;
}

EFI_STATUS Net_DnsLookup(CHAR16 *DomainName, CHAR16 *OutIpStr) {
    EFI_STATUS Status;
    EFI_HANDLE DnsHandle = NULL;
    EFI_DNS4_PROTOCOL *Dns4 = NULL;

    Status = CreateServiceChild(&gEfiDns4ServiceBindingProtocolGuid, &gEfiDns4ProtocolGuid, &DnsHandle, (VOID**)&Dns4);
    if (EFI_ERROR(Status)) return Status;

    EFI_DNS4_CONFIG_DATA ConfigData;
    ZeroMem(&ConfigData, sizeof(ConfigData));
    ConfigData.UseDefaultSetting = TRUE;
    Dns4->Configure(Dns4, &ConfigData);

    EFI_DNS4_COMPLETION_TOKEN Token;
    ZeroMem(&Token, sizeof(Token));
    gBS->CreateEvent(0, 0, NULL, NULL, &Token.Event);

    Status = Dns4->HostNameToIp(Dns4, DomainName, &Token);
    if (Status == EFI_SUCCESS) {
        Status = SafeWaitForEvent(Token.Event, 5000);
        if (!EFI_ERROR(Status)) Status = Token.Status;
    }

    if (!EFI_ERROR(Status) && Token.RspData.H2AData != NULL) {
        EFI_IPv4_ADDRESS Ip = Token.RspData.H2AData->IpList[0];
        UnicodeSPrint(OutIpStr, 64, L"%d.%d.%d.%d", Ip.Addr[0], Ip.Addr[1], Ip.Addr[2], Ip.Addr[3]);
        FreePool(Token.RspData.H2AData);
    }

    gBS->CloseEvent(Token.Event);
    Dns4->Configure(Dns4, NULL);
    return Status;
}

EFI_STATUS Net_TcpConnect(CHAR16 *IpStr, UINT16 Port) {
    EFI_STATUS Status;
    EFI_IPv4_ADDRESS RemoteIp;
    if (EFI_ERROR(ParseIp4(IpStr, &RemoteIp))) return EFI_INVALID_PARAMETER;

    Status = CreateServiceChild(&gEfiTcp4ServiceBindingProtocolGuid, &gEfiTcp4ProtocolGuid, &mTcpHandle, (VOID**)&mTcp4);
    if (EFI_ERROR(Status)) return Status;

    EFI_TCP4_CONFIG_DATA Config;
    ZeroMem(&Config, sizeof(Config));
    Config.AccessPoint.UseDefaultAddress = TRUE;
    Config.AccessPoint.RemotePort = Port;
    Config.AccessPoint.ActiveFlag = TRUE;
    CopyMem(&Config.AccessPoint.RemoteAddress, &RemoteIp, sizeof(RemoteIp));

    Status = mTcp4->Configure(mTcp4, &Config);
    if (EFI_ERROR(Status)) return Status;

    EFI_TCP4_CONNECTION_TOKEN Token;
    ZeroMem(&Token, sizeof(Token));
    gBS->CreateEvent(0, 0, NULL, NULL, &Token.CompletionToken.Event);
    
    Status = mTcp4->Connect(mTcp4, &Token);
    if (!EFI_ERROR(Status)) {
        Status = SafeWaitForEvent(Token.CompletionToken.Event, 5000);
        if (!EFI_ERROR(Status)) Status = Token.CompletionToken.Status;
    }
    gBS->CloseEvent(Token.CompletionToken.Event);
    return Status;
}

VOID Network_INIT(VOID) {
    static NETWORK_DRIVER_IF NetInterface = {
        .Init = Net_Init,
        .TcpConnect = Net_TcpConnect,
        .TcpDisconnect = (VOID*)0,
        .DnsLookup = Net_DnsLookup
    };
    RegisterDriver(&(DRIVER){.Type = DRIVER_TYPE_NETWORK, .Priority = 1, .Interface = &NetInterface});
}