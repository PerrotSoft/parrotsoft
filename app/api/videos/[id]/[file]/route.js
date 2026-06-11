// app/api/videos/[id]/[file]/route.js
import { NextResponse } from 'next/server';
import { promises as fsPromises } from 'fs';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const MIME_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/MP2T',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const { id, file } = resolvedParams;
  const { searchParams } = new URL(request.url);
  const quality = searchParams.get('quality');

  const basePath = path.join(process.cwd(), 'public', 'uploads', 'videos', id);
  const filePath = path.join(basePath, file);

  if (!filePath.startsWith(basePath)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // 1. Обработка playlist.m3u8 для конкретного качества
  if (file === 'playlist.m3u8' || file.endsWith('.m3u8')) {
    try {
      let playlistContent = await fsPromises.readFile(filePath, 'utf-8');
      
      // Добавляем параметр quality ко всем .ts сегментам внутри плейлиста
      if (quality && quality !== '1080') {
        playlistContent = playlistContent.split('\n').map(line => {
          if (line.trim().endsWith('.ts')) {
            return `${line}?quality=${quality}`;
          }
          return line;
        }).join('\n');
      }

      return new NextResponse(playlistContent, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' }
      });
    } catch (error) {
      return new NextResponse('Playlist not found', { status: 404 });
    }
  }

  // 2. Транскодирование .ts сегментов "на лету" без сохранения новых файлов на диск
  if (file.endsWith('.ts') && quality && quality !== '1080') {
    if (!fs.existsSync(filePath)) {
      return new NextResponse('Segment not found', { status: 404 });
    }

    let scale = '-2:720';
    if (quality === '360') scale = '-2:360'; // Уменьшение разрешения

    const ffmpeg = spawn('ffmpeg', [
      '-i', filePath,
      '-vf', `scale=${scale}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // Максимальная скорость для real-time
      '-c:a', 'copy',
      '-f', 'mpegts',
      'pipe:1'
    ]);

    const stream = new ReadableStream({
      start(controller) {
        ffmpeg.stdout.on('data', (chunk) => controller.enqueue(chunk));
        ffmpeg.stdout.on('end', () => controller.close());
        ffmpeg.on('error', (err) => controller.error(err));
      },
      cancel() {
        ffmpeg.kill('SIGKILL');
      }
    });

    return new NextResponse(stream, {
      status: 200,
      headers: {
        'Content-Type': 'video/MP2T',
        'Cache-Control': 'public, max-age=31536000'
      }
    });
  }

  // 3. Отдача обычных файлов, картинок и оригинальных видео с поддержкой Range-запросов
  try {
    const stat = await fsPromises.stat(filePath);
    const ext = path.extname(file).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const range = request.headers.get('range');

    if (range && (ext === '.mp4' || ext === '.webm' || ext === '.ogg')) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunksize = (end - start) + 1;
      
      const stream = fs.createReadStream(filePath, { start, end });
      const webStream = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk) => controller.enqueue(chunk));
          stream.on('end', () => controller.close());
          stream.on('error', (err) => controller.error(err));
        }
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize.toString(),
          'Content-Type': contentType,
        },
      });
    }

    const fileStream = fs.createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      }
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': (ext === '.jpg' || ext === '.ts') ? 'public, max-age=31536000' : 'no-cache',
      }
    });

  } catch (error) {
    if (error.code === 'ENOENT') {
      return new NextResponse('File not found', { status: 404 });
    }
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}