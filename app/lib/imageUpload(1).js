// Клиентская утилита: любое загруженное изображение приводим к SD-разрешению
// и пересжимаем в JPEG, прежде чем класть в base64/data URL (обложки, картинки
// в конструкторе новостей). Никогда не увеличиваем маленькие картинки — только уменьшаем.
//
// Максимум:
//   16:9 (широкоформатные) → 854×480
//   4:3  (обычные)          → 640×480
// Выбор между ними — по тому, на какое соотношение сторон похож оригинал.

const SD_16_9 = { w: 854, h: 480 };
const SD_4_3 = { w: 640, h: 480 };

export function compressImageToJPEG(file, { quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      reject(new Error('Файл не является изображением'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Не удалось декодировать изображение'));
      img.onload = () => {
        const srcW = img.naturalWidth || img.width;
        const srcH = img.naturalHeight || img.height;
        const ratio = srcW / srcH;
        const midpoint = (16 / 9 + 4 / 3) / 2; // ближе к 16:9 или к 4:3
        const cap = ratio >= midpoint ? SD_16_9 : SD_4_3;

        // Только уменьшаем (scale <= 1), апскейл не делаем.
        const scale = Math.min(1, cap.w / srcW, cap.h / srcH);
        const targetW = Math.max(1, Math.round(srcW * scale));
        const targetH = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        // JPEG не поддерживает прозрачность — белая подложка под PNG со альфа-каналом.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);
        ctx.drawImage(img, 0, 0, targetW, targetH);

        resolve({
          dataUrl: canvas.toDataURL('image/jpeg', quality),
          width: targetW,
          height: targetH,
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
