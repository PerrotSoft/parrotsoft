// Загрузка файлов чата через обычный API route, а не через Server Action.
// Server Actions в Next.js по умолчанию ограничены ~1MB на тело запроса — из-за
// этого видео (и вообще любой файл покрупнее) не отправлялось. У route handler'а
// такого маленького лимита нет (см. остаточное примечание про хостинг ниже).
//
// Путь до actions.js подставлен из расчёта, что он лежит в app/actions.js —
// поправьте импорт, если у вас иначе.
import { storeFileBlob, hasFileBlob } from '../../actions';

export async function POST(req) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const hash = formData.get('hash');
    const type = formData.get('type') || 'application/octet-stream';

    if (!file || !hash) {
      return Response.json({ success: false, error: 'Нет файла или хэша' }, { status: 400 });
    }

    const already = await hasFileBlob(hash);
    if (!already) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const dataUrl = `data:${type};base64,${base64}`;
      const res = await storeFileBlob(hash, dataUrl, type);
      if (!res.success) {
        return Response.json({ success: false, error: res.error || 'Не удалось сохранить файл' }, { status: 500 });
      }
    }

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ⚠️ Если вы деплоите на Vercel: у serverless-функций там тоже есть лимит тела
// запроса (обычно 4.5MB на Hobby-плане, больше — на платных). Для действительно
// больших видео на Vercel нужен либо платный план, либо прямая загрузка в
// облачное хранилище (S3/Vercel Blob) в обход этого route. На своём сервере
// (Node.js напрямую, как у вас сейчас — судя по консоли, `npm run dev`) такого
// ограничения нет вообще.
