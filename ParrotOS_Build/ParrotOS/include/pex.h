#ifndef PEX_H
#define PEX_H

#include <Uefi.h>
#include "../include/Vector.h"

#define Min_Process 10

struct Process { 
    INT32 ID;
    const CHAR16* Name;
    UINT8 Rights;
    VOID* ArgContext; 
    VOID* storage;
    BOOLEAN active;
    INT32 ParentID;
};

void       ProcessManagerInit();
EFI_STATUS LoadAndStartPex(CHAR16* Path, struct Process init_data);
UINT8      Process_Exit(INT32 ID);
struct Process* GetTaskById(INT32 ID);
void       TaskStop(INT32 ID);

#endif