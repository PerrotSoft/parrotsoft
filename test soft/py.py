import os
import subprocess
import struct

def build():
    # Компиляция
    res1 = subprocess.run("gcc -ffreestanding -fshort-wchar -m64 -c hello.c -o hello.o", shell=True)
    res2 = subprocess.run("ld -T app.ld hello.o -o hello.bin", shell=True)
    
    if res1.returncode != 0 or res2.returncode != 0:
        print("Ошибка компиляции!")
        return

    # Создание start.pex (Заголовок 64 байта)
    with open("hello.bin", "rb") as f:
        code = f.read()
    
    header = bytearray(64)
    header[0:2] = b"MZ" 
    header[8:12] = struct.pack("<I", len(code))
    
    with open("usb_root/start.pex", "wb") as f:
        f.write(header + code)

    # Пересборка образа
    subprocess.run("dd if=/dev/zero of=boot.img bs=1M count=2 status=none", shell=True)
    subprocess.run("mkfs.vfat boot.img", shell=True)
    subprocess.run("mcopy -i boot.img -s usb_root/* ::/", shell=True)

    print("Сборка завершена. Запуск...")
    subprocess.run("qemu-system-x86_64 -m 256M -bios /usr/share/ovmf/OVMF.fd -drive file=boot.img,format=raw,if=ide", shell=True)

if __name__ == "__main__":
    build()
# import os
# import subprocess
# import struct
# import subprocess
# import platform
# def build():
#     # Компиляция
#     res1 = subprocess.run("gcc -ffreestanding -fshort-wchar -m64 -c hello.c -o hello.o", shell=True)
#     res2 = subprocess.run("ld -T app.ld hello.o -o hello.bin", shell=True)
    
#     if res1.returncode != 0 or res2.returncode != 0:
#         print("Ошибка компиляции!")
#         return

#     # Создание start.pex (Заголовок 64 байта)
#     with open("hello.bin", "rb") as f:
#         code = f.read()
    
#     header = bytearray(64)
#     header[0:2] = b"MZ" 
#     header[8:12] = struct.pack("<I", len(code))
    
#     with open("usb_root/start.pex", "wb") as f:
#         f.write(header + code)

#     # Пересборка образа
#     subprocess.run("dd if=/dev/zero of=boot.img bs=1M count=2 status=none", shell=True)
#     subprocess.run("mkfs.vfat boot.img", shell=True)
#     subprocess.run("mcopy -i boot.img -s usb_root/* ::/", shell=True)

#     print("Сборка завершена. Запуск...")
#     system = platform.system()
#     accel = ""
    
#     if system == "Linux":
#         accel = "-enable-kvm -cpu host"
#     elif system == "Windows":
#         accel = "-accel whpx -cpu host"
#     else:
#         accel = "" # Для macOS или если нет ускорения
        
#     qemu_cmd = f"qemu-system-x86_64 -hda boot.img -m 512M -bios /usr/share/ovmf/OVMF.fd {accel} -vga std"
#     subprocess.run(qemu_cmd, shell=True)

# if __name__ == "__main__":
#     build()