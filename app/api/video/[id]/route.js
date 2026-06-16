import { statSync, createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export async function GET(req, { params }) {
  const { id } = params;
  const videoPath = join(process.cwd(), 'public', 'videos', `${id}.mp4`);

  if (!existsSync(videoPath)) {
    return new NextResponse('Video not found', { status: 404 });
  }

  try {
    const stat = statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.get('range');

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const fileStream = createReadStream(videoPath, { start, end });

      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        }
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        },
      });
    } else {
      const fileStream = createReadStream(videoPath);
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
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        },
      });
    }
  } catch (err) {
    return new NextResponse('Error streaming video', { status: 500 });
  }
}