#include "ParrotOS_API.h"
#include "console.h"
#include "console.c"
#include "cmd.h"

void StdioHandler(uint64_t Type, void* Context) {
    EFI_SYSTEM_CONTEXT_X64* ctx = (EFI_SYSTEM_CONTEXT_X64*)Context;
    uint32_t syscall_num = (uint32_t)ctx->rax;

    switch (syscall_num) {
        case 0x01: 
            PrintChar((CHAR16)ctx->rcx, (uint32_t)ctx->rdx, (uint32_t)ctx->r8);
            break;
        case 0x02: 
            PrintString((const CHAR16*)ctx->rcx, (uint32_t)ctx->rdx, (uint32_t)ctx->r8);
            break;
        case 0x03: 
            ConsoleClear();
            break;
    }
    RenderConsole();
}
void main(struct Process* pr) {
    GfxLoadFont((CHAR16*)L"Ubuntu.ttf", (CHAR16*)L"Ubuntu");
    GfxSetFont((CHAR16*)L"Ubuntu");
    SysRegisterHandler(0x80, (void*)StdioHandler);
    ConsoleClear();

    while (1) {
        Cmd();
    }
}