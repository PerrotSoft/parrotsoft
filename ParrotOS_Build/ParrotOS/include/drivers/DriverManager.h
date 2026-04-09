#pragma once
#include <Uefi.h>
#include <Protocol/GraphicsOutput.h>
typedef struct {
    UINT8* PcmData;
    UINTN   DataSize;
    UINT32  SampleRate;
    UINT16  Channels;
    UINT16  Bits;
    BOOLEAN IsPlaying;
} AUDIO_STATE;
typedef struct {
    UINT32 ChunkID;       
    UINT32 ChunkSize;
    UINT32 Format;        
    UINT32 Subchunk1ID;   
    UINT32 Subchunk1Size;
    UINT16 AudioFormat;
    UINT16 NumChannels;
    UINT32 SampleRate;
    UINT32 ByteRate;
    UINT16 BlockAlign;
    UINT16 BitsPerSample;
    UINT32 Subchunk2ID;  
    UINT32 Subchunk2Size; 
} WAV_HEADER;
typedef struct {
    UINT32 width;
    UINT32 height;
    UINT32 bpp;
    UINT32 pitch;
    volatile UINT8* fb;          
    UINT8* back_buffer;          
    EFI_GRAPHICS_PIXEL_FORMAT pixel_format;
} VideoMode;

typedef struct {
    EFI_STATUS Status;
    CHAR16     *Message;
    UINTN      FileSize;
} EC16;

typedef enum {
    DRIVER_TYPE_NONE = 0,
    DRIVER_TYPE_KEYBOARD = 1,
    DRIVER_TYPE_VIDEO = 2,
    DRIVER_TYPE_STORAGE = 3,
    DRIVER_TYPE_NETWORK = 4,
    DRIVER_TYPE_AUDIO = 5,
    DRIVER_TYPE_MOUSE = 6
} DRIVER_TYPE;
typedef struct {
    CHAR16  (*GetKey)(EFI_SYSTEM_TABLE *SytemTables);
    BOOLEAN (*HasKey)(EFI_SYSTEM_TABLE *SytemTables);
    VOID    (*Reset)(EFI_SYSTEM_TABLE *SytemTables);
} KEY_DRIVER_IF;

typedef struct {
    EFI_STATUS (*ReadFileByPath)(CHAR16 *path_in, EC16 *out);
    EFI_STATUS (*SetCurrentDisk)(CHAR16 Letter);
    const CHAR16* (*GetCurrentPath)(VOID);
    EFI_STATUS (*PathUp)(VOID);
    EC16 (*ListDir)(VOID);
    EFI_STATUS (*ChangeDir)(CHAR16 *path);
    EFI_STATUS (*CreateFile)(CHAR16 *name);
    EFI_STATUS (*DeleteFile)(CHAR16 *name);
    EC16 (*ReadFile)(CHAR16 *filename);
    EFI_STATUS (*WriteFile)(CHAR16 *filename, UINT16 *data, UINTN len);
    EFI_STATUS (*GetFileSize)(CHAR16 *filename, UINT64 *filesize);
    void       (*RegisterrsDisk)();
    EC16       (*ListDisks)();
    BOOLEAN    (*ExistsFile)(CHAR16 *path);
    BOOLEAN    (*ExistsDir)(CHAR16 *path);
    EFI_STATUS (*CreateDir)(CHAR16 *name);
    EFI_STATUS (*DeleteDir)(CHAR16 *name);
    EFI_STATUS (*MoveFile)(CHAR16 *src, CHAR16 *dst);
    EFI_STATUS (*CopyFile)(CHAR16 *src, CHAR16 *dst);
} STORAGE_DRIVER_IF;

typedef struct {
    EFI_STATUS (*Init)(EFI_SYSTEM_TABLE *SystemTable);
    VOID       (*ClearScreen)(UINT32 rgb24);
    VOID       (*PutPixel)(INT32 x, INT32 y, UINT32 rgb24);
    VOID       (*DrawLine)(INT32 x0, INT32 y0, INT32 x1, INT32 y1, UINT32 rgb24);
    VOID       (*DrawBitmap32)(const UINT32* bmp, INT32 bmp_w, INT32 bmp_h, INT32 x0, INT32 y0);
    VideoMode* (*GetVideoMode)(VOID);
    UINT32     (*Get_Pixel)(INT32 x, INT32 y);
    VOID       (*SwapBuffers)(VOID);
    VOID       (*UploadShader)(VOID* Code, UINTN Size, UINT64 Offset);
    VOID       (*RunCompute)(UINT64 Offset, UINT32 Threads);
    const CHAR8* (*GetDriverType)(VOID);
} VIDEO_DRIVER_IF;

