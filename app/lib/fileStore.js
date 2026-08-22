// Хэширование содержимого файла (для дедупликации одинаковых файлов — теперь
// не только в одном чате, а везде, где угодно) + генерация маленьких превью
// (128px картинка, первый кадр видео), чтобы в ленте сообщений не тянуть сразу
// полный файл — только лёгкий thumb, а сам файл подгружается по хэшу при клике.

export async function sha256OfDataUrl(dataUrl) {
  // ВАЖНО: брать индекс ПЕРВОЙ запятой всё ещё неправильно — сам MIME видео
  // может содержать запятую внутри себя (например "video/webm;codecs=vp9,opus"),
  // и тогда первая запятая — это запятая ВНУТРИ codecs, а не граница перед
  // данными, из-за чего atob() падал с InvalidCharacterError. Ищем сам маркер
  // ";base64," — это единственное надёжное место границы для base64 data URL.
  const marker = ';base64,';
  const markerIdx = dataUrl.indexOf(marker);
  const base64 = markerIdx >= 0
    ? dataUrl.slice(markerIdx + marker.length)
    : dataUrl.slice(dataUrl.indexOf(',') + 1); // не-base64 data URL — маловероятно, но на всякий случай
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Уменьшает глубину цвета (меньше уровней на канал), сохраняя разрешение —
// плюс лёгкий шум перед квантованием, чтобы замаскировать полосы (banding)
// от урезанной палитры (классический dithering). Даёт заметную экономию
// размера файла почти без потери воспринимаемого качества.
export function reduceColorDepth(dataUrl, levels = 6) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const step = 255 / (levels - 1);
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const noise = (Math.random() - 0.5) * step;
          const v = Math.min(255, Math.max(0, data[i + c] + noise));
          data[i + c] = Math.round(Math.round(v / step) * step);
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Возвращает не просто dataURL превью, а ещё и реальные пропорции картинки
// (natural width/height) — они нужны, чтобы отрисовать сообщение с картинкой
// динамического размера (как в Telegram), а не квадратным кропом.
export function makeImageThumb(dataUrl, maxW = 128) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.7), w: img.width, h: img.height });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Аватарка WavyChat: всегда квадрат 360×360 (центр-кроп + масштаб), JPEG.
export function makeAvatar360(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = 360; canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 360, 360);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// Кадр видео берём через offscreen <video>, отдаём маленькую JPEG-превьюшку —
// сама видео-дорожка при этом никуда не грузится (только метаданные + 1 кадр).
// Тоже отдаёт реальные пропорции видео (videoWidth/videoHeight) вместе с
// превью-кадром — по тем же причинам, что и makeImageThumb выше.
export function makeVideoThumb(dataUrl, maxW = 128) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = dataUrl;
    video.onloadeddata = () => {
      try {
        const scale = Math.min(1, maxW / video.videoWidth);
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.7), w: video.videoWidth, h: video.videoHeight, duration: isFinite(video.duration) ? video.duration : null });
      } catch (e) {
        reject(e);
      }
    };
    video.onerror = reject;
    video.currentTime = 0.1;
  });
}

// Пересжимает видео с тем же разрешением, но меньшим битрейтом (через canvas +
// MediaRecorder — честного транскодера в браузере без WASM-библиотек нет).
// Кодирование идёт в реальном времени (со скоростью воспроизведения), поэтому
// для длинных роликов это медленно — на любой ошибке просто отдаём оригинал.
export function compressVideoFile(file, { targetBitrate = 1200000, maxDurationSec = 120 } = {}) {
  return new Promise((resolve) => {
    const fallback = () => resolve(file);
    try {
      const video = document.createElement('video');
      video.muted = true; // не проигрываем звук вслух, но дорожку заберём отдельно ниже
      video.playsInline = true;
      video.src = URL.createObjectURL(file);

      video.onloadedmetadata = () => {
        if (!video.duration || video.duration > maxDurationSec || !video.videoWidth) return fallback();
        try {
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          const canvasStream = canvas.captureStream(30);

          let audioTrack = null;
          try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaElementSource(video);
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(dest);
            audioTrack = dest.stream.getAudioTracks()[0];
            if (audioTrack) canvasStream.addTrack(audioTrack);
          } catch (e) { /* без звука — не критично, лучше видео без звука, чем вообще без сжатия */ }

          const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
            .find(m => window.MediaRecorder?.isTypeSupported?.(m)) || 'video/webm';
          const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: targetBitrate });
          const chunks = [];
          recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            resolve(blob.size > 0 && blob.size < file.size ? blob : file); // если не вышло меньше оригинала — не подсовываем "сжатую" версию
          };
          recorder.onerror = fallback;

          let raf;
          const draw = () => {
            if (video.paused || video.ended) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            raf = requestAnimationFrame(draw);
          };
          video.onended = () => { cancelAnimationFrame(raf); recorder.stop(); };
          video.onerror = fallback;

          recorder.start();
          video.play().then(draw).catch(fallback);
        } catch (e) {
          fallback();
        }
      };
      video.onerror = fallback;
    } catch (e) {
      fallback();
    }
  });
}
