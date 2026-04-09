#pragma once
#include <Uefi.h>
#include <Protocol/GraphicsOutput.h>
#include "DriverManager.h"

extern VideoMode vmode;

EFI_STATUS init_gop_driver(EFI_SYSTEM_TABLE *SystemTable);
void scroll_screen_up(int speed_scroll);
void put_pixel(INT32 x, INT32 y, UINT32 rgb24);
void draw_line(INT32 x0, INT32 y0, INT32 x1, INT32 y1, UINT32 rgb24);
void clear_screen(UINT32 rgb24);
void fill_rect(INT32 x, INT32 y, INT32 w, INT32 h, UINT32 rgb24);
void draw_bitmap32(const UINT32* bmp, INT32 bmp_w, INT32 bmp_h, INT32 x0, INT32 y0);
VOID init_vd(VOID);
VideoMode* get_current_vmode(VOID);
UINT32 get_pixel(INT32 x, INT32 y);