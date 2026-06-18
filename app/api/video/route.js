import { createClient } from '@libsql/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

function getClient() {
  return createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// ─── GET: стриминг видео ────────────────────────────────────────────────────
export async function GET(req) {
  const client = getClient();
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID видео не указан' }, { status: 400 });
    }

    const rs = await client.execute({
      sql: "SELECT video_data FROM wt_videos WHERE id = ?",
      args: [id],
    });

    if (rs.rows.length === 0 || !rs.rows[0].video_data) {
      return new NextResponse('Video not found in database', { status: 404 });
    }

    const base64Data = rs.rows[0].video_data.toString().replace(/^data:[^;]+;base64,/, '');
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

// ─── POST: загрузка чанков ──────────────────────────────────────────────────
export async function POST(req) {
  const client = getClient();
  try {
    let body;
    try {
      body = await req.json();
    } catch (parseErr) {
      return NextResponse.json({ error: 'Невалидный JSON: ' + parseErr.message }, { status: 400 });
    }

    const { chunk, videoId, isFirst, isLast } = body;

    if (!chunk || !videoId) {
      return NextResponse.json({ error: 'Отсутствуют chunk или videoId' }, { status: 400 });
    }

    // Убираем любой data:-префикс на случай если он остался
    const cleanChunk = chunk.replace(/^data:[^;]+;base64,/, '').replace(/=+$/, '');

    if (isFirst) {
      // UPSERT: создаём строку или перезаписываем video_data с нуля
      await client.execute({
        sql: `INSERT INTO wt_videos (id, video_data) VALUES (?, ?)
              ON CONFLICT(id) DO UPDATE SET video_data = excluded.video_data`,
        args: [videoId, cleanChunk],
      });
    } else {
      // Дописываем чанк к существующим данным
      await client.execute({
        sql: "UPDATE wt_videos SET video_data = video_data || ? WHERE id = ?",
        args: [cleanChunk, videoId],
      });
    }

    // Последний чанк: восстанавливаем base64-паддинг '='
    if (isLast) {
      await client.execute({
        sql: `UPDATE wt_videos SET video_data = video_data ||
              CASE (LENGTH(video_data) % 4)
                WHEN 2 THEN '=='
                WHEN 3 THEN '='
                ELSE ''
              END
              WHERE id = ?`,
        args: [videoId],
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/video] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}