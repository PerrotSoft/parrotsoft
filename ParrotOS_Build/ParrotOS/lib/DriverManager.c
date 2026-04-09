#include "../include/drivers/DriverManager.h"

#define MAX_DRIVERS 32

static DRIVER Drivers[MAX_DRIVERS];
static UINTN  DriversCount = 0;
static EFI_SYSTEM_TABLE* SystemTables;

BOOLEAN RegisterDriver(DRIVER* Driver)
{
    if (DriversCount >= MAX_DRIVERS || Driver == NULL)
        return FALSE;

    Drivers[DriversCount++] = *Driver;
    GetBestDriver(Driver->Type);
    return TRUE;
}

DRIVER* GetBestDriver(DRIVER_TYPE Type)
{
    DRIVER* Best = NULL;

    for (UINTN i = 0; i < DriversCount; i++) {
        if (Drivers[i].Type != Type)
            continue;

        if (Best == NULL || Drivers[i].Priority > Best->Priority)
            Best = &Drivers[i];
    }

    return Best;
}

VOID INIT(EFI_SYSTEM_TABLE *SytemTables)
{
    SystemTables = SytemTables;
}
CHAR16 GetKey(VOID) {
    DRIVER* d = GetBestDriver(DRIVER_TYPE_KEYBOARD);
    if (d && d->Interface && SystemTables) {
        return ((KEY_DRIVER_IF*)d->Interface)->GetKey(SystemTables);
    }
    return 0;
}

BOOLEAN HasKey(VOID) {
    DRIVER* d = GetBestDriver(DRIVER_TYPE_KEYBOARD);
    if (d && d->Interface && SystemTables) {
        return ((KEY_DRIVER_IF*)d->Interface)->HasKey(SystemTables);
    }
    return FALSE;
}
VOID Reset(VOID)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_KEYBOARD);
    if (!drv || !drv->Interface)
        return;

    KEY_DRIVER_IF* key = (KEY_DRIVER_IF*)drv->Interface;
    key->Reset(SystemTables);
}



EFI_STATUS ReadFileByPath(CHAR16 *path_in, EC16 *out)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ReadFileByPath(path_in, out);
}
EFI_STATUS SetCurrentDisk(CHAR16 Letter)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->SetCurrentDisk(Letter);
}
const CHAR16* GetCurrentPath(VOID)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return NULL;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->GetCurrentPath();
}
EFI_STATUS PathUp(VOID)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->PathUp();
}
EC16 ListDir(VOID)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface) {
        EC16 error = { EFI_NOT_FOUND, NULL, 0 };
        return error;
    }

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ListDir();
}
EFI_STATUS ChangeDir(CHAR16 *path)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ChangeDir(path);
}
EFI_STATUS CreateFile(CHAR16 *name)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->CreateFile(name);
}
EFI_STATUS DeleteFile(CHAR16 *name)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->DeleteFile(name);
}
EC16 ReadFile(CHAR16 *filename)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface) {
        EC16 error = { EFI_NOT_FOUND, NULL, 0 };
        return error;
    }

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ReadFile(filename);
}
EFI_STATUS WriteFile(CHAR16 *filename, UINT16 *data, UINTN len)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->WriteFile(filename, data, len);
}
EFI_STATUS GetFileSize(CHAR16 *filename, UINT64 *filesize)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->GetFileSize(filename, filesize);
}
VOID RegisterrsDisk()
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    storage->RegisterrsDisk();
}
EC16 ListDisks()
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface) {
        EC16 error_res = { EFI_NOT_FOUND, NULL, 0 };
        return error_res;
    }

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ListDisks();
}
BOOLEAN FileExists(CHAR16 *path)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return FALSE;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ExistsFile(path);
}
BOOLEAN DirExists(CHAR16 *path)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return FALSE;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->ExistsDir(path);
}
EFI_STATUS CreateDir(CHAR16 *name)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->CreateDir(name);
}
EFI_STATUS DeleteDir(CHAR16 *name)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->DeleteDir(name);
}
EFI_STATUS MoveFile(CHAR16 *src, CHAR16 *dst)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->MoveFile(src, dst);
}
EFI_STATUS CopyFile(CHAR16 *src, CHAR16 *dst)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_STORAGE);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    STORAGE_DRIVER_IF* storage = (STORAGE_DRIVER_IF*)drv->Interface;
    return storage->CopyFile(src, dst);
}
EFI_STATUS INIT_VIDEO_DRIVER(EFI_SYSTEM_TABLE *SystemTable) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (!drv || !drv->Interface) return EFI_NOT_FOUND;
    return ((VIDEO_DRIVER_IF*)drv->Interface)->Init(SystemTable);
}

