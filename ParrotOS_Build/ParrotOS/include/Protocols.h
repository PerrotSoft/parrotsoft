#ifndef PROTOCOLS_H
#define PROTOCOLS_H
#pragma once

#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Library/MemoryAllocationLib.h>
#include "../include/Vector.h"
#include "../include/task.h"
#include "../include/pex.h"

typedef struct {
    int32_t TaskID;    
    int32_t ProcessID;
} TASK_PROCESS_MAP;

extern Vector task_registry; 
extern Vector prs;   
extern int32_t current_task;   

static inline void INIT_PROTOCOLS() {
    if (task_registry._push == NULL) {
        VectorInit(&task_registry, 10);
    }
}

static inline struct Process* GetCurrentCallerProcess() {
    if (task_registry._push == NULL) INIT_PROTOCOLS();
    int32_t tid = current_task; 
    for (uint64_t i = 0; i < task_registry._cnt(&task_registry); i++) {
        TASK_PROCESS_MAP* map = (TASK_PROCESS_MAP*)task_registry._at(&task_registry, i);
        if (map != NULL && map->TaskID == tid) {
            return (struct Process*)prs.GetById(map->ProcessID);
        }
    }
    return NULL;
}
static inline BOOLEAN IFProcessHasRight(UINT8 right) {
    return (GetCurrentCallerProcess()->Rights <= right) != 0;
}
static inline void RegisterTaskToProcess(INT32 tid, INT32 pid) {
    if (task_registry._push == NULL) INIT_PROTOCOLS();
    TASK_PROCESS_MAP* map = AllocateZeroPool(sizeof(TASK_PROCESS_MAP));
    if (map == NULL) return;
    map->TaskID = tid;
    map->ProcessID = pid;
    task_registry._push(&task_registry, tid, map);
}

static inline void DeRegisterTaskToProcess(INT32 tid) {
    if (task_registry._push == NULL) INIT_PROTOCOLS();
    for (uint64_t i = 0; i < task_registry._cnt(&task_registry); i++) {
        TASK_PROCESS_MAP* map = (TASK_PROCESS_MAP*)task_registry._at(&task_registry, i);
        if (map != NULL && map->TaskID == tid) {
            FreePool(map);
            task_registry._rem(&task_registry, i);
            return;
        }
    }
}

#endif