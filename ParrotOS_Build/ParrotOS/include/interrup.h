#ifndef _INTERRUPT_LIB_H_
#define _INTERRUPT_LIB_H_

#include <Uefi.h>
#include <Protocol/Cpu.h>

#if defined(MDE_CPU_X64)
  #define SYSTEM_CONTEXT_TYPE EFI_SYSTEM_CONTEXT_X64
  #define CTX_FIELD SystemContextX64
  #define REG_AX Rax
  #define REG_BX Rbx
  #define REG_CX Rcx
  #define REG_DX Rdx
  #define REG_R8 R8
  #define REG_R9 R9
  #define REG_R10 R10
  #define REG_R11 R11
#elif defined(MDE_CPU_IA32)
  #define SYSTEM_CONTEXT_TYPE EFI_SYSTEM_CONTEXT_IA32
  #define CTX_FIELD SystemContextIa32
  #define REG_AX Eax
  #define REG_CX Ecx
  #define REG_DX Edx
  #define REG_R8 Ebx 
  #define REG_R9 Esi
  #define REG_R10 Edi
  #define REG_R11 R11
#endif

typedef VOID (EFIAPI *MY_HANDLER_FUNC)(
  IN EFI_EXCEPTION_TYPE   InterruptType,
  IN EFI_SYSTEM_CONTEXT   SystemContext
  );

EFI_STATUS RegisterCustomHandler (IN UINT8 Vector, IN MY_HANDLER_FUNC HandlerFunc);
VOID TriggerInterrupt (IN UINT8 Vector, EFI_SYSTEM_CONTEXT_X64* ctx);

#endif