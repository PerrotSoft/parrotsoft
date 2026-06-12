import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request, { params }) {
  const { id } = await params;
  
  // Здесь мы предполагаем, что финальные файлы лежат в папке /tmp/videos (или S3).
  // Настрой путь к месту, куда ты реально сохраняешь итоговый MP4 на сервере
  const filePath = path.join(process.cwd(), 'tmp', 'videos', `${id}.mp4`);
  
  if (!fs.existsSync(filePath)) {
    return new NextResponse("Video not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.get('range');

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 10 ** 6, fileSize - 1);
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    
    return new NextResponse(file, {
      status: 206, // Partial Content!
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      },
    });
  } else {
    return new NextResponse(fs.createReadStream(filePath), {
      headers: { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' }
    });
  }
}