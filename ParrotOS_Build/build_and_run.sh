#!/usr/bin/env bash
set -e

SDK_DIR="$(dirname "$0")/../edk2"
HW_DIR="$(dirname "$0")"
DSC_FILE="$HW_DIR/Minimal.dsc"
BUILD_FILE="$HW_DIR/build_number.txt"
OUTPUT_DIR="$HW_DIR/out"
EFI_SOURCE="$SDK_DIR/Build/RELEASE_GCC5/X64/ParrotOS.efi"

if [ ! -f "$BUILD_FILE" ]; then
    echo 1 > "$BUILD_FILE"
fi
BUILD_NUMBER=$(cat "$BUILD_FILE")
echo "--- Сборка версии #$BUILD_NUMBER ---"

mkdir -p "$OUTPUT_DIR"
echo "--- Сборка UEFI приложения ---"
cd "$SDK_DIR"
source edksetup.sh
build -a X64 -t GCC5 -b RELEASE -p "$DSC_FILE" -D BUILD_VERSION=$BUILD_NUMBER
cd "$HW_DIR"

if [ ! -f "$EFI_SOURCE" ]; then
    echo "Ошибка: EFI файл не найден по пути $EFI_SOURCE"
    exit 1
fi

echo "--- Подготовка носителей ---"
USB_ROOT="$OUTPUT_DIR/usb_root"
mkdir -p "$USB_ROOT/EFI/BOOT"
cp "$EFI_SOURCE" "$USB_ROOT/EFI/BOOT/BOOTX64.EFI"

IMG_FILE="$OUTPUT_DIR/boot.img"
dd if=/dev/zero of="$IMG_FILE" bs=1M count=1
mkfs.vfat "$IMG_FILE"
mmd -i "$IMG_FILE" ::/EFI
mmd -i "$IMG_FILE" ::/EFI/BOOT
mcopy -i "$IMG_FILE" "$EFI_SOURCE" ::/EFI/BOOT/BOOTX64.EFI
mcopy -i "$IMG_FILE" "$HW_DIR/ParrotOS/ico_100x100.bmp" ::/ico_100x100.bmp
mcopy -i "$IMG_FILE" "$HW_DIR/ParrotOS/p.pex" ::/p.pex
mcopy -i "$IMG_FILE" "$HW_DIR/ParrotOS/system.ttf" ::/system.ttf

echo "--- Отправка изменений в Git ---"
rm -f "$HW_DIR/.git/index.lock"

NEXT_BUILD=$((BUILD_NUMBER + 1))
echo $NEXT_BUILD > "$BUILD_FILE"

git add .
git commit -m "Auto-build #$BUILD_NUMBER" || echo "Нет изменений для коммита"

echo "--- Запуск QEMU ---"
qemu-system-x86_64 -hda "$IMG_FILE" -m 512M -bios /usr/share/ovmf/OVMF.fd \
  -vga std -net none -netdev user,id=net0 -device e1000,netdev=net0 \
  -usb -device usb-tablet

echo "------------------------------------------------"
echo "Завершено. Текущий билд: $BUILD_NUMBER. Следующий: $NEXT_BUILD"