#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Library/UefiRuntimeServicesTableLib.h>
#include "include/drivers/DriverManager.h"
#include "include/drivers/Keybord.h"
#include "include/drivers/fat32.h"
#include "include/drivers/Audiodrv.h"
#include "include/drivers/Video_Driver.h"
#include "include/drivers/Mausedrv.h"
#include "include/interrup.h"
#include "include/task.h"
#include "include/bmp.h"
#include "include/pex.h"
#include "include/font.h"
#include "include/Protocols.h"
#include <stdbool.h>
#include <Library/PrintLib.h>
#define STR_HELPER(x) #x
#define STR(x) STR_HELPER(x)

#ifndef BUILD_VERSION
    #define ACTUAL_BUILD "0"
#else
    #define ACTUAL_BUILD STR(BUILD_VERSION)
#endif
extern VideoMode vmode;
bool kernal_loop;
CHAR16* StartFile;

CHAR16* ExceptionNames[] = {
    L"0x00: Division by Zero",
    L"0x01: Debug Exception",
    L"0x02: NMI Interrupt",
    L"0x03: Breakpoint",
    L"0x04: Overflow",
    L"0x05: BOUND Range Exceeded",
    L"0x06: Invalid Opcode",
    L"0x07: Device Not Available",
    L"0x08: Double Fault",
    L"0x09: Coprocessor Segment Overrun",
    L"0x0A: Invalid TSS",
    L"0x0B: Segment Not Present",
    L"0x0C: Stack-Segment Fault",
    L"0x0D: General Protection Fault",
    L"0x0E: Page Fault"
};

VOID INITDRV(){
    INIT_VIDEO_DRIVER(gST);
    INIT_MOUSE();
    RegisterrsDisk(); 
}
VOID EFIAPI Int20h_SystemTime(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01:
            //ctx->REG_AX = GetInternalTicks(); 
            break;
        case 0x02: 
            gBS->Stall((UINTN)ctx->REG_CX * 1000);
            break;
        case 0x03: 
            ctx->REG_AX = (UINT64)ACTUAL_BUILD;
            break;
    }
}
VOID EFIAPI Int21h_ConsoleIO(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(60)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: Print(L"%c", (CHAR16)ctx->REG_CX); break;
        case 0x02: Print((CHAR16*)ctx->REG_CX); break;
        case 0x04: gST->ConOut->SetAttribute(gST->ConOut, ctx->REG_CX); break;
        case 0x05: gST->ConOut->ClearScreen(gST->ConOut); break;
        case 0x06: gST->ConOut->SetCursorPosition(gST->ConOut, ctx->REG_CX, ctx->REG_DX); break;
        case 0x07: gST->ConOut->EnableCursor(gST->ConOut, (BOOLEAN)ctx->REG_CX); break;
    }
}
VOID EFIAPI Int22h_Keyboard(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: ctx->REG_AX = (UINT64)GetKey(); break;
        case 0x02: ctx->REG_AX = (UINT64)HasKey(); break;
        case 0x03: Reset(); break;
    }
}
VOID EFIAPI Int23h_Storage(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(200)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: { // ReadFile
            EC16 f;
            ctx->REG_AX = (UINT64)ReadFileByPath((CHAR16*)ctx->REG_CX, &f); 
            ctx->REG_DX = (UINT64)f.Message;
            ctx->REG_R8 = (UINT64)f.FileSize;
        } break;
        case 0x02: ctx->REG_AX = (UINT64)SetCurrentDisk((CHAR16)ctx->REG_CX); break;
        case 0x03: ctx->REG_AX = (UINT64)WriteFile((CHAR16*)ctx->REG_CX, (UINT16*)ctx->REG_DX, (UINTN)ctx->REG_R8); break;
        case 0x04: ctx->REG_AX = (UINT64)CreateFile((CHAR16*)ctx->REG_CX); break;
        case 0x05: ctx->REG_AX = (UINT64)DeleteFile((CHAR16*)ctx->REG_CX); break;
        case 0x06: ctx->REG_AX = (UINT64)GetFileSize((CHAR16*)ctx->REG_CX, (UINT64*)ctx->REG_DX); break;
        case 0x07: ctx->REG_AX = (UINT64)ChangeDir((CHAR16*)ctx->REG_CX); break;
        case 0x08: ctx->REG_AX = (UINT64)(ListDir().Message); break; 
        case 0x09: ctx->REG_AX = (UINT64)(ListDisks().Message); break;
        case 0x0A: ctx->REG_AX = (UINT64)FileExists((CHAR16*)ctx->REG_CX); break;
        case 0x0B: ctx->REG_AX = (UINT64)DirExists((CHAR16*)ctx->REG_CX);break;
        case 0x0C: ctx->REG_AX = (UINT64)CreateDir((CHAR16*)ctx->REG_CX);break;
        case 0x0D: ctx->REG_AX = (UINT64)DeleteDir((CHAR16*)ctx->REG_CX);break;
        case 0x0E: ctx->REG_AX = (UINT64)MoveFile((CHAR16*)ctx->REG_CX, (CHAR16*)ctx->REG_DX);break;
        case 0x0F: ctx->REG_AX = (UINT64)CopyFile((CHAR16*)ctx->REG_CX, (CHAR16*)ctx->REG_DX);break;
    }
}

