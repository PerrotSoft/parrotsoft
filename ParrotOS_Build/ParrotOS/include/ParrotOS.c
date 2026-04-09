#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Library/UefiRuntimeServicesTableLib.h>
#include "include/drivers/DriverManager.h"
#include "include/drivers/Keybord.h"
#include "include/drivers/fat32.h"
#include "include/drivers/Video_Driver.h"
#include "include/interrup.h"
#include "include/task.h"
#include "include/bmp.h"
#include "include/pex.h"
#include "include/font.h"
#include <stdbool.h>

extern VideoMode vmode;
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

bool kernal_loop;
VOID EFIAPI Int21h_ConsoleIO (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: Print(L"%c", (CHAR16)ctx->REG_CX); break;
        case 0x02: Print((CHAR16*)ctx->REG_CX); break;
        case 0x04: gST->ConOut->SetAttribute(gST->ConOut, ctx->REG_CX); break;
        case 0x05: gST->ConOut->ClearScreen(gST->ConOut); break;
        case 0x06: gST->ConOut->SetCursorPosition(gST->ConOut, ctx->REG_CX, ctx->REG_DX); break;
    }
}
VOID EFIAPI Int22h_Keyboard (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: ctx->REG_AX = (UINT64)GetKey(); break;
        case 0x02: ctx->REG_AX = (UINT64)HasKey(); break;
        case 0x03: Reset(); break;
        case 0x04: ctx->REG_AX = (UINT64)GetKeyRun(); break;
        case 0x05: ctx->REG_AX = (UINT64)HasKeyRun(); break;
    }
}
VOID EFIAPI Int23h_Storage (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: ctx->REG_AX = (UINT64)ReadFileByPath((CHAR16*)ctx->REG_CX, (EC16*)ctx->REG_DX); break;
        case 0x02: ctx->REG_AX = (UINT64)SetCurrentDisk((CHAR16)ctx->REG_CX); break;
        case 0x03: ctx->REG_AX = (UINT64)WriteFile((CHAR16*)ctx->REG_CX, (UINT16*)ctx->REG_DX, (UINTN)ctx->REG_R8); break;
        case 0x04: ctx->REG_AX = (UINT64)CreateFile((CHAR16*)ctx->REG_CX); break;
        case 0x05: ctx->REG_AX = (UINT64)DeleteFile((CHAR16*)ctx->REG_CX); break;
        case 0x06: ctx->REG_AX = (UINT64)GetFileSize((CHAR16*)ctx->REG_CX, (UINT64*)ctx->REG_DX); break;
        case 0x07: ctx->REG_AX = (UINT64)ChangeDir((CHAR16*)ctx->REG_CX); break;
    }
}
VOID EFIAPI Int24h_Graphics (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: CLEAR_SCREEN((UINT32)ctx->REG_CX); break;
        case 0x02: PUT_PIXEL((INT32)ctx->REG_CX, (INT32)ctx->REG_DX, (UINT32)ctx->REG_R8); break;
        case 0x03: DRAW_LINE((INT32)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10); break;
        case 0x04: DRAW_BITMAP32((UINT32*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (INT32)ctx->REG_R10); break;
        case 0x05: ctx->REG_AX = (UINT64)font_load_from_disk((CHAR16*)ctx->REG_CX, (const CHAR16*)ctx->REG_DX); break;
        case 0x06: 
            font_draw_char((const CHAR16*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10, (CHAR16)ctx->REG_R11); 
            break;
        case 0x08: 
            font_draw_string((const CHAR16*)ctx->REG_CX, (INT32)ctx->REG_DX, (INT32)ctx->REG_R8, (INT32)ctx->REG_R9, (UINT32)ctx->REG_R10, (const CHAR16*)ctx->REG_R11); 
            break;
    }
}
VOID EFIAPI Int25h_MultiTasking (IN EFI_EXCEPTION_TYPE Type, IN EFI_SYSTEM_CONTEXT Context) {
    SYSTEM_CONTEXT_TYPE* ctx = Context.CTX_FIELD;
    switch (ctx->REG_AX) {
        case 0x01: task_create((INT32)ctx->REG_CX, (VOID (*)(VOID))ctx->REG_DX); break;
        case 0x02: task_yield(); break;
        case 0x03: task_exit(); break;
        case 0x04: ctx->REG_AX = (UINT64)current_task; break;
        case 0x05: task_start_first(); break;
        case 0x06: ctx->REG_AX = (UINT64)LoadAndStartPex((CHAR16*)ctx->REG_CX); break;
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

void kernal() {
    Fat32_RegisterrsDisk(); 
    EC16 file;
    EFI_STATUS Status = ReadFileByPath(L"p.pex", &file);
    if (EFI_ERROR(Status)) {
        Print(L"[ERROR] p.pex not found! Status: %r\n", Status);
        while(1);
    } else {
        Print(L"[KERNEL] p.pex found. Loading...\n");
        Status = LoadAndStartPex(L"p.pex");
        if (EFI_ERROR(Status)) {
            Print(L"[ERROR] Load failed! Status: %r\n", Status);
        } else {
            Print(L"[KERNEL] Load success. Entering loop.\n");
        }
    }
    while (kernal_loop) {
        Fat32_RegisterrsDisk();
        UINT8 f = 0;
        for (int i = 0; i < MAX_TASKS; i++) if (tasks[i].active) f++;
        if(f < 2) task_exit();
        task_yield();
    }
    task_exit();
}
EFI_STATUS EFIAPI UefiMain (IN EFI_HANDLE ImageHandle, IN EFI_SYSTEM_TABLE *SystemTable)
{
    gST = SystemTable;
    gBS = SystemTable->BootServices;
    gST->BootServices->SetWatchdogTimer(0, 0, 0, NULL);
    INIT(SystemTable);
    init_vd();
    INIT_VIDEO_DRIVER(SystemTable);
    Fat32_Storage_INIT();
    Fat32_RegisterrsDisk(); 
    draw_logo_from_disk('A');
    RegisterCustomHandler(0x00, CommonExceptionHandler);
    RegisterCustomHandler(0x0E, CommonExceptionHandler);
    RegisterCustomHandler(0x21, Int21h_ConsoleIO);
    RegisterCustomHandler(0x22, Int22h_Keyboard);
    RegisterCustomHandler(0x23, Int23h_Storage);
    RegisterCustomHandler(0x24, Int24h_Graphics);
    RegisterCustomHandler(0x25, Int25h_MultiTasking);
    init_scheduler();
    font_init();
    kernal_loop = true;
    font_load_from_disk(L"system.ttf", L"SysFont");

    INT32 tl_x = (INT32)(vmode.width / 2 - 50);
    INT32 tl_y = (INT32)(vmode.height / 2 + 74);

    font_draw_string(L"SysFont", tl_x, tl_y, 32, 0xFFFFFF, L"Parrot OS");
    
    kernal_loop = true;
    task_create(0,kernal);
    
    task_start_first();
    
    return EFI_SUCCESS;
}