typedef struct {
    EFI_STATUS (*Init)(EFI_SYSTEM_TABLE *SystemTable, CHAR16 *NicName, CHAR16 *Password);
    EFI_STATUS (*TcpConnect)(CHAR16 *Ip, UINT16 Port);
    EFI_STATUS (*TcpSend)(UINT8 *Data, UINTN Len);
    EFI_STATUS (*TcpReceive)(UINT8 *Buffer, UINTN *Len);
    EFI_STATUS (*TcpDisconnect)(VOID);
    EFI_STATUS (*DnsLookup)(CHAR16 *DomainName, CHAR16 *OutIpStr);
} NETWORK_DRIVER_IF;
typedef struct {
    EFI_STATUS (*Init)(VOID);
    VOID       (*Beep)(UINT32 Freq, UINT32 Duration);
    EFI_STATUS (*PlayRaw)(UINT8 *Buffer, UINTN Size);
} AUDIO_DRIVER_IF;
typedef struct {
    EFI_STATUS (*Init)(VOID);
    EFI_STATUS (*GetState)(INT32 *x, INT32 *y, BOOLEAN *lb, BOOLEAN *rb);
} MOUSE_DRIVER_IF;
typedef struct {
    DRIVER_TYPE Type;
    UINT8       Priority;
    VOID* Interface;
} DRIVER;

BOOLEAN RegisterDriver(DRIVER* Driver);
DRIVER* GetBestDriver(DRIVER_TYPE Type);
VOID INIT(EFI_SYSTEM_TABLE *SytemTables);

CHAR16 GetKey(VOID);
BOOLEAN HasKey(VOID);
VOID Reset(VOID);

EFI_STATUS ReadFileByPath(CHAR16 *path_in, EC16 *out);
EFI_STATUS SetCurrentDisk(CHAR16 Letter);
const CHAR16* GetCurrentPath(VOID);
EFI_STATUS PathUp(VOID);
EC16 ListDir(VOID);
EFI_STATUS ChangeDir(CHAR16 *path);
EFI_STATUS CreateFile(CHAR16 *name);
EFI_STATUS DeleteFile(CHAR16 *name);
EC16 ReadFile(CHAR16 *filename);
EFI_STATUS WriteFile(CHAR16 *filename, UINT16 *data, UINTN len);
EFI_STATUS GetFileSize(CHAR16 *filename, UINT64 *filesize);
VOID RegisterrsDisk();
EC16 ListDisks();
BOOLEAN FileExists(CHAR16 *path);
BOOLEAN DirExists(CHAR16 *path);
EFI_STATUS CreateDir(CHAR16 *name);
EFI_STATUS DeleteDir(CHAR16 *name);
EFI_STATUS MoveFile(CHAR16 *src, CHAR16 *dst);
EFI_STATUS CopyFile(CHAR16 *src, CHAR16 *dst);

EFI_STATUS INIT_VIDEO_DRIVER(EFI_SYSTEM_TABLE *SystemTable);
VOID       CLEAR_SCREEN(UINT32 rgb24);
VOID       PUT_PIXEL(INT32 x, INT32 y, UINT32 rgb24);
VOID       DRAW_LINE(INT32 x0, INT32 y0, INT32 x1, INT32 y1, UINT32 rgb24);
VOID       DRAW_BITMAP32(const UINT32* bmp, INT32 bmp_w, INT32 bmp_h, INT32 x0, INT32 y0);
VideoMode* GET_CURRENT_VMODE(VOID);
UINT32     GET_PIXEL(INT32 x, INT32 y);
VOID       SWAP_BUFFERS(VOID);
VOID       GPU_UPLOAD_SHADER(VOID* Code, UINTN Size, UINT64 Offset);
VOID       GPU_RUN_COMPUTE(UINT64 Offset, UINT32 Threads);
const CHAR8* GET_VIDEO_STATUS_STR(VOID);

EFI_STATUS INIT_NETWORK_DRIVER(CHAR16 *NicName, CHAR16 *Password);
EFI_STATUS NETWORK_TCP_CONNECT(CHAR16 *Ip, UINT16 Port);
EFI_STATUS NETWORK_TCP_SEND(UINT8 *Data, UINTN Len);
EFI_STATUS NETWORK_TCP_RECEIVE(UINT8 *Buffer, UINTN *Len);
EFI_STATUS NETWORK_TCP_DISCONNECT(VOID);
EFI_STATUS NETWORK_DNS_LOOKUP(CHAR16 *DomainName, CHAR16 *OutIpStr);

EFI_STATUS INIT_MOUSE(VOID);
EFI_STATUS GET_MOUSE_STATE(INT32 *x, INT32 *y, BOOLEAN *lb, BOOLEAN *rb);

EFI_STATUS INIT_AUDIO(VOID);
VOID       AudioBeep(UINT32 Freq, UINT32 Duration);
EFI_STATUS AudioPlay(UINT8 *Data, UINTN Size);