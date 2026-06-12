import { put } from '@vercel/blob';
import { createClient } from '@libsql/client';
import { NextResponse } from 'next/server';

// Проверка наличия переменных при запуске
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const username = formData.get('username');
    const title = formData.get('title') || 'Без названия';
    const description = formData.get('description') || '';
    const videoSettings = formData.get('settings') || '{}';
    const isShort = formData.get('isShort') === '1' ? 1 : 0;
    const videoId = formData.get('videoId');

    if (!file || !username || !videoId) {
      return NextResponse.json({ error: 'Недостаточно данных' }, { status: 400 });
    }

    // 1. Загрузка файла в Vercel Blob
    const blob = await put(`${videoId}.mp4`, file, {
      access: 'public',
    });

    // 2. Сохранение метаданных в Turso
    await client.execute({
      sql: "INSERT INTO videos (id, channel_id, title, description, url, settings, is_short) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [String(videoId), String(username), String(title), String(description), blob.url, String(videoSettings), isShort]
    });

    return NextResponse.json({ success: true, url: blob.url });
  } catch (error) {
    console.error('Ошибка загрузки:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}