VOID EFIAPI Int24h_Graphics(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(200)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: CLEAR_SCREEN((UINT32)ctx->REG_CX); break;
        case 0x02: PUT_PIXEL((INT32)ctx->REG_CX, (INT32)ctx->REG_DX, (UINT32)ctx->REG_R8); break;
        case 0x03: DRAW_LINE((INT32)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10); break;
        case 0x04: DRAW_BITMAP32((UINT32*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (INT32)ctx->REG_R10); break;
        case 0x05: ctx->REG_AX = (UINT64)font_load_from_disk((CHAR16*)ctx->REG_CX, (const CHAR16*)ctx->REG_DX); break;
        case 0x06: font_draw_char((const CHAR16*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10, (CHAR16)ctx->REG_R11); break;
        case 0x08: font_draw_string((const CHAR16*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10, (const CHAR16*)ctx->REG_R11); break;
        case 0x09: {
            VideoMode* vm = GET_CURRENT_VMODE();
            ctx->REG_AX = (UINT64)vm->width;
            ctx->REG_BX = (UINT64)vm->height;
            ctx->REG_CX = (UINT64)vm;
        } break;
        case 0x0A: ctx->REG_AX = (UINT64)GET_PIXEL((INT32)ctx->REG_CX, (INT32)ctx->REG_DX); break;
        case 0x0C: SWAP_BUFFERS(); break;
        case 0x0D: GPU_UPLOAD_SHADER((VOID*)ctx->REG_CX, (UINTN)ctx->REG_DX, ctx->REG_R8); break;
        case 0x0E: GPU_RUN_COMPUTE(ctx->REG_CX, (UINT32)ctx->REG_DX); break;
        case 0x0F: ctx->REG_AX = (UINT64)GET_VIDEO_STATUS_STR(); break;
    }
}
VOID EFIAPI Int25h_MultiTasking(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(210)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: 
            task_create((INT32)ctx->REG_CX, (VOID (*)(VOID))ctx->REG_DX); 
            RegisterTaskToProcess((INT32)ctx->REG_CX, GetCurrentCallerProcess()->ID); 
            break;
        case 0x02: 
            task_create_with_arg((INT32)ctx->REG_CX, (VOID (*)(VOID*))ctx->REG_DX, (VOID*)ctx->REG_R8); 
            RegisterTaskToProcess((INT32)ctx->REG_CX, GetCurrentCallerProcess()->ID); 
            break;
        case 0x03: task_yield(); break;
        case 0x04: task_exit(); DeRegisterTaskToProcess(current_task); break;
        case 0x05: ctx->REG_AX = (UINT64)current_task; break;
        case 0x06: task_start_first(); break;
        case 0x07: task_stop_and_run((INT32)ctx->REG_CX); break;
        case 0x08: task_exitx((INT32)ctx->REG_CX); DeRegisterTaskToProcess((INT32)ctx->REG_CX); break;
        case 0x09: 
            if (ctx->REG_DX != 0) {
                struct Process* init_ptr = (struct Process*)ctx->REG_DX;
                ctx->REG_AX = (UINT64)LoadAndStartPex((CHAR16*)ctx->REG_CX, *init_ptr); 
            } break;
        case 0x0A: 
            ctx->REG_AX = (UINT64)GetCurrentCallerProcess();
            break;
        case 0x0B:
            ctx->REG_AX = (UINT64)Process_Exit((INT32)ctx->REG_CX);
            break;
        case 0x0c:
            ctx->REG_AX = (UINT64)GetTaskById((INT32)ctx->REG_CX);
            break;
    }
}
VOID EFIAPI Int26h_KernelService(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(50)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: 
            if (ctx->REG_BX <= 0xFF) RegisterCustomHandler((UINT8)ctx->REG_BX, (MY_HANDLER_FUNC)ctx->REG_CX);
            break;
        case 0x02: ctx->REG_AX = (UINT64)RegisterDriver((DRIVER*)ctx->REG_CX); break;
        case 0x03: 
            ctx->REG_CX = (UINT64)gImageHandle;
            ctx->REG_DX = (UINT64)gST;
            break;
        case 0x04: gRT->ResetSystem(EfiResetWarm, EFI_SUCCESS, 0, NULL); break;
        case 0x05: gRT->ResetSystem(EfiResetShutdown, EFI_SUCCESS, 0, NULL); break;
        case 0x06: INITDRV(); break;
    }
}
VOID EFIAPI Int27h_Network(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(200)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: ctx->REG_AX = (UINT64)INIT_NETWORK_DRIVER((CHAR16*)ctx->REG_CX, (CHAR16*)ctx->REG_DX); break;
        case 0x02: ctx->REG_AX = (UINT64)NETWORK_TCP_CONNECT((CHAR16*)ctx->REG_CX, (UINT16)ctx->REG_DX); break;
        case 0x03: ctx->REG_AX = (UINT64)NETWORK_TCP_SEND((UINT8*)ctx->REG_CX, (UINTN)ctx->REG_DX); break;
        case 0x04: ctx->REG_AX = (UINT64)NETWORK_TCP_RECEIVE((UINT8*)ctx->REG_CX, (UINTN*)ctx->REG_DX); break;
        case 0x05: ctx->REG_AX = (UINT64)NETWORK_TCP_DISCONNECT(); break;
        case 0x06: ctx->REG_AX = (UINT64)NETWORK_DNS_LOOKUP((CHAR16*)ctx->REG_CX, (CHAR16*)ctx->REG_DX); break;
    }
}
VOID EFIAPI Int28h_Audio(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(200)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: AudioBeep((UINT32)ctx->REG_CX, (UINT32)ctx->REG_DX); break;
        case 0x02: ctx->REG_AX = (UINT64)AudioPlay((UINT8*)ctx->REG_CX, (UINTN)ctx->REG_DX); break;
    }
}
VOID EFIAPI Int29h_Mouse(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(200)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: ctx->REG_AX = (UINT64)INIT_MOUSE(); break;
        case 0x02: ctx->REG_AX = (UINT64)GET_MOUSE_STATE((INT32*)ctx->REG_CX, (INT32*)ctx->REG_DX, (BOOLEAN*)ctx->REG_R8, (BOOLEAN*)ctx->REG_R9); break;
    }
}
VOID EFIAPI Int2Ah_Memory(IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if(!IFProcessHasRight(205)) {
        return;
    }
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01:
            {
                VOID* ptr = NULL;
                EFI_STATUS s = gBS->AllocatePool(EfiLoaderData, (UINTN)ctx->REG_CX, &ptr);
                ctx->REG_AX = (s == EFI_SUCCESS) ? (UINT64)ptr : 0;
            } break;
        case 0x02: // Free Pool
            if (ctx->REG_CX != 0) gBS->FreePool((VOID*)ctx->REG_CX);
            break;
    }
}
VOID KernelPanic(const CHAR16* message, EFI_SYSTEM_CONTEXT Context, UINT64 ErrorCode) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    gBS->SetWatchdogTimer(60, 0x00, 0, NULL);

    CLEAR_SCREEN(0x0000AA); 

    INT32 screen_w = (INT32)vmode.width;
    INT32 screen_h = (INT32)vmode.height;
    INT32 margin_x = screen_w / 12;

    font_draw_string(L"SysFont", margin_x, screen_h / 6, 80, 0xFFFFFF, L":(");

    INT32 text_y = (screen_h / 6) + 100;
    font_draw_string(L"SysFont", margin_x, text_y, 22, 0xFFFFFF, 
        L"Your PC ran into a problem and needs to restart.");
    font_draw_string(L"SysFont", margin_x, text_y + 40, 20, 0xFFFFFF, 
        L"We're just collecting some error info, and then we'll restart for you.");

    font_draw_string(L"SysFont", margin_x, text_y + 120, 18, 0xFFFFFF, L"0% complete");

    INT32 footer_y = screen_h - (screen_h / 4);

    font_draw_string(L"SysFont", margin_x, footer_y, 16, 0xCCCCCC, 
        L"For more information about this issue, visit: https://perrotsoft.github.io/datapedia");
    
    font_draw_string(L"SysFont", margin_x, footer_y + 40, 14, 0xEEEEEE, L"Stop Code: ");
    font_draw_string(L"SysFont", margin_x + 110, footer_y + 40, 14, 0xFFFFFF, message);

    if (ctx) {
        font_draw_string(L"SysFont", margin_x, footer_y + 70, 12, 0xAAAAAA, L"RIP: ");
    }

    font_draw_string(L"SysFont", margin_x, screen_h - 40, 12, 0x888888, 
        L"System will automatically reboot in 60 seconds.");

    while(TRUE) {
        __asm__ ("hlt");
    }
}
VOID EFIAPI CommonExceptionHandler (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    if (Type <= 0x0E) {
        KernelPanic(ExceptionNames[Type], Context, (UINT64)Type);
    } else {
        KernelPanic(L"Unknown Hardware Exception", Context, (UINT64)Type);
    }
}

