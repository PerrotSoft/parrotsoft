#include "../include/drivers/fat32.h"
#include <Uefi.h>
#include <Library/UefiLib.h>
#include <Library/BaseLib.h>
#include <Library/MemoryAllocationLib.h>
#include <Library/PrintLib.h>
#include <Library/UefiBootServicesTableLib.h>
#include <Protocol/SimpleFileSystem.h>
#include <Protocol/LoadedImage.h>
#include <Guid/FileInfo.h>

EFI_FILE_PROTOCOL *FAT32_CWD = NULL;
CHAR16 FAT32_CurrentPath[MAX_PATH_LEN] = L"\\";
CHAR16 FAT32_CurrentDisk = L'A';
EFI_FILE_PROTOCOL *FAT32_Disks[MAX_DISKS];
CHAR16 FAT32_DiskLetters[MAX_DISKS];
UINTN FAT32_DiskCount = 0;

UINTN FAT32_SplitLine(CHAR16 *line, CHAR16 *args[], UINTN max_args) {
    UINTN argc = 0;
    CHAR16 *ptr = line;
    while (*ptr && argc < max_args) {
        while (*ptr == L' ') ptr++;
        if (*ptr == 0) break;
        args[argc++] = ptr;
        while (*ptr && *ptr != L' ') ptr++;
        if (*ptr == L' ') *ptr++ = 0;
    }
    return argc;
}

CHAR16* FAT32_GetFullPathString(VOID) {
    static CHAR16 out[MAX_PATH_LEN + 4];
    out[0] = FAT32_CurrentDisk;
    out[1] = L':';
    out[2] = L'\0';
    if (FAT32_CurrentPath[0] == L'\\') {
       StrCatS(out, MAX_PATH_LEN + 4, FAT32_CurrentPath);
    } else {
        StrCatS(out, MAX_PATH_LEN + 4, L"\\");
        StrCatS(out, MAX_PATH_LEN + 4, FAT32_CurrentPath);
    }
    return out;
}

INTN FAT32_FindDiskIndex(CHAR16 letter) {
    for (UINTN i = 0; i < FAT32_DiskCount; i++) {
        if (FAT32_DiskLetters[i] == letter) return (INTN)i;
    }
    return -1;
}
void FAT32_RegisterDisk(CHAR16 letter, EFI_FILE_PROTOCOL *root) {
    if (FAT32_DiskCount >= MAX_DISKS) return;
    for (UINTN i = 0; i < FAT32_DiskCount; i++) {
        if (FAT32_DiskLetters[i] == letter) return;
    }
    FAT32_Disks[FAT32_DiskCount] = root;
    FAT32_DiskLetters[FAT32_DiskCount] = letter;
    FAT32_DiskCount++;
    if (FAT32_CWD == NULL) {
        FAT32_CWD = root;
        FAT32_CurrentDisk = letter;
        StrCpyS(FAT32_CurrentPath, MAX_PATH_LEN, L"\\");
    }
}

void Fat32_RegisterrsDisk(VOID) {
    UINTN HandleCount;
    EFI_HANDLE *Handles;
    EFI_STATUS Status;

    Status = gBS->LocateHandleBuffer(ByProtocol, &gEfiSimpleFileSystemProtocolGuid, NULL, &HandleCount, &Handles);
    if (!EFI_ERROR(Status)) {
        for (UINTN i = 0; i < HandleCount; i++) {
            EFI_SIMPLE_FILE_SYSTEM_PROTOCOL *Fs;
            EFI_FILE_PROTOCOL *Root;

            Status = gBS->HandleProtocol(Handles[i], &gEfiSimpleFileSystemProtocolGuid, (VOID**)&Fs);
            if (EFI_ERROR(Status)) continue;

            Status = Fs->OpenVolume(Fs, &Root);
            if (EFI_ERROR(Status)) continue;

            if (i < 26) {
                FAT32_RegisterDisk((CHAR16)(L'A' + i), Root);
            }
        }
    }
}
EFI_STATUS FAT32_ChangeDisk(CHAR16 letter) {
    INTN idx = FAT32_FindDiskIndex(letter);
    if (idx < 0) return EFI_NOT_FOUND;
    if (FAT32_CWD && FAT32_CWD != FAT32_Disks[idx]) {
        FAT32_CWD->Close(FAT32_CWD);
    }
    FAT32_CWD = FAT32_Disks[idx];
    FAT32_CurrentDisk = letter;
    StrCpyS(FAT32_CurrentPath, MAX_PATH_LEN, L"\\");
    return EFI_SUCCESS;
}

