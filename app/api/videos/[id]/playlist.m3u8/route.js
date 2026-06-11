import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const quality = searchParams.get('quality') || '1080p';

    // Получаем оригинальный список файлов, загруженных с клиента
    const rs = await client.execute({
      sql: "SELECT filename FROM video_hls_files WHERE video_id = ? AND filename LIKE '%.ts' ORDER BY filename ASC",
      args: [String(id)]
    });

    if (rs.rows.length === 0) {
      return new Response("Сегменты не найдены", { status: 404 });
    }

    let playlist = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n`;
    
    // Формируем ссылки на каждый сегмент, пробрасывая параметр качества для транскодирования
    for (const row of rs.rows) {
      playlist += `#EXTINF:4.000000,\n/api/videos/${id}/segment/${row.filename}?quality=${quality}\n`;
    }
    
    playlist += `#EXT-X-ENDLIST`;

    return new Response(playlist, {
      headers: {
        'Content-Type': 'application/x-mpegURL',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}