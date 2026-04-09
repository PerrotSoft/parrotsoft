#ifndef FAT32_H
#define FAT32_H

#include <Uefi.h>
#include <Protocol/SimpleFileSystem.h>
#include <Library/UefiLib.h>
#include "DriverManager.h"

#define MAX_PATH_LEN 512
#define MAX_DISKS 52

typedef enum {
    DISK_A = 0,
    DISK_B,
    DISK_C,
    DISK_D,
    DISK_MAX
} DISK_TYPE;

typedef struct {
    CHAR16 Letter;
    EFI_FILE_HANDLE Root; 
    BOOLEAN Mounted;
} Disk;

extern CHAR16 FAT32_CurrentDisk;
extern EFI_FILE_PROTOCOL *FAT32_CWD;
extern CHAR16 FAT32_CurrentPath[MAX_PATH_LEN];
extern EFI_FILE_PROTOCOL *FAT32_Disks[MAX_DISKS];
extern CHAR16 FAT32_DiskLetters[MAX_DISKS];
extern UINTN FAT32_DiskCount;
extern Disk Disks[DISK_MAX];

VOID Fat32_Storage_INIT(VOID);
void Fat32_RegisterrsDisk(VOID);

#endif