import { createClient } from '@libsql/client';
import { spawn } from 'child_process';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(request, { params }) {
  try {
    const { id, filename } = await params;
    const { searchParams } = new URL(request.url);
    const quality = searchParams.get('quality') || '1080p';

    // 1. Извлекаем оригинальный чанк из базы данных
    const rs = await client.execute({
      sql: "SELECT data FROM video_hls_files WHERE video_id = ? AND filename = ?",
      args: [String(id), String(filename)]
    });

    if (rs.rows.length === 0 || !rs.rows[0].data) {
      return new Response("Сегмент не найден", { status: 404 });
    }

    const originalBuffer = Buffer.from(rs.rows[0].data);

    // 2. Если запрашивается оригинал (1080p), отдаем его сразу, не тратя процессор
    if (quality === '1080p') {
      return new Response(originalBuffer, {
        headers: {
          'Content-Type': 'video/MP2T',
          'Cache-Control': 'public, max-age=31536000',
        },
      });
    }

    // 3. Выбор параметров для "кастрации" (срезаем пиксели и битрейт)
    let scale = '-2:720';
    let bitrate = '2500k';
    
    if (quality === '480p') {
      scale = '-2:480';
      bitrate = '1000k';
    }

    // 4. Запуск транскодирования на лету с помощью системного FFmpeg
    return new Promise((resolve, reject) => {
      const ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',          // Читаем видеопоток из буфера
        '-vf', scale,            // Обрезаем разрешение
        '-b:v', bitrate,         // Уменьшаем вес
        '-preset', 'ultrafast',  // Максимальная скорость
        '-c:a', 'copy',          // Оставляем аудио без изменений
        '-f', 'mpegts',          // Формат выхода - кусок HLS
        'pipe:1'                 // Выдаем результат потоком
      ]);

      const chunks = [];
      
      ffmpegProcess.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });

      ffmpegProcess.stderr.on('data', (data) => {
        // Логи ffmpeg (можно раскомментировать для дебага, если нужно)
        // console.log(`FFmpeg: ${data}`);
      });

      ffmpegProcess.on('close', (code) => {
        if (code !== 0) {
          resolve(new Response(JSON.stringify({ error: `Ошибка FFmpeg: Код ${code}` }), { status: 500 }));
          return;
        }

        const transcodedBuffer = Buffer.concat(chunks);
        
        // Отдаем клиенту перекодированный, урезанный кусок
        resolve(new Response(transcodedBuffer, {
          headers: {
            'Content-Type': 'video/MP2T',
            'Cache-Control': 'public, max-age=31536000',
          }
        }));
      });

      ffmpegProcess.on('error', (err) => {
        resolve(new Response(JSON.stringify({ error: 'FFmpeg не установлен на сервере или не может быть запущен.' }), { status: 500 }));
      });

      // Скармливаем оригинальный буфер процессу ffmpeg
      ffmpegProcess.stdin.write(originalBuffer);
      ffmpegProcess.stdin.end();
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}