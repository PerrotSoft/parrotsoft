#include <Uefi.h>
#include "DriverManager.h"

EFI_SIMPLE_TEXT_INPUT_PROTOCOL* GetKeyboard(EFI_SYSTEM_TABLE* SystemTable);
BOOLEAN Keyboard_HasKey(EFI_SYSTEM_TABLE* SystemTable);
CHAR16 Keyboard_GetKey(EFI_SYSTEM_TABLE* SystemTable);
VOID Keyboard_Reset(EFI_SYSTEM_TABLE* SystemTable);
VOID Keyboard_INIT(VOID);