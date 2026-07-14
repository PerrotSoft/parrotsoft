import { NextResponse } from 'next/server';
import * as actions from '@/app/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── GET: стриминг видео ────────────────────────────────────────────────────
// Раньше здесь создавался отдельный libsql-клиент и писался прямой SQL.
// Теперь route вообще не знает, что данные лежат в Turso — он просто
// просит actions.js отдать "видео с таким id" через root="videos".
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID видео не указан' }, { status: 400 });
    }

    const rawData = await actions.getVideoBlob(id);

    if (!rawData) {
      return new NextResponse('Video not found in database', { status: 404 });
    }

    const base64Data = rawData.toString().replace(/^data:[^;]+;base64,/, '');
    const videoBuffer = Buffer.from(base64Data, 'base64');
    const fileSize = videoBuffer.length;

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400, immutable',
    };

    const range = req.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const chunk = videoBuffer.subarray(start, end + 1);

      headers['Content-Range'] = `bytes ${start}-${end}/${fileSize}`;
      headers['Content-Length'] = chunksize;

      return new Response(chunk, { status: 206, headers });
    } else {
      headers['Content-Length'] = fileSize;
      return new Response(videoBuffer, { status: 200, headers });
    }
  } catch (err) {
    return new NextResponse('Error streaming video: ' + err.message, { status: 500 });
  }
}

// ─── POST: поэтапная загрузка кусков (чанков) ──────────────────────────────
export async function POST(req) {
  try {
    const body = await req.json();
    const { chunk, videoId, isFirst } = body;

    if (!chunk || !videoId) {
      return NextResponse.json({ error: 'Отсутствуют chunk или videoId' }, { status: 400 });
    }

    await actions.writeVideoChunk(videoId, chunk, isFirst);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/video] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
