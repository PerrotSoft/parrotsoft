#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Protocol/SimplePointer.h>
#include "../include/drivers/Mausedrv.h"
#include "../include/drivers/Video_Driver.h"
#include "../include/drivers/DriverManager.h"

static EFI_SIMPLE_POINTER_PROTOCOL *gMouse = NULL;
static INT32 gPosX = 0;
static INT32 gPosY = 0;
static VideoMode* vmode_mouse = NULL;

EFI_STATUS MouseInit(VOID) {
    EFI_STATUS Status;

    Status = gBS->LocateProtocol(&gEfiSimplePointerProtocolGuid, NULL, (VOID**)&gMouse);
    if (EFI_ERROR(Status)) {
        return Status;
    }

    Status = gMouse->Reset(gMouse, TRUE);
    if (EFI_ERROR(Status)) {
        return Status;
    }

    vmode_mouse = GET_CURRENT_VMODE();
    if (vmode_mouse != NULL) {
        gPosX = (INT32)vmode_mouse->width / 2;
        gPosY = (INT32)vmode_mouse->height / 2;
    }

    return EFI_SUCCESS;
}

EFI_STATUS MouseGetState(INT32 *x, INT32 *y, BOOLEAN *lb, BOOLEAN *rb) {
    if (gMouse == NULL) return EFI_NOT_READY;

    EFI_SIMPLE_POINTER_STATE State;
    EFI_STATUS Status = gMouse->GetState(gMouse, &State);

    if (!EFI_ERROR(Status)) {
        gPosX += State.RelativeMovementX / 2;
        gPosY += State.RelativeMovementY / 2;

        if (vmode_mouse != NULL) {
            if (gPosX < 0) gPosX = 0;
            if (gPosY < 0) gPosY = 0;
            if (gPosX >= (INT32)vmode_mouse->width) gPosX = (INT32)vmode_mouse->width - 1;
            if (gPosY >= (INT32)vmode_mouse->height) gPosY = (INT32)vmode_mouse->height - 1;
        }

        if (x) *x = gPosX;
        if (y) *y = gPosY;
        if (lb) *lb = State.LeftButton;
        if (rb) *rb = State.RightButton;
        
        return EFI_SUCCESS;
    }

    return Status;
}

VOID RegisterMouseDriver(VOID) {
    EFI_STATUS Status = MouseInit();
    
    if (EFI_ERROR(Status)) {
        return;
    }
    
    static MOUSE_DRIVER_IF mouse_if = {
        .Init = MouseInit,
        .GetState = MouseGetState
    };

    DRIVER mouse_driver;
    mouse_driver.Type = DRIVER_TYPE_MOUSE;
    mouse_driver.Priority = 5;
    mouse_driver.Interface = &mouse_if;

    RegisterDriver(&mouse_driver);
}