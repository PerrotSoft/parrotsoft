// Общая авторизация для двух новых API Вавичата:
//   - Bot API    (app/api/wavychat-bot/route.js)    — ограниченный набор методов для ботов
//   - Client API (app/api/wavychat-client/route.js) — полное зеркало возможностей Вавичата
//
// Схема авторизации намеренно самая простая и совместимая с тем, что уже есть
// в проекте (см. verifyPassword в actions.js — обычная проверка пароля
// аккаунта, без отдельной таблицы токенов): каждый запрос несёт username +
// password в теле. Это тот же принцип, что уже используется в других местах
// проекта (pdb_authorize, ad API — accountKey на каждый запрос), так что
// ничего нового в схему данных добавлять не пришлось.
//
// ⚠️ Если захотите позже сделать полноценные бот-токены (чтобы не гонять
// пароль аккаунта туда-сюда) — это отдельная небольшая доработка: добавить
// таблицу bot_tokens(token, owner_username, created_at) и заменить
// authenticateRequest() на проверку токена вместо verifyPassword. Роуты и
// реестр методов трогать не придётся.

import { verifyPassword } from '../actions';

export async function authenticateRequest(body) {
  const { username, password } = body || {};
  if (!username || !password) {
    return { ok: false, error: 'Укажите username и password', status: 401 };
  }
  const valid = await verifyPassword(username, password);
  if (!valid) {
    return { ok: false, error: 'Неверный логин или пароль', status: 401 };
  }
  return { ok: true, username: String(username) };
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function apiJson(data, status = 200) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

export function apiError(error, status = 400) {
  return apiJson({ success: false, error }, status);
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