EFI_FILE_PROTOCOL* FAT32_GetRoot(EFI_HANDLE ImageHandle, EFI_SYSTEM_TABLE *ST) {
    EFI_LOADED_IMAGE_PROTOCOL *loaded_image;
    EFI_STATUS s = ST->BootServices->HandleProtocol(ImageHandle, &gEfiLoadedImageProtocolGuid, (void**)&loaded_image);
    if (EFI_ERROR(s)) return NULL;

    EFI_SIMPLE_FILE_SYSTEM_PROTOCOL *fs;
    s = ST->BootServices->HandleProtocol(loaded_image->DeviceHandle, &gEfiSimpleFileSystemProtocolGuid, (void**)&fs);
    if (EFI_ERROR(s)) return NULL;

    EFI_FILE_PROTOCOL *root;
    s = fs->OpenVolume(fs, &root);
    if (EFI_ERROR(s)) return NULL;
    return root;
}

EC16 FAT32_ListDisks(VOID) {
    EC16 result;
    result.Status = EFI_SUCCESS;
    UINTN total_len = FAT32_DiskCount * 16;
    CHAR16 *buffer = AllocatePool(total_len * sizeof(CHAR16));
    if (!buffer) {
        result.Status = EFI_OUT_OF_RESOURCES;
        result.Message = L"Out of memory\n";
        return result;
    }
    buffer[0] = 0;
    for (UINTN i = 0; i < FAT32_DiskCount; i++) {
        CHAR16 line[32];
        UnicodeSPrint(line, sizeof(line), L"%c: [root]\n", FAT32_DiskLetters[i]);
        StrCatS(buffer, total_len, line);
    }
    result.Message = buffer;
    return result;
}

EFI_STATUS FAT32_OpenRelative(EFI_FILE_PROTOCOL *root_handle, CHAR16 *path, EFI_FILE_PROTOCOL **out_dir) {
    EFI_FILE_PROTOCOL *base = root_handle ? root_handle : FAT32_CWD;
    if (!base) return EFI_INVALID_PARAMETER;
    EFI_FILE_PROTOCOL *dir;
    EFI_STATUS status = base->Open(base, &dir, path, EFI_FILE_MODE_READ, EFI_FILE_DIRECTORY);
    if (EFI_ERROR(status)) return status;
    *out_dir = dir;
    return EFI_SUCCESS;
}

CHAR16* FAT32_PrintCurrentPath(VOID) {
    static CHAR16 buffer[512];
    UnicodeSPrint(buffer, sizeof(buffer), L"%c:%s", FAT32_CurrentDisk, FAT32_CurrentPath);
    return buffer;
}

EFI_STATUS FAT32_ParsePath(CHAR16 *path_src, CHAR16 *outDiskLetter, BOOLEAN *outIsAgBSolute, CHAR16 **outPathPtr) {
    if (!path_src || !outDiskLetter || !outIsAgBSolute || !outPathPtr) return EFI_INVALID_PARAMETER;
    *outDiskLetter = 0;
    *outIsAgBSolute = FALSE;
    *outPathPtr = path_src;
    while (*path_src == L' ') path_src++;
    if (((path_src[0] >= L'A' && path_src[0] <= L'Z') || (path_src[0] >= L'a' && path_src[0] <= L'z')) && path_src[1] == L':') {
        CHAR16 letter = path_src[0];
        if (letter >= L'a' && letter <= L'z') letter = letter - (L'a' - L'A');
        *outDiskLetter = letter;
        path_src += 2;
        if (*path_src == L'\\') {
            *outIsAgBSolute = TRUE;
            *outPathPtr = path_src + 1;
        } else {
            *outIsAgBSolute = FALSE;
            *outPathPtr = path_src;
        }
        return EFI_SUCCESS;
    }
    if (path_src[0] == L'\\') {
        *outIsAgBSolute = TRUE;
        *outPathPtr = path_src + 1;
        return EFI_SUCCESS;
    }
    *outIsAgBSolute = FALSE;
    *outPathPtr = path_src;
    return EFI_SUCCESS;
}

