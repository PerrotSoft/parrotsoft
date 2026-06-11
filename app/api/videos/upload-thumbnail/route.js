import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function POST(request) {
  try {
    const formData = await request.formData();
    const videoId = formData.get('videoId');
    const file = formData.get('file');

    if (!videoId || !file) {
      return NextResponse.json({ error: 'Отсутствуют обязательные параметры.' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    await client.execute({
      sql: `INSERT INTO thumbnails (video_id, image_data, mime_type) 
            VALUES (?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET image_data = excluded.image_data, mime_type = excluded.mime_type`,
      args: [String(videoId), buffer, file.type]
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}