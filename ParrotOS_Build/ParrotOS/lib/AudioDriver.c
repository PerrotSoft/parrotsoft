#include <Library/UefiBootServicesTableLib.h>
#include "../include/drivers/DriverManager.h"
#include "../include/drivers/Audiodrv.h"

typedef struct _EFI_AUDIO_IO_PROTOCOL EFI_AUDIO_IO_PROTOCOL;

typedef EFI_STATUS (EFIAPI *EFI_AUDIO_IO_PROTOCOL_PLAYBACK)(
    IN EFI_AUDIO_IO_PROTOCOL *This,
    IN VOID                  *Buffer,
    IN UINTN                 Size,
    IN UINTN                 LoopCount
);

struct _EFI_AUDIO_IO_PROTOCOL {
    EFI_AUDIO_IO_PROTOCOL_PLAYBACK Playback;
};

static inline void outb(UINT16 port, UINT8 val) {
    __asm__ volatile ("outb %0, %1" : : "a"(val), "Nd"(port));
}

static inline UINT8 inb(UINT16 port) {
    UINT8 ret;
    __asm__ volatile ("inb %1, %0" : "=a"(ret) : "Nd"(port));
    return ret;
}

VOID AudioBeepImp(UINT32 Freq, UINT32 DurationMs) {
    if (Freq == 0) return;
    UINT32 Div = 1193180 / Freq;
    outb(0x43, 0xB6);
    outb(0x42, (UINT8)(Div & 0xFF));
    outb(0x42, (UINT8)((Div >> 8) & 0xFF));
    UINT8 tmp = inb(0x61);
    if (tmp != (tmp | 3)) outb(0x61, tmp | 3);
    
    if (gBS) gBS->Stall(DurationMs * 1000);

    outb(0x61, inb(0x61) & 0xFC);
}

static EFI_AUDIO_IO_PROTOCOL *AudioProt = NULL;
static EFI_GUID gEfiAudioIoGuid = { 0xF446EA0D, 0x6148, 0x4A4D, { 0x97, 0xCD, 0x99, 0xD8, 0x05, 0x98, 0x5E, 0x35 } };

EFI_STATUS DriverPlayRaw(UINT8 *Buffer, UINTN Size) {
    if (!AudioProt) return EFI_UNSUPPORTED;
    return AudioProt->Playback(AudioProt, Buffer, Size, 0);
}

VOID InitSimpleAudio() {
    gBS->LocateProtocol(&gEfiAudioIoGuid, NULL, (VOID**)&AudioProt);

    static AUDIO_DRIVER_IF audio_if;
    audio_if.Beep = AudioBeepImp;
    audio_if.PlayRaw = DriverPlayRaw;

    DRIVER d;
    d.Type = DRIVER_TYPE_AUDIO;
    d.Priority = 5;
    d.Interface = &audio_if;
    RegisterDriver(&d);
}