static void BuildNormalizedPath(CHAR16 *dest, const CHAR16 *basePath, const CHAR16 *relPath) {
    CHAR16 work[MAX_PATH_LEN];
    if (basePath && basePath[0] == L'\\') {
        StrCpyS(work, MAX_PATH_LEN, basePath);
        UINTN len = StrLen(work);
        if (len > 1 && work[len - 1] == L'\\') work[len - 1] = L'\0';
    } else StrCpyS(work, MAX_PATH_LEN, L"\\");

    if (!relPath || *relPath == L'\0') {
        StrCpyS(dest, MAX_PATH_LEN, work);
        return;
    }
    CHAR16 segments[64][128];
    UINTN segc = 0;
    UINTN i = (work[0] == L'\\') ? 1 : 0;
    UINTN wlen = StrLen(work);
    while (i < wlen) {
        CHAR16 segbuf[128];
        UINTN p = 0;
        while (i < wlen && work[i] != L'\\' && p < 127) segbuf[p++] = work[i++];
        segbuf[p] = L'\0';
        if (p > 0 && segc < 64) StrCpyS(segments[segc++], 128, segbuf);
        if (i < wlen && work[i] == L'\\') i++;
    }
    i = 0;
    UINTN rlen = StrLen(relPath);
    while (i < rlen) {
        CHAR16 segbuf[128];
        UINTN p = 0;
        while (i < rlen && relPath[i] != L'\\' && p < 127) segbuf[p++] = relPath[i++];
        segbuf[p] = L'\0';
        if (p == 0) { if (i < rlen && relPath[i] == L'\\') i++; continue; }
        if (StrCmp(segbuf, L".") == 0) {}
        else if (StrCmp(segbuf, L"..") == 0) { if (segc > 0) segc--; }
        else { if (segc < 64) StrCpyS(segments[segc++], 128, segbuf); }
        if (i < rlen && relPath[i] == L'\\') i++;
    }
    dest[0] = L'\\'; dest[1] = L'\0';
    for (UINTN s = 0; s < segc; s++) {
        StrCatS(dest, MAX_PATH_LEN, segments[s]);
        if (s + 1 < segc) StrCatS(dest, MAX_PATH_LEN, L"\\");
    }
}

EFI_STATUS FAT32_ChangeDirEx(CHAR16 *inputPath) {
    if (!inputPath) return EFI_INVALID_PARAMETER;
    CHAR16 diskLetter = 0; BOOLEAN isAgBSolute = FALSE; CHAR16 *pathPart = NULL;
    EFI_STATUS s = FAT32_ParsePath(inputPath, &diskLetter, &isAgBSolute, &pathPart);
    if (EFI_ERROR(s)) return s;
    if (diskLetter) {
        s = FAT32_ChangeDisk(diskLetter);
        if (EFI_ERROR(s)) return s;
    }
    INTN curIndex = FAT32_FindDiskIndex(FAT32_CurrentDisk);
    EFI_FILE_PROTOCOL *root_handle = (curIndex >= 0) ? FAT32_Disks[curIndex] : FAT32_CWD;
    EFI_FILE_PROTOCOL *newdir;
    if (isAgBSolute) {
        s = FAT32_OpenRelative(root_handle, pathPart, &newdir);
        if (EFI_ERROR(s)) return s;
        if (FAT32_CWD && FAT32_CWD != root_handle) FAT32_CWD->Close(FAT32_CWD);
        FAT32_CWD = newdir;
        BuildNormalizedPath(FAT32_CurrentPath, L"\\", pathPart);
        return EFI_SUCCESS;
    }
    s = FAT32_OpenRelative(FAT32_CWD, pathPart, &newdir);
    if (EFI_ERROR(s)) return s;
    INTN rootidx = FAT32_FindDiskIndex(FAT32_CurrentDisk);
    EFI_FILE_PROTOCOL *registeredRoot = (rootidx >= 0) ? FAT32_Disks[rootidx] : NULL;
    if (FAT32_CWD && FAT32_CWD != registeredRoot) FAT32_CWD->Close(FAT32_CWD);
    FAT32_CWD = newdir;
    BuildNormalizedPath(FAT32_CurrentPath, FAT32_CurrentPath, pathPart);
    return EFI_SUCCESS;
}

