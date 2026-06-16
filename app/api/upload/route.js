import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { NextResponse } from 'next/server';

export const maxBodySize = '500mb';

export async function POST(req) {
  try {
    const data = await req.formData();
    const file = data.get('file');
    const videoId = data.get('videoId');

    if (!file || !videoId) {
      return NextResponse.json({ error: 'Идентификатор или файл повреждены.' }, { status: 400 });
    }

    const videosDir = join(process.cwd(), 'public', 'videos');
    if (!existsSync(videosDir)) {
      await mkdir(videosDir, { recursive: true });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(join(videosDir, `${videoId}.mp4`), buffer);

    return NextResponse.json({ success: true, id: videoId });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}