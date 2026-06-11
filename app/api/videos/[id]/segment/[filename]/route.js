import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(request, { params }) {
  try {
    const { id, filename } = await params;

    // Мгновенный запрос фрагмента из БД
    const rs = await client.execute({
      sql: "SELECT data FROM video_hls_files WHERE video_id = ? AND filename = ?",
      args: [String(id), String(filename)]
    });

    if (rs.rows.length === 0 || !rs.rows[0].data) {
      return new Response("Сегмент не найден", { status: 404 });
    }

    // Конвертируем бинарные данные (BLOB) в буфер
    const buffer = Buffer.from(rs.rows[0].data);

    // Отдаем клиенту с мощным кэшированием (чтобы плеер не запрашивал один кусок дважды)
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'video/MP2T',
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error("Ошибка отдачи сегмента:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}