EC16 FAT32_ListDir(VOID) {
    EC16 result; result.Status = EFI_SUCCESS; result.Message = NULL;
    if (!FAT32_CWD) { result.Status = EFI_NOT_READY; return result; }
    EFI_FILE_PROTOCOL *dir;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &dir, L".", EFI_FILE_MODE_READ, EFI_FILE_DIRECTORY);
    if (EFI_ERROR(status)) { result.Status = status; return result; }
    UINTN buf_size = sizeof(EFI_FILE_INFO) + 512;
    EFI_FILE_INFO *info = AllocatePool(buf_size);
    CHAR16 *outbuf = AllocatePool(sizeof(CHAR16) * 2);
    outbuf[0] = L'\0';
    while (TRUE) {
        buf_size = sizeof(EFI_FILE_INFO) + 512;
        status = dir->Read(dir, &buf_size, info);
        if (EFI_ERROR(status) || buf_size == 0) break;
        if ((StrCmp(info->FileName, L".") == 0) || (StrCmp(info->FileName, L"..") == 0)) continue;
        UINTN new_len = StrLen(outbuf) + StrLen(info->FileName) + 16;
        CHAR16 *newbuf = AllocatePool(new_len * sizeof(CHAR16));
        StrCpyS(newbuf, new_len, outbuf);
        StrCatS(newbuf, new_len, (info->Attribute & EFI_FILE_DIRECTORY) ? L"<dir>  " : L"<file> ");
        StrCatS(newbuf, new_len, info->FileName);
        StrCatS(newbuf, new_len, L"\n");
        FreePool(outbuf);
        outbuf = newbuf;
    }
    FreePool(info); dir->Close(dir);
    result.Message = outbuf; return result;
}

EFI_STATUS FAT32_CreateDir(CHAR16 *name) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *dir;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &dir, name, EFI_FILE_MODE_READ | EFI_FILE_MODE_WRITE | EFI_FILE_MODE_CREATE, EFI_FILE_DIRECTORY);
    if (!EFI_ERROR(status)) dir->Close(dir);
    return status;
}

EFI_STATUS FAT32_DeleteDir(CHAR16 *name) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *dir;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &dir, name, EFI_FILE_MODE_READ, EFI_FILE_DIRECTORY);
    if (EFI_ERROR(status)) return status;
    return dir->Delete(dir);
}

EFI_STATUS FAT32_CreateFile(CHAR16 *name) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *file;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &file, name, EFI_FILE_MODE_READ | EFI_FILE_MODE_WRITE | EFI_FILE_MODE_CREATE, 0);
    if (!EFI_ERROR(status)) file->Close(file);
    return status;
}

EFI_STATUS FAT32_DeleteFile(CHAR16 *name) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *file;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &file, name, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return status;
    return file->Delete(file);
}

EC16 FAT32_ReadFile(CHAR16 *filename) {
    EC16 result = { .Status = EFI_NOT_READY };
    if (!FAT32_CWD) return result;
    EFI_FILE_PROTOCOL *file;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &file, filename, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) { result.Status = status; return result; }
    UINTN info_size = sizeof(EFI_FILE_INFO) + 200;
    EFI_FILE_INFO *info = AllocatePool(info_size);
    status = file->GetInfo(file, &gEfiFileInfoGuid, &info_size, info);
    UINTN file_size = (UINTN)info->FileSize;
    FreePool(info);
    UINT8 *buf = AllocatePool(file_size);
    status = file->Read(file, &file_size, buf);
    file->Close(file);
    result.Status = status; result.Message = (CHAR16*)buf; result.FileSize = file_size;
    return result;
}

EFI_STATUS FAT32_WriteFile(CHAR16 *filename, UINT16 *data, UINTN len) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *file;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &file, filename, EFI_FILE_MODE_READ | EFI_FILE_MODE_WRITE | EFI_FILE_MODE_CREATE, 0);
    if (EFI_ERROR(status)) return status;
    UINTN size = len * sizeof(UINT16);
    file->Write(file, &size, data);
    file->Close(file);
    return EFI_SUCCESS;
}

