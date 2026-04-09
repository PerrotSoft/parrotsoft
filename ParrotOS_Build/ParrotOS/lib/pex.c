#include "../include/pex.h"
#include "../include/task.h"
#include <Library/UefiBootServicesTableLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/BaseMemoryLib.h>
#include "../include/drivers/DriverManager.h"
#include "../include/Vector.h"
#include "../include/Protocols.h"

Vector prs;
Vector task_registry;
void ProcessManagerInit() {
    VectorInit(&prs, Min_Process);
    INIT_PROTOCOLS();
}

struct Process* GetTaskById(INT32 ID) {
    return (struct Process*)prs.GetById(ID);
}

void TaskStop(INT32 ID) {
    task_stop_and_run(ID);
    struct Process* p = (struct Process*)prs.GetById(ID);
    if (p != NULL) {
        p->active = !p->active;
    }
}

UINT8 Process_Exit(INT32 ID) {
    struct Process* pr = GetTaskById(ID);
    if (!pr) return 0;
    task_exitx(ID);

    if (pr->storage) {
        gBS->FreePool(pr->storage);
    }
    DeRegisterTaskToProcess(ID);
    prs.Remove(ID);
    gBS->FreePool(pr);
    
    return 1;
}

INT32 FindFreeTaskSlot(VOID) {
    for (INT32 i = 1; i < MAX_TASKS; i++) {
        if (!tasks[i].active) {
            return i;
        }
    }
    return -1; 
}

EFI_STATUS LoadAndStartPex(CHAR16* Path, struct Process init_data) {
    EFI_STATUS Status;
    EC16 e;
    struct Process* pr = NULL;

    if (prs._push == NULL) ProcessManagerInit();

    Status = ReadFileByPath(Path, &e);
    if (EFI_ERROR(Status)) return Status;

    Status = gBS->AllocatePool(EfiLoaderData, sizeof(struct Process), (VOID**)&pr);
    if (EFI_ERROR(Status)) {
        gBS->FreePool(e.Message);
        return Status;
    }
    
    gBS->CopyMem(pr, &init_data, sizeof(struct Process));

    INT32 id = FindFreeTaskSlot();
    if (id == -1) {
        gBS->FreePool(e.Message);
        gBS->FreePool(pr);
        return EFI_OUT_OF_RESOURCES;
    }

    pr->ID = id;
    pr->storage = e.Message;
    pr->active = TRUE;

    struct Process* caller = GetCurrentCallerProcess();
    if (caller != NULL) {
        pr->ParentID = caller->ID;
    } else {
        pr->ParentID = 0;
    }

    RegisterTaskToProcess(id, pr->ID);
    prs.Push(id, pr);

    Status = task_create_with_arg(id, (VOID (*)(VOID*))e.Message, pr);
    
    if (EFI_ERROR(Status)) {
        Process_Exit(id);
        return Status;
    }

    return EFI_SUCCESS;
}