// route.js
import { createClient } from '@libsql/client';
import { NextResponse } from 'next/server';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export const maxBodySize = '500mb'; 

export async function POST(req) {
  try {
    const data = await req.formData();
    const base64Video = data.get('base64');
    const videoId = data.get('videoId');

    if (!base64Video || !videoId) {
      return NextResponse.json({ error: 'Не хватает данных.' }, { status: 400 });
    }

    await client.execute({
      sql: "UPDATE wt_videos SET video_data = ? WHERE id = ?",
      args: [base64Video, videoId]
    });

    return NextResponse.json({ success: true, id: videoId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}