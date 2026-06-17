import { createClient } from '@libsql/client';
import { NextResponse } from 'next/server';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID видео не указан' }, { status: 400 });
    }

    const rs = await client.execute({
      sql: "SELECT video_data FROM wt_videos WHERE id = ?",
      args: [id]
    });

    if (rs.rows.length === 0 || !rs.rows[0].video_data) {
      return new NextResponse('Video not found in database', { status: 404 });
    }

    const base64Data = rs.rows[0].video_data.toString().replace(/^data:video\/\w+;base64,/, "");
    const videoBuffer = Buffer.from(base64Data, 'base64');
    const fileSize = videoBuffer.length;
    
    const range = req.headers.get('range');
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const chunk = videoBuffer.subarray(start, end + 1);

      return new Response(chunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        },
      });
    } else {
      return new Response(videoBuffer, {
        status: 200,
        headers: {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
        },
      });
    }
  } catch (err) {
    return new NextResponse('Error streaming video: ' + err.message, { status: 500 });
  }
}