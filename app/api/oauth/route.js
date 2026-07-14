import { NextResponse } from 'next/server';
import * as actions from '@/app/actions';

// POST /api/oauth  { grant_type: 'authorization_code', code, client_id, client_secret, redirect_uri }
// Вызывается СЕРВЕРОМ стороннего приложения (не браузером), меняет code на access_token.
export async function POST(req) {
  try {
    const body = await req.json();
    const { code, client_id, client_secret, redirect_uri } = body;

    if (!code || !client_id || !client_secret || !redirect_uri) {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }

    const result = await actions.exchangeOAuthCode(code, client_id, client_secret, redirect_uri);
    if (result.error) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: 'server_error', message: e.message }, { status: 500 });
  }
}

// GET /api/oauth?action=userinfo  (заголовок Authorization: Bearer <access_token>)
// Тоже вызывается сервером стороннего приложения — отдаёт минимальный профиль.
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('action') !== 'userinfo') {
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : searchParams.get('access_token');
    if (!token) return NextResponse.json({ error: 'invalid_token' }, { status: 401 });

    const info = await actions.getOAuthUserInfo(token);
    if (info.error) return NextResponse.json(info, { status: 401 });
    return NextResponse.json(info);
  } catch (e) {
    return NextResponse.json({ error: 'server_error', message: e.message }, { status: 500 });
  }
}