EFI_STATUS FAT32_CopyFile(CHAR16 *src, CHAR16 *dest) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *srcf, *dstf;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &srcf, src, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return status;
    status = FAT32_CWD->Open(FAT32_CWD, &dstf, dest, EFI_FILE_MODE_READ | EFI_FILE_MODE_WRITE | EFI_FILE_MODE_CREATE, 0);
    if (EFI_ERROR(status)) { srcf->Close(srcf); return status; }
    UINTN chunk = 8192; VOID *buf = AllocatePool(chunk);
    while (TRUE) {
        UINTN read = chunk;
        status = srcf->Read(srcf, &read, buf);
        if (EFI_ERROR(status) || read == 0) break;
        dstf->Write(dstf, &read, buf);
    }
    FreePool(buf); srcf->Close(srcf); dstf->Close(dstf);
    return status;
}

EFI_STATUS FAT32_DeleteEntry(CHAR16 *name) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *f;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &f, name, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return status;
    return f->Delete(f);
}

EFI_STATUS FAT32_MoveFile(CHAR16 *src, CHAR16 *dest) {
    EFI_STATUS s = FAT32_CopyFile(src, dest);
    if (EFI_ERROR(s)) return s;
    return FAT32_DeleteEntry(src);
}

EFI_STATUS FAT32_AppendFile(CHAR16 *filename, UINT16 *data, UINTN len) {
    if (!FAT32_CWD) return EFI_NOT_READY;
    EFI_FILE_PROTOCOL *file;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &file, filename, EFI_FILE_MODE_READ | EFI_FILE_MODE_WRITE, 0);
    if (EFI_ERROR(status)) return status;
    file->SetPosition(file, 0xFFFFFFFFFFFFFFFFULL);
    UINTN size = len * sizeof(UINT16);
    file->Write(file, &size, data);
    file->Close(file);
    return EFI_SUCCESS;
}

EFI_STATUS FAT32_ReadFileByPath(CHAR16 *path_in, EC16 *out) {
    CHAR16 pathbuf[MAX_PATH_LEN]; StrCpyS(pathbuf, MAX_PATH_LEN, path_in);
    CHAR16 diskLetter = 0; BOOLEAN isAbs = FALSE; CHAR16 *pathPart = NULL;
    FAT32_ParsePath(pathbuf, &diskLetter, &isAbs, &pathPart);
    EFI_FILE_PROTOCOL *base = (diskLetter) ? FAT32_Disks[FAT32_FindDiskIndex(diskLetter)] : FAT32_CWD;
    EFI_FILE_PROTOCOL *f;
    base->Open(base, &f, pathPart, EFI_FILE_MODE_READ, 0);
    UINTN info_size = sizeof(EFI_FILE_INFO) + 512;
    EFI_FILE_INFO *info = AllocatePool(info_size);
    f->GetInfo(f, &gEfiFileInfoGuid, &info_size, info);
    UINTN fs = (UINTN)info->FileSize; FreePool(info);
    UINT8 *buf = AllocatePool(fs); f->Read(f, &fs, buf); f->Close(f);
    out->Status = EFI_SUCCESS; out->Message = (CHAR16*)buf; out->FileSize = fs;
    return EFI_SUCCESS;
}

