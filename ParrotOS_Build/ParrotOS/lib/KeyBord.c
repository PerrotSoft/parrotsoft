#include <Uefi.h>
#include "../include/drivers/Keybord.h"
#include "../include/drivers/DriverManager.h"
static KEY_DRIVER_IF KeyboardInterface = {
    .HasKey = Keyboard_HasKey,
    .GetKey = Keyboard_GetKey,
    .Reset  = Keyboard_Reset
};

static DRIVER KeyboardDriver = {
    .Type = DRIVER_TYPE_KEYBOARD,
    .Priority = 10,
    .Interface = &KeyboardInterface
};

EFI_SIMPLE_TEXT_INPUT_PROTOCOL* GetKeyboard(EFI_SYSTEM_TABLE* SystemTable) {
    if (!SystemTable || !SystemTable->ConIn) return NULL;
    return SystemTable->ConIn;
}

BOOLEAN Keyboard_HasKey(EFI_SYSTEM_TABLE* SystemTable) {
    EFI_SIMPLE_TEXT_INPUT_PROTOCOL* Keyboard = GetKeyboard(SystemTable);
    if (!Keyboard) return FALSE;
    return (SystemTable->BootServices->CheckEvent(Keyboard->WaitForKey) == EFI_SUCCESS);
}

CHAR16 Keyboard_GetKey(EFI_SYSTEM_TABLE* SystemTable) {
    EFI_SIMPLE_TEXT_INPUT_PROTOCOL* Keyboard = GetKeyboard(SystemTable);
    if (!Keyboard) return 0;
    EFI_INPUT_KEY Key;
    while (SystemTable->BootServices->CheckEvent(Keyboard->WaitForKey) != EFI_SUCCESS) {
        SystemTable->BootServices->Stall(10);
    }
    if (Keyboard->ReadKeyStroke(Keyboard, &Key) == EFI_SUCCESS) {
        return (Key.UnicodeChar != 0) ? Key.UnicodeChar : (CHAR16)(Key.ScanCode + 0xFF00);
    }
    return 0;
}

VOID Keyboard_Reset(EFI_SYSTEM_TABLE* SystemTable) {
    EFI_SIMPLE_TEXT_INPUT_PROTOCOL* Keyboard = GetKeyboard(SystemTable);
    if (Keyboard) {
        Keyboard->Reset(Keyboard, TRUE);
        SystemTable->BootServices->Stall(200000);
    }
}

VOID Keyboard_INIT(VOID) {
    RegisterDriver(&KeyboardDriver);
}