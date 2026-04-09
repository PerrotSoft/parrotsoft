#include <Library/UefiBootServicesTableLib.h>
#include "../include/interrup.h"

EFI_STATUS RegisterCustomHandler(IN UINT8 Vector, IN MY_HANDLER_FUNC HandlerFunc)
{
    EFI_STATUS              Status;
    EFI_CPU_ARCH_PROTOCOL   *Cpu;

    Status = gBS->LocateProtocol(&gEfiCpuArchProtocolGuid, NULL, (VOID **)&Cpu);
    if (EFI_ERROR(Status)) return Status;
    Cpu->RegisterInterruptHandler(Cpu, Vector, NULL);
    if (HandlerFunc != NULL) {
        return Cpu->RegisterInterruptHandler(Cpu, Vector, (EFI_CPU_INTERRUPT_HANDLER)HandlerFunc);
    }

    return EFI_SUCCESS;
}
VOID TriggerInterrupt (IN UINT8 Vector, EFI_SYSTEM_CONTEXT_X64* ctx)
{
    if (ctx != NULL) {
#if defined(MDE_CPU_X64)
        asm volatile (
            "movq %0, %%rax\n"
            "movq %1, %%rbx\n"
            "movq %2, %%rcx\n"
            "movq %3, %%rdx\n"
            "movq %4, %%r8\n"
            "movq %5, %%r9\n"
            "movq %6, %%r10\n"
            :
            : "m"(ctx->Rax), "m"(ctx->Rbx), "m"(ctx->Rcx), "m"(ctx->Rdx), 
              "m"(ctx->R8), "m"(ctx->R9), "m"(ctx->R10)
            : "rax", "rbx", "rcx", "rdx", "r8", "r9", "r10"
        );
#elif defined(MDE_CPU_IA32)
        asm volatile (
            "movl %0, %%eax\n"
            "movl %1, %%ebx\n"
            "movl %2, %%ecx\n"
            "movl %3, %%edx\n"
            "movl %4, %%esi\n"
            "movl %5, %%edi\n"
            :
            : "m"(ctx->Eax), "m"(ctx->Ebx), "m"(ctx->Ecx), "m"(ctx->Edx),
              "m"(ctx->Esi), "m"(ctx->Edi)
            : "eax", "ebx", "ecx", "edx", "esi", "edi"
        );
#endif
    }
    switch (Vector) {
        case 0x0: __asm__ __volatile__ ("int $0x00"); break;
        case 0x1: __asm__ __volatile__ ("int $0x01"); break;
        case 0x2: __asm__ __volatile__ ("int $0x02"); break;
        case 0x3: __asm__ __volatile__ ("int $0x03"); break;
        case 0x4: __asm__ __volatile__ ("int $0x04"); break;
        case 0x5: __asm__ __volatile__ ("int $0x05"); break;
        case 0x6: __asm__ __volatile__ ("int $0x06"); break;
        case 0x7: __asm__ __volatile__ ("int $0x07"); break;
        case 0x8: __asm__ __volatile__ ("int $0x08"); break;
        case 0x9: __asm__ __volatile__ ("int $0x09"); break;
        case 0xA: __asm__ __volatile__ ("int $0x0A"); break;
        case 0xB: __asm__ __volatile__ ("int $0x0B"); break;
        case 0xC: __asm__ __volatile__ ("int $0x0C"); break;
        case 0xD: __asm__ __volatile__ ("int $0x0D"); break;
        case 0xE: __asm__ __volatile__ ("int $0x0E"); break;
        case 0xF: __asm__ __volatile__ ("int $0x0F"); break;
        case 0x10: __asm__ __volatile__ ("int $0x10"); break;
        case 0x11: __asm__ __volatile__ ("int $0x11"); break;
        case 0x12: __asm__ __volatile__ ("int $0x12"); break;
        case 0x13: __asm__ __volatile__ ("int $0x13"); break;
        case 0x14: __asm__ __volatile__ ("int $0x14"); break;
        case 0x15: __asm__ __volatile__ ("int $0x15"); break;
        case 0x16: __asm__ __volatile__ ("int $0x16"); break;
        case 0x17: __asm__ __volatile__ ("int $0x17"); break;
        case 0x18: __asm__ __volatile__ ("int $0x18"); break;
        case 0x19: __asm__ __volatile__ ("int $0x19"); break;
        case 0x1A: __asm__ __volatile__ ("int $0x1A"); break;
        case 0x1B: __asm__ __volatile__ ("int $0x1B"); break;
        case 0x1C: __asm__ __volatile__ ("int $0x1C"); break;
        case 0x1D: __asm__ __volatile__ ("int $0x1D"); break;
        case 0x1E: __asm__ __volatile__ ("int $0x1E"); break;
        case 0x1F: __asm__ __volatile__ ("int $0x1F"); break;
        case 0x20: __asm__ __volatile__ ("int $0x20"); break;
        case 0x21: __asm__ __volatile__ ("int $0x21"); break;
        case 0x22: __asm__ __volatile__ ("int $0x22"); break;
        case 0x23: __asm__ __volatile__ ("int $0x23"); break;
        case 0x24: __asm__ __volatile__ ("int $0x24"); break;
        case 0x25: __asm__ __volatile__ ("int $0x25"); break;
        case 0x26: __asm__ __volatile__ ("int $0x26"); break;
        case 0x27: __asm__ __volatile__ ("int $0x27"); break;
        case 0x28: __asm__ __volatile__ ("int $0x28"); break;
        case 0x29: __asm__ __volatile__ ("int $0x29"); break;
        case 0x2A: __asm__ __volatile__ ("int $0x2A"); break;
        case 0x2B: __asm__ __volatile__ ("int $0x2B"); break;
        case 0x2C: __asm__ __volatile__ ("int $0x2C"); break;
        case 0x2D: __asm__ __volatile__ ("int $0x2D"); break;
        case 0x2E: __asm__ __volatile__ ("int $0x2E"); break;
        case 0x2F: __asm__ __volatile__ ("int $0x2F"); break;
        case 0x30: __asm__ __volatile__ ("int $0x30"); break;
        case 0x31: __asm__ __volatile__ ("int $0x31"); break;
        case 0x32: __asm__ __volatile__ ("int $0x32"); break;
        case 0x33: __asm__ __volatile__ ("int $0x33"); break;
        case 0x34: __asm__ __volatile__ ("int $0x34"); break;
        case 0x35: __asm__ __volatile__ ("int $0x35"); break;
        case 0x36: __asm__ __volatile__ ("int $0x36"); break;
        case 0x37: __asm__ __volatile__ ("int $0x37"); break;
        case 0x38: __asm__ __volatile__ ("int $0x38"); break;
        case 0x39: __asm__ __volatile__ ("int $0x39"); break;
        case 0x3A: __asm__ __volatile__ ("int $0x3A"); break;
        case 0x3B: __asm__ __volatile__ ("int $0x3B"); break;
        case 0x3C: __asm__ __volatile__ ("int $0x3C"); break;
        case 0x3D: __asm__ __volatile__ ("int $0x3D"); break;
        case 0x3E: __asm__ __volatile__ ("int $0x3E"); break;
        case 0x3F: __asm__ __volatile__ ("int $0x3F"); break;
        case 0x40: __asm__ __volatile__ ("int $0x40"); break;
        case 0x41: __asm__ __volatile__ ("int $0x41"); break;
        case 0x42: __asm__ __volatile__ ("int $0x42"); break;
        case 0x43: __asm__ __volatile__ ("int $0x43"); break;
        case 0x44: __asm__ __volatile__ ("int $0x44"); break;
        case 0x45: __asm__ __volatile__ ("int $0x45 "); break;
        case 0x46: __asm__ __volatile__ ("int $0x46"); break;
        case 0x47: __asm__ __volatile__ ("int $0x47"); break;
        case 0x48: __asm__ __volatile__ ("int $0x48"); break;
        case 0x49: __asm__ __volatile__ ("int $0x49"); break;
        case 0x4A: __asm__ __volatile__ ("int $0x4A"); break;
        case 0x4B: __asm__ __volatile__ ("int $0x4B"); break;
        case 0x4C: __asm__ __volatile__ ("int $0x4C"); break;
        case 0x4D: __asm__ __volatile__ ("int $0x4D"); break;
        case 0x4E: __asm__ __volatile__ ("int $0x4E"); break;
        case 0x4F: __asm__ __volatile__ ("int $0x4F"); break;
        case 0x50: __asm__ __volatile__ ("int $0x50"); break;
        case 0x51: __asm__ __volatile__ ("int $0x51"); break;
        case 0x52: __asm__ __volatile__ ("int $0x52"); break;
        case 0x53: __asm__ __volatile__ ("int $0x53"); break;
        case 0x54: __asm__ __volatile__ ("int $0x54"); break;
        case 0x55: __asm__ __volatile__ ("int $0x55"); break;
        case 0x56: __asm__ __volatile__ ("int $0x56"); break;
        case 0x57: __asm__ __volatile__ ("int $0x57"); break;       
        case 0x58: __asm__ __volatile__ ("int $0x58"); break;
        case 0x59: __asm__ __volatile__ ("int $0x59"); break;
        case 0x5A: __asm__ __volatile__ ("int $0x5A"); break;
        case 0x5B: __asm__ __volatile__ ("int $0x5B"); break;
        case 0x5C: __asm__ __volatile__ ("int $0x5C"); break;
        case 0x5D: __asm__ __volatile__ ("int $0x5D"); break;
        case 0x5E: __asm__ __volatile__ ("int $0x5E"); break;
        case 0x5F: __asm__ __volatile__ ("int $0x5F"); break;
        case 0x60: __asm__ __volatile__ ("int $0x60"); break;
        case 0x61: __asm__ __volatile__ ("int $0x61"); break;
        case 0x62: __asm__ __volatile__ ("int $0x62"); break;
        case 0x63: __asm__ __volatile__ ("int $0x63"); break;
        case 0x64: __asm__ __volatile__ ("int $0x64"); break;
        case 0x65: __asm__ __volatile__ ("int $0x65"); break;
        case 0x66: __asm__ __volatile__ ("int $0x66"); break;
        case 0x67: __asm__ __volatile__ ("int $0x67"); break;
        case 0x68: __asm__ __volatile__ ("int $0x68"); break;       
        case 0x69: __asm__ __volatile__ ("int $0x69"); break;
        case 0x6A: __asm__ __volatile__ ("int $0x6A"); break;
        case 0x6B: __asm__ __volatile__ ("int $0x6B"); break;
        case 0x6C: __asm__ __volatile__ ("int $0x6C"); break;
        case 0x6D: __asm__ __volatile__ ("int $0x6D"); break;
        case 0x6E: __asm__ __volatile__ ("int $0x6E"); break;
        case 0x6F: __asm__ __volatile__ ("int $0x6F"); break;
        case 0x70: __asm__ __volatile__ ("int $0x70"); break;
        case 0x71: __asm__ __volatile__ ("int $0x71"); break;
        case 0x72: __asm__ __volatile__ ("int $0x72"); break;
        case 0x73: __asm__ __volatile__ ("int $0x73"); break;
        case 0x74: __asm__ __volatile__ ("int $0x74"); break;
        case 0x75: __asm__ __volatile__ ("int $0x75"); break;
        case 0x76: __asm__ __volatile__ ("int $0x76"); break;
        case 0x77: __asm__ __volatile__ ("int $0x77"); break;
        case 0x78: __asm__ __volatile__ ("int $0x78"); break;
        case 0x79: __asm__ __volatile__ ("int $0x79"); break;
        case 0x7A: __asm__ __volatile__ ("int $0x7A"); break;
        case 0x7B: __asm__ __volatile__ ("int $0x7B"); break;
        case 0x7C: __asm__ __volatile__ ("int $0x7C"); break;
        case 0x7D: __asm__ __volatile__ ("int $0x7D"); break;
        case 0x7E: __asm__ __volatile__ ("int $0x7E"); break;
        case 0x7F: __asm__ __volatile__ ("int $0x7F"); break;
        case 0x80: __asm__ __volatile__ ("int $0x80"); break;
        case 0x81: __asm__ __volatile__ ("int $0x81"); break;
        case 0x82: __asm__ __volatile__ ("int $0x82"); break;
        case 0x83: __asm__ __volatile__ ("int $0x83"); break;
        case 0x84: __asm__ __volatile__ ("int $0x84"); break;
        case 0x85: __asm__ __volatile__ ("int $0x85"); break;
        case 0x86: __asm__ __volatile__ ("int $0x86"); break;
        case 0x87: __asm__ __volatile__ ("int $0x87"); break;
        case 0x88: __asm__ __volatile__ ("int $0x88"); break;
        case 0x89: __asm__ __volatile__ ("int $0x89"); break;
        case 0x8A: __asm__ __volatile__ ("int $0x8A"); break;
        case 0x8B: __asm__ __volatile__ ("int $0x8B"); break;
        case 0x8C: __asm__ __volatile__ ("int $0x8C"); break;
        case 0x8D: __asm__ __volatile__ ("int $0x8D"); break;
        case 0x8E: __asm__ __volatile__ ("int $0x8E"); break;
        case 0x8F: __asm__ __volatile__ ("int $0x8F"); break;
        case 0x90: __asm__ __volatile__ ("int $0x90"); break;
        case 0x91: __asm__ __volatile__ ("int $0x91"); break;
        case 0x92: __asm__ __volatile__ ("int $0x92"); break;
        case 0x93: __asm__ __volatile__ ("int $0x93"); break;
        case 0x94: __asm__ __volatile__ ("int $0x94"); break;
        case 0x95: __asm__ __volatile__ ("int $0x95"); break;
        case 0x96: __asm__ __volatile__ ("int $0x96"); break;
        case 0x97: __asm__ __volatile__ ("int $0x97"); break;
        case 0x98: __asm__ __volatile__ ("int $0x98"); break;
        case 0x99: __asm__ __volatile__ ("int $0x99"); break;
        case 0x9A: __asm__ __volatile__ ("int $0x9A"); break;
        case 0x9B: __asm__ __volatile__ ("int $0x9B"); break;
        case 0x9C: __asm__ __volatile__ ("int $0x9C"); break;
        case 0x9D: __asm__ __volatile__ ("int $0x9D"); break;
        case 0x9E: __asm__ __volatile__ ("int $0x9E"); break;
        case 0x9F: __asm__ __volatile__ ("int $0x9F"); break;
        case 0xA0: __asm__ __volatile__ ("int $0xA0"); break;
        case 0xA1: __asm__ __volatile__ ("int $0xA1"); break;
        case 0xA2: __asm__ __volatile__ ("int $0xA2"); break;
        case 0xA3: __asm__ __volatile__ ("int $0xA3"); break;
        case 0xA4: __asm__ __volatile__ ("int $0xA4"); break;
        case 0xA5: __asm__ __volatile__ ("int $0xA5"); break;
        case 0xA6: __asm__ __volatile__ ("int $0xA6"); break;
        case 0xA7: __asm__ __volatile__ ("int $0xA7"); break;
        case 0xA8: __asm__ __volatile__ ("int $0xA8"); break;
        case 0xA9: __asm__ __volatile__ ("int $0xA9"); break;
        case 0xAA: __asm__ __volatile__ ("int $0xAA"); break;
        case 0xAB: __asm__ __volatile__ ("int $0xAB"); break;
        case 0xAC: __asm__ __volatile__ ("int $0xAC"); break;
        case 0xAD: __asm__ __volatile__ ("int $0xAD"); break;
        case 0xAE: __asm__ __volatile__ ("int $0xAE"); break;
        case 0xAF: __asm__ __volatile__ ("int $0xAF"); break;
        case 0xB0: __asm__ __volatile__ ("int $0xB0"); break;
        case 0xB1: __asm__ __volatile__ ("int $0xB1"); break;
        case 0xB2: __asm__ __volatile__ ("int $0xB2"); break;
        case 0xB3: __asm__ __volatile__ ("int $0xB3"); break;
        case 0xB4: __asm__ __volatile__ ("int $0xB4"); break;
        case 0xB5: __asm__ __volatile__ ("int $0xB5"); break;
        case 0xB6: __asm__ __volatile__ ("int $0xB6"); break;
        case 0xB7: __asm__ __volatile__ ("int $0xB7"); break;
        case 0xB8: __asm__ __volatile__ ("int $0xB8"); break;
        case 0xB9: __asm__ __volatile__ ("int $0xB9"); break;
        case 0xBA: __asm__ __volatile__ ("int $0xBA"); break;
        case 0xBB: __asm__ __volatile__ ("int $0xBB"); break;
        case 0xBC: __asm__ __volatile__ ("int $0xBC"); break;
        case 0xBD: __asm__ __volatile__ ("int $0xBD"); break;
        case 0xBE: __asm__ __volatile__ ("int $0xBE"); break;
        case 0xBF: __asm__ __volatile__ ("int $0xBF"); break;
        case 0xC0: __asm__ __volatile__ ("int $0xC0"); break;
        case 0xC1: __asm__ __volatile__ ("int $0xC1"); break;
        case 0xC2: __asm__ __volatile__ ("int $0xC2"); break;
        case 0xC3: __asm__ __volatile__ ("int $0xC3"); break;
        case 0xC4: __asm__ __volatile__ ("int $0xC4"); break;
        case 0xC5: __asm__ __volatile__ ("int $0xC5"); break;
        case 0xC6: __asm__ __volatile__ ("int $0xC6"); break;
        case 0xC7: __asm__ __volatile__ ("int $0xC7"); break;
        case 0xC8: __asm__ __volatile__ ("int $0xC8"); break;
        case 0xC9: __asm__ __volatile__ ("int $0xC9"); break;
        case 0xCA: __asm__ __volatile__ ("int $0xCA"); break;
        case 0xCB: __asm__ __volatile__ ("int $0xCB"); break;
        case 0xCC: __asm__ __volatile__ ("int $0xCC"); break;
        case 0xCD: __asm__ __volatile__ ("int $0xCD"); break;
        case 0xCE: __asm__ __volatile__ ("int $0xCE"); break;
        case 0xCF: __asm__ __volatile__ ("int $0xCF"); break;
        case 0xD0: __asm__ __volatile__ ("int $0xD0"); break;
        case 0xD1: __asm__ __volatile__ ("int $0xD1"); break;
        case 0xD2: __asm__ __volatile__ ("int $0xD2"); break;
        case 0xD3: __asm__ __volatile__ ("int $0xD3"); break;
        case 0xD4: __asm__ __volatile__ ("int $0xD4"); break;
        case 0xD5: __asm__ __volatile__ ("int $0xD5"); break;
        case 0xD6: __asm__ __volatile__ ("int $0xD6"); break;
        case 0xD7: __asm__ __volatile__ ("int $0xD7"); break;
        case 0xD8: __asm__ __volatile__ ("int $0xD8"); break;
        case 0xD9: __asm__ __volatile__ ("int $0xD9"); break;
        case 0xDA: __asm__ __volatile__ ("int $0xDA"); break;
        case 0xDB: __asm__ __volatile__ ("int $0xDB"); break;
        case 0xDC: __asm__ __volatile__ ("int $0xDC"); break;
        case 0xDD: __asm__ __volatile__ ("int $0xDD"); break;
        case 0xDE: __asm__ __volatile__ ("int $0xDE"); break;
        case 0xDF: __asm__ __volatile__ ("int $0xDF"); break;
        case 0xE0: __asm__ __volatile__ ("int $0xE0"); break;
        case 0xE1: __asm__ __volatile__ ("int $0xE1"); break;
        case 0xE2: __asm__ __volatile__ ("int $0xE2"); break;
        case 0xE3: __asm__ __volatile__ ("int $0xE3"); break;
        case 0xE4: __asm__ __volatile__ ("int $0xE4"); break;
        case 0xE5: __asm__ __volatile__ ("int $0xE5"); break;
        case 0xE6: __asm__ __volatile__ ("int $0xE6"); break;
        case 0xE7: __asm__ __volatile__ ("int $0xE7"); break;
        case 0xE8: __asm__ __volatile__ ("int $0xE8"); break;
        case 0xE9: __asm__ __volatile__ ("int $0xE9"); break;
        case 0xEA: __asm__ __volatile__ ("int $0xEA"); break;
        case 0xEB: __asm__ __volatile__ ("int $0xEB"); break;
        case 0xEC: __asm__ __volatile__ ("int $0xEC"); break;
        case 0xED: __asm__ __volatile__ ("int $0xED"); break;
        case 0xEE: __asm__ __volatile__ ("int $0xEE"); break;
        case 0xEF: __asm__ __volatile__ ("int $0xEF"); break;
        case 0xF0: __asm__ __volatile__ ("int $0xF0"); break;
        case 0xF1: __asm__ __volatile__ ("int $0xF1"); break;
        case 0xF2: __asm__ __volatile__ ("int $0xF2"); break;
        case 0xF3: __asm__ __volatile__ ("int $0xF3"); break;
        case 0xF4: __asm__ __volatile__ ("int $0xF4"); break;
        case 0xF5: __asm__ __volatile__ ("int $0xF5"); break;
        case 0xF6: __asm__ __volatile__ ("int $0xF6"); break;
        case 0xF7: __asm__ __volatile__ ("int $0xF7"); break;
        case 0xF8: __asm__ __volatile__ ("int $0xF8"); break;
        case 0xF9: __asm__ __volatile__ ("int $0xF9"); break;
        case 0xFA: __asm__ __volatile__ ("int $0xFA"); break;
        case 0xFB: __asm__ __volatile__ ("int $0xFB"); break;
        case 0xFC: __asm__ __volatile__ ("int $0xFC"); break;
        case 0xFD: __asm__ __volatile__ ("int $0xFD"); break;
        case 0xFE: __asm__ __volatile__ ("int $0xFE"); break;
        case 0xFF: __asm__ __volatile__ ("int $0xFF"); break;
    }
}