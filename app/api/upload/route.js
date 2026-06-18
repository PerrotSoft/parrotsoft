import { createClient } from '@libsql/client';
import { NextResponse } from 'next/server';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function POST(req) {
  try {
    const data = await req.json();
    const { chunk, videoId, isFirst } = data;

    if (isFirst) {
      // Создаем запись или перезаписываем, если загрузка началась с нуля
      await client.execute({
        sql: "UPDATE wt_videos SET video_data = ? WHERE id = ?",
        args: [chunk, videoId]
      });
    } else {
      // МАГИЯ: оператор || дописывает новый кусок к тому, что уже лежит в базе
      await client.execute({
        sql: "UPDATE wt_videos SET video_data = video_data || ? WHERE id = ?",
        args: [chunk, videoId]
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}