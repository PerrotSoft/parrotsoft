#ifndef _FONT_H_
#define _FONT_H_

#define STBTT_malloc(x,u)  AllocatePool(x)
#define STBTT_free(x,u)    FreePool(x)
#define STBTT_assert(x)    
#include <Library/UefiLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/BaseLib.h>
// Математические заглушки (библиотеке нужны функции для вычисления кривых)
#define pow(x,y)           pow_uefi(x,y) 
#define sqrt(x)            sqrt_uefi(x)

#define MAX_FONTS 10

typedef struct {
    CHAR16  name[32]; // Используем CHAR16 для имен шрифтов
    UINT8   *data;
    UINT32  size;
    BOOLEAN is_ttf;
    BOOLEAN loaded;
} font_t;
typedef enum {
    FONT_TYPE_BITMAP, // 8x16 сырые данные
    FONT_TYPE_PSF,    // Linux PC Screen Font
    FONT_TYPE_TTF,    // TrueType / OpenType
} FONT_FORMAT;
VOID font_init(VOID);

INT32 font_load_custom(
    const CHAR16* name, 
    UINT8* data, 
    UINT32        size, 
    BOOLEAN       is_ttf
    );

INT32 font_load_from_disk(
    CHAR16* path, 
    const CHAR16* internal_name
    );

VOID font_draw_char(
    const CHAR16* font_name, 
    INT32         x, 
    INT32         y, 
    INT32         size, 
    UINT32        color, 
    CHAR16        c
    );

VOID font_draw_string(
    const CHAR16* font_name, 
    INT32         x, 
    INT32         y, 
    INT32         size, 
    UINT32        color, 
    const CHAR16* str
    );

#endif