EFI_STATUS draw_logo_from_disk(CHAR16 DiskLetter) {
    INT32 bmp_x = (INT32)(vmode.width / 2 - 50);
    INT32 bmp_y = (INT32)(vmode.height / 2 - 50);
    SetCurrentDisk(DiskLetter);
    EC16 file;
    EFI_STATUS status = ReadFileByPath(L"\\ico_100x100.bmp", &file);
    if (EFI_ERROR(status)) return status;
    CLEAR_SCREEN(0x000000);
    return draw_bmp_from_memory_safe((UINT8*)file.Message, file.FileSize, bmp_x, bmp_y);
}
static inline void wrmsr(uint32_t msr, uint64_t val) {
    uint32_t low = (uint32_t)val;
    uint32_t high = (uint32_t)(val >> 32);
    __asm__ volatile("wrmsr" : : "c"(msr), "a"(low), "d"(high));
}
void kernal() {
    Fat32_RegisterrsDisk(); 
    INT32 tl_x = (INT32)(vmode.width / 2 - 50);
    INT32 tl_y = (INT32)(vmode.height / 2 + 200);
    EC16 file;
    
    EFI_STATUS Status = ReadFileByPath(StartFile, &file);

    if (EFI_ERROR(Status) || file.Message == NULL) {
        CHAR16 Buffer[100]; 
        UnicodeSPrint(Buffer, sizeof(Buffer), L"[ERROR] %s not found! Status: %r", StartFile, Status);
        font_draw_string(L"SysFont", tl_x, tl_y, 14, 0xFF0000, Buffer);
        task_yield(); 
    } else {
        gBS->FreePool(file.Message);
        static const CHAR16* args[] = { L"0.2b", L"yka", L"posbm", NULL }; 
        struct Process p;
        p.Name = L"KernelInit";
        p.ArgContext = (void*)args;
        p.Rights = 0;
        p.active = TRUE;
        p.ParentID = 0;

        Status = LoadAndStartPex(StartFile, p);
        
        if (EFI_ERROR(Status)) {
            CHAR16 Buffer[100];
            UnicodeSPrint(Buffer, sizeof(Buffer), L"[ERROR] Load failed! Status: %r", Status);
            font_draw_string(L"SysFont", tl_x, tl_y, 14, 0xFF0000, Buffer);
        }
    }
    while (kernal_loop) {
        Fat32_RegisterrsDisk(); 

        UINT8 active_tasks = 0;
        for (int i = 0; i < MAX_TASKS; i++) {
            if (tasks[i].active) active_tasks++;
        }
        if(active_tasks < 2) {
            kernal_loop = FALSE;
            break;
        }
        task_yield();
    }
    
    task_exit();
}
void AsciiToUnicode(const char* src, CHAR16* dest) {
    while (*src) {
        *dest++ = (CHAR16)(*src++);
    }
    *dest = L'\0'; 
}
void GfxEnableUltraSpeed(void) {
    // Настраиваем IA32_PAT (MSR 0x277). 
    // Мы меняем настройки так, чтобы индекс 1 соответствовал Write-Combining (01h)
    uint64_t pat = 0x0007040600070106ULL; 

    uint32_t low = (uint32_t)pat;
    uint32_t high = (uint32_t)(pat >> 32);

    __asm__ volatile (
        "mov $0x277, %%rcx\n\t"
        "wrmsr\n\t"        // Записываем новое значение PAT
        "wbinvd"           // Сбрасываем кэши, чтобы изменения вступили в силу
        : : "a"(low), "d"(high) : "rcx", "memory"
    );
}
EFI_STATUS EFIAPI UefiMain (IN EFI_HANDLE ImageHandle, IN EFI_SYSTEM_TABLE *SystemTable)
{
    gST = SystemTable;
    gBS = SystemTable->BootServices;
    gRT = SystemTable->RuntimeServices;
    gST->BootServices->SetWatchdogTimer(0, 0, 0, NULL);
    GfxEnableUltraSpeed();
    INIT(SystemTable);
    init_vd();
    Fat32_Storage_INIT();
    Keyboard_INIT();
    InitSimpleAudio();
    RegisterMouseDriver();
    
    INITDRV();

    draw_logo_from_disk('A');
    SWAP_BUFFERS();
    INIT_PROTOCOLS();

    RegisterCustomHandler(0x00, CommonExceptionHandler); // Division by Zero
    RegisterCustomHandler(0x01, CommonExceptionHandler); // Debug
    RegisterCustomHandler(0x02, CommonExceptionHandler); // NMI
    RegisterCustomHandler(0x03, CommonExceptionHandler); // Breakpoint
    RegisterCustomHandler(0x04, CommonExceptionHandler); // Overflow
    RegisterCustomHandler(0x05, CommonExceptionHandler); // Bound Range Exceeded
    RegisterCustomHandler(0x06, CommonExceptionHandler); // Invalid Opcode
    RegisterCustomHandler(0x07, CommonExceptionHandler); // Device Not Available
    RegisterCustomHandler(0x08, CommonExceptionHandler); // Double Fault
    RegisterCustomHandler(0x09, CommonExceptionHandler); // Coprocessor Segment Overrun
    RegisterCustomHandler(0x0A, CommonExceptionHandler); // Invalid TSS
    RegisterCustomHandler(0x0B, CommonExceptionHandler); // Segment Not Present
    RegisterCustomHandler(0x0C, CommonExceptionHandler); // Stack-Segment Fault
    RegisterCustomHandler(0x0D, CommonExceptionHandler); // General Protection Fault
    RegisterCustomHandler(0x0E, CommonExceptionHandler); // Page Fault);
    
    RegisterCustomHandler(0x20, Int20h_SystemTime);
    RegisterCustomHandler(0x21, Int21h_ConsoleIO);
    RegisterCustomHandler(0x22, Int22h_Keyboard);
    RegisterCustomHandler(0x23, Int23h_Storage);
    RegisterCustomHandler(0x24, Int24h_Graphics);
    RegisterCustomHandler(0x25, Int25h_MultiTasking);
    RegisterCustomHandler(0x26, Int26h_KernelService);
    RegisterCustomHandler(0x27, Int27h_Network);
    RegisterCustomHandler(0x28, Int28h_Audio);
    RegisterCustomHandler(0x29, Int29h_Mouse);
    RegisterCustomHandler(0x2A, Int2Ah_Memory);

    init_scheduler();
    font_init();
    
    kernal_loop = true;
    StartFile=L"start.pex";
    font_load_from_disk(L"system.ttf", L"SysFont");
    INT32 tl_x = (INT32)(vmode.width / 2 - 50);
    INT32 tl_y = (INT32)(vmode.height / 2 + 74);
    font_draw_string(L"SysFont", tl_x, tl_y, 32, 0xFFFFFF, L"Parrot OS");
    CHAR16 build_ver_unicode[128]; 
    AsciiToUnicode(ACTUAL_BUILD, build_ver_unicode);
    UINTN current_len = 0;
    while (build_ver_unicode[current_len] != L'\0' && current_len < 60) {
        current_len++;
    }

    UnicodeSPrint(&build_ver_unicode[current_len], 
                  sizeof(build_ver_unicode) - (current_len * 2), 
                  L" Build    Developed by ParrotSoft");

    font_draw_string(L"SysFont", vmode.width - 280, vmode.height - 25, 12, 0xAAAAAA, build_ver_unicode);
    SWAP_BUFFERS();
    kernal_loop = true;
    task_create(0,kernal);
    SWAP_BUFFERS();
    task_start_first();
    draw_logo_from_disk('A');
    SWAP_BUFFERS();
    return EFI_SUCCESS;
}