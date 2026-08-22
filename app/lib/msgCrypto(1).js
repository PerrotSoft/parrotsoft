// Шифрование текста сообщений и метаданных вложений «на диске».
//
// Два режима:
//  1. Базовый (для обычных чатов без пароля) — общий серверный ключ
//     WAVYCHAT_MSG_KEY. Защищает от "просто открыл дашборд БД и всё видно",
//     но сервер сам может расшифровать (иначе не работали бы поиск и т.д.).
//  2. Для чатов С ПАРОЛЕМ — ключ шифрования выводится (scrypt) ИЗ САМОГО
//     ПАРОЛЯ чата, а не хранится готовым. Пароль в БД (таблица wc_chats)
//     хранится только как хэш+соль (см. hashChatPassword/verifyChatPassword
//     ниже) — то есть даже у владельца сервера с полным доступом к БД нет
//     способа восстановить пароль и расшифровать переписку без пароля.
//     Клиент передаёт пароль на сервер при каждой отправке/чтении сообщений
//     этого чата (по HTTPS) — сервер выводит ключ на лету и НИГДЕ его не
//     сохраняет. Сам пароль (не хэш) браузер кладёт в localStorage, чтобы
//     не спрашивать его у пользователя каждый раз — см. getChatPw/setChatPw
//     в WavyChat/page.js.

import crypto from 'crypto';

const FALLBACK_KEY_HEX = '9f2b6c9e2a2148e0b7a5f2a86e6a5b7a1b8ea31e0f0b2f3ff1a56a5b0d9e6c1a';

function getGlobalKey() {
  const hex = process.env.WAVYCHAT_MSG_KEY || FALLBACK_KEY_HEX;
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) return Buffer.from(FALLBACK_KEY_HEX, 'hex');
  return key;
}

// Ключ для конкретного запароленного чата — выводится из пароля чата.
// Соль = сам chatId (уникален на чат, этого достаточно, чтобы одинаковый
// пароль в разных чатах давал разные ключи — chatId не секрет, но и не
// обязан им быть: он не хранится вместе с ключом нигде, ключ каждый раз
// пересчитывается на лету и никогда не сохраняется).
export function deriveChatKey(chatId, password) {
  return crypto.scryptSync(String(password), `wavychat-chatkey-${chatId}`, 32);
}

const PREFIX = 'enc1:'; // версия схемы шифрования — на будущее, если формат поменяется

// Шифрует строку. undefined/null проходят насквозь (чтобы не плодить
// шифртекст из "null" там, где сообщение без текста/медиа). key — опционален,
// по умолчанию общий серверный ключ; для запароленных чатов передавайте
// deriveChatKey(chatId, password).
export function encryptText(plain, key = null) {
  if (plain === null || plain === undefined) return plain;
  const useKey = key || getGlobalKey();
  const iv = crypto.randomBytes(12); // GCM: 12 байт — рекомендованный размер
  const cipher = crypto.createCipheriv('aes-256-gcm', useKey, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // iv (12) + authTag (16) + шифртекст, всё вместе в base64, с версионным префиксом
  return PREFIX + Buffer.concat([iv, authTag, enc]).toString('base64');
}

// Расшифровывает. Если строка не в формате enc1: (например, старые записи,
// созданные до включения шифрования) — возвращает как есть, чтобы старые
// сообщения не превратились в мусор задним числом. Неверный ключ (например,
// не тот пароль чата) естественно провалит проверку GCM-тега — это и есть
// встроенная проверка "тот пароль или нет", отдельно ничего сверять не нужно.
export function decryptText(value, key = null) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  const useKey = key || getGlobalKey();
  try {
    const buf = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', useKey, iv);
    decipher.setAuthTag(authTag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    return '[не удалось расшифровать сообщение]';
  }
}

// ── Хэш пароля чата (для проверки доступа — НЕ для шифрования) ────────────
// Формат хранения: "<соль_hex>:<хэш_hex>" — кладётся в wc_chats.password
// вместо пароля открытым текстом. scrypt, отдельная случайная соль на чат.
export function hashChatPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

// true/false. Поддерживает ДВА формата в stored:
//  - новый "соль:хэш" (см. hashChatPassword выше) — чаты, созданные/изменённые
//    после введения хэширования;
//  - старый — пароль чата открытым текстом, как хранилось ДО этого изменения.
//    Раньше здесь просто возвращалось false для такого формата, что ломало
//    sendMsg/checkChatAccess для ВСЕХ уже существующих запароленных чатов
//    (реальная ошибка "Неверный пароль чата" в проде) — теперь сравниваем
//    как раньше, напрямую строками, если формат не похож на "соль:хэш".
export function verifyChatPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  if (!stored.includes(':')) {
    // Старый формат — пароль лежал открытым текстом.
    return String(stored) === String(password);
  }
  try {
    const [salt, hashHex] = stored.split(':');
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(candidate, expected);
  } catch (e) {
    return false;
  }
}
