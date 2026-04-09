#ifndef _TASK_H_
#define _TASK_H_

#include <Uefi.h>

#define MAX_TASKS 100
#define STACK_SIZE 16384

#pragma pack(push, 1)
typedef struct {
    VOID    *sp; 
    VOID    *stack_limit;
    VOID    *storage;
    BOOLEAN active;
    UINT8   padding[7]; 
} task_t;
#pragma pack(pop)

extern task_t tasks[MAX_TASKS];
extern INT32  current_task;
extern VOID   *uefi_stack_save;

VOID init_scheduler(VOID); 
EFI_STATUS task_create(INT32 id, VOID (*entry)(VOID));
EFI_STATUS task_create_with_arg(INT32 id, VOID (*entry)(VOID*), VOID* arg);
VOID task_yield(VOID);
VOID task_exit(VOID);
VOID task_exitx(INT32 id);
VOID task_stop_and_run(INT32 id);
VOID task_start_first(VOID);

#endif