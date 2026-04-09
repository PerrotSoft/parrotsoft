#pragma once
#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/MemoryAllocationLib.h>
#include <string.h>
#include "drivers/Video_Driver.h"

#pragma pack(push,1)
typedef struct {
    UINT16 bfType;
    UINT32 bfSize;
    UINT16 bfReserved1;
    UINT16 bfReserved2;
    UINT32 bfOffBits;
} BMP_FILEHEADER;

typedef struct {
    UINT32 biSize;
    INT32  biWidth;
    INT32  biHeight;
    UINT16 biPlanes;
    UINT16 biBitCount;
    UINT32 biCompression;
    UINT32 biSizeImage;
    INT32  biXPelsPerMeter;
    INT32  biYPelsPerMeter;
    UINT32 biClrUsed;
    UINT32 biClrImportant;
} BMP_INFOHEADER;
#pragma pack(pop)

#define BI_RGB 0
#define BMP_ERROR_INCOMPATIBLE EFI_UNSUPPORTED

static inline EFI_STATUS bmp_fail(const CHAR16 *msg, EFI_STATUS code) {
    Print(L"[BMP] %s (code=%r)\n", msg, code);
    return code;
}

static EFI_STATUS check_bmp_compatibility(const BMP_FILEHEADER *fh, const BMP_INFOHEADER *ih, UINTN size) {
    if (!fh || !ih) return BMP_ERROR_INCOMPATIBLE;
    if (fh->bfType != 0x4D42) return BMP_ERROR_INCOMPATIBLE;
    if (ih->biPlanes != 1) return BMP_ERROR_INCOMPATIBLE;
    if (ih->biBitCount != 24 && ih->biBitCount != 32) return BMP_ERROR_INCOMPATIBLE;
    if (ih->biCompression != BI_RGB) return BMP_ERROR_INCOMPATIBLE;

    UINT32 width = (UINT32)ih->biWidth;
    UINT32 height = (UINT32)(ih->biHeight < 0 ? -ih->biHeight : ih->biHeight);
    UINT32 bpp = ih->biBitCount / 8;
    UINT32 row_stride = ((width * bpp + 3) / 4) * 4;
    if (fh->bfOffBits + row_stride * height > size) return BMP_ERROR_INCOMPATIBLE;

    return EFI_SUCCESS;
}
EFI_STATUS draw_bmp_from_memory_safe(const UINT8 *data, UINTN size, INT32 x0, INT32 y0) {
    if (!data || size < sizeof(BMP_FILEHEADER) + sizeof(BMP_INFOHEADER))
        return bmp_fail(L"Buffer too small", EFI_INVALID_PARAMETER);

    BMP_FILEHEADER fh;
    BMP_INFOHEADER ih;
    memcpy(&fh, data, sizeof(fh));
    memcpy(&ih, data + sizeof(fh), sizeof(ih));

    EFI_STATUS compat = check_bmp_compatibility(&fh, &ih, size);
    if (EFI_ERROR(compat)) return bmp_fail(L"Incompatible BMP file", compat);

    INT32 bmp_w = ih.biWidth;
    INT32 bmp_h = ih.biHeight;
    BOOLEAN top_down = bmp_h < 0;
    UINT32 abs_w = (UINT32)bmp_w;
    UINT32 abs_h = (UINT32)(top_down ? -bmp_h : bmp_h);

    UINT32 bpp_bytes = ih.biBitCount / 8;
    UINT64 row_stride = ((UINT64)abs_w * bpp_bytes + 3) & ~3ULL;
    const UINT8 *pixels = data + fh.bfOffBits;

    VideoMode* current_vmode = GET_CURRENT_VMODE();
    INT32 screen_w = (INT32)current_vmode->width;
    INT32 screen_h = (INT32)current_vmode->height;

    INT32 draw_x0 = x0 < 0 ? 0 : x0;
    INT32 draw_y0 = y0 < 0 ? 0 : y0;

    INT32 src_x0 = x0 < 0 ? -x0 : 0;
    INT32 src_y0 = y0 < 0 ? -y0 : 0;

    INT32 draw_w = abs_w - src_x0;
    INT32 draw_h = abs_h - src_y0;
    if (draw_x0 + draw_w > screen_w) draw_w = screen_w - draw_x0;
    if (draw_y0 + draw_h > screen_h) draw_h = screen_h - draw_y0;

    if (draw_w <= 0 || draw_h <= 0) return EFI_SUCCESS;

    UINT32 *buf = AllocatePool(draw_w * draw_h * sizeof(UINT32));
    if (!buf) return bmp_fail(L"Cannot allocate buffer", EFI_OUT_OF_RESOURCES);

    for (INT32 yy = 0; yy < draw_h; yy++) {
        UINT32 src_row = top_down ? (src_y0 + yy) : (abs_h - 1 - (src_y0 + yy));
        const UINT8 *row_ptr = pixels + src_row * row_stride + src_x0 * bpp_bytes;
        for (INT32 xx = 0; xx < draw_w; xx++) {
            const UINT8 *p = row_ptr + xx * bpp_bytes;
            UINT32 r = p[2], g = p[1], b = p[0];
            buf[yy * draw_w + xx] = (r << 16) | (g << 8) | b;
        }
    }

    DRAW_BITMAP32(buf, draw_w, draw_h, draw_x0, draw_y0);
    FreePool(buf);
    return EFI_SUCCESS;
}