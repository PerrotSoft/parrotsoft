#include "../include/font.h"
#include "../include/drivers/DriverManager.h"
#include <Library/BaseMemoryLib.h>
#include <Library/MemoryAllocationLib.h>

double sqrt_uefi(double x) {
    if (x < 0) return 0;
    double z = 1.0;
    for (int i = 0; i < 10; i++) z -= (z * z - x) / (2 * z);
    return z;
}

double fabs(double x) { return (x < 0) ? -x : x; }
double floor(double x) { 
    long long i = (long long)x;
    return (x < i) ? (double)(i - 1) : (double)i; 
}
double ceil(double x) { 
    long long i = (long long)x;
    return (x > i) ? (double)(i + 1) : (double)i; 
}

#define STBTT_ifloor(x)   ((int)floor(x))
#define STBTT_iceil(x)    ((int)ceil(x))
#define STBTT_sqrt(x)     sqrt_uefi(x)
#define STBTT_fabs(x)     fabs(x)
#define STBTT_malloc(x,u) AllocatePool(x)
#define STBTT_free(x,u)   FreePool(x)

#define STB_TRUETYPE_IMPLEMENTATION
#include "../include/stb_truetype.h"

static font_t font_library[MAX_FONTS];
static INT32 fonts_count = 0;
static stbtt_fontinfo ttf_info[MAX_FONTS];

VOID font_init(VOID) {
    fonts_count = 0;
    for(INT32 i = 0; i < MAX_FONTS; i++) {
        font_library[i].loaded = FALSE;
    }
}

INT32 font_load_custom(const CHAR16* name, UINT8* data, UINT32 size, BOOLEAN is_ttf) {
    if (fonts_count >= MAX_FONTS) return -1;
    
    INT32 id = fonts_count++;
    
    INT32 i = 0;
    for(i = 0; i < 31 && name[i]; i++) font_library[id].name[i] = name[i];
    font_library[id].name[i] = L'\0';
    
    font_library[id].data = data;
    font_library[id].size = size;
    font_library[id].is_ttf = is_ttf;

    if (is_ttf) {
        if (!stbtt_InitFont(&ttf_info[id], data, 0)) {
            fonts_count--;
            return -1;
        }
    }

    font_library[id].loaded = TRUE;
    return id;
}

INT32 font_load_from_disk(CHAR16* path, const CHAR16* internal_name) {
    EC16 file_out;
    EFI_STATUS status = ReadFileByPath(path, &file_out);
    
    if (status == EFI_SUCCESS) {
        return font_load_custom(internal_name, (UINT8*)file_out.Message, (UINT32)file_out.FileSize, TRUE);
    }
    return -1;
}

static INT32 font_draw_char_internal(font_t* f, INT32 f_id, INT32 x, INT32 y, INT32 size, UINT32 color, CHAR16 c) {
    if (f->is_ttf) {
        float scale = stbtt_ScaleForPixelHeight(&ttf_info[f_id], (float)size);
        int advance, lsb;
        stbtt_GetCodepointHMetrics(&ttf_info[f_id], c, &advance, &lsb);
        
        int x0, y0, x1, y1;
        stbtt_GetCodepointBitmapBox(&ttf_info[f_id], c, scale, scale, &x0, &y0, &x1, &y1);
        
        int width = x1 - x0, height = y1 - y0;
        unsigned char* bitmap = stbtt_GetCodepointBitmap(&ttf_info[f_id], 0, scale, c, &width, &height, 0, 0);

        if (bitmap) {
            for (INT32 iy = 0; iy < height; iy++) {
                for (INT32 ix = 0; ix < width; ix++) {
                    UINT8 alpha = bitmap[iy * width + ix];
                    if (alpha == 0) continue;

                    INT32 px = x + x0 + ix;
                    INT32 py = y + y0 + iy;

                    if (alpha == 255) {
                        PUT_PIXEL(px, py, color);
                    } else {
                        // Получаем цвет фона через системный интерфейс
                        UINT32 bg = GET_PIXEL(px, py);

                        // Каналы шрифта
                        UINT8 rf = (UINT8)((color >> 16) & 0xFF);
                        UINT8 gf = (UINT8)((color >> 8) & 0xFF);
                        UINT8 bf = (UINT8)(color & 0xFF);

                        // Каналы фона
                        UINT8 rb = (UINT8)((bg >> 16) & 0xFF);
                        UINT8 gb = (UINT8)((bg >> 8) & 0xFF);
                        UINT8 bb = (UINT8)(bg & 0xFF);

                        // Alpha Blending
                        UINT8 r = (UINT8)((rf * alpha + rb * (255 - alpha)) / 255);
                        UINT8 g = (UINT8)((gf * alpha + gb * (255 - alpha)) / 255);
                        UINT8 b = (UINT8)((bf * alpha + bb * (255 - alpha)) / 255);

                        PUT_PIXEL(px, py, (UINT32)((r << 16) | (g << 8) | b));
                    }
                }
            }
            FreePool(bitmap);
        }
        return (INT32)(advance * scale);
    } else {
        for(int i = 0; i < 16; i++) {
            UINT8 row = f->data[c * 16 + i];
            for(int j = 0; j < 8; j++) {
                if(row & (0x80 >> j)) PUT_PIXEL(x + j, y + i, color);
            }
        }
        return 8;
    }
}

VOID font_draw_string(const CHAR16* font_name, INT32 x, INT32 y, INT32 size, UINT32 color, const CHAR16* str) {
    font_t* f = NULL;
    INT32 f_id = -1;
    for (INT32 i = 0; i < fonts_count; i++) {
        if (StrCmp(font_name, font_library[i].name) == 0) { f = &font_library[i]; f_id = i; break; }
    }

    if (!f || !f->loaded) return;

    INT32 cur_x = x;
    INT32 baseline_y = y;
    if (f->is_ttf) {
        int ascent, descent, lineGap;
        stbtt_GetFontVMetrics(&ttf_info[f_id], &ascent, &descent, &lineGap);
        float scale = stbtt_ScaleForPixelHeight(&ttf_info[f_id], (float)size);
        baseline_y += (INT32)(ascent * scale);
    }

    while (*str) {
        cur_x += font_draw_char_internal(f, f_id, cur_x, baseline_y, size, color, *str);
        str++;
    }
}
VOID font_draw_char(const CHAR16* font_name, INT32 x, INT32 y, INT32 size, UINT32 color, CHAR16 c) {
    font_t* f = NULL;
    INT32 f_id = -1;
    for (INT32 i = 0; i < fonts_count; i++) {
        if (StrCmp(font_name, font_library[i].name) == 0) { 
            f = &font_library[i]; 
            f_id = i; 
            break; 
        }
    }

    if (!f || !f->loaded) return;

    INT32 baseline_y = y;
    if (f->is_ttf) {
        int ascent, descent, lineGap;
        stbtt_GetFontVMetrics(&ttf_info[f_id], &ascent, &descent, &lineGap);
        float scale = stbtt_ScaleForPixelHeight(&ttf_info[f_id], (float)size);
        baseline_y += (INT32)(ascent * scale);
    }

    font_draw_char_internal(f, f_id, x, baseline_y, size, color, c);
}