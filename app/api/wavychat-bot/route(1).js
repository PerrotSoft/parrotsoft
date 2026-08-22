// Bot API Вавичата.
//
// Как пользоваться (пример на fetch, но подойдёт любой HTTP-клиент):
//
//   POST /api/wavychat-bot
//   { "username": "мой_бот_аккаунт", "password": "...", "method": "sendMessage",
//     "params": { "chatId": "abc123", "text": "Привет от бота!" } }
//
// GET  /api/wavychat-bot — список доступных методов бота (без авторизации,
// просто справка, ничего секретного не отдаёт).
//
// Бот — это обычный аккаунт Вавичата (заведите его как любой другой
// пользователь), просто общающийся через этот HTTP-эндпоинт вместо веб-интерфейса.
// Набор методов сюда осознанно ограничен тем, что нужно боту (сообщения,
// реакции, опросы, чтение списка чатов) — управление чатом целиком (кик,
// смена приватности, удаление чата и т.д.) доступно только в Client API
// (см. app/api/wavychat-client/route.js), чтобы случайно скомпрометированный
// бот-токен не мог разнести весь чат.
import { authenticateRequest, apiJson, apiError, handleOptions } from '../../lib/wavychatApiAuth';
import { callMethod, methodsFor } from '../../lib/wavychatApiMethods';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET() {
  return apiJson({
    success: true,
    api: 'wavychat-bot',
    methods: methodsFor('bot'),
    usage: 'POST { username, password, method, params }',
  });
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return apiError('Тело запроса должно быть JSON', 400);
  }

  const auth = await authenticateRequest(body);
  if (!auth.ok) return apiError(auth.error, auth.status);

  const { method, params } = body;
  if (!method) return apiError('Не указан method', 400);

  const res = await callMethod(method, params, { username: auth.username }, 'bot');
  const { status, ...payload } = res;
  return apiJson(payload, status || 200);
}
