// Client API Вавичата — «полная копия Вавичата, но через запросы», как и
// просили: почти всё, что умеет делать веб-интерфейс WavyChat (переписка,
// создание/управление чатами, участники, админы, реакции, опросы, звонки,
// аватар), доступно тем же HTTP-эндпоинтом — чтобы можно было писать
// альтернативные клиенты (десктоп, мобильный, консольный и т.д.), не трогая
// сам сайт.
//
// Авторизация та же схема, что и в Bot API — username + password аккаунта
// на каждый запрос (см. wavychatApiAuth.js, там же — как заменить на токены
// позже, если понадобится).
//
//   POST /api/wavychat-client
//   { "username": "...", "password": "...", "method": "createChat",
//     "params": { "title": "Тест", "type": "group", "privacy": "public" } }
//
// GET  /api/wavychat-client — список всех доступных методов (без авторизации).
//
// Единственное, что здесь намеренно НЕ доступно — смена/установка пароля
// аккаунта (changePassword/setInitialPassword) и вообще всё, что не касается
// самого Вавичата: это остаётся только через основной сайт, чтобы кража
// одного bot/client-запроса не превращалась в захват аккаунта целиком.
import { authenticateRequest, apiJson, apiError, handleOptions } from '../../lib/wavychatApiAuth';
import { callMethod, methodsFor } from '../../lib/wavychatApiMethods';

export async function OPTIONS() {
  return handleOptions();
}

export async function GET() {
  return apiJson({
    success: true,
    api: 'wavychat-client',
    methods: methodsFor('client'),
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

  const res = await callMethod(method, params, { username: auth.username }, 'client');
  const { status, ...payload } = res;
  return apiJson(payload, status || 200);
}
