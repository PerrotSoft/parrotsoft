#include <Uefi.h>
#include <Library/BaseLib.h>
#include <Library/UefiRuntimeServicesTableLib.h>
#include <Library/PrintLib.h>
#include <Library/MemoryAllocationLib.h>
#include "include/drivers/DriverManager.h"
// Сообщаем компилятору, что эта переменная живет где-то в основном ParrotOS.c
extern CHAR16* StartFile; 

VOID* Split(const CHAR16* str, CHAR16 delimiter) {
    UINTN count = 1;
    for (const CHAR16* p = str; *p; p++) {
        if (*p == delimiter) count++;
    }

    CHAR16** result = (CHAR16**)AllocatePool(count * sizeof(CHAR16*));
    if (!result) return NULL;

    UINTN index = 0;
    const CHAR16* start = str;
    for (const CHAR16* p = str; ; p++) {
        if (*p == delimiter || *p == L'\0') {
            UINTN len = p - start;
            result[index] = (CHAR16*)AllocatePool((len + 1) * sizeof(CHAR16));
            if (!result[index]) {
                for (UINTN j = 0; j < index; j++) FreePool(result[j]);
                FreePool(result);
                return NULL;
            }
            // Правильный вызов StrnCpyS: (Назначение, Макс_размер, Источник, Сколько_копировать)
            StrnCpyS(result[index], len + 1, start, len);
            result[index][len] = L'\0';
            index++;
            start = p + 1;
        }
        if (*p == L'\0') break;
    }
    return result;
}
void init_boot() {
    EC16 file;
    if(FileExists(L"\\EFI\\bootcfg.cfg")) {
        EFI_STATUS Status = ReadFileByPath(L"\\EFI\\bootcfg.cfg", &file);
        
        if (EFI_ERROR(Status) || file.Message == NULL) {
            StartFile = L"start.pex";
            WriteFile(L"\\EFI\\bootcfg.cfg", (UINT16*)L"StartFile=start.pex\nWidth=1280\nHeight=720\nDrivers=\n", 100);
            return;
        }

        CHAR16* content = (CHAR16*)file.Message;
        CHAR16* line = content;
        UINT32 ConfigWidth = 0;
        UINT32 ConfigHeight = 0;

        while (*line) {
            while (*line == L' ' || *line == L'\r') line++;
            if (*line == L'\0') break;

            if (StrnCmp(line, L"StartFile=", 10) == 0) {
                CHAR16* val = line + 10;
                UINTN len = 0;
                while (val[len] && val[len] != L'\n' && val[len] != L'\r') len++;
                StartFile = AllocatePool((len + 1) * sizeof(CHAR16));
                if (StartFile) {
                    StrnCpyS(StartFile, len + 1, val, len);
                    StartFile[len] = L'\0';
                }
            } 
            else if (StrnCmp(line, L"Width=", 6) == 0) {
                ConfigWidth = (UINT32)StrDecimalToUintn(line + 6);
            }
            else if (StrnCmp(line, L"Height=", 7) == 0) {
                ConfigHeight = (UINT32)StrDecimalToUintn(line + 7);
            }
            else if (StrnCmp(line, L"Drivers=", 8) == 0) {
                CHAR16* driver_list_start = line + 8;
                UINTN len = 0;
                while (driver_list_start[len] && driver_list_start[len] != L'\n' && driver_list_start[len] != L'\r') len++;
                
                if (len > 0) {
                    CHAR16* temp_list = AllocatePool((len + 1) * sizeof(CHAR16));
                    if (temp_list) {
                        StrnCpyS(temp_list, len + 1, driver_list_start, len);
                        temp_list[len] = L'\0';

                        CHAR16** drivers_names = Split(temp_list, L',');
                        if (drivers_names) {
                            for (UINTN i = 0; drivers_names[i] != NULL; i++) {
                                struct Process p;
                                p.Name = drivers_names[i];
                                p.ArgContext = NULL;
                                p.Rights = 0;
                                p.active = TRUE;
                                p.ParentID = 0;
                                
                                LoadAndStartPex(drivers_names[i], p);
                                FreePool(drivers_names[i]);
                            }
                            FreePool(drivers_names);
                        }
                        FreePool(temp_list);
                    }
                }
            }

            while (*line && *line != L'\n') line++;
            if (*line == L'\n') line++;
        }

        if (ConfigWidth != 0 && ConfigHeight != 0) {
            SetVideoMode(ConfigWidth, ConfigHeight);
            vmode.width = ConfigWidth;
            vmode.height = ConfigHeight;
        }
        
        if (file.Message) {
            gBS->FreePool(file.Message);
        }
    } else {
        StartFile = L"start.pex";
        WriteFile(L"\\EFI\\bootcfg.cfg", (UINT16*)L"StartFile=start.pex\nWidth=1280\nHeight=720\nDrivers=\n", 100);
    }
}