EC16* FAT32_ListSimple(UINTN *SizeOut) {
    if (!FAT32_CWD) { *SizeOut = 0; return NULL; }
    UINTN count = 0, infoSize = sizeof(EFI_FILE_INFO) + 512;
    VOID *infoBuf = AllocatePool(infoSize);
    FAT32_CWD->SetPosition(FAT32_CWD, 0);
    while (TRUE) {
        infoSize = sizeof(EFI_FILE_INFO) + 512;
        if (EFI_ERROR(FAT32_CWD->Read(FAT32_CWD, &infoSize, infoBuf)) || infoSize == 0) break;
        EFI_FILE_INFO *info = (EFI_FILE_INFO*)infoBuf;
        if (info->FileName[0] != 0 && StrCmp(info->FileName, L".") != 0 && StrCmp(info->FileName, L"..") != 0) count++;
    }
    EC16 *result = AllocatePool(count * sizeof(EC16));
    FAT32_CWD->SetPosition(FAT32_CWD, 0);
    for (UINTN i = 0; i < count; ) {
        infoSize = sizeof(EFI_FILE_INFO) + 512;
        FAT32_CWD->Read(FAT32_CWD, &infoSize, infoBuf);
        EFI_FILE_INFO *info = (EFI_FILE_INFO*)infoBuf;
        if (info->FileName[0] != 0 && StrCmp(info->FileName, L".") != 0 && StrCmp(info->FileName, L"..") != 0) {
            result[i].Message = AllocateCopyPool((StrLen(info->FileName) + 1) * sizeof(CHAR16), info->FileName);
            i++;
        }
    }
    FreePool(infoBuf); *SizeOut = count; return result;
}
EFI_STATUS FAT32_GetFileSize(CHAR16 *filename, UINT64 *filesize) {
    if (!FAT32_CWD || !filesize) return EFI_INVALID_PARAMETER;
    EFI_FILE_PROTOCOL *f;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &f, filename, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return status;

    UINTN info_size = sizeof(EFI_FILE_INFO) + 200;
    EFI_FILE_INFO *info = AllocatePool(info_size);
    status = f->GetInfo(f, &gEfiFileInfoGuid, &info_size, info);
    if (!EFI_ERROR(status)) *filesize = info->FileSize;

    FreePool(info);
    f->Close(f);
    return status;
}
EFI_STATUS Disk_SetCurrent(CHAR16 Letter) {
    return FAT32_ChangeDisk(Letter);
}

const CHAR16* Disk_GetCurrentPath(VOID) {
    return FAT32_PrintCurrentPath();
}

EFI_STATUS Disk_PathUp(VOID) {
    return FAT32_ChangeDirEx(L"..");
}
BOOLEAN ExistsFile(CHAR16 *filename) {
    if (!FAT32_CWD) return FALSE;
    EFI_FILE_PROTOCOL *f;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &f, filename, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return FALSE;
    f->Close(f);
    return TRUE;
}
BOOLEAN ExistsDir(CHAR16 *dirname) {
    if (!FAT32_CWD) return FALSE;
    EFI_FILE_PROTOCOL *f;
    EFI_STATUS status = FAT32_CWD->Open(FAT32_CWD, &f, dirname, EFI_FILE_MODE_READ, 0);
    if (EFI_ERROR(status)) return FALSE;
    UINTN info_size = sizeof(EFI_FILE_INFO) + 200;
    EFI_FILE_INFO *info = AllocatePool(info_size);
    status = f->GetInfo(f, &gEfiFileInfoGuid, &info_size, info);
    BOOLEAN isDir = FALSE;
    if (!EFI_ERROR(status)) isDir = (info->Attribute & EFI_FILE_DIRECTORY) != 0;
    FreePool(info); f->Close(f);
    return isDir;
}

VOID Fat32_Storage_INIT(VOID)
{
    static STORAGE_DRIVER_IF Fat32Interface = {
        .ReadFileByPath = FAT32_ReadFileByPath,
        .SetCurrentDisk = Disk_SetCurrent,
        .GetCurrentPath = Disk_GetCurrentPath,
        .PathUp = Disk_PathUp,
        .ListDir = FAT32_ListDir,
        .ChangeDir = FAT32_ChangeDirEx,
        .CreateFile = FAT32_CreateFile,
        .DeleteFile = FAT32_DeleteFile,
        .ReadFile = FAT32_ReadFile,
        .WriteFile = FAT32_WriteFile,
        .GetFileSize = FAT32_GetFileSize,
        .RegisterrsDisk = Fat32_RegisterrsDisk,
        .ListDisks = FAT32_ListDisks,
        .CreateDir = FAT32_CreateDir,
        .DeleteDir = FAT32_DeleteDir,
        .MoveFile = FAT32_MoveFile,
        .CopyFile = FAT32_CopyFile,
        .ExistsFile = ExistsFile,
        .ExistsDir = ExistsDir
    };

    RegisterDriver(&(DRIVER){
        .Type = DRIVER_TYPE_STORAGE,
        .Priority = 1,
        .Interface = &Fat32Interface
    });
}