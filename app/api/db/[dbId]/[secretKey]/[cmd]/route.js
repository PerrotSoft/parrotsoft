import { NextResponse } from 'next/server';
import * as actions from '@/app/actions';

// Настройка для работы с большими файлами
export const config = {
    api: { bodyParser: { sizeLimit: '100mb' } },
};

// Заголовки для обхода блокировок браузера (CORS)
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
    return NextResponse.json({}, { headers });
}

export async function POST(request, { params }) {
    const { dbId, secretKey, cmd } = await params;
    try {
        const result = await actions.findDbAndOwner(dbId);
        if (!result) return NextResponse.json({ error: "DB Not Found" }, { status: 404, headers });

        const { owner, db, allDocs } = result;
        if (db.secretKey !== secretKey) return NextResponse.json({ error: "Invalid Key" }, { status: 403, headers });

        const limit = db.maxSize || 2097152;
        const body = await request.json();
        let content = db.content || {};

        switch (cmd) {
            case 'write_all':
                const sizeAll = JSON.stringify(body).length;
                if (sizeAll > limit) return NextResponse.json({ error: "Quota Exceeded", limit }, { status: 413, headers });
                await actions.pdb_update(owner, dbId, body, allDocs);
                return NextResponse.json({ ok: true, size: sizeAll }, { headers });

            case 'write_cell':
                if (!body.key) return NextResponse.json({ error: "Key missing" }, { status: 400, headers });
                const nextContent = { ...content, [body.key]: body.val };
                const sizeCell = JSON.stringify(nextContent).length;
                if (sizeCell > limit) return NextResponse.json({ error: "Quota Exceeded", limit }, { status: 413, headers });
                await actions.pdb_update(owner, dbId, nextContent, allDocs);
                return NextResponse.json({ ok: true, size: sizeCell }, { headers });

            default:
                return NextResponse.json({ error: "Unknown POST cmd" }, { status: 400, headers });
        }
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500, headers });
    }
}

export async function GET(request, { params }) {
    const { dbId, secretKey, cmd } = await params;
    const { searchParams } = new URL(request.url);
    try {
        const result = await actions.findDbAndOwner(dbId);
        if (!result) return NextResponse.json({ error: "Not Found" }, { status: 404, headers });
        const { owner, db, allDocs } = result;
        if (db.secretKey !== secretKey) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });

        let content = db.content || {};
        const limit = db.maxSize || 2097152;

        switch (cmd) {
            case 'read_all':
                return NextResponse.json(content, { headers });

            case 'read_cell':
                const key = searchParams.get('key');
                return NextResponse.json({ key, val: content[key] || null }, { headers });

            case 'del_cell':
                const dKey = searchParams.get('key');
                if (content.hasOwnProperty(dKey)) {
                    delete content[dKey];
                    await actions.pdb_update(owner, dbId, content, allDocs);
                    return NextResponse.json({ ok: true }, { headers });
                }
                return NextResponse.json({ error: "Not found" }, { status: 404, headers });

            case 'search':
                const query = searchParams.get('q')?.toLowerCase();
                const results = Object.keys(content)
                    .filter(k => k.toLowerCase().includes(query) || JSON.stringify(content[k]).toLowerCase().includes(query))
                    .reduce((obj, k) => { obj[k] = content[k]; return obj; }, {});
                return NextResponse.json(results, { headers });

            case 'stats':
                const size = JSON.stringify(content).length;
                return NextResponse.json({
                    id: dbId,
                    name: db.name,
                    sizeBytes: size,
                    limitBytes: limit,
                    percent: ((size / limit) * 100).toFixed(2) + "%",
                    free: limit - size
                }, { headers });

            default:
                return NextResponse.json({ error: "Unknown GET cmd" }, { status: 400, headers });
        }
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500, headers });
    }
}