VOID CLEAR_SCREEN(UINT32 rgb24) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->ClearScreen(rgb24);
}

VOID PUT_PIXEL(INT32 x, INT32 y, UINT32 rgb24) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->PutPixel(x, y, rgb24);
}

VOID DRAW_LINE(INT32 x0, INT32 y0, INT32 x1, INT32 y1, UINT32 rgb24) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->DrawLine(x0, y0, x1, y1, rgb24);
}

VOID DRAW_BITMAP32(const UINT32* bmp, INT32 bmp_w, INT32 bmp_h, INT32 x0, INT32 y0) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->DrawBitmap32(bmp, bmp_w, bmp_h, x0, y0);
}

VideoMode* GET_CURRENT_VMODE(VOID) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) return ((VIDEO_DRIVER_IF*)drv->Interface)->GetVideoMode();
    return NULL;
}

UINT32 GET_PIXEL(INT32 x, INT32 y) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) return ((VIDEO_DRIVER_IF*)drv->Interface)->Get_Pixel(x, y);
    return 0;
}

VOID SWAP_BUFFERS(VOID) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->SwapBuffers();
}

VOID GPU_UPLOAD_SHADER(VOID* Code, UINTN Size, UINT64 Offset) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->UploadShader(Code, Size, Offset);
}

VOID GPU_RUN_COMPUTE(UINT64 Offset, UINT32 Threads) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) ((VIDEO_DRIVER_IF*)drv->Interface)->RunCompute(Offset, Threads);
}

const CHAR8* GET_VIDEO_STATUS_STR(VOID) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_VIDEO);
    if (drv && drv->Interface) return ((VIDEO_DRIVER_IF*)drv->Interface)->GetDriverType();
    return "No Video Driver";
}
EFI_STATUS INIT_NETWORK_DRIVER(CHAR16 *NicName, CHAR16 *Password)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->Init( SystemTables, NicName, Password);
}

EFI_STATUS NETWORK_TCP_CONNECT(CHAR16 *Ip, UINT16 Port)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->TcpConnect(Ip, Port);
}

EFI_STATUS NETWORK_TCP_SEND(UINT8 *Data, UINTN Len)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->TcpSend(Data, Len);
}

EFI_STATUS NETWORK_TCP_RECEIVE(UINT8 *Buffer, UINTN *Len)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->TcpReceive(Buffer, Len);
}

EFI_STATUS NETWORK_TCP_DISCONNECT(VOID)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->TcpDisconnect();
}
EFI_STATUS NETWORK_DNS_LOOKUP(CHAR16 *DomainName, CHAR16 *OutIpStr)
{
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_NETWORK);
    if (!drv || !drv->Interface)
        return EFI_NOT_FOUND;

    NETWORK_DRIVER_IF* net = (NETWORK_DRIVER_IF*)drv->Interface;
    return net->DnsLookup(DomainName, OutIpStr);
}
EFI_STATUS INIT_MOUSE(VOID) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_MOUSE);
    if (!drv || !drv->Interface) return EFI_NOT_FOUND;
    return ((MOUSE_DRIVER_IF*)drv->Interface)->Init();
}

EFI_STATUS GET_MOUSE_STATE(INT32 *x, INT32 *y, BOOLEAN *lb, BOOLEAN *rb) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_MOUSE);
    if (!drv || !drv->Interface) return EFI_NOT_FOUND;
    return ((MOUSE_DRIVER_IF*)drv->Interface)->GetState(x, y, lb, rb);
}

EFI_STATUS INIT_AUDIO(VOID) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_AUDIO);
    if (!drv || !drv->Interface) return EFI_NOT_FOUND;
    return ((AUDIO_DRIVER_IF*)drv->Interface)->Init();
}

VOID AudioBeep(UINT32 Freq, UINT32 Dur) {
    DRIVER* drv = GetBestDriver(DRIVER_TYPE_AUDIO);
    if (drv && drv->Interface) {
        ((AUDIO_DRIVER_IF*)drv->Interface)->Beep(Freq, Dur);
    }
}
EFI_STATUS AudioPlay(UINT8 *Data, UINTN Size) {
    DRIVER* d = GetBestDriver(DRIVER_TYPE_AUDIO);
    if (d && d->Interface) return ((AUDIO_DRIVER_IF*)d->Interface)->PlayRaw(Data, Size);
    return EFI_NOT_FOUND;
}