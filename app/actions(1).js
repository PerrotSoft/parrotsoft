'use server';

import { createClient } from '@libsql/client';
import crypto from 'crypto';
import { encryptText, decryptText, deriveChatKey, hashChatPassword, verifyChatPassword } from './lib/msgCrypto';
import { VECTOR_DIMS, textToVector, parseVector, vectorToJson, cosineSimilarity, nudge } from './lib/recommendVectors';
import { MAX_CHANNELS_PER_ACCOUNT, DRIVE_QUOTA_BYTES } from './lib/siteConfig';

// ВАЖНО: реальные ключи доступа к базе больше не хранятся в коде как fallback —
// это боевой токен, и он был виден в открытом виде прямо в исходнике.
// Задайте TURSO_DATABASE_URL и TURSO_AUTH_TOKEN в переменных окружения
// (.env.local локально, Environment Variables в Vercel и т.д.).
if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error(
    'TURSO_DATABASE_URL / TURSO_AUTH_TOKEN не заданы в переменных окружения. ' +
    'Старый хардкод токена в коде убран, т.к. он был реальным боевым ключом — ' +
    'пропишите те же значения в .env.local / настройках хостинга и, по-хорошему, ротируйте токен.'
  );
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Транспортные обрывы до Turso (ETIMEDOUT/ECONNRESET/DNS и т.п.) — обычно
// разовая сетевая заминка, а не настоящая ошибка запроса. Оборачиваем
// client.execute() ретраем с бэкоффом ПРОЗРАЧНО для всего остального кода —
// ни одно из ~150 существующих мест, где вызывается client.execute, трогать
// не нужно, они все получают устойчивость автоматически. Настоящие ошибки
// (плохой SQL, конфликт данных и т.д.) как падали, так и падают — ретраим
// только сетевые/системные сбои.
const rawExecute = client.execute.bind(client);
client.execute = async (...args) => {
  const maxAttempts = 3;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await rawExecute(...args);
    } catch (e) {
      lastErr = e;
      const transient = e?.code === 'ETIMEDOUT' || e?.code === 'ECONNRESET' || e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN' || e?.type === 'system';
      if (!transient || attempt === maxAttempts - 1) throw e;
      await new Promise(r => setTimeout(r, 300 * (attempt + 1))); // 300ms, затем 600ms
    }
  }
  throw lastErr;
};

const ensureTables = once(async function ensureTables() {
  await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
  // Таблица transactions раньше создавалась отдельной копией ensureTables
  // прямо в app/layout.js — переносим сюда, чтобы миграция была одна на всё.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user TEXT,
      amount REAL,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ─────────────────────────────────────────────────────────────────────────
// PAYPAL: приём платежей (создание/подтверждение заказа)
// ─────────────────────────────────────────────────────────────────────────
// Раньше жило прямо в app/layout.js со своим захардкоженным client id/secret
// (это sandbox-ключи PayPal, не боевые, но хардкодить их всё равно не стоит —
// переехали в переменные окружения, значения те же самые, чтобы ничего не
// сломать; пропишите их в .env.local, см. .env.local.additions).
const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = 'https://api-m.sandbox.paypal.com';

async function getPayPalToken() {
  if (!PAYPAL_CLIENT || !PAYPAL_SECRET) {
    console.error('[PayPal] PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET не заданы в переменных окружения — платежи через PayPal отключены.');
    return null;
  }
  try {
    const auth = Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString('base64');
    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
      method: 'POST',
      body: 'grant_type=client_credentials',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      cache: 'no-store'
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("[SERVER] Ошибка авторизации PayPal:", errorData);
      return null;
    }

    const data = await response.json();
    return data.access_token;
  } catch (e) {
    console.error("[SERVER] Ошибка при получении токена:", e.message);
    return null;
  }
}

export async function createPaySession(username, amount) {
  'use server';
  try {
    console.log(`[SERVER] Попытка создания оплаты для ${username} на сумму ${amount}`);

    const token = await getPayPalToken();
    if (!token) return null;

    // Лимит Sandbox обычно 5000-10000 USD. Сумма 54543 слишком велика.
    // Для теста принудительно ограничим сумму, если она огромная.
    let safeAmount = parseFloat(amount);
    if (safeAmount > 5000) safeAmount = 5000;

    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: safeAmount.toFixed(2)
          },
          custom_id: username
        }]
      }),
      cache: 'no-store'
    });

    const order = await res.json();

    if (order.id) {
      console.log("[SERVER] Сессия создана:", order.id);
      return order.id;
    } else {
      console.error("[SERVER] PayPal вернул ошибку:", JSON.stringify(order, null, 2));
      return null;
    }
  } catch (error) {
    console.error("[SERVER] Критическая ошибка:", error);
    return null;
  }
}

export async function finalizeAndAddBalance(orderID, username) {
  'use server';
  try {
    const token = await getPayPalToken();
    if (!token) return { success: false };

    const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      cache: 'no-store'
    });

    const data = await res.json();

    if (data.status === 'COMPLETED') {
      const paidAmount = data.purchase_units[0].payments.captures[0].amount.value;

      const userData = await getRawUserData(username);
      userData.balance = (Number(userData.balance) || 0) + Number(paidAmount);

      await client.execute({
        sql: "UPDATE users SET data = ? WHERE username = ?",
        args: [JSON.stringify(userData), username]
      });

      return { success: true, newBalance: userData.balance };
    }
    console.warn("[SERVER] Оплата не завершена. Статус:", data.status);
  } catch (e) {
    console.error("[SERVER] Ошибка захвата средств:", e);
  }
  return { success: false };
}

// ─────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────
// db.* — ЕДИНАЯ ТОЧКА ДОСТУПА К ДАННЫМ. Единственное место во всём файле,
// где встречается SQL. Весь остальной код (все функции ниже, и весь остальной
// проект) обращается ТОЛЬКО к db.get/db.upsert/db.update/db.find/db.remove/
// db.getField/db.setField — и никогда напрямую к client.execute с SQL внутри.
//
// Первый параметр везде — имя структуры (= имя таблицы), например
// db.get('wt_videos', id) или db.get('users', username, 'username').
//
// Если завтра нужно переехать с SQL на что-то другое (JSON-файлы, другая
// БД) — меняется ТОЛЬКО код внутри db{} ниже. Все ~50+ функций дальше по
// файлу, которые зовут db.*, трогать не нужно вообще.
//
// db.config.writesEnabled — небольшой рубильник: если false, любая запись
// (set/upsert/update/remove) молча ничего не делает. Пригодится, например,
// как аварийный "только чтение" режим или заготовка под синхронизацию с
// ещё одной БД в будущем.
const db = {
  config: {
    writesEnabled: true,
  },

  // Получить одну запись целиком по значению id-колонки (по умолчанию 'id').
  async get(struct, idValue, idColumn = 'id') {
    if (idValue === undefined || idValue === null) return null;
    const rs = await client.execute({
      sql: `SELECT * FROM ${struct} WHERE ${idColumn} = ?`,
      args: [idValue],
    });
    return rs.rows[0] || null;
  },

  // Получить значение ОДНОЙ колонки одной записи (например, video_data).
  async getField(struct, idValue, field, idColumn = 'id') {
    const rs = await client.execute({
      sql: `SELECT ${field} AS value FROM ${struct} WHERE ${idColumn} = ?`,
      args: [idValue],
    });
    return rs.rows[0]?.value ?? null;
  },

  // Создать запись или полностью заменить существующую по id (upsert).
  // data — обычный JS-объект { колонка: значение }.
  async upsert(struct, idColumn, idValue, data) {
    if (!db.config.writesEnabled) return null;
    const columns = [idColumn, ...Object.keys(data)];
    const values = [idValue, ...Object.values(data)];
    const placeholders = columns.map(() => '?').join(', ');
    const updateSet = Object.keys(data).map(c => `${c} = excluded.${c}`).join(', ');
    await client.execute({
      sql: `INSERT INTO ${struct} (${columns.join(', ')}) VALUES (${placeholders})
            ON CONFLICT(${idColumn}) DO UPDATE SET ${updateSet}`,
      args: values,
    });
    return true;
  },

  // Точечное обновление части полей записи (без чтения-изменения-записи).
  // fields: { колонка: значение } либо { колонка: { raw: 'колонка + ?', arg: 1 } }
  // для случаев вроде "video_data = video_data || ?" или "budget = budget - ?".
  async update(struct, idColumn, idValue, fields) {
    if (!db.config.writesEnabled) return null;
    const sets = [];
    const args = [];
    for (const [col, val] of Object.entries(fields)) {
      if (val && typeof val === 'object' && 'raw' in val) {
        sets.push(`${col} = ${val.raw}`);
        if ('arg' in val) args.push(val.arg);
      } else {
        sets.push(`${col} = ?`);
        args.push(val);
      }
    }
    args.push(idValue);
    await client.execute({
      sql: `UPDATE ${struct} SET ${sets.join(', ')} WHERE ${idColumn} = ?`,
      args,
    });
    return true;
  },

  // Найти несколько записей: where — { колонка: значение }, orderBy/limit — строки/числа.
  // Для действительно нестандартных случаев (RANDOM(), JOIN, LIKE по нескольким
  // колонкам, агрегаты AVG/COUNT) используйте db.raw — это редкий, явно
  // помеченный "люк", а не общий путь.
  async find(struct, { where = {}, orderBy, limit } = {}) {
    const cols = Object.keys(where);
    const whereSql = cols.length ? `WHERE ${cols.map(c => `${c} = ?`).join(' AND ')}` : '';
    const orderSql = orderBy ? `ORDER BY ${orderBy}` : '';
    const limitSql = limit ? `LIMIT ${Number(limit)}` : '';
    const rs = await client.execute({
      sql: `SELECT * FROM ${struct} ${whereSql} ${orderSql} ${limitSql}`.trim(),
      args: cols.map(c => where[c]),
    });
    return rs.rows.map(r => ({ ...r }));
  },

  async remove(struct, where) {
    if (!db.config.writesEnabled) return null;
    const cols = Object.keys(where);
    await client.execute({
      sql: `DELETE FROM ${struct} WHERE ${cols.map(c => `${c} = ?`).join(' AND ')}`,
      args: cols.map(c => where[c]),
    });
    return true;
  },

  // Явный, редко используемый "люк" для запросов, которые не ложатся в
  // get/upsert/update/find (агрегаты, JOIN, RANDOM() и т.п.). Использование
  // этого метода — сигнал "тут особый случай", а не общий путь для новых функций.
  async raw(sql, args = []) {
    return client.execute({ sql, args });
  },
};

// ─────────────────────────────────────────────────────────────────────────
// once(fn): выполняет асинхронную миграцию (CREATE TABLE IF NOT EXISTS и т.д.)
// РОВНО ОДИН РАЗ за жизнь процесса, вместо того чтобы гонять её на каждый
// вызов API. Раньше initWavyDB/initParrotDB/initAdsDBFull и т.д. дёргались
// (и делали по 5-10 SQL-запросов, включая PRAGMA + ALTER TABLE) буквально
// на каждый вызов каждой функции — это была основная причина медленных и
// нестабильных ответов API. Теперь миграция реально происходит один раз.
// Если первая попытка упала (например, БД была недоступна) — следующий
// вызов попробует снова, а не останется навсегда "сломанным".
function once(fn) {
  let inFlight = null;
  return async function (...args) {
    if (!inFlight) {
      inFlight = fn.apply(this, args).catch((err) => {
        inFlight = null;
        throw err;
      });
    }
    return inFlight;
  };
}

// ── Возраст аккаунта ────────────────────────────────────────────────────────
// Считаем возраст по дате рождения каждый раз заново (а не берём один раз сохранённое
// число) — иначе возраст "застывает" на момент регистрации и не растёт с годами/днём рождения.
// Если дата некорректна/не задана — 12 лет по умолчанию (безопасное консервативное значение,
// ограничивающее доступ к 18+/эротическому контенту).
function computeAgeFromBirthDate(birthDate) {
  const birth = new Date(birthDate);
  if (isNaN(birth.getTime())) return 12;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age--;
  return age >= 0 ? age : 12;
}

export async function syncDocs(username, docsData) {
  'use server';
  const userData = await getRawUserData(username);
  userData.docs = docsData;
  await saveUserData(username, userData);
}

export async function getDocs(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.docs || [];
}


export async function setUserBirthDate(username, birthDate) {
  'use server';
  if (!username) return { error: 'no_username' };
  await ensureTables();
  const userData = await getRawUserData(username);
  const age = computeAgeFromBirthDate(birthDate);
  userData.birthDate = birthDate;
  userData.age = age;
  await saveUserData(username, userData);
  return { success: true, age };
}
export async function getRawUserData(username) {
  const row = await db.get('users', String(username), 'username');
  if (row && row.data) {
    const rawContent = row.data;
    try {
      const parsed = JSON.parse(rawContent);
      
      // Перередактирование / перенос данных: если параметра нет в корне пользователя, но он есть в ОС
      if (!parsed.birthDate && parsed.os) {
        let osBirth = null;
        if (typeof parsed.os === 'object' && parsed.os !== null) {
          osBirth = parsed.os.birthDate;
        } else if (typeof parsed.os === 'string') {
          try {
            const pOs = JSON.parse(parsed.os);
            osBirth = pOs?.birthDate;
          } catch (e) {}
        }
        if (osBirth) parsed.birthDate = osBirth;
      }

      parsed.age = parsed.birthDate ? computeAgeFromBirthDate(parsed.birthDate) : (parsed.age || 12);
      if (!parsed.drive) parsed.drive = { files: [], folders: [] };
      if (!parsed.projects) parsed.projects = []; 
      return parsed;
    } catch (e) {
      return { 
        os: rawContent, 
        age: 12,
        drive: { files: [], folders: [] },
        birthDate: null,
        projects: []
      };
    }
  }
  return { os: null, age: 12, drive: { files: [], folders: [] }, projects: [] };
}

// Сохранить JSON-блоб пользователя (users.data). Раньше этот же самый SQL
// (INSERT ... ON CONFLICT ... DO UPDATE) был скопирован вручную в 8 местах
// по всему файлу — теперь это один вызов db.upsert.
async function saveUserData(username, userData) {
  await db.upsert('users', 'username', String(username), { data: JSON.stringify(userData) });
}

// ─────────────────────────────────────────────────────────────────────────
// ПАРОЛЬ АККАУНТА (хэш + соль, scrypt). Раньше пароля у аккаунтов не было
// вообще — /api/pc?cmd=auth принимал любой пароль. Теперь пароль реально
// хранится (хэш + соль в JSON-профиле пользователя) и реально проверяется.
// ─────────────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

// Строгая проверка: false, если пароль неверный ИЛИ если у аккаунта пароль
// ещё не задан вообще (намеренно — see setInitialPassword ниже).
export async function verifyPassword(username, password) {
  'use server';
  if (!username || !password) return false;
  const userData = await getRawUserData(username);
  if (!userData.passwordHash || !userData.passwordSalt) return false;
  try {
    const candidate = hashPassword(password, userData.passwordSalt);
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(userData.passwordHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

// Задать пароль аккаунту В ПЕРВЫЙ РАЗ. Намеренно НЕ работает, если пароль
// уже есть (чтобы это нельзя было использовать для угона аккаунта — только
// changePassword ниже может заменить существующий пароль, и то по старому
// паролю). Вызывать это можно только для пользователя, который уже вошёл
// через существующую (доверенную) сессию сайта — не через анонимный auth.
export async function setInitialPassword(username, newPassword) {
  'use server';
  if (!username || !newPassword) return { success: false, error: 'Missing username or password' };
  const userData = await getRawUserData(username);
  if (userData.passwordHash) return { success: false, error: 'Пароль уже установлен, используйте смену пароля' };
  const salt = crypto.randomBytes(16).toString('hex');
  userData.passwordSalt = salt;
  userData.passwordHash = hashPassword(newPassword, salt);
  await saveUserData(username, userData);
  return { success: true };
}

// Смена пароля — требует правильный старый пароль.
export async function changePassword(username, oldPassword, newPassword) {
  'use server';
  if (!newPassword) return { success: false, error: 'Missing new password' };
  const ok = await verifyPassword(username, oldPassword);
  if (!ok) return { success: false, error: 'Неверный текущий пароль' };
  const userData = await getRawUserData(username);
  const salt = crypto.randomBytes(16).toString('hex');
  userData.passwordSalt = salt;
  userData.passwordHash = hashPassword(newPassword, salt);
  await saveUserData(username, userData);
  return { success: true };
}

// ── TOTP / Аутентификатор (RFC 6238) ─────────────────────────────────────
// Реализация без внешних пакетов — только встроенный crypto.
// Совместимо с Google Authenticator, Yandex Key, Aegis и любым другим
// TOTP-приложением.
//
// Как работает:
//  1. setupTotp()     — генерирует секрет, возвращает otpauth:// URI для QR
//  2. verifyTotp()    — проверяет 6-значный код (окно ±1 период = 90 сек)
//  3. enableTotp()    — активирует 2FA на аккаунте (после подтверждения кода)
//  4. disableTotp()   — отключает 2FA (требует текущий пароль)
//  5. verifyPassword() — уже умеет проверять TOTP вместо пароля, если
//                        у аккаунта установлен флаг totpOnly (для входа
//                        "логин + код без пароля")
//
// Хранение: секрет пишется в зашифрованный JSON-блоб пользователя
// (userData.totpSecret). Не в открытом виде — он проходит через
// encryptText()/decryptText() из lib/msgCrypto.js.

// RFC 4648 Base32 без паддинга
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0, out = '';
  for (let i = 0; i < buf.length; i++) {
    val = (val << 8) | buf[i];
    bits += 8;
    while (bits >= 5) { out += alphabet[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  str = str.toUpperCase().replace(/[= ]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of str) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function totpCode(secret, counter) {
  const key = base32Decode(secret);
  const msg = Buffer.allocUnsafe(8);
  // BigInt для 64-бит счётчика
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { msg[i] = Number(c & 0xffn); c >>= 8n; }
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[19] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset+1] << 16 | hmac[offset+2] << 8 | hmac[offset+3]) % 1000000;
  return String(code).padStart(6, '0');
}

function totpIsValid(secret, userCode, windowSteps = 1) {
  const now = Math.floor(Date.now() / 1000 / 30);
  for (let d = -windowSteps; d <= windowSteps; d++) {
    if (totpCode(secret, now + d) === String(userCode).trim()) return true;
  }
  return false;
}

// Генерирует новый секрет (не активирует — до вызова enableTotp 2FA не
// включена). Возвращает { secret (base32), uri (otpauth://...) } для QR.
export async function setupTotp(username) {
  'use server';
  if (!username) return { success: false, error: 'Нет имени пользователя' };
  const secretBytes = crypto.randomBytes(20);
  const secret = base32Encode(secretBytes);
  const uri = `otpauth://totp/WavyChat:${encodeURIComponent(username)}?secret=${secret}&issuer=ParrotOS&algorithm=SHA1&digits=6&period=30`;
  // Секрет пока только возвращаем — в БД пишем ТОЛЬКО после подтверждения кода (enableTotp).
  return { success: true, secret, uri };
}

// Активирует 2FA: сохраняет секрет в профиль и включает флаг.
// code — первый TOTP-код, подтверждающий правильность настройки.
export async function enableTotp(username, secret, code) {
  'use server';
  if (!username || !secret || !code) return { success: false, error: 'Отсутствуют параметры' };
  if (!totpIsValid(secret, code)) return { success: false, error: 'Неверный код — проверьте время на устройстве' };
  const userData = await getRawUserData(username);
  // Шифруем секрет тем же ключом, что и сообщения чата
  const chatKey = await deriveChatKey(`totp_${username}`, 'site_totp_pepper');
  userData.totpSecret = await encryptText(secret, chatKey);
  userData.totpEnabled = true;
  await saveUserData(username, userData);
  return { success: true };
}

// Отключает 2FA (требует текущий пароль для подтверждения).
export async function disableTotp(username, password) {
  'use server';
  const ok = await verifyPassword(username, password);
  if (!ok) return { success: false, error: 'Неверный пароль' };
  const userData = await getRawUserData(username);
  delete userData.totpSecret;
  delete userData.totpEnabled;
  delete userData.totpOnly;
  await saveUserData(username, userData);
  return { success: true };
}

// Проверяет TOTP-код пользователя (не меняет состояние, просто проверяет).
export async function verifyTotpCode(username, code) {
  'use server';
  if (!username || !code) return false;
  const userData = await getRawUserData(username);
  if (!userData.totpEnabled || !userData.totpSecret) return false;
  try {
    const chatKey = await deriveChatKey(`totp_${username}`, 'site_totp_pepper');
    const secret = await decryptText(userData.totpSecret, chatKey);
    return totpIsValid(secret, code);
  } catch (e) {
    console.error('[verifyTotpCode] сбой расшифровки TOTP-секрета:', e);
    return false;
  }
}

// Включает режим "вход только по коду" (без пароля — только логин + TOTP).
// Требует: 2FA уже включена + пароль для подтверждения.
export async function enableTotpOnly(username, password) {
  'use server';
  const ok = await verifyPassword(username, password);
  if (!ok) return { success: false, error: 'Неверный пароль' };
  const userData = await getRawUserData(username);
  if (!userData.totpEnabled) return { success: false, error: 'Сначала включите 2FA' };
  userData.totpOnly = true;
  await saveUserData(username, userData);
  return { success: true };
}

// Проверяет credential при входе с учётом всех режимов:
//  - totpOnly=true  → принимает только TOTP-код (пароль не нужен)
//  - totpEnabled    → принимает и пароль, и TOTP-код (любой из двух)
//  - обычный режим  → только пароль
export async function verifyCredential(username, credential) {
  'use server';
  if (!username || !credential) return false;
  const userData = await getRawUserData(username);

  // Режим "только аутентификатор"
  if (userData.totpOnly && userData.totpEnabled) {
    return verifyTotpCode(username, credential);
  }
  // 2FA включена — принимаем и пароль, и TOTP
  if (userData.totpEnabled) {
    const byPassword = await verifyPassword(username, credential);
    if (byPassword) return true;
    return verifyTotpCode(username, credential);
  }
  // Обычная авторизация
  return verifyPassword(username, credential);
}

// Статус 2FA аккаунта (для UI настроек).
export async function getTotpStatus(username) {
  'use server';
  if (!username) return { enabled: false, totpOnly: false };
  const userData = await getRawUserData(username);
  return {
    enabled: Boolean(userData.totpEnabled),
    totpOnly: Boolean(userData.totpOnly),
  };
}

export async function hasPasswordSet(username) {
  'use server';
  const userData = await getRawUserData(username);
  return Boolean(userData.passwordHash);
}

export async function getUserAgeInfo(username) {
  'use server';
  if (!username) return { age: 12, birthDate: null };
  const row = await db.get('users', String(username), 'username');
  if (!row || !row.data) return { age: 12, birthDate: null };
  try {
    const parsed1 = JSON.parse(row.data);
    
    // Ищем параметр сначала на уровне пользователя, если нет — во внутренней ОС
    let birthDate = parsed1.birthDate;
    if (!birthDate && parsed1.os) {
      if (typeof parsed1.os === 'object' && parsed1.os !== null) {
        birthDate = parsed1.os.birthDate;
      } else if (typeof parsed1.os === 'string') {
        try {
          const pOs = JSON.parse(parsed1.os);
          birthDate = pOs?.birthDate;
        } catch (e) {}
      }
    }

    if (birthDate) {
      return { age: computeAgeFromBirthDate(birthDate), birthDate };
    }
    
    let age = parsed1.age;
    if (!age && parsed1.os) {
      if (typeof parsed1.os === 'object' && parsed1.os !== null) {
        age = parsed1.os.age;
      } else if (typeof parsed1.os === 'string') {
        try {
          const pOs = JSON.parse(parsed1.os);
          age = pOs?.age;
        } catch (e) {}
      }
    }
    return { age: age || 12, birthDate: null };
  } catch (e) {
    return { age: 12, birthDate: null };
  }
}

export async function onSync(username, osData, birthDate = null) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.os = osData;
  
  // Параметр может редактироваться во внешней части (birthDate) или внутри ОС (внутри osData)
  let finalBirthDate = birthDate;
  if (!finalBirthDate && osData) {
    if (typeof osData === 'object' && osData !== null) {
      finalBirthDate = osData.birthDate;
    } else if (typeof osData === 'string') {
      try {
        const parsedOs = JSON.parse(osData);
        finalBirthDate = parsedOs?.birthDate;
      } catch (e) {}
    }
  }

  if (finalBirthDate) {
    userData.birthDate = finalBirthDate;
    userData.age = computeAgeFromBirthDate(finalBirthDate);
  } else if (!userData.birthDate && userData.os) {
    // Перередактирование, если параметра нет в корне, но он сохранился внутри ОС
    let osBirth = null;
    if (typeof userData.os === 'object' && userData.os !== null) {
      osBirth = userData.os.birthDate;
    } else if (typeof userData.os === 'string') {
      try {
        const parsedOs = JSON.parse(userData.os);
        osBirth = parsedOs?.birthDate;
      } catch (e) {}
    }
    if (osBirth) {
      userData.birthDate = osBirth;
      userData.age = computeAgeFromBirthDate(osBirth);
    }
  }

  await saveUserData(username, userData);
}

export async function getGlobalSearchList() {
  try {
    await ensureTables();
    const rs = await client.execute("SELECT username, data FROM users");
    return rs.rows.map(row => {
      let content = { projects: [], docs: [] };
      try { 
        content = JSON.parse(row.data); 
      } catch(e) {
        console.error("Parse error for user:", row.username);
      }
      return { 
        username: row.username, 
        projects: content.projects || [],
        docs: content.docs || []
      };
    });
  } catch (e) { 
    console.error("Global search list error:", e);
    return []; 
  }
}
export async function addSearchItem(username, newItem) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.projects.push({ id: Date.now(), ...newItem });
  await saveUserData(username, userData);
  return { success: true };
}

export async function syncProjects(username, projectsData) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.projects = projectsData;
  await saveUserData(username, userData);
}

export async function getProjects(username) {
  return (await getRawUserData(username)).projects || [];
}

export async function setAge(username, age, birthDate = null) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.age = age;
  userData.birthDate = birthDate;
  await saveUserData(username, userData);
}
export async function syncDrive(username, driveData) {
  await ensureTables();
  // Лимит места на диск (см. site.config.json: limits.driveQuotaBytes,
  // 100 МБ по умолчанию). Файлы хранятся либо с явным полем size, либо как
  // base64-строка (тогда реальный размер ~ length * 0.75).
  const files = Array.isArray(driveData) ? driveData : (driveData?.files || []);
  const estimateBytes = (f) => {
    if (typeof f.size === 'number') return f.size;
    const content = f.content || f.data || f.url || '';
    return typeof content === 'string' ? Math.round(content.length * 0.75) : 0;
  };
  const totalBytes = files.reduce((sum, f) => sum + estimateBytes(f), 0);
  if (totalBytes > DRIVE_QUOTA_BYTES) {
    return { success: false, error: 'quota_exceeded', quotaBytes: DRIVE_QUOTA_BYTES, usedBytes: totalBytes };
  }
  const userData = await getRawUserData(username);
  userData.drive = driveData;
  await db.update('users', 'username', String(username), { data: JSON.stringify(userData) });
  return { success: true };
}

export async function getUserFiles(username) {
  return (await getRawUserData(username)).drive;
}


async function initDBImpl() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wc_chats (
      id TEXT PRIMARY KEY,
      title TEXT,
      admin TEXT,
      type TEXT DEFAULT 'group',
      privacy TEXT DEFAULT 'public',
      password TEXT,
      icon TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wc_members (
      chat_id TEXT,
      username TEXT,
      PRIMARY KEY (chat_id, username)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wc_msgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      sender TEXT,
      text TEXT,
      media TEXT,
      time INTEGER
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS active_calls (
      chat_id TEXT PRIMARY KEY,
      caller TEXT,
      status TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  return { success: true };
}
export const initDB = once(initDBImpl);
const toPlain = (rows) => rows.map(r => ({ ...r }));

// ── Жалобы на чаты (для модерации в админ-панели). НЕ связано с извлечением
// паролей/токенов — обычный репорт "юзер посчитал, что тут что-то не так",
// админ потом сам решает, что делать (может выдать страйк, удалить чат и
// т.д.). Для запароленных чатов текст жалобы всё равно не даёт доступа к
// самой переписке — это осознанный компромисс: репорты работают везде
// одинаково, шифрование остаётся реальной гарантией, а не фикцией.
const ensureChatReportsTable = once(async function ensureChatReportsTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS chat_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      reporter TEXT,
      reason TEXT,
      timestamp INTEGER,
      status TEXT DEFAULT 'open'
    )
  `);
});

export async function reportChat(username, chatId, reason) {
  if (!username || !chatId) return { success: false, error: 'missing_fields' };
  const clean = String(reason || '').trim().slice(0, 1000);
  if (!clean) return { success: false, error: 'empty_reason' };
  try {
    await ensureChatReportsTable();
    await client.execute({
      sql: "INSERT INTO chat_reports (chat_id, reporter, reason, timestamp, status) VALUES (?, ?, ?, ?, 'open')",
      args: [chatId, String(username), clean, Date.now()],
    });
    return { success: true };
  } catch (e) {
    console.error('[reportChat] сбой отправки жалобы:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

export async function leaveChat(chatId, username) {
    await client.execute({
        sql: "DELETE FROM wc_members WHERE chat_id = ? AND username = ?",
        args: [chatId, username]
    });
    return { success: true };
}

// ── Жалобы на видео (WavyTube) — та же схема, что и chat_reports ──────────
const ensureVideoReportsTable = once(async function ensureVideoReportsTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS video_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT,
      reporter TEXT,
      reason TEXT,
      timestamp INTEGER,
      status TEXT DEFAULT 'open'
    )
  `);
});

export async function reportVideo(username, videoId, reason) {
  if (!username || !videoId) return { success: false, error: 'missing_fields' };
  const clean = String(reason || '').trim().slice(0, 1000);
  if (!clean) return { success: false, error: 'empty_reason' };
  try {
    await ensureVideoReportsTable();
    await client.execute({
      sql: "INSERT INTO video_reports (video_id, reporter, reason, timestamp, status) VALUES (?, ?, ?, ?, 'open')",
      args: [videoId, String(username), clean, Date.now()],
    });
    return { success: true };
  } catch (e) {
    console.error('[reportVideo] сбой отправки жалобы:', e);
    return { success: false, error: e?.message || String(e) };
  }
}
export async function getMyChats(username) {
  await initDB();
  const rs = await client.execute({
    sql: "SELECT * FROM wc_chats WHERE id IN (SELECT chat_id FROM wc_members WHERE username = ?)",
    args: [username]
  });
  return toPlain(rs.rows);
}
export async function renameChat(chatId, newTitle) {
    await client.execute({
        sql: "UPDATE wc_chats SET title = ? WHERE id = ?",
        args: [newTitle, chatId]
    });
    return { success: true };
}

export async function deleteChat(chatId) {
    await client.execute({ sql: "DELETE FROM wc_msgs WHERE chat_id = ?", args: [chatId] });
    await client.execute({ sql: "DELETE FROM wc_chats WHERE id = ?", args: [chatId] });
    await client.execute({ sql: "DELETE FROM wc_members WHERE chat_id = ?", args: [chatId] });
    return { success: true };
}

export async function updateChatIcon(chatId, base64Data) {
    await client.execute({
        sql: "UPDATE wc_chats SET icon = ? WHERE id = ?",
        args: [base64Data, chatId]
    });
    return { success: true };
}
export async function searchGlobal(q) {
  const rs = await client.execute({
    sql: "SELECT * FROM wc_chats WHERE title LIKE ? LIMIT 10",
    args: [`%${q}%`]
  });
  return toPlain(rs.rows);
}
export async function joinChat(chatId, username) {
  await client.execute({
    sql: "INSERT OR IGNORE INTO wc_members (chat_id, username) VALUES (?, ?)",
    args: [chatId, username]
  });
  
  return { success: true };
}
export async function createChat(title, admin, type, privacy, icon, password) {
  const id = Math.random().toString(36).substring(7);
  // Пароль чата храним ТОЛЬКО как хэш+соль (см. lib/msgCrypto.js) — сам
  // пароль нигде на сервере не остаётся, он нужен только клиенту, чтобы
  // выводить из него ключ шифрования сообщений на лету при каждом запросе.
  const storedPassword = password ? hashChatPassword(password) : null;
  
  await client.execute({
    sql: "INSERT INTO wc_chats (id, title, admin, type, privacy, icon, password) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, title, admin, type, privacy, icon, storedPassword]
  });

  await client.execute({
    sql: "INSERT INTO wc_members (chat_id, username) VALUES (?, ?)",
    args: [id, admin]
  });
  
  return id;
}
export async function checkChatAccess(chatId, password) {
  const rs = await client.execute({
    sql: "SELECT password, privacy FROM wc_chats WHERE id = ?",
    args: [chatId]
  });
  const chat = rs.rows[0];
  if (!chat) throw new Error("Chat not found");
  // Пароль в БД теперь хэш (см. createChat/updateChatPassword) — сверяем
  // через verifyChatPassword, а не прямым сравнением строк. verifyChatPassword
  // также умеет сверять старый формат (открытым текстом) — для чатов,
  // созданных до введения хэширования.
  if (chat.privacy === 'private' && !verifyChatPassword(password, chat.password)) {
    throw new Error("Invalid password");
  }
  // Если пароль прошёл проверку, но ещё лежит старым (открытым) способом —
  // тихо мигрируем на хэш прямо сейчас, чтобы больше не хранить его в явном
  // виде. Не блокирует ответ пользователю (fire-and-forget).
  if (chat.privacy === 'private' && chat.password && !String(chat.password).includes(':')) {
    client.execute({
      sql: "UPDATE wc_chats SET password = ? WHERE id = ?",
      args: [hashChatPassword(password), chatId],
    }).catch(() => {});
  }
  
  return { success: true };
}
export async function sendMsg(chatId, sender, text, media = null, chatPassword = null) {
  const chat = await client.execute({ sql: "SELECT type, admin, privacy, password FROM wc_chats WHERE id = ?", args: [chatId] });
  const chatRow = chat.rows[0];
  if (chatRow?.type === 'channel' && chatRow?.admin !== sender) {
    throw new Error("Only admins can post in channels");
  }
  const mediaData = media ? JSON.stringify(media) : null;
  // Шифруем текст и метаданные вложений перед записью в БД (см. lib/msgCrypto.js) —
  // раньше это лежало в таблице открытым текстом, читаемым прямо из дашборда БД.
  // Для запароленных чатов ключ выводится из ПАРОЛЯ ЧАТА (а не общего серверного
  // ключа) — проверяем пароль по хэшу ДО шифрования, чтобы не заблокировать
  // сообщение навсегда неверным ключом из-за опечатки в пароле.
  let cryptoKey = null;
  if (chatRow?.privacy === 'private' && chatRow?.password) {
    if (!verifyChatPassword(chatPassword, chatRow.password)) {
      throw new Error("Неверный пароль чата");
    }
    if (!String(chatRow.password).includes(':')) {
      // Тот же ленивый апгрейд старого открытого пароля на хэш, что и в checkChatAccess.
      client.execute({ sql: "UPDATE wc_chats SET password = ? WHERE id = ?", args: [hashChatPassword(chatPassword), chatId] }).catch(() => {});
    }
    cryptoKey = deriveChatKey(chatId, chatPassword);
  }

  await client.execute({ 
    sql: "INSERT INTO wc_msgs (chat_id, sender, text, media, time) VALUES (?, ?, ?, ?, ?)", 
    args: [chatId, sender, encryptText(text, cryptoKey), encryptText(mediaData, cryptoKey), Date.now()] 
  });
}

// Для запароленных чатов сообщения зашифрованы ключом, выведенным из пароля
// ЧАТА (см. sendMsg) — здесь тот же вывод ключа, чтобы расшифровать обратно.
// Если пароль не передан или неверный — GCM-проверка внутри decryptText сама
// провалится и сообщения придут как '[не удалось расшифровать сообщение]',
// отдельно ничего проверять не нужно.
async function resolveChatCryptoKey(chatId, chatPassword) {
  const rs = await client.execute({ sql: "SELECT privacy, password FROM wc_chats WHERE id = ?", args: [chatId] });
  const chat = rs.rows[0];
  if (chat?.privacy === 'private' && chat?.password) {
    return deriveChatKey(chatId, chatPassword);
  }
  return null;
}

export async function getMsgs(chatId, chatPassword = null) {
  const cryptoKey = await resolveChatCryptoKey(chatId, chatPassword);
  const rs = await client.execute({ 
    sql: "SELECT * FROM wc_msgs WHERE chat_id = ? ORDER BY time ASC", 
    args: [chatId] 
  });
  return toPlain(rs.rows).map(r => ({ ...r, time: Number(r.time), text: decryptText(r.text, cryptoKey), media: decryptText(r.media, cryptoKey) }));
}

export async function deleteMsgs(ids) {
  const placeholders = ids.map(() => '?').join(',');
  await client.execute({
    sql: `DELETE FROM wc_msgs WHERE id IN (${placeholders})`,
    args: ids
  });
}
export async function kickUser(chatId, username) {
  'use server';
  try {
    await client.execute({
      sql: "DELETE FROM wc_members WHERE chat_id = ? AND username = ?",
      args: [chatId, username]
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function promoteUser(chatId, username) {
  'use server';
  try {
    // Передаем права создателя (admin) другому пользователю
    await client.execute({
      sql: "UPDATE wc_chats SET admin = ? WHERE id = ?",
      args: [username, chatId]
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function updateChatPassword(chatId, newPassword) {
  'use server';
  try {
    // Тоже только хэш — см. createChat выше про то, зачем.
    await client.execute({
      sql: "UPDATE wc_chats SET password = ? WHERE id = ?",
      args: [newPassword ? hashChatPassword(newPassword) : null, chatId]
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
export async function joinCall(chatId, username) {
    'use server';
    const res = await client.execute({
        sql: "SELECT participants FROM active_calls WHERE chat_id = ?",
        args: [chatId]
    });
    
    let parts = res.rows[0]?.participants ? JSON.parse(res.rows[0].participants) : [];
    if (!parts.includes(username)) parts.push(username);

    await client.execute({
        sql: "UPDATE active_calls SET participants = ? WHERE chat_id = ?",
        args: [JSON.stringify(parts), chatId]
    });
    return parts;
}
export async function startCallNotification(chatId, caller) {
  'use server';
  await client.execute({
    sql: "INSERT INTO active_calls (chat_id, caller, status) VALUES (?, ?, 'active') ON CONFLICT(chat_id) DO UPDATE SET status = 'active', caller = excluded.caller",
    args: [chatId, caller]
  });
  return true;
}

export async function endCallNotification(chatId) {
  'use server';
  await client.execute({
    sql: "DELETE FROM active_calls WHERE chat_id = ?",
    args: [chatId]
  });
  return true;
}

export async function checkActiveCall(chatId) {
  'use server';
  try {
    const res = await client.execute({
      sql: "SELECT * FROM active_calls WHERE chat_id = ?",
      args: [chatId]
    });

    if (res.rows.length > 0) {
      const row = res.rows[0];
      return {
        chat_id: String(row.chat_id),
        caller: String(row.caller),
        status: String(row.status),
        timestamp: String(row.timestamp)
      };
    }
    return null;
  } catch (e) {
    console.error("Call verification error:", e);
    return null;
  }
}






async function initParrotDBImpl() {
  await ensureTables();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS market_items (
      pkg_name TEXT PRIMARY KEY, 
      display_name TEXT, 
      icon TEXT, 
      author TEXT,
      description TEXT,
      type TEXT DEFAULT 'App',
      os_versions TEXT DEFAULT '[]',
      installs INTEGER DEFAULT 0,
      price INTEGER DEFAULT 0,
      custom_ui TEXT DEFAULT '',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS market_purchases (
      username TEXT,
      pkg_name TEXT,
      PRIMARY KEY (username, pkg_name)
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS market_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      pkg_name TEXT, 
      username TEXT, 
      rating INTEGER, 
      comment TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const cols = [
    {n: 'description', t: 'TEXT'},
    {n: 'installs', t: 'INTEGER DEFAULT 0'},
    {n: 'os_versions', t: "TEXT DEFAULT '[]'"},
    {n: 'price', t: 'INTEGER DEFAULT 0'},
    {n: 'custom_ui', t: 'TEXT DEFAULT ""'}
  ];
  for (const c of cols) {
    try { await client.execute(`ALTER TABLE market_items ADD COLUMN ${c.n} ${c.t}`); } catch(e) {}
  }
}
export const initParrotDB = once(initParrotDBImpl);
export async function addBalance(username, amount) {
  const name = typeof username === 'object' ? username.username : username;
  
  if (!name) return 0;

  await initParrotDB();
  
  try {
    const userRes = await client.execute({
      sql: "SELECT data FROM users WHERE username = ?",
      args: [name]
    });

    if (userRes.rows.length > 0) {
      let userData = JSON.parse(userRes.rows[0].data);
      const currentBalance = Number(userData.balance) || 0;
      const addAmount = Number(amount) || 0;
      
      userData.balance = currentBalance + addAmount;
      
      await client.execute({
        sql: "UPDATE users SET data = ? WHERE username = ?",
        args: [JSON.stringify(userData), name]
      });
      
      return userData.balance;
    }
  } catch (e) {
    console.error("Ошибка при пополнении:", e);
  }
  return 0;
}
export async function getMarketItems(q = "") {
  await initParrotDB();
  const sql = q 
    ? "SELECT * FROM market_items WHERE display_name LIKE ? ORDER BY timestamp DESC" 
    : "SELECT * FROM market_items ORDER BY timestamp DESC";
  const rs = await client.execute({ sql, args: q ? [`%${q}%`] : [] });
  
  const items = [];
  for (const row of rs.rows) {
    const revs = await client.execute({ 
      sql: "SELECT AVG(rating) as avg, COUNT(*) as cnt FROM market_reviews WHERE pkg_name = ?", 
      args: [row.pkg_name] 
    });
    items.push({
      ...row,
      os_versions: JSON.parse(row.os_versions || '[]'),
      rating: revs.rows[0]?.avg || 0,
      rev_count: revs.rows[0]?.cnt || 0
    });
  }
  return items;
}

export async function uploadApp(appData) {
  await initParrotDB();
  await client.execute({
    sql: `INSERT INTO market_items (pkg_name, display_name, icon, author, description, type, os_versions, price, custom_ui) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) 
          ON CONFLICT(pkg_name) DO UPDATE SET 
          icon=excluded.icon, os_versions=excluded.os_versions, description=excluded.description, 
          display_name=excluded.display_name, price=excluded.price, custom_ui=excluded.custom_ui`,
    args: [appData.pkg, appData.name, appData.icon, appData.author, appData.desc, appData.type, JSON.stringify(appData.versions), appData.price || 0, appData.custom_ui || '']
  });
}

export async function deleteApp(pkg, user) {
  await client.execute({ sql: "DELETE FROM market_items WHERE pkg_name = ? AND author = ?", args: [pkg, user] });
}

export async function addReview(pkg, user, rating, comment) {
  await client.execute({
    sql: "INSERT INTO market_reviews (pkg_name, username, rating, comment) VALUES (?, ?, ?, ?)",
    args: [pkg, user, rating, comment]
  });
}

export async function getReviews(pkg) {
  const rs = await client.execute({
    sql: "SELECT * FROM market_reviews WHERE pkg_name = ? ORDER BY timestamp DESC",
    args: [pkg]
  });
  return rs.rows;
}
export async function getBalance(user) {
  if (!user) return 0;
  await initParrotDB();
  const rs = await client.execute({ 
    sql: "SELECT data FROM users WHERE username = ?", 
    args: [String(user)] 
  });

  if (rs.rows.length > 0) {
    try {
      const userData = JSON.parse(rs.rows[0].data);
      return Number(userData.balance) || 0;
    } catch (e) {
      console.error("Ошибка парсинга данных пользователя:", e);
      return 0;
    }
  }
  
  return 0;
}

// Абсолютная установка баланса (в отличие от addBalance, который прибавляет
// дельту). Раньше жила отдельной копией прямо в layout.js со своим клиентом.
export async function setBalance(username, newBalance) {
  'use server';
  if (!username) return { success: false, error: "No username" };
  try {
    await ensureTables();
    const userData = await getRawUserData(username);
    userData.balance = Number(newBalance);
    await saveUserData(username, userData);
    return { success: true, newBalance: userData.balance };
  } catch (e) {
    console.error("Error setting balance:", e);
    return { success: false, error: e.message };
  }
}

// Полный дамп таблицы users (username -> raw JSON строка). Раньше этот
// запрос жил прямо в RootLayout (app/layout.js) со своим отдельным клиентом.
export async function getAllUsersRaw() {
  'use server';
  await ensureTables();
  const users = {};
  try {
    const rs = await client.execute("SELECT username, data FROM users");
    if (rs.rows) {
      rs.rows.forEach(row => {
        users[row.username] = { data: String(row.data) };
      });
    }
  } catch (e) {
    console.error("getAllUsersRaw error (ignoring for build):", e);
  }
  return users;
}

export async function addPyCoins(user, amount = 1000) {
  await initParrotDB();
  await client.execute({ sql: "UPDATE users SET pycoins = pycoins + ? WHERE username = ?", args: [amount, String(user)] });
}
export async function checkOwnership(username, pkg) {
  await initParrotDB();
  try {
    const rs = await client.execute({
      sql: "SELECT 1 FROM market_purchases WHERE username = ? AND pkg_name = ?",
      args: [String(username), pkg]
    });
    return rs.rows.length > 0;
  } catch (e) {
    console.error("Ошибка проверки владения:", e);
    return false;
  }
}
export async function buyApp(pkg_name, buyer_username) {
  'use server';
  try {
    await ensureTables();

    const marketRes = await client.execute({
      sql: "SELECT author, price, display_name FROM market_items WHERE pkg_name = ?",
      args: [pkg_name]
    });

    if (marketRes.rows.length === 0) return { success: false, error: "Приложение не найдено" };
    
    const app = marketRes.rows[0];
    const price = Number(app.price) || 0;
    const author = app.author;

    const buyerData = await getRawUserData(buyer_username);
    const buyerBalance = Number(buyerData.balance || 0);

    if (buyerBalance < price) return { success: false, error: "Недостаточно средств" };
    buyerData.balance = buyerBalance - price;
    if (!buyerData.owned_apps) buyerData.owned_apps = [];
    if (!buyerData.owned_apps.includes(pkg_name)) {
        buyerData.owned_apps.push(pkg_name);
    }

    await client.execute({
      sql: "UPDATE users SET data = ? WHERE username = ?",
      args: [JSON.stringify(buyerData), String(buyer_username)]
    });

    if (author && author !== buyer_username) {
        const authorData = await getRawUserData(author);
        const authorBalance = Number(authorData.balance || 0);
        
        authorData.balance = authorBalance + price;

        await client.execute({
          sql: "UPDATE users SET data = ? WHERE username = ?",
          args: [JSON.stringify(authorData), String(author)]
        });
        console.log(`Начислено ${price} pc автору ${author}`);
    }

    return { success: true, newBalance: buyerData.balance };

  } catch (error) {
    console.error("Ошибка при покупке:", error);
    return { success: false, error: error.message };
  }
}
export async function apiSearchPacks(query = "") {
  await initParrotDB();
  const sql = "SELECT pkg_name, display_name, author, type, price FROM market_items WHERE display_name LIKE ? OR pkg_name LIKE ?";
  const rs = await client.execute({ sql, args: [`%${query}%`, `%${query}%`] });
  return rs.rows;
}
export async function apiGetManifest(pkg_name) {
  await initParrotDB();
  const rs = await client.execute({
    sql: "SELECT * FROM market_items WHERE pkg_name = ?",
    args: [pkg_name]
  });

  if (rs.rows.length === 0) return { error: "Package not found" };

  const item = rs.rows[0];
  return {
    package: item.pkg_name,
    name: item.display_name,
    author: item.author,
    description: item.description,
    price: item.price,
    versions: JSON.parse(item.os_versions || '[]'),
    timestamp: item.timestamp
  };
}

export async function apiResolvePackage(pkg_name, os = "ParrotOS", arch = "x64") {
  const manifest = await apiGetManifest(pkg_name);
  if (manifest.error) return manifest;

  const versions = manifest.versions;
  const compatible = versions.find(v => v.os === os && (v.arch === arch || !v.arch)) 
                   || versions.find(v => v.isPrimary);

  if (!compatible) return { error: "No compatible version found for your OS/Arch" };

  return {
    pkg_name: manifest.package,
    version_name: compatible.name,
    download_url: compatible.link,
    file_type: compatible.type,
    price: manifest.price
  };
}

export async function setupSystemDatabases(adminName) {
  if (adminName !== localStorage.getItem('p_user')) return { error: "DENIED" };

  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS admin_controls (
        username TEXT PRIMARY KEY,
        strikes INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT 0,
        admin_notes TEXT
      )
    `);

    return { success: true, message: "База данных ParrotOS и WavyTube зарегистрирована" };
  } catch (e) {
    return { error: e.message };
  }
}

export async function syncUserData(username, type, payload) {
  const data = await getRawUserData(username);
  data[type] = payload; 
  await client.execute({
    sql: "INSERT OR REPLACE INTO users (username, data) VALUES (?, ?)",
    args: [username, JSON.stringify(data)]
  });
  return { success: true };
}

export async function syncDb(username, dbData) {
  'use server';
  await ensureTables();
  const userData = await getRawUserData(username);
  
  userData.db = dbData;
  
  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), String(username)]
  });
}
export async function findDbAndOwner(dbId) {
  'use server';
  await ensureTables();
  const rs = await client.execute("SELECT username, data FROM users");
  for (let row of rs.rows) {
    const userData = JSON.parse(row.data || "{}");
    const dbList = userData.db || [];
    
    const db = dbList.find(d => d.id === dbId);
    if (db) return { owner: row.username, db, allDbs: dbList };
  }
  return null;
}

export async function pdb_create(username, dbName) {
  'use server';
  await ensureTables();
  const userData = await getRawUserData(username);
  
  const dbId = 'pdb_' + Math.random().toString(36).substring(2, 10);
  const secretKey = 'sk_' + Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const newDb = {
    id: dbId,
    name: dbName,
    type: 'v_db',
    secretKey: secretKey,
    content: {}, 
    size: 0,
    created: Date.now()
  };

  if (!userData.db || !Array.isArray(userData.db)) {
    userData.db = [];
  }
  userData.db.push(newDb);
  await syncDb(username, userData.db);
  
  return newDb;
}

export async function pdb_list(username) {
  'use server';
  const userData = await getRawUserData(username);
  const separateDbs = userData.db || [];
  let driveDbs = [];
  if (userData.drive && userData.drive.files) {
    driveDbs = userData.drive.files.filter(f => f.type === 'v_db');
  } else if (Array.isArray(userData.drive)) {
    driveDbs = userData.drive.filter(f => f.type === 'v_db');
  }
  const combined = [...separateDbs, ...driveDbs];
  const uniqueDbs = Array.from(new Map(combined.map(item => [item.id, item])).values());
  
  return uniqueDbs;
}

export async function pdb_update(username, dbId, content) {
  'use server';
  const userData = await getRawUserData(username);
  const currentDbs = userData.db || [];
  
  const updatedDbs = currentDbs.map(db => {
    if (db.id === dbId) {
      return { ...db, content: content, lastModified: Date.now() };
    }
    return db;
  });

  await syncDb(username, updatedDbs);
  return { success: true };
}

export async function pdb_delete(username, dbId) {
  'use server';
  const userData = await getRawUserData(username);
  const updatedDbs = (userData.db || []).filter(db => db.id !== dbId);
  
  await syncDb(username, updatedDbs);
  return { ok: true };
}

// Цена увеличения лимита личной базы данных: 10 PC за каждый доп. мегабайт.
const PDB_EXPAND_COST_PC_PER_MB = 10;

export async function pdb_expandStorage(username, dbId, extraMB) {
  'use server';
  const mb = Number(extraMB);
  if (!mb || mb <= 0) return { success: false, error: 'Некорректный размер (МБ)' };

  const cost = mb * PDB_EXPAND_COST_PC_PER_MB;
  const userData = await getRawUserData(username);
  const currentBalance = Number(userData.balance) || 0;

  if (currentBalance < cost) {
    return { success: false, error: `Недостаточно PC: нужно ${cost}, на счету ${currentBalance}` };
  }

  const dbList = userData.db || [];
  const target = dbList.find(d => d.id === dbId);
  if (!target) return { success: false, error: 'База данных не найдена' };

  const currentMax = target.maxSize || 2097152;
  target.maxSize = currentMax + mb * 1024 * 1024;
  userData.balance = Number((currentBalance - cost).toFixed(6));

  await saveUserData(username, userData);

  return { success: true, newMaxSize: target.maxSize, newBalance: userData.balance, spent: cost };
}

// ─────────────────────────────────────────────────────────────────────────
// Personal DB (pdb) HTTP-операции.
// Раньше вся эта логика (проверка secretKey, лимит по размеру, слияние
// ячеек, поиск, статистика) жила прямо в app/api/pdb/.../route.js — сам
// route.js собирал JSON, считал размеры и т.д. Теперь route.js — тонкая
// HTTP-обвязка, а вся логика тут, в одном месте.
//
// Заодно исправлена мелкая, но реальная нестабильность: старый route.js
// делал `const { owner, db, allDocs } = result`, хотя findDbAndOwner
// возвращает поле `allDbs` (не `allDocs`) — allDocs всегда был undefined
// и без пользы прокидывался дальше в pdb_update.
export async function pdb_authorize(dbId, secretKey) {
  'use server';
  const result = await findDbAndOwner(dbId);
  if (!result) return { error: 'DB Not Found', status: 404 };
  const { owner, db } = result;
  if (db.secretKey !== secretKey) return { error: 'Invalid Key', status: 403 };
  return { owner, db };
}

function pdb_quotaCheck(db, sizeBytes) {
  const limit = db.maxSize || 2097152;
  if (sizeBytes > limit) return { error: 'Quota Exceeded', limit, status: 413 };
  return null;
}

export async function pdb_writeAll(owner, dbId, db, body) {
  'use server';
  const size = JSON.stringify(body).length;
  const quotaErr = pdb_quotaCheck(db, size);
  if (quotaErr) return quotaErr;
  await pdb_update(owner, dbId, body);
  return { ok: true, size };
}

export async function pdb_writeCell(owner, dbId, db, key, val) {
  'use server';
  if (!key) return { error: 'Key missing', status: 400 };
  const nextContent = { ...(db.content || {}), [key]: val };
  const size = JSON.stringify(nextContent).length;
  const quotaErr = pdb_quotaCheck(db, size);
  if (quotaErr) return quotaErr;
  await pdb_update(owner, dbId, nextContent);
  return { ok: true, size };
}

export async function pdb_readAll(db) {
  'use server';
  return db.content || {};
}

export async function pdb_readCell(db, key) {
  'use server';
  const content = db.content || {};
  return { key, val: content[key] ?? null };
}

export async function pdb_deleteCell(owner, dbId, db, key) {
  'use server';
  const content = db.content || {};
  if (!Object.prototype.hasOwnProperty.call(content, key)) return { error: 'Not found', status: 404 };
  const nextContent = { ...content };
  delete nextContent[key];
  await pdb_update(owner, dbId, nextContent);
  return { ok: true };
}

export async function pdb_search(db, query) {
  'use server';
  const content = db.content || {};
  const q = (query || '').toLowerCase();
  return Object.keys(content)
    .filter(k => k.toLowerCase().includes(q) || JSON.stringify(content[k]).toLowerCase().includes(q))
    .reduce((obj, k) => { obj[k] = content[k]; return obj; }, {});
}

export async function pdb_stats(dbId, db) {
  'use server';
  const content = db.content || {};
  const limit = db.maxSize || 2097152;
  const size = JSON.stringify(content).length;
  return {
    id: dbId,
    name: db.name,
    sizeBytes: size,
    limitBytes: limit,
    percent: ((size / limit) * 100).toFixed(2) + '%',
    free: limit - size,
  };
}

















async function initWavyDBImpl() {
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_channels (username TEXT PRIMARY KEY, avatar TEXT, description TEXT, subscribers INTEGER DEFAULT 0, owner_account TEXT DEFAULT '', icon TEXT DEFAULT '', display_name TEXT DEFAULT '')`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_videos (id TEXT PRIMARY KEY, channel_id TEXT, title TEXT, description TEXT, playlist TEXT DEFAULT '', likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, views INTEGER DEFAULT 0, duration REAL DEFAULT 0, thumbnail TEXT, is_short INTEGER DEFAULT 0, timestamp INTEGER, video_data TEXT, age_rating TEXT DEFAULT '12+', is_explicit INTEGER DEFAULT 0)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_subs (subscriber TEXT, channel TEXT, PRIMARY KEY (subscriber, channel))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_likes (username TEXT, video_id TEXT, type TEXT, PRIMARY KEY (username, video_id))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_comments (id TEXT PRIMARY KEY, video_id TEXT, username TEXT, text TEXT, timestamp INTEGER)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_telemetry (video_id TEXT, segment_index INTEGER, watch_count INTEGER DEFAULT 0, PRIMARY KEY (video_id, segment_index))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_playlists (id TEXT PRIMARY KEY, name TEXT, username TEXT)`);

  try {
    const info = await client.execute("PRAGMA table_info(wt_videos)");
    const cols = info.rows.map(r => r.name);
    if (!cols.includes('description')) await client.execute("ALTER TABLE wt_videos ADD COLUMN description TEXT DEFAULT ''");
    if (!cols.includes('duration')) await client.execute("ALTER TABLE wt_videos ADD COLUMN duration REAL DEFAULT 0");
    if (!cols.includes('playlist')) await client.execute("ALTER TABLE wt_videos ADD COLUMN playlist TEXT DEFAULT ''");
    if (!cols.includes('thumbnail')) await client.execute("ALTER TABLE wt_videos ADD COLUMN thumbnail TEXT DEFAULT ''");
    if (!cols.includes('is_short')) await client.execute("ALTER TABLE wt_videos ADD COLUMN is_short INTEGER DEFAULT 0");
    if (!cols.includes('dislikes')) await client.execute("ALTER TABLE wt_videos ADD COLUMN dislikes INTEGER DEFAULT 0");
    if (!cols.includes('views')) await client.execute("ALTER TABLE wt_videos ADD COLUMN views INTEGER DEFAULT 0");
    if (!cols.includes('timestamp')) await client.execute("ALTER TABLE wt_videos ADD COLUMN timestamp INTEGER DEFAULT 0");
    if (!cols.includes('video_data')) await client.execute("ALTER TABLE wt_videos ADD COLUMN video_data TEXT DEFAULT ''");
    // Возрастной рейтинг видео (по умолчанию 12+) и флаг эротического/18+ контента
    if (!cols.includes('age_rating')) await client.execute("ALTER TABLE wt_videos ADD COLUMN age_rating TEXT DEFAULT '12+'");
    if (!cols.includes('is_explicit')) await client.execute("ALTER TABLE wt_videos ADD COLUMN is_explicit INTEGER DEFAULT 0");
    // Теги (раньше собирались в форме загрузки, но никуда не сохранялись —
    // analyticsData.tags просто игнорировался) и вектор интересов видео для
    // персональных рекомендаций (см. lib/recommendVectors.js).
    if (!cols.includes('tags')) await client.execute("ALTER TABLE wt_videos ADD COLUMN tags TEXT DEFAULT ''");
    // Ручные позиции рекламы внутри видео (до 4 таймкодов, секунды через
    // запятую) — если пусто, WavyPlayer сам считает расписание автоматически.
    if (!cols.includes('ad_positions')) await client.execute("ALTER TABLE wt_videos ADD COLUMN ad_positions TEXT DEFAULT ''");
    if (!cols.includes('vector')) await client.execute("ALTER TABLE wt_videos ADD COLUMN vector TEXT DEFAULT ''");
  } catch(e) { console.error("WavyDB Video Migration error: ", e); }
  // Вектор интересов ПОЛЬЗОВАТЕЛЯ (256 параметров, см. lib/recommendVectors.js) —
  // отдельная таблица, а не колонка в users: обновляется часто (на каждый
  // досмотренный сегмент видео), незачем перезаписывать весь users.data ради этого.
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_user_vectors (username TEXT PRIMARY KEY, vector TEXT)`);
  // Отдельный вектор интересов для Shorts — раньше был один общий вектор на
  // пользователя, и залипание в шортсах (быстрый, "жвачный" контент) через
  // пару минут скроллинга портило рекомендации в обычной ленте видео (и
  // наоборот, длинные видео "тянули" рекомендации шортсов не туда). Теперь
  // это два независимых профиля интересов у одного и того же человека.
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_user_vectors_shorts (username TEXT PRIMARY KEY, vector TEXT)`);

  // ── Статистика просмотров со снижением точности со временем ────────────
  // wt_view_events — точный лог, один ряд на просмотр, полная точность
  // (миллисекундный timestamp). Хранится ~14 дней (см. STATS_* в
  // rollupStats ниже), потом сворачивается.
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_view_events (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT, ts INTEGER)`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_wt_view_events_video_ts ON wt_view_events (video_id, ts)`);
  // wt_stats_rollup — свёрнутые бакеты. bucket_type: 'hour' → 'day' → 'year'.
  // bucket_span у 'year' — сколько лет в одном бакете (1, потом 2, потом 4…
  // при старении данные грубеют дальше, см. rollupStats).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wt_stats_rollup (
      video_id TEXT, bucket_type TEXT, bucket_start INTEGER, bucket_span INTEGER DEFAULT 1,
      views INTEGER DEFAULT 0,
      PRIMARY KEY (video_id, bucket_type, bucket_start)
    )
  `);
}
export const initWavyDB = once(initWavyDBImpl);

// ── Единый "живой" конфиг сайта ──────────────────────────────────────────
// Первый кусок системы конфигов из голосового сообщения: базовый конфиг —
// это обычный JS/JSON-модуль (app/lib/siteConfig.js, DEFAULT_CONFIG),
// правка = деплой. А поверх него — вот эта таблица в БД: значения отсюда
// перекрывают базовые "на лету", без передеплоя (для будущей admin-панели).
// Пока панели ещё нет, писать сюда можно только зная SITE_CONFIG_ADMIN_KEY
// (переменная окружения, как остальные секреты в .env.local).
async function initSiteConfigDBImpl() {
  await client.execute(`CREATE TABLE IF NOT EXISTS site_config_kv (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)`);
}
const initSiteConfigDB = once(initSiteConfigDBImpl);

// Возвращает ТОЛЬКО живые оверрайды (объект, может быть пустым {}) — база
// (DEFAULT_CONFIG) подмешивается на вызывающей стороне через mergeConfig(),
// чтобы этот модуль ничего не знал про сами дефолтные значения.
export async function getLiveConfig() {
  try {
    await initSiteConfigDB();
    const rs = await client.execute("SELECT key, value FROM site_config_kv");
    const out = {};
    for (const row of rs.rows) {
      try { out[row.key] = JSON.parse(row.value); } catch (_) { out[row.key] = row.value; }
    }
    return out;
  } catch (e) {
    console.error('[getLiveConfig] сбой чтения живого конфига:', e);
    return {}; // при сбое просто откатываемся на базовый конфиг, сайт не должен падать из-за этого
  }
}

export async function setLiveConfigValue(key, value, adminKey) {
  'use server';
  if (!process.env.SITE_CONFIG_ADMIN_KEY || adminKey !== process.env.SITE_CONFIG_ADMIN_KEY) {
    return { success: false, error: 'invalid_admin_key' };
  }
  try {
    await initSiteConfigDB();
    await client.execute({
      sql: "INSERT INTO site_config_kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      args: [key, JSON.stringify(value), Date.now()],
    });
    return { success: true };
  } catch (e) {
    console.error('[setLiveConfigValue] сбой записи живого конфига:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

// ── Поддержка (настройки → «Поддержка») ─────────────────────────────────────
// Обычные текстовые обращения пользователя в поддержку. НЕ то же самое, что
// зашифрованные чаты WavyChat — это просто открытое сообщение админам,
// пользователь сам решает, что писать, ничего принудительно не извлекается.
const ensureSupportTable = once(async function ensureSupportTable() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS support_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      text TEXT,
      timestamp INTEGER,
      status TEXT DEFAULT 'open'
    )
  `);
});

export async function sendSupportMessage(username, text) {
  if (!username) return { success: false, error: 'no_username' };
  const clean = String(text || '').trim();
  if (!clean) return { success: false, error: 'empty' };
  if (clean.length > 4000) return { success: false, error: 'too_long' };
  try {
    await ensureSupportTable();
    await client.execute({
      sql: "INSERT INTO support_messages (username, text, timestamp, status) VALUES (?, ?, ?, 'open')",
      args: [String(username), clean, Date.now()],
    });
    return { success: true };
  } catch (e) {
    console.error('[sendSupportMessage] сбой отправки:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

export async function getMySupportMessages(username) {
  if (!username) return [];
  try {
    await ensureSupportTable();
    const rs = await client.execute({
      sql: "SELECT id, text, timestamp, status FROM support_messages WHERE username = ? ORDER BY timestamp DESC LIMIT 50",
      args: [String(username)],
    });
    return toPlain(rs.rows);
  } catch (e) {
    console.error('[getMySupportMessages] сбой чтения:', e);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════
// WavyMusic — отдельный сервис (своя папка /app/WavyMusic, свои таблицы
// wm_*). Урезанная копия идеи WavyTube: без каналов, без комментариев,
// без плейлистов на первую версию — только загрузка, лента, лайки,
// счётчик прослушиваний. Аудио хранится так же, как видео в WavyTube —
// base64 прямо в колонке (audio_data), тот же подход, тот же масштаб.
async function ensureWavyMusicTables() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wm_tracks (
      id TEXT PRIMARY KEY,
      username TEXT,
      title TEXT,
      artist TEXT,
      cover TEXT,
      audio_data TEXT,
      duration REAL DEFAULT 0,
      plays INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      timestamp INTEGER
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wm_likes (
      track_id TEXT,
      username TEXT,
      PRIMARY KEY (track_id, username)
    )
  `);
}

export async function uploadTrack(username, { title, artist, cover, audioData, duration }) {
  'use server';
  if (!username) return { success: false, error: 'no_username' };
  const clean = String(title || '').trim().slice(0, 200);
  if (!clean) return { success: false, error: 'no_title' };
  if (!audioData) return { success: false, error: 'no_audio' };
  try {
    await ensureWavyMusicTables();
    const id = randomId('wm', 10);
    await client.execute({
      sql: `INSERT INTO wm_tracks (id, username, title, artist, cover, audio_data, duration, plays, likes, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      args: [id, String(username), clean, String(artist || username).slice(0, 100), cover || null, audioData, Number(duration) || 0, Date.now()],
    });
    return { success: true, id };
  } catch (e) {
    console.error('[uploadTrack] сбой загрузки трека:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

export async function getMusicFeed(limit = 100) {
  'use server';
  try {
    await ensureWavyMusicTables();
    const rs = await client.execute({
      sql: `SELECT id, username, title, artist, cover, duration, plays, likes, timestamp
            FROM wm_tracks ORDER BY timestamp DESC LIMIT ?`,
      args: [limit],
    });
    return toPlain(rs.rows);
  } catch (e) {
    console.error('[getMusicFeed] сбой чтения ленты:', e);
    return [];
  }
}

export async function getTrackAudio(trackId) {
  'use server';
  await ensureWavyMusicTables();
  const rs = await client.execute({ sql: 'SELECT audio_data FROM wm_tracks WHERE id = ?', args: [trackId] });
  return rs.rows[0]?.audio_data || null;
}

export async function registerPlay(trackId) {
  'use server';
  await ensureWavyMusicTables();
  await client.execute({ sql: 'UPDATE wm_tracks SET plays = plays + 1 WHERE id = ?', args: [trackId] });
  return { success: true };
}

export async function toggleTrackLike(username, trackId) {
  'use server';
  if (!username) return { success: false, error: 'no_username' };
  await ensureWavyMusicTables();
  const rs = await client.execute({ sql: 'SELECT 1 FROM wm_likes WHERE track_id = ? AND username = ?', args: [trackId, String(username)] });
  if (rs.rows.length) {
    await client.execute({ sql: 'DELETE FROM wm_likes WHERE track_id = ? AND username = ?', args: [trackId, String(username)] });
    await client.execute({ sql: 'UPDATE wm_tracks SET likes = MAX(likes - 1, 0) WHERE id = ?', args: [trackId] });
    return { success: true, liked: false };
  } else {
    await client.execute({ sql: 'INSERT INTO wm_likes (track_id, username) VALUES (?, ?)', args: [trackId, String(username)] });
    await client.execute({ sql: 'UPDATE wm_tracks SET likes = likes + 1 WHERE id = ?', args: [trackId] });
    return { success: true, liked: true };
  }
}

export async function getMyTrackLikes(username) {
  'use server';
  if (!username) return [];
  await ensureWavyMusicTables();
  const rs = await client.execute({ sql: 'SELECT track_id FROM wm_likes WHERE username = ?', args: [String(username)] });
  return rs.rows.map(r => r.track_id);
}

export async function deleteTrack(username, trackId) {
  'use server';
  await ensureWavyMusicTables();
  const rs = await client.execute({ sql: 'SELECT username FROM wm_tracks WHERE id = ?', args: [trackId] });
  if (!rs.rows.length) return { success: false, error: 'not_found' };
  if (rs.rows[0].username !== String(username)) return { success: false, error: 'no_access' };
  await client.execute({ sql: 'DELETE FROM wm_tracks WHERE id = ?', args: [trackId] });
  await client.execute({ sql: 'DELETE FROM wm_likes WHERE track_id = ?', args: [trackId] });
  return { success: true };
}
// ══════════════════════════════════════════════════════════════════════════

// ── Векторы интересов (см. lib/recommendVectors.js) ─────────────────────────
// isShort=true работает с отдельным профилем интересов wt_user_vectors_shorts
// (см. initWavyDBImpl) — Shorts и обычные видео больше не смешивают сигнал.
function userVectorsTable(isShort) { return isShort ? 'wt_user_vectors_shorts' : 'wt_user_vectors'; }

async function getOrCreateUserVector(username, isShort = false) {
  const table = userVectorsTable(isShort);
  const rs = await client.execute({ sql: `SELECT vector FROM ${table} WHERE username = ?`, args: [username] });
  const existing = parseVector(rs.rows[0]?.vector);
  if (existing) return existing;
  // Новый пользователь — вектор из его имени (просто чтобы не было нулевого
  // вектора, который ни к чему не притянешь); первые же просмотры быстро
  // его переформируют под реальные интересы.
  const fresh = textToVector(username);
  await client.execute({ sql: `INSERT INTO ${table} (username, vector) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET vector = excluded.vector`, args: [username, vectorToJson(fresh)] });
  return fresh;
}

async function getOrCreateVideoVector(videoId, videoRow) {
  const existing = parseVector(videoRow?.vector);
  if (existing) return existing;
  // Видео, залитые до появления этой системы, — вектор из title/description/tags,
  // раз уж на них ничего пока не насмотрели.
  const fresh = textToVector(`${videoRow?.title || ''} ${videoRow?.description || ''} ${videoRow?.tags || ''}`);
  await client.execute({ sql: "UPDATE wt_videos SET vector = ? WHERE id = ?", args: [vectorToJson(fresh), videoId] });
  return fresh;
}

async function saveUserVector(username, vec, isShort = false) {
  const table = userVectorsTable(isShort);
  await client.execute({ sql: `INSERT INTO ${table} (username, vector) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET vector = excluded.vector`, args: [username, vectorToJson(vec)] });
}

async function saveVideoVector(videoId, vec) {
  await client.execute({ sql: "UPDATE wt_videos SET vector = ? WHERE id = ?", args: [vectorToJson(vec), videoId] });
}

// ─── Кэш видео-blob'ов в памяти процесса ───────────────────────────────────
// Плеер на одно видео делает много Range-запросов подряд (старт, перемотка,
// буферизация), а getVideoBlob раньше на КАЖДЫЙ такой запрос заново тащил
// из Turso весь base64 целиком (это и видно в логах — по 2-3 секунды на
// запрос). Кэшируем сам blob на короткое время, чтобы вторая, третья и
// так далее Range-запросы одного и того же videoId брали данные из памяти.
const BLOB_CACHE_TTL_MS = 60_000;
const BLOB_CACHE_MAX_ENTRIES = 20;
const blobCache = new Map(); // videoId -> { value, expiresAt }

function blobCacheGet(key) {
  const entry = blobCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    blobCache.delete(key);
    return undefined;
  }
  blobCache.delete(key); // переставляем в конец Map — простое псевдо-LRU
  blobCache.set(key, entry);
  return entry.value;
}

function blobCacheSet(key, value) {
  blobCache.delete(key);
  blobCache.set(key, { value, expiresAt: Date.now() + BLOB_CACHE_TTL_MS });
  if (blobCache.size > BLOB_CACHE_MAX_ENTRIES) {
    blobCache.delete(blobCache.keys().next().value); // вытесняем самый старый
  }
}

// ─── Видео: бинарные данные (чтение/чанковая запись) через root="videos" ───
// Раньше это делалось прямым SQL прямо внутри app/api/video/route.js —
// теперь route.js вообще не знает, что это Turso/SQL, он просто зовёт
// эти две функции.
export async function getVideoBlob(videoId) {
  await initWavyDB();
  const cached = blobCacheGet(videoId);
  if (cached !== undefined) return cached;
  const value = await db.getField('wt_videos', videoId, 'video_data');
  blobCacheSet(videoId, value);
  return value;
}

export async function writeVideoChunk(videoId, chunk, isFirst) {
  await initWavyDB();
  // Первый чанк — перезаписываем ячейку целиком, остальные — дописываем.
  if (isFirst) {
    await db.update('wt_videos', 'id', videoId, { video_data: chunk });
  } else {
    await db.update('wt_videos', 'id', videoId, { video_data: { raw: 'video_data || ?', arg: chunk } });
  }
  blobCache.delete(videoId); // иначе плеер может получить из кэша старую/неполную версию
  return { success: true };
}

export async function saveVideoMetadata(videoData, analyticsData) {
  'use server';
  // ВАЖНО: в production Next.js подменяет ЛЮБОЕ необработанное исключение из
  // Server Action на непрозрачное "An error occurred in the Server Components
  // render..." — реальный текст ошибки клиенту не долетает вообще (это его
  // защитное поведение против утечки деталей стека, а не баг). Поэтому здесь
  // и во всех остальных action'ах, вызываемых из формы загрузки видео, мы сами
  // ловим исключение и возвращаем его текст как обычные данные — тогда
  // handleFastUpload на клиенте сможет показать настоящую причину сбоя.
  try {
    await initWavyDB();

    await client.execute({
      sql: "INSERT INTO wt_channels (username, avatar) VALUES (?, ?) ON CONFLICT(username) DO NOTHING",
      args: [videoData.channel, `https://api.dicebear.com/7.x/bottts/svg?seed=${videoData.channel}`]
    });

    // Теги раньше собирались в форме загрузки (analyticsData.tags), но нигде не
    // сохранялись — просто терялись. Теперь сохраняем их и, вместе с
    // заголовком/описанием, используем как холодный старт для вектора
    // интересов видео (см. lib/recommendVectors.js) — пока у видео нет
    // просмотров, персональные рекомендации ориентируются на эти слова.
    const tags = (analyticsData?.tags || '').trim();
    const initialVector = textToVector(`${videoData.title || ''} ${videoData.description || ''} ${tags}`);

    await client.execute({
      sql: "INSERT INTO wt_videos (id, channel_id, title, description, playlist, thumbnail, is_short, duration, timestamp, video_data, age_rating, is_explicit, tags, vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        videoData.id, 
        videoData.channel, 
        videoData.title, 
        videoData.description || '', 
        videoData.playlist || '', 
        videoData.thumbnail || '', 
        videoData.is_short ? 1 : 0, 
        videoData.duration || 0, 
        Date.now(), 
        '', 
        videoData.age_rating || '12+', // Дефолтное ограничение 12+
        videoData.is_explicit ? 1 : 0,  // Флаг эротического/18+ контента
        tags,
        vectorToJson(initialVector),
      ]
    });

    return { success: true };
  } catch (e) {
    // Полный стек — в лог Vercel (Runtime Logs), краткое сообщение — клиенту.
    console.error('[saveVideoMetadata] сбой сохранения видео:', e);
    return { success: false, error: e?.message || String(e) };
  }
}
// Метаданные ОДНОГО видео по id (без video_data — используется публичной
// embed-страницей /watch/[id], которая ничего не знает про SQL, только зовёт это).
export async function getVideoById(videoId) {
  await initWavyDB();
  const adCols = ['ad_dev_id', 'ad_static_site_id', 'ad_video_site_id'];
  for (const col of adCols) {
    try { await client.execute(`ALTER TABLE wt_channels ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (_) {}
  }
  const columns = "v.id, v.channel_id, v.title, v.description, v.playlist, v.likes, v.dislikes, v.views, v.duration, v.thumbnail, v.is_short, v.timestamp, v.age_rating, v.is_explicit, v.tags, v.ad_positions, c.ad_dev_id as ad_dev_id, c.ad_static_site_id as ad_static_site_id, c.ad_video_site_id as ad_video_site_id";
  const rs = await client.execute({
    sql: `SELECT ${columns} FROM wt_videos v LEFT JOIN wt_channels c ON c.username = v.channel_id WHERE v.id = ?`,
    args: [videoId],
  });
  if (!rs.rows.length) return null;
  const v = rs.rows[0];
  return { ...v, channel: v.channel_id, age_rating: v.age_rating || '12+', is_explicit: Number(v.is_explicit) === 1 };
}

export async function getVideos(searchQuery = '') {
  await initWavyDB();
  // Ensure ad columns exist on wt_channels (lazily added, may not exist on older DBs)
  const adCols = ['ad_dev_id', 'ad_static_site_id', 'ad_video_site_id'];
  for (const col of adCols) {
    try { await client.execute(`ALTER TABLE wt_channels ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (_) {}
  }
  let rs;
  // КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ ДЛЯ СКОРОСТИ: НЕ ЗАГРУЖАЕМ video_data ПРИ ОТКРЫТИИ ЛЕНТЫ! (Снижает загрузку с 10+ сек до <1 сек)
  const columns = "v.id, v.channel_id, v.title, v.description, v.playlist, v.likes, v.dislikes, v.views, v.duration, v.thumbnail, v.is_short, v.timestamp, v.age_rating, v.is_explicit, v.tags, v.ad_positions, c.ad_dev_id as ad_dev_id, c.ad_static_site_id as ad_static_site_id, c.ad_video_site_id as ad_video_site_id";
  const joinSql = `FROM wt_videos v LEFT JOIN wt_channels c ON c.username = v.channel_id`;

  if (searchQuery) {
    rs = await client.execute({ sql: `SELECT ${columns} ${joinSql} WHERE v.title LIKE ? OR v.description LIKE ? ORDER BY v.timestamp DESC`, args: [`%${searchQuery}%`, `%${searchQuery}%`] });
  } else {
    rs = await client.execute(`SELECT ${columns} ${joinSql} ORDER BY v.timestamp DESC`);
  }
  return toPlain(rs.rows).map(v => ({
    ...v,
    channel: v.channel_id,
    age_rating: v.age_rating || '12+',
    is_explicit: Number(v.is_explicit) === 1,
  }));
}

// ── Персональная лента "Рекомендации" (в отличие от "Тренды", которые общие
// для всех и не смотрят на вектор интересов — см. getGlobalRecommendations
// в components/recommendations.js, она осталась как была). Ранжирует по
// косинусному сходству вектора пользователя (см. lib/recommendVectors.js) с
// вектором каждого видео, подмешивая небольшой вес популярности/свежести —
// иначе совсем новое видео без единого просмотра никогда бы никому не
// показалось (у него ещё нет накопленной "похожести" ни с кем).
export async function getPersonalizedFeed(username, limit = 60) {
  await initWavyDB();
  if (!username || username === 'guest') {
    // Гостю персонализировать нечего — отдаём пусто, страница сама
    // откатится на общие "Тренды" (см. page.js).
    return [];
  }
  const userVec = await getOrCreateUserVector(username);
  const columns = "v.id, v.channel_id, v.title, v.description, v.playlist, v.likes, v.dislikes, v.views, v.duration, v.thumbnail, v.is_short, v.timestamp, v.age_rating, v.is_explicit, v.tags, v.ad_positions, v.vector, c.ad_dev_id as ad_dev_id, c.ad_static_site_id as ad_static_site_id, c.ad_video_site_id as ad_video_site_id";
  const rs = await client.execute(`SELECT ${columns} FROM wt_videos v LEFT JOIN wt_channels c ON c.username = v.channel_id ORDER BY v.timestamp DESC LIMIT 500`);
  const rows = toPlain(rs.rows);

  const now = Date.now();
  const scored = rows.map(v => {
    const videoVec = parseVector(v.vector) || textToVector(`${v.title || ''} ${v.description || ''} ${v.tags || ''}`);
    const similarity = cosineSimilarity(userVec, videoVec); // от -1 до 1
    const ageDays = (now - (v.timestamp || now)) / (1000 * 3600 * 24);
    const popularity = Math.log10((v.views || 0) + 1) * 0.3 + Math.log10((v.likes || 0) + 1) * 0.5 - ageDays * 0.05;
    const score = similarity * 10 + popularity; // сходство — основной вес, популярность — тай-брейк/подстраховка для новых видео
    return {
      ...v,
      channel: v.channel_id,
      age_rating: v.age_rating || '12+',
      is_explicit: Number(v.is_explicit) === 1,
      vector: undefined, // клиенту вектор не нужен и не должен уходить с фронта
      score,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function incrementViews(videoId) {
  await initWavyDB();
  await client.execute({ sql: "UPDATE wt_videos SET views = views + 1 WHERE id = ?", args: [videoId] });
  // Точный лог для статистики со снижением точности со временем — см.
  // rollupStats ниже. Один ряд на просмотр, есть только миллисекундный
  // timestamp, больше ничего лишнего.
  await client.execute({ sql: "INSERT INTO wt_view_events (video_id, ts) VALUES (?, ?)", args: [videoId, Date.now()] });
  rollupStats().catch(e => console.error('Ошибка сворачивания статистики:', e));
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RAW_RETENTION_MS = 14 * DAY_MS;         // точный лог — 2 недели
const HOURLY_RETENTION_MS = 60 * DAY_MS;      // почасовые бакеты — 2 месяца
const DAILY_RETENTION_MS = 2 * 365 * DAY_MS;  // подневные бакеты — 2 года
const YEARLY_MERGE_AGE_MS = 10 * 365 * DAY_MS; // после 10 лет — начинаем укрупнять и годовые бакеты

let lastRollupAt = 0;
const ROLLUP_THROTTLE_MS = 60 * 60 * 1000; // не чаще раза в час — незачем это делать на каждый просмотр

// Сворачивает старую статистику просмотров во всё более грубые бакеты:
// точные события (мс) → по часам → по дням → по годам → раз в несколько лет
// (2, потом 4…) для совсем старых данных. Чем старше данные, тем меньше
// деталей — так и просили: "большие логи стоят всё менее точек".
async function rollupStats() {
  const now = Date.now();
  if (now - lastRollupAt < ROLLUP_THROTTLE_MS) return;
  lastRollupAt = now;
  await initWavyDB();

  // 1) Точные события старше 14 дней → часовые бакеты.
  const rawCutoff = now - RAW_RETENTION_MS;
  const rawRows = await client.execute({ sql: "SELECT video_id, ts FROM wt_view_events WHERE ts < ?", args: [rawCutoff] });
  if (rawRows.rows.length) {
    const hourly = new Map(); // `${video_id}|${bucketStart}` -> count
    for (const r of rawRows.rows) {
      const bucketStart = Math.floor(Number(r.ts) / HOUR_MS) * HOUR_MS;
      const key = `${r.video_id}|${bucketStart}`;
      hourly.set(key, (hourly.get(key) || 0) + 1);
    }
    for (const [key, count] of hourly) {
      const [videoId, bucketStart] = key.split('|');
      await client.execute({
        sql: `INSERT INTO wt_stats_rollup (video_id, bucket_type, bucket_start, bucket_span, views) VALUES (?, 'hour', ?, 1, ?)
              ON CONFLICT(video_id, bucket_type, bucket_start) DO UPDATE SET views = views + excluded.views`,
        args: [videoId, Number(bucketStart), count],
      });
    }
    await client.execute({ sql: "DELETE FROM wt_view_events WHERE ts < ?", args: [rawCutoff] });
  }

  // 2) Часовые бакеты старше ~2 месяцев → дневные.
  const hourlyCutoff = now - HOURLY_RETENTION_MS;
  const oldHourly = await client.execute({ sql: "SELECT video_id, bucket_start, views FROM wt_stats_rollup WHERE bucket_type = 'hour' AND bucket_start < ?", args: [hourlyCutoff] });
  if (oldHourly.rows.length) {
    const daily = new Map();
    for (const r of oldHourly.rows) {
      const bucketStart = Math.floor(Number(r.bucket_start) / DAY_MS) * DAY_MS;
      const key = `${r.video_id}|${bucketStart}`;
      daily.set(key, (daily.get(key) || 0) + Number(r.views));
    }
    for (const [key, count] of daily) {
      const [videoId, bucketStart] = key.split('|');
      await client.execute({
        sql: `INSERT INTO wt_stats_rollup (video_id, bucket_type, bucket_start, bucket_span, views) VALUES (?, 'day', ?, 1, ?)
              ON CONFLICT(video_id, bucket_type, bucket_start) DO UPDATE SET views = views + excluded.views`,
        args: [videoId, Number(bucketStart), count],
      });
    }
    await client.execute({ sql: "DELETE FROM wt_stats_rollup WHERE bucket_type = 'hour' AND bucket_start < ?", args: [hourlyCutoff] });
  }

  // 3) Дневные бакеты старше ~2 лет → годовые (bucket_span = 1 год).
  const dailyCutoff = now - DAILY_RETENTION_MS;
  const oldDaily = await client.execute({ sql: "SELECT video_id, bucket_start, views FROM wt_stats_rollup WHERE bucket_type = 'day' AND bucket_start < ?", args: [dailyCutoff] });
  if (oldDaily.rows.length) {
    const yearly = new Map();
    for (const r of oldDaily.rows) {
      const year = new Date(Number(r.bucket_start)).getUTCFullYear();
      const bucketStart = Date.UTC(year, 0, 1);
      const key = `${r.video_id}|${bucketStart}`;
      yearly.set(key, (yearly.get(key) || 0) + Number(r.views));
    }
    for (const [key, count] of yearly) {
      const [videoId, bucketStart] = key.split('|');
      await client.execute({
        sql: `INSERT INTO wt_stats_rollup (video_id, bucket_type, bucket_start, bucket_span, views) VALUES (?, 'year', ?, 1, ?)
              ON CONFLICT(video_id, bucket_type, bucket_start) DO UPDATE SET views = views + excluded.views`,
        args: [videoId, Number(bucketStart), count],
      });
    }
    await client.execute({ sql: "DELETE FROM wt_stats_rollup WHERE bucket_type = 'day' AND bucket_start < ?", args: [dailyCutoff] });
  }

  // 4) Годовые бакеты старше 10 лет — укрупняем дальше: соседние бакеты с
  // одинаковым bucket_span попарно сливаются, span удваивается (1 → 2 → 4…).
  // "через десять лет будет считаться двумя годами" — вот этот шаг.
  const yearlyCutoff = now - YEARLY_MERGE_AGE_MS;
  const oldYearly = await client.execute({
    sql: "SELECT video_id, bucket_start, bucket_span, views FROM wt_stats_rollup WHERE bucket_type = 'year' AND bucket_start < ? ORDER BY video_id, bucket_start ASC",
    args: [yearlyCutoff],
  });
  if (oldYearly.rows.length) {
    const byVideo = new Map();
    for (const r of oldYearly.rows) {
      if (!byVideo.has(r.video_id)) byVideo.set(r.video_id, []);
      byVideo.get(r.video_id).push({ bucket_start: Number(r.bucket_start), bucket_span: Number(r.bucket_span), views: Number(r.views) });
    }
    for (const [videoId, buckets] of byVideo) {
      // Сливаем парами только бакеты с одинаковым span — иначе легко
      // случайно слить разномасштабные куски и запутать данные.
      for (let i = 0; i + 1 < buckets.length; i += 2) {
        const a = buckets[i], b = buckets[i + 1];
        if (a.bucket_span !== b.bucket_span) continue; // разный масштаб — не трогаем, дождёмся следующего прохода
        await client.execute({ sql: "DELETE FROM wt_stats_rollup WHERE video_id = ? AND bucket_type = 'year' AND bucket_start IN (?, ?)", args: [videoId, a.bucket_start, b.bucket_start] });
        await client.execute({
          sql: `INSERT INTO wt_stats_rollup (video_id, bucket_type, bucket_start, bucket_span, views) VALUES (?, 'year', ?, ?, ?)
                ON CONFLICT(video_id, bucket_type, bucket_start) DO UPDATE SET views = views + excluded.views, bucket_span = excluded.bucket_span`,
          args: [videoId, a.bucket_start, a.bucket_span * 2, a.views + b.views],
        });
      }
    }
  }
}

// Отдаёт статистику просмотров по дням/часам — сама решает, из какого
// уровня точности брать (сырые события/часы/дни/годы), в зависимости от
// того, что реально сохранилось для этого видео на момент запроса.
export async function getVideoViewStats(videoId) {
  await initWavyDB();
  const raw = await client.execute({ sql: "SELECT ts FROM wt_view_events WHERE video_id = ? ORDER BY ts ASC", args: [videoId] });
  const rollup = await client.execute({ sql: "SELECT bucket_type, bucket_start, bucket_span, views FROM wt_stats_rollup WHERE video_id = ? ORDER BY bucket_start ASC", args: [videoId] });
  return {
    raw: raw.rows.map(r => Number(r.ts)), // точные timestamp'ы за последние ~14 дней
    rollup: toPlain(rollup.rows).map(r => ({ ...r, bucket_start: Number(r.bucket_start), bucket_span: Number(r.bucket_span), views: Number(r.views) })),
  };
}
export async function logSegmentWatch(videoId, segmentIndex, username) {
  await initWavyDB();

  // Сигнал для персональных рекомендаций (см. lib/recommendVectors.js) —
  // маленький шаг, потому что это событие срабатывает на КАЖДЫЙ сегмент
  // видео (раз в 5-20 секунд), а не один раз за просмотр — иначе долгий
  // просмотр одного видео перетянул бы вектор пользователя целиком на него.
  if (username && username !== 'guest') {
    try {
      const videoRow = (await client.execute({ sql: "SELECT title, description, tags, vector FROM wt_videos WHERE id = ?", args: [videoId] })).rows[0];
      if (videoRow) {
        const userVec = await getOrCreateUserVector(username);
        const videoVec = await getOrCreateVideoVector(videoId, videoRow);
        await saveUserVector(username, nudge(userVec, videoVec, 0.015));
        await saveVideoVector(videoId, nudge(videoVec, userVec, 0.01));
      }
    } catch (e) { console.error('Ошибка обновления вектора интересов:', e); }
  }
  return { success: true };
}

export async function getComments(videoId) {
  await initWavyDB();
  const rs = await client.execute({ sql: "SELECT * FROM wt_comments WHERE video_id = ? ORDER BY timestamp DESC", args: [videoId] });
  return toPlain(rs.rows).map(c => ({...c, author: c.username}));
}

export async function addComment(videoId, username, text) {
  await initWavyDB();
  const id = 'c_' + Math.random().toString(36).substring(2, 11);
  await client.execute({ sql: "INSERT INTO wt_comments (id, video_id, username, text, timestamp) VALUES (?, ?, ?, ?, ?)", args: [id, videoId, username, text, Date.now()] });
  return { success: true };
}

export async function toggleLike(videoId, username, actionType) {
  await initWavyDB();
  const existing = await client.execute({ sql: "SELECT type FROM wt_likes WHERE username = ? AND video_id = ?", args: [username, videoId] });
  let netChange = null; // что реально произошло с точки зрения профиля: 'like' | 'dislike' | 'remove' | null (ничего не изменилось)
  if (existing.rows.length > 0) {
    const currentType = existing.rows[0].type;
    await client.execute({ sql: "DELETE FROM wt_likes WHERE username = ? AND video_id = ?", args: [username, videoId] });
    if (currentType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = MAX(0, likes - 1) WHERE id = ?", args: [videoId] });
    if (currentType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = MAX(0, dislikes - 1) WHERE id = ?", args: [videoId] });

    if (currentType !== actionType) {
      await client.execute({ sql: "INSERT INTO wt_likes (username, video_id, type) VALUES (?, ?, ?)", args: [username, videoId, actionType] });
      if (actionType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = likes + 1 WHERE id = ?", args: [videoId] });
      if (actionType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = dislikes + 1 WHERE id = ?", args: [videoId] });
      netChange = actionType;
    } else {
      netChange = 'remove'; // сняли свою же реакцию — сигнал для профиля тоже стоит откатить по духу (см. ниже)
    }
  } else {
    await client.execute({ sql: "INSERT INTO wt_likes (username, video_id, type) VALUES (?, ?, ?)", args: [username, videoId, actionType] });
    if (actionType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = likes + 1 WHERE id = ?", args: [videoId] });
    if (actionType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = dislikes + 1 WHERE id = ?", args: [videoId] });
    netChange = actionType;
  }

  // Сигнал для персональных рекомендаций (см. lib/recommendVectors.js) —
  // заметно сильнее просмотра сегмента: лайк — осознанное действие.
  if (netChange === 'like' || netChange === 'dislike') {
    try {
      const videoRow = (await client.execute({ sql: "SELECT title, description, tags, vector FROM wt_videos WHERE id = ?", args: [videoId] })).rows[0];
      if (videoRow) {
        const userVec = await getOrCreateUserVector(username);
        const videoVec = await getOrCreateVideoVector(videoId, videoRow);
        if (netChange === 'like') {
          await saveUserVector(username, nudge(userVec, videoVec, 0.12));
          await saveVideoVector(videoId, nudge(videoVec, userVec, 0.05));
        } else {
          // Дизлайк: пользователя отталкиваем от вектора видео (отрицательный
          // шаг), а сам вектор видео почти не трогаем — иначе один дизлайк от
          // человека с нетипичным профилем мог бы испортить рекомендации
          // видео для всех остальных, кому оно нормально заходит.
          await saveUserVector(username, nudge(userVec, videoVec, -0.08));
          await saveVideoVector(videoId, nudge(videoVec, userVec, -0.01));
        }
      }
    } catch (e) { console.error('Ошибка обновления вектора интересов:', e); }
  }

  const updated = await client.execute({ sql: "SELECT likes, dislikes FROM wt_videos WHERE id = ?", args: [videoId] });
  return { success: true, likes: updated.rows[0]?.likes || 0, dislikes: updated.rows[0]?.dislikes || 0 };
}

export async function checkChannelState(subscriber, channel) {
  await initWavyDB();
  const subCheck = await client.execute({ sql: "SELECT 1 FROM wt_subs WHERE subscriber = ? AND channel = ?", args: [subscriber, channel] });
  const countCheck = await client.execute({ sql: "SELECT subscribers, icon, display_name FROM wt_channels WHERE username = ?", args: [channel] });
  const row = countCheck.rows[0] || {};
  return {
    isSubscribed: subCheck.rows.length > 0,
    subscribers: row.subscribers || 0,
    icon: row.icon || '',
    display_name: row.display_name || '',
  };
}

export async function toggleSubscription(subscriber, channel) {
  await initWavyDB();
  const check = await client.execute({ sql: "SELECT 1 FROM wt_subs WHERE subscriber = ? AND channel = ?", args: [subscriber, channel] });
  let isSubbed = false;
  if (check.rows.length > 0) {
    await client.execute({ sql: "DELETE FROM wt_subs WHERE subscriber = ? AND channel = ?", args: [subscriber, channel] });
    await client.execute({ sql: "UPDATE wt_channels SET subscribers = MAX(0, subscribers - 1) WHERE username = ?", args: [channel] });
  } else {
    await client.execute({ sql: "INSERT INTO wt_subs (subscriber, channel) VALUES (?, ?)", args: [subscriber, channel] });
    await client.execute({ sql: "UPDATE wt_channels SET subscribers = subscribers + 1 WHERE username = ?", args: [channel] });
    isSubbed = true;
  }
  const count = await client.execute({ sql: "SELECT subscribers FROM wt_channels WHERE username = ?", args: [channel] });
  return { success: true, isSubbed, count: count.rows[0]?.subscribers || 0 };
}

export async function getChannelProfile(username) {
  await initWavyDB();
  const rs = await client.execute({ sql: "SELECT * FROM wt_channels WHERE username = ?", args: [username] });
  if (rs.rows.length === 0) return { username, avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`, subscribers: 0, description: '' };
  return toPlain(rs.rows)[0];
}

export async function updateChannelProfile(username, settings) {
  'use server';
  await initWavyDB();
  // Ensure columns exist (added lazily so existing DBs are not broken)
  const extraCols = ['ad_dev_id', 'ad_static_site_id', 'ad_video_site_id', 'icon', 'display_name', 'link'];
  for (const col of extraCols) {
    try { await client.execute(`ALTER TABLE wt_channels ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (_) {}
  }
  await client.execute({
    sql: `UPDATE wt_channels
          SET description = ?,
              ad_dev_id = ?,
              ad_static_site_id = ?,
              ad_video_site_id = ?,
              icon = ?,
              display_name = ?,
              link = ?
          WHERE username = ?`,
    args: [
      String(settings.description || ''),
      String(settings.ad_dev_id || ''),
      String(settings.ad_static_site_id || ''),
      String(settings.ad_video_site_id || ''),
      String(settings.icon || ''),
      String(settings.display_name || ''),
      String(settings.link || ''),
      String(username),
    ],
  });
  return { success: true };
}

export async function getUserPlaylists(username) {
  await initWavyDB();
  const rs = await client.execute({ sql: "SELECT * FROM wt_playlists WHERE username = ?", args: [username] });
  return toPlain(rs.rows);
}

export async function createPlaylist(name, username) {
  await initWavyDB();
  const id = 'pl_' + Math.random().toString(36).substring(2, 10);
  await client.execute({ sql: "INSERT INTO wt_playlists (id, name, username) VALUES (?, ?, ?)", args: [id, name, username] });
  return id;
}

export async function searchChannels(query) {
  await initWavyDB();
  if (!query || !query.trim()) return [];
  const q = `%${query.trim()}%`;
  const rs = await client.execute({
    sql: "SELECT username, display_name, avatar, icon, subscribers FROM wt_channels WHERE username LIKE ? OR display_name LIKE ? ORDER BY subscribers DESC LIMIT 20",
    args: [q, q]
  });
  return toPlain(rs.rows);
}

export async function getPlaylistById(playlistId) {
  await initWavyDB();
  if (!playlistId) return null;
  const rs = await client.execute({ sql: "SELECT * FROM wt_playlists WHERE id = ?", args: [playlistId] });
  if (rs.rows.length === 0) return null;
  return toPlain(rs.rows)[0];
}

export async function getVideoAnalytics(videoId) {
  await initWavyDB();
  const rs = await client.execute({ sql: "SELECT segment_index, watch_count FROM wt_telemetry WHERE video_id = ? ORDER BY segment_index ASC", args: [videoId] });
  return toPlain(rs.rows);
}

export async function migrateChannelOwnership() {
  'use server';
  try {
    const info = await client.execute("PRAGMA table_info(wt_channels)");
    const cols = info.rows.map(r => r.name);
    if (!cols.includes('owner_account')) await client.execute("ALTER TABLE wt_channels ADD COLUMN owner_account TEXT DEFAULT ''");
    if (!cols.includes('icon')) await client.execute("ALTER TABLE wt_channels ADD COLUMN icon TEXT DEFAULT ''");
    if (!cols.includes('display_name')) await client.execute("ALTER TABLE wt_channels ADD COLUMN display_name TEXT DEFAULT ''");
  } catch(e) { console.error("Channel ownership migration error:", e); }
}

export async function getMyAccountChannels(accountId, accountKey) {
  'use server';
  await migrateChannelOwnership();
  const userRow = await client.execute({ sql: "SELECT data FROM users WHERE username = ?", args: [String(accountId)] });
  if (userRow.rows.length === 0) return [];
  if (!accountKey || accountKey.length < 10) return { error: 'invalid_key' };
  const rs = await client.execute({ sql: "SELECT * FROM wt_channels WHERE owner_account = ? ORDER BY username ASC", args: [String(accountId)] });
  return toPlain(rs.rows);
}

export async function createAccountChannel(accountId, accountKey, channelName, displayName, icon) {
  'use server';
  await migrateChannelOwnership();
  if (!accountKey || accountKey.length < 10) return { error: 'invalid_key' };
  if (!channelName || channelName.trim().length < 2) return { error: 'name_too_short' };

  const countRs = await client.execute({ sql: "SELECT COUNT(*) as cnt FROM wt_channels WHERE owner_account = ?", args: [String(accountId)] });
  if (Number(countRs.rows[0]?.cnt || 0) >= MAX_CHANNELS_PER_ACCOUNT) return { error: 'limit_reached' };

  const existCheck = await client.execute({ sql: "SELECT username FROM wt_channels WHERE username = ?", args: [channelName.trim()] });
  if (existCheck.rows.length > 0) return { error: 'name_taken' };

  await client.execute({
    sql: `INSERT INTO wt_channels (username, display_name, avatar, icon, description, subscribers, owner_account) VALUES (?, ?, ?, ?, '', 0, ?)`,
    args: [ channelName.trim(), displayName?.trim() || channelName.trim(), `https://api.dicebear.com/7.x/bottts/svg?seed=${channelName}`, icon || '', String(accountId) ]
  });
  return { success: true, channelId: channelName.trim() };
}

export async function verifyChannelOwnership(accountId, accountKey, channelUsername) {
  'use server';
  if (!accountId || !accountKey || accountKey.length < 10) return false;
  try {
    const rs = await client.execute({ sql: "SELECT owner_account FROM wt_channels WHERE username = ?", args: [channelUsername] });
    if (rs.rows.length === 0) return false;
    return String(rs.rows[0].owner_account) === String(accountId);
  } catch (e) {
    console.error('[verifyChannelOwnership] сбой проверки владения каналом:', e);
    return false;
  }
}

export async function deleteAccountChannel(accountId, accountKey, channelUsername) {
  'use server';
  if (!accountKey || accountKey.length < 10) return { error: 'invalid_key' };
  const ownerCheck = await client.execute({ sql: "SELECT owner_account FROM wt_channels WHERE username = ?", args: [channelUsername] });
  if (ownerCheck.rows.length === 0) return { error: 'not_found' };
  if (String(ownerCheck.rows[0].owner_account) !== String(accountId)) return { error: 'access_denied' };

  const videos = await client.execute({ sql: "SELECT id FROM wt_videos WHERE channel_id = ?", args: [channelUsername] });
  for (const v of videos.rows) {
    await client.execute({ sql: "DELETE FROM wt_comments WHERE video_id = ?", args: [v.id] });
    await client.execute({ sql: "DELETE FROM wt_likes WHERE video_id = ?", args: [v.id] });
    await client.execute({ sql: "DELETE FROM wt_telemetry WHERE video_id = ?", args: [v.id] });
  }

  await client.execute({ sql: "DELETE FROM wt_videos WHERE channel_id = ?", args: [channelUsername] });
  await client.execute({ sql: "DELETE FROM wt_subs WHERE channel = ?", args: [channelUsername] });
  await client.execute({ sql: "DELETE FROM wt_channels WHERE username = ?", args: [channelUsername] });
  return { success: true };
}

export async function deleteVideoSecure(videoId, channelUsername, accountId, accountKey) {
  'use server';
  const isOwner = await verifyChannelOwnership(accountId, accountKey, channelUsername);
  if (!isOwner) return { error: 'access_denied' };

  await client.execute({ sql: "DELETE FROM wt_videos WHERE id = ? AND channel_id = ?", args: [videoId, channelUsername] });
  await client.execute({ sql: "DELETE FROM wt_comments WHERE video_id = ?", args: [videoId] });
  await client.execute({ sql: "DELETE FROM wt_likes WHERE video_id = ?", args: [videoId] });
  await client.execute({ sql: "DELETE FROM wt_telemetry WHERE video_id = ?", args: [videoId] });
  return { success: true };
}

// Редактирование параметров уже загруженного видео (название, описание,
// плейлист, возрастной рейтинг, теги) — раньше такой функции не было вообще,
// только создание (saveVideoMetadata) и удаление (deleteVideoSecure).
export async function updateVideoMetadata(videoId, channelUsername, accountId, accountKey, updates) {
  'use server';
  const isOwner = await verifyChannelOwnership(accountId, accountKey, channelUsername);
  if (!isOwner) return { error: 'access_denied' };

  const own = await client.execute({ sql: "SELECT channel_id, title, description, tags FROM wt_videos WHERE id = ?", args: [videoId] });
  if (!own.rows.length || own.rows[0].channel_id !== channelUsername) return { error: 'access_denied' };

  const title = updates.title !== undefined ? adServe_sanitize(updates.title, 200) : own.rows[0].title;
  const description = updates.description !== undefined ? adServe_sanitize(updates.description, 5000) : own.rows[0].description;
  const tags = updates.tags !== undefined ? adServe_sanitize(updates.tags, 500) : own.rows[0].tags;
  const playlist = updates.playlist !== undefined ? adServe_sanitize(updates.playlist, 100) : undefined;
  const ageRating = updates.age_rating !== undefined ? updates.age_rating : undefined;
  const isExplicit = updates.is_explicit !== undefined ? (updates.is_explicit ? 1 : 0) : undefined;
  // До 4 таймкодов (секунды), через запятую — остальное отбрасываем молча,
  // а не ругаемся ошибкой, там всё равно просто цифры из текстового поля.
  const adPositions = updates.ad_positions !== undefined
    ? String(updates.ad_positions).split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0).slice(0, 4).join(',')
    : undefined;

  await client.execute({
    sql: `UPDATE wt_videos SET title = ?, description = ?, tags = ?
          ${playlist !== undefined ? ', playlist = ?' : ''}
          ${ageRating !== undefined ? ', age_rating = ?' : ''}
          ${isExplicit !== undefined ? ', is_explicit = ?' : ''}
          ${adPositions !== undefined ? ', ad_positions = ?' : ''}
          WHERE id = ? AND channel_id = ?`,
    args: [
      title, description, tags,
      ...(playlist !== undefined ? [playlist] : []),
      ...(ageRating !== undefined ? [ageRating] : []),
      ...(isExplicit !== undefined ? [isExplicit] : []),
      ...(adPositions !== undefined ? [adPositions] : []),
      videoId, channelUsername,
    ],
  });

  // Название/описание/теги поменялись — слегка подталкиваем вектор видео к
  // новому тексту (НЕ полный сброс: то, что уже "выучилось" от реальных
  // зрителей, ценнее одной правки текста, поэтому вес небольшой).
  try {
    const newTextVec = textToVector(`${title} ${description} ${tags}`);
    const rs = await client.execute({ sql: "SELECT vector FROM wt_videos WHERE id = ?", args: [videoId] });
    const currentVec = parseVector(rs.rows[0]?.vector) || newTextVec;
    await client.execute({ sql: "UPDATE wt_videos SET vector = ? WHERE id = ?", args: [vectorToJson(nudge(currentVec, newTextVec, 0.15)), videoId] });
  } catch (e) { console.error('Ошибка обновления вектора после редактирования:', e); }

  return { success: true };
}












// ── КОНФИГ (дефолтные значения — замени здесь) ────────────────────────────
const ADS_CONFIG = {
  DEV_ACCOUNT_COST: 10,       // Pey Coins за аккаунт разработчика
  MIN_WITHDRAWAL:   10,       // Минимальная сумма вывода
  MAX_SITES:        10,       // Макс. сайтов у одного разработчика
  DEFAULT_CPV:      0.5,      // Дефолтная цена за просмотр
  FALLBACK_BANNER:  'https://via.placeholder.com/468x60?text=ParrotSoft+Ads', // Заглушка
  FALLBACK_VIDEO:   'https://www.w3schools.com/html/mov_bbb.mp4',           // Заглушка
};
// ─────────────────────────────────────────────────────────────────────────

// БАГ, который был в исходном файле: initAdsDBFull() ниже вызывала initAdsDB(),
// а сама initAdsDB нигде не была объявлена. Из-за этого ЛЮБОЙ вызов
// initAdsDBFull() падал с "ReferenceError: initAdsDB is not defined" —
// то есть вся рекламная система и весь dev-аккаунт функционал
// (getAdCampaignStats, createAdCampaignFull, setAdStatus, activateDevAccount,
// isDevAccount, registerDevSite и т.д.) были нерабочими. Восстановил
// таблицы по факту их использования (fa_ads, fa_withdrawals) ниже по файлу.
const initAdsDB = once(async function initAdsDB() {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_ads (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      title TEXT,
      type TEXT,
      content_url TEXT,
      target_url TEXT,
      budget REAL DEFAULT 0,
      initial_budget REAL DEFAULT 0,
      cost_per_view REAL DEFAULT 0,
      status TEXT DEFAULT 'active',
      timestamp INTEGER
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_withdrawals (
      id TEXT PRIMARY KEY,
      dev_id TEXT,
      amount REAL DEFAULT 0,
      method TEXT,
      details TEXT,
      status TEXT DEFAULT 'pending',
      timestamp INTEGER
    )
  `);
});

// Инициализация расширенных таблиц рекламной системы
async function initAdsDBFullImpl() {
  'use server';
  await initAdsDB(); // базовая инициализация (теперь реально существует, см. выше)
  
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_sites (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      name TEXT,
      url TEXT,
      description TEXT,
      status TEXT DEFAULT 'active',
      total_views INTEGER DEFAULT 0,
      total_earned REAL DEFAULT 0,
      timestamp INTEGER
    )
  `);
  
  // Добавляем флаг разработчика в таблицу пользователей (идемпотентно)
  try {
    await client.execute(`ALTER TABLE users ADD COLUMN is_dev INTEGER DEFAULT 0`);
  } catch (_) { /* уже есть */ }
  
  // Добавляем initial_budget в fa_ads для отображения расходов
  try {
    await client.execute(`ALTER TABLE fa_ads ADD COLUMN initial_budget REAL DEFAULT 0`);
  } catch (_) { /* уже есть */ }
}
export const initAdsDBFull = once(initAdsDBFullImpl);

// ── Полная статистика кампании ─────────────────────────────────────────────
export async function getAdCampaignStats(ownerId) {
  'use server';
  await initAdsDBFull();
  const rs = await client.execute({
    sql: `SELECT id, title, type, content_url, target_url, budget, initial_budget,
                 cost_per_view, status, timestamp
          FROM fa_ads WHERE owner_id = ? ORDER BY timestamp DESC`,
    args: [String(ownerId)],
  });
  return toPlain(rs.rows).map(r => ({
    ...r,
    budget:          Number(r.budget || 0),
    initial_budget:  Number(r.initial_budget || r.budget || 0),
    cost_per_view:   Number(r.cost_per_view || 0),
    spent:           Number(r.initial_budget || 0) - Number(r.budget || 0),
    est_views:       Math.floor(Number(r.budget || 0) / Number(r.cost_per_view || 1)),
  }));
}

// ── Создание кампании с initial_budget ────────────────────────────────────
export async function createAdCampaignFull(ownerId, title, type, contentUrl, targetUrl, budget, cpv) {
  'use server';
  await initAdsDBFull();
  
  const userData = await getRawUserData(ownerId);
  const currentBalance = Number(userData.balance || 0);
  const totalBudget = Number(budget);
  const costPerView = Number(cpv || ADS_CONFIG.DEFAULT_CPV);

  if (currentBalance < totalBudget) {
    return { success: false, error: 'Недостаточно Pey Coins на балансе' };
  }
  if (totalBudget < costPerView) {
    return { success: false, error: 'Бюджет не может быть меньше CPV' };
  }

  userData.balance = currentBalance - totalBudget;
  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), String(ownerId)],
  });

  const adId = 'ad_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: `INSERT INTO fa_ads 
            (id, owner_id, title, type, content_url, target_url, budget, initial_budget, cost_per_view, status, timestamp) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    args: [adId, ownerId, title, type, contentUrl, targetUrl, totalBudget, totalBudget, costPerView, Date.now()],
  });

  return { success: true, adId };
}

// ── Изменение статуса кампании ─────────────────────────────────────────────
export async function setAdStatus(adId, ownerId, newStatus) {
  'use server';
  const check = await client.execute({
    sql: 'SELECT owner_id, budget, cost_per_view FROM fa_ads WHERE id = ?',
    args: [adId],
  });
  if (check.rows.length === 0) return { error: 'not_found' };
  if (String(check.rows[0].owner_id) !== String(ownerId)) return { error: 'access_denied' };

  // При возобновлении проверяем что есть бюджет
  if (newStatus === 'active') {
    const ad = check.rows[0];
    if (Number(ad.budget) < Number(ad.cost_per_view)) {
      return { error: 'budget_too_low' };
    }
  }

  await client.execute({
    sql: 'UPDATE fa_ads SET status = ? WHERE id = ?',
    args: [newStatus, adId],
  });
  return { success: true };
}

// ── Активация аккаунта разработчика ───────────────────────────────────────
export async function activateDevAccount(username) {
  'use server';
  await initAdsDBFull();
  
  // Уже активирован?
  const isDevRow = await client.execute({
    sql: 'SELECT is_dev FROM users WHERE username = ?',
    args: [username],
  });
  if (Number(isDevRow.rows[0]?.is_dev) === 1) {
    return { success: false, error: 'already_activated' };
  }

  const userData = await getRawUserData(username);
  const balance = Number(userData.balance || 0);
  const cost = ADS_CONFIG.DEV_ACCOUNT_COST;

  if (balance < cost) {
    return { success: false, error: `Нужно ${cost} pc, у тебя ${balance} pc` };
  }

  userData.balance = balance - cost;
  await client.execute({
    sql: 'UPDATE users SET data = ?, is_dev = 1 WHERE username = ?',
    args: [JSON.stringify(userData), String(username)],
  });

  return { success: true, newBalance: userData.balance };
}

// ── Проверка статуса разработчика ─────────────────────────────────────────
export async function isDevAccount(username) {
  'use server';
  try {
    await initAdsDBFull();
    const rs = await client.execute({
      sql: 'SELECT is_dev FROM users WHERE username = ?',
      args: [String(username)],
    });
    return Boolean(Number(rs.rows[0]?.is_dev || 0));
  } catch (_) {
    return false;
  }
}

// ── Регистрация сайта ──────────────────────────────────────────────────────
export async function registerDevSite(username, name, url, description) {
  'use server';
  await initAdsDBFull();
  
  const isDev = await isDevAccount(username);
  if (!isDev) return { error: 'not_dev_account' };

  const countR = await client.execute({
    sql: 'SELECT COUNT(*) as cnt FROM fa_sites WHERE owner_id = ?',
    args: [String(username)],
  });
  if (Number(countR.rows[0]?.cnt) >= ADS_CONFIG.MAX_SITES) {
    return { error: `Лимит ${ADS_CONFIG.MAX_SITES} сайтов достигнут` };
  }

  const siteId = 'site_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: 'INSERT INTO fa_sites (id, owner_id, name, url, description, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    args: [siteId, String(username), name.trim(), url.trim(), description?.trim() || '', Date.now()],
  });
  return { success: true, siteId };
}

// ── Получить сайты разработчика ────────────────────────────────────────────
export async function getDevSites(username) {
  'use server';
  await initAdsDBFull();
  const rs = await client.execute({
    sql: 'SELECT * FROM fa_sites WHERE owner_id = ? ORDER BY timestamp DESC',
    args: [String(username)],
  });
  return toPlain(rs.rows).map(r => ({
    ...r,
    total_views:  Number(r.total_views || 0),
    total_earned: Number(r.total_earned || 0),
  }));
}

// ── Удалить сайт ────────────────────────────────────────────────────────────
export async function deleteDevSite(username, siteId) {
  'use server';
  const check = await client.execute({
    sql: 'SELECT owner_id FROM fa_sites WHERE id = ?',
    args: [siteId],
  });
  if (check.rows.length === 0) return { error: 'not_found' };
  if (String(check.rows[0].owner_id) !== String(username)) return { error: 'access_denied' };
  await client.execute({ sql: 'DELETE FROM fa_sites WHERE id = ?', args: [siteId] });
  return { success: true };
}

// ── Ротатор рекламы с типом ─────────────────────────────────────────────────
export async function getAdForPlacementFull(type, devUsername, siteId) {
  'use server';
  await initAdsDBFull();
  
  const rs = await client.execute({
    sql: "SELECT * FROM fa_ads WHERE type = ? AND status = 'active' AND budget >= cost_per_view ORDER BY RANDOM() LIMIT 1",
    args: [type],
  });

  if (rs.rows.length === 0) {
    // Фоллбэк реклама
    return {
      isFallback: true,
      id: 'fallback',
      type,
      content_url: type === 'video' ? ADS_CONFIG.FALLBACK_VIDEO : ADS_CONFIG.FALLBACK_BANNER,
      target_url: 'https://parrotsoft.vercel.app',
    };
  }

  const ad = toPlain(rs.rows)[0];
  
  // Засчитываем показ автоматически если переданы данные разработчика
  if (devUsername && siteId) {
    await logAdImpressionFull(ad.id, devUsername, siteId);
  }

  return ad;
}

// ── Биллинг просмотра с обновлением статистики сайта ──────────────────────
export async function logAdImpressionFull(adId, devUsername, siteId) {
  'use server';
  if (!adId || adId === 'fallback') return { success: true };
  await initAdsDBFull();

  const adRs = await client.execute({
    sql: 'SELECT budget, cost_per_view FROM fa_ads WHERE id = ?',
    args: [adId],
  });
  if (adRs.rows.length === 0) return { error: 'ad_not_found' };

  const ad = adRs.rows[0];
  const cost = Number(ad.cost_per_view);

  if (Number(ad.budget) < cost) {
    await client.execute({ sql: "UPDATE fa_ads SET status = 'ended' WHERE id = ?", args: [adId] });
    return { error: 'budget_ended' };
  }

  // Списываем с бюджета кампании
  await client.execute({
    sql: 'UPDATE fa_ads SET budget = budget - ? WHERE id = ?',
    args: [cost, adId],
  });

  // Начисляем разработчику
  if (devUsername) {
    const devData = await getRawUserData(devUsername);
    devData.balance = Number(devData.balance || 0) + cost;
    await client.execute({
      sql: 'UPDATE users SET data = ? WHERE username = ?',
      args: [JSON.stringify(devData), String(devUsername)],
    });
  }

  // Обновляем статистику сайта
  if (siteId) {
    await client.execute({
      sql: 'UPDATE fa_sites SET total_views = total_views + 1, total_earned = total_earned + ? WHERE id = ?',
      args: [cost, siteId],
    });
  }

  return { success: true };
}

// ── Вывод средств разработчика ─────────────────────────────────────────────
export async function requestAdWithdrawalFull(devId, amount, method, details) {
  'use server';
  await initAdsDBFull();
  
  const reqAmount = Number(amount);
  if (reqAmount < ADS_CONFIG.MIN_WITHDRAWAL) {
    return { success: false, error: `Минимум для вывода: ${ADS_CONFIG.MIN_WITHDRAWAL} pc` };
  }

  const userData = await getRawUserData(devId);
  const currentBalance = Number(userData.balance || 0);

  if (currentBalance < reqAmount) {
    return { success: false, error: `Недостаточно средств. Баланс: ${currentBalance} pc` };
  }

  // Замораживаем средства
  userData.balance = currentBalance - reqAmount;
  await client.execute({
    sql: 'UPDATE users SET data = ? WHERE username = ?',
    args: [JSON.stringify(userData), String(devId)],
  });

  const withdrawalId = 'with_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: `INSERT INTO fa_withdrawals (id, dev_id, amount, method, details, status, timestamp) 
          VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    args: [withdrawalId, devId, reqAmount, method, details, Date.now()],
  });

  return { success: true, withdrawalId, newBalance: userData.balance };
}

// ── История выводов ─────────────────────────────────────────────────────────
export async function getWithdrawalHistory(devId) {
  'use server';
  await initAdsDBFull();
  const rs = await client.execute({
    sql: 'SELECT * FROM fa_withdrawals WHERE dev_id = ? ORDER BY timestamp DESC',
    args: [String(devId)],
  });
  return toPlain(rs.rows).map(r => ({ ...r, amount: Number(r.amount) }));
}

// ── Баланс пользователя ────────────────────────────────────────────────────
export async function getUserBalance(username) {
  'use server';
  const userRes = await client.execute({
      sql: "SELECT data FROM users WHERE username = ?",
      args: [name]
    });

    if (userRes.rows.length > 0) {
      let userData = JSON.parse(userRes.rows[0].data);
      const currentBalance = Number(userData.balance) || 0;
    }
}

// ── Экспортируем конфиг для использования во фронте ────────────────────────
export async function getAdsConfig() {
  'use server';
  return ADS_CONFIG;
}
// ══════════════════════════════════════════════════════════════════
// ██████╗  █████╗ ██████╗ ██████╗  ██████╗ ████████╗███╗   ███╗ █████╗ ██╗██╗
// ██╔══██╗██╔══██╗██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝████╗ ████║██╔══██╗██║██║
// ██████╔╝███████║██████╔╝██████╔╝██║   ██║   ██║   ██╔████╔██║███████║██║██║
// ██╔═══╝ ██╔══██║██╔══██╗██╔══██╗██║   ██║   ██║   ██║╚██╔╝██║██╔══██║██║██║
// ██║     ██║  ██║██║  ██║██║  ██║╚██████╔╝   ██║   ██║ ╚═╝ ██║██║  ██║██║███████╗
// ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
// ═════════════════════════════════════════════════════════════════════════
// СИСТЕМА ПОКАЗА РЕКЛАМЫ (реальный /api/ads, используется WavyPlayer)
// ═════════════════════════════════════════════════════════════════════════
// Перенесено из app/api/ads/route.js — там был отдельный клиент Turso со
// своим хардкодом credentials. Логика (SQL, названия колонок, поведение)
// не менялась, только вызов client теперь общий (см. верх файла).
//
// ⚠️ ВАЖНО: в файле уже ЕСТЬ другой, более старый набор функций для рекламы
// (initAdsDBFull, createAdCampaignFull, getAdCampaignStats, setAdStatus,
// activateDevAccount, registerDevSite и т.д. — выше по файлу). Он работает
// с теми же таблицами fa_ads/fa_sites/fa_withdrawals, но ждёт ДРУГИЕ
// колонки (например cost_per_view вместо cpv/cpc, нет views/clicks).
// Судя по тому, что WavyPlayer реально дёргает именно /api/ads?action=getAd
// и action=verifyImpression — актуальна схема ИМЕННО из этого блока
// (cpv/cpc/views/clicks). Тот, старый набор функций, скорее всего, уже
// нерабочий (упадёт на "no such column: cost_per_view") и является
// мёртвым/устаревшим кодом — я его не трогал и не удалял, но имей в виду
// и дай знать, если он где-то ещё используется — надо будет разобраться,
// который из двух вариантов оставлять.

const ANTI_FRAUD_SECRET = process.env.API_SECRET || "firesoft_super_secret_key_2026";
const AD_PLATFORM_ACCOUNT = 'Icfg';

const AD_DEV_REWARD_MULTIPLIER = 0.001; // Разработчик получает 1/1000 от стоимости (PC -> WC)
const AD_WITHDRAWAL_FEE_PCT    = 0.50;  // Комиссия при выводе средств (50%)
const AD_DEV_ACCOUNT_COST      = 10;    // Цена активации аккаунта разработчика (PC)

// БАГ: banner/video/interstitial использовали один и тот же ключ
// '461fc1b30ddf891492b673d9f9ce6b0b', но выдавали его за 468×60 и грузили
// через www.profitabledisplaynetwork.com — а по факту (см. components/AdBanner.jsx,
// где ключи реально размечены по форматам) этот конкретный ключ на стороне
// Adsterra зарегистрирован как зона 728×90 и должен вызываться через
// www.highperformanceformat.com. Неверный размер/хост для ключа — Adsterra
// не может сопоставить запрос с настроенной зоной и отдаёт заглушку "no fill"
// (тот самый жёлто-синий картиночный плейсхолдер с водяным знаком shutterstock,
// который ты видела на скриншоте — это не наш баг в вёрстке, это ответ
// самого Adsterra на неправильный запрос).
const ADSTERRA_CONFIGS = {
  banner:       { key: '3680ffe122e759a51ccf2ff1a1662602', width: 468, height: 60 },
  video:        { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 728, height: 90 },
  interstitial: { key: 'e12a683813d15c90e3c07907f05208ae', width: 300, height: 250 },
};
const ADSTERRA_SCRIPT_HOST = 'www.highperformanceformat.com';

const ensureAdsServeTables = once(async function ensureAdsServeTables() {
  await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_ads (
      id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, type TEXT, content_url TEXT, target_url TEXT,
      budget TEXT DEFAULT '0', initial_budget TEXT DEFAULT '0',
      cpv TEXT DEFAULT '0.1', cpc TEXT DEFAULT '0.5',
      views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, status TEXT DEFAULT 'active', timestamp INTEGER
    )`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_withdrawals (
      id TEXT PRIMARY KEY, dev_id TEXT, amount_requested REAL DEFAULT 0, amount_payout REAL DEFAULT 0,
      fee REAL DEFAULT 0, method TEXT, details TEXT, status TEXT DEFAULT 'pending', timestamp INTEGER
    )`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_sites (
      id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, url TEXT, description TEXT, status TEXT DEFAULT 'active',
      total_views INTEGER DEFAULT 0, total_earned REAL DEFAULT 0, timestamp INTEGER
    )`);

  await client.execute(`CREATE TABLE IF NOT EXISTS fa_views_log (token TEXT PRIMARY KEY, timestamp INTEGER)`);

  for (const sql of [
    `ALTER TABLE users ADD COLUMN is_dev INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN initial_budget TEXT DEFAULT '0'`,
    `ALTER TABLE fa_ads ADD COLUMN views INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN clicks INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN cpc TEXT DEFAULT '0.5'`,
    `ALTER TABLE fa_withdrawals ADD COLUMN amount_payout REAL DEFAULT 0`,
    `ALTER TABLE fa_withdrawals ADD COLUMN fee REAL DEFAULT 0`,
  ]) { try { await client.execute(sql); } catch (_) {} }
});

async function adServe_getRawUser(username) {
  if (!username || username === 'null' || username === 'undefined') return { balance: 0, wavy_coins: 0, isDevAccount: false };
  const row = await db.get('users', String(username), 'username');
  if (!row) return { balance: 0, wavy_coins: 0, isDevAccount: false };
  try {
    const d = JSON.parse(row.data || '{}');
    return { ...d, balance: Number(d.balance || 0), wavy_coins: Number(d.wavy_coins || 0), isDevAccount: Boolean(d.isDevAccount) };
  } catch { return { balance: 0, wavy_coins: 0, isDevAccount: false }; }
}

async function adServe_saveUser(username, data) {
  if (!username || username === 'null') return;
  await saveUserData(username, data);
}

async function adServe_addPlatformFee(amountWC) {
  if (!amountWC || amountWC <= 0 || !AD_PLATFORM_ACCOUNT) return;
  try {
    const pd = await adServe_getRawUser(AD_PLATFORM_ACCOUNT);
    pd.wavy_coins = Number(((pd.wavy_coins || 0) + amountWC).toFixed(8));
    await adServe_saveUser(AD_PLATFORM_ACCOUNT, pd);
  } catch (_) {}
}

function adServe_sanitize(s, max = 300) { return typeof s === 'string' ? s.replace(/[<>"'`]/g, '').trim().slice(0, max) : ''; }

// ── Рендер рекламы в iframe (HTML) ──────────────────────────────────────────
export async function renderAdHtml({ type = 'banner', devId = '', siteId = '' }) {
  'use server';
  await ensureAdsServeTables();

  const rs = await client.execute({
    sql: `SELECT * FROM fa_ads WHERE type = ? AND status = 'active' AND CAST(budget AS REAL) >= CAST(cpv AS REAL) ORDER BY RANDOM() LIMIT 1`,
    args: [type]
  });

  let adId = 'adsterra';
  let mediaHtml = '';

  if (rs.rows.length > 0) {
    const ad = rs.rows[0];
    adId = ad.id;
    const clickUrl = `/api/ads?action=click&adId=${ad.id}&devId=${encodeURIComponent(devId)}&siteId=${encodeURIComponent(siteId)}&target=${encodeURIComponent(ad.target_url)}`;
    const mediaTag = type === 'video'
      ? `<video src="${ad.content_url}" autoplay loop muted playsinline></video>`
      : `<img src="${ad.content_url}" alt="Ad" />`;

    mediaHtml = `
      ${mediaTag}
      <a href="${clickUrl}" target="_blank" class="link"></a>
      <div class="badge">ParrotSoft Ads</div>
    `;
  } else {
    const cfg = ADSTERRA_CONFIGS[type] || ADSTERRA_CONFIGS.banner;
    mediaHtml = `
      <script type="text/javascript">
        atOptions = { 'key': '${cfg.key}', 'format': 'iframe', 'height': ${cfg.height}, 'width': ${cfg.width}, 'params': {} };
      </script>
      <script type="text/javascript" src="https://${ADSTERRA_SCRIPT_HOST}/${cfg.key}/invoke.js"></script>
      <div class="badge" style="z-index:100;background:rgba(0,0,0,0.5);">Adsterra</div>
    `;
  }

  const payloadObj = { adId, devId, siteId, ts: Date.now() };
  const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
  const signature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payloadBase64).digest('hex');

  return `
    <!DOCTYPE html><html><head><style>
      body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: sans-serif; display: flex; justify-content: center; align-items: center; }
      .box { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
      video, img { width: 100%; height: 100%; object-fit: contain; display: block; }
      .link { position: absolute; inset: 0; z-index: 10; cursor: pointer; }
      .badge { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.7); font-size: 10px; padding: 2px 6px; border-radius: 4px; z-index: 11; pointer-events: none; }
    </style></head><body>
      <div class="box" id="ad-container">
        ${mediaHtml}
      </div>
      <script>
        let impressionSent = false;
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting && !impressionSent) {
            impressionSent = true;
            fetch('/api/ads', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'verifyImpression',
                payload: '${payloadBase64}',
                signature: '${signature}'
              })
            }).catch(()=>{});
          }
        }, { threshold: 0.5 });
        observer.observe(document.getElementById('ad-container'));
      </script>
    </body></html>
  `;
}

// ── Реклама для встроенного мидролла (используется WavyPlayer, без iframe) ──
export async function getAdForPlayer(type, devId, siteId) {
  'use server';
  await ensureAdsServeTables();
  const rs = await client.execute({
    sql: `SELECT * FROM fa_ads WHERE type = ? AND status = 'active' AND CAST(budget AS REAL) >= CAST(cpv AS REAL) ORDER BY RANDOM() LIMIT 1`,
    args: [type]
  });

  if (rs.rows.length === 0) {
    // БАГ: раньше здесь просто возвращалось { success: false } — на свежей
    // платформе, где ещё нет ни одной кампании рекламодателя в fa_ads (обычный
    // случай в самом начале), это означало, что мидролл-реклама в плеере
    // НИКОГДА не показывалась вообще: tryShowMidroll просто молча ничего не
    // делал на КАЖДОМ запланированном показе. У баннеров (renderAdHtml) уже
    // был запасной вариант на Adsterra, а тут — нет. Добавляем тот же
    // запасной вариант: рендерим Adsterra через iframe (тот же /api/ads
    // ?action=renderAd маршрут, что и у баннеров) — content_url тут не
    // простая картинка/видео, поэтому используем отдельное поле use_iframe
    // и iframe_url, а WavyPlayer рендерит iframe вместо <video>/<img>.
    const payloadObj = { adId: 'adsterra', devId, siteId, ts: Date.now() };
    const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
    const signature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payloadBase64).digest('hex');
    return {
      success: true,
      ad: {
        id: 'adsterra',
        use_iframe: true,
        iframe_url: `/api/ads?action=renderAd&type=banner&devId=${encodeURIComponent(devId || '')}&siteId=${encodeURIComponent(siteId || '')}`,
        payload: payloadBase64,
        signature,
      },
    };
  }

  const ad = rs.rows[0];
  const payloadObj = { adId: ad.id, devId, siteId, ts: Date.now() };
  const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
  const signature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payloadBase64).digest('hex');

  return {
    success: true,
    ad: {
      id: ad.id,
      source: ad.type,
      content_url: ad.content_url,
      target_url: `/api/ads?action=click&adId=${ad.id}&devId=${encodeURIComponent(devId)}&siteId=${encodeURIComponent(siteId)}&target=${encodeURIComponent(ad.target_url)}`,
      payload: payloadBase64,
      signature
    }
  };
}

// ── Обработка клика (и биллинг перехода) ────────────────────────────────────
export async function handleAdClick(adId, devId, siteId, target) {
  'use server';
  await ensureAdsServeTables();
  const finalTarget = target || 'https://parrotsoft.ru';

  if (adId && adId !== 'adsterra') {
    const adRes = await client.execute({ sql: "SELECT cpc, budget FROM fa_ads WHERE id = ?", args: [adId] });
    if (adRes.rows.length > 0) {
      const ad = adRes.rows[0];
      const cpc = parseFloat(ad.cpc || '0.5');
      const budget = parseFloat(ad.budget || '0');

      if (budget >= cpc) {
        await client.execute({
          sql: "UPDATE fa_ads SET budget = CAST(CAST(budget AS REAL) - ? AS TEXT), clicks = clicks + 1 WHERE id = ?",
          args: [cpc, adId]
        });

        if (devId && devId !== 'null') {
          const costWC = cpc * AD_DEV_REWARD_MULTIPLIER;
          const ud = await adServe_getRawUser(devId);
          ud.wavy_coins = Number((ud.wavy_coins + costWC).toFixed(8));
          await adServe_saveUser(devId, ud);

          if (siteId && siteId !== 'null') {
            await client.execute({ sql: "UPDATE fa_sites SET total_earned = total_earned + ? WHERE id = ?", args: [costWC, siteId] });
          }
        }
      }
    }
  }
  return finalTarget;
}

// ── Кабинеты ─────────────────────────────────────────────────────────────
export async function getAdStatus(user) {
  'use server';
  await ensureAdsServeTables();
  const ud = await adServe_getRawUser(user);
  return { balance_pc: ud.balance, balance_wc: ud.wavy_coins, isDevAccount: ud.isDevAccount, devAccountCost: AD_DEV_ACCOUNT_COST, withdrawalFee: AD_WITHDRAWAL_FEE_PCT };
}

export async function getMyAdCampaigns(user) {
  'use server';
  await ensureAdsServeTables();
  const rs = await client.execute({ sql: 'SELECT * FROM fa_ads WHERE owner_id=? ORDER BY timestamp DESC', args: [String(user)] });
  return toPlain(rs.rows);
}

export async function getMyAdSites(user) {
  'use server';
  await ensureAdsServeTables();
  const rs = await client.execute({ sql: 'SELECT * FROM fa_sites WHERE owner_id=? ORDER BY timestamp DESC', args: [String(user)] });
  return toPlain(rs.rows);
}

export async function getAdWithdrawals(user) {
  'use server';
  await ensureAdsServeTables();
  const rs = await client.execute({ sql: 'SELECT * FROM fa_withdrawals WHERE dev_id=? ORDER BY timestamp DESC', args: [String(user)] });
  return toPlain(rs.rows);
}

// ── Биллинг показа (после подтверждения Anti-Fraud скриптом на клиенте) ────
export async function verifyAdImpression(payload, signature) {
  'use server';
  await ensureAdsServeTables();
  if (!payload || !signature) return { error: 'Missing security data' };

  const expectedSignature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payload).digest('hex');
  if (signature !== expectedSignature) return { error: 'Fraud detected', status: 403 };

  const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  const { adId, devId, siteId, ts } = data;

  if (Date.now() - ts > 30 * 60 * 1000) return { error: 'Token expired', status: 403 };

  try {
    await client.execute({ sql: "INSERT INTO fa_views_log (token, timestamp) VALUES (?, ?)", args: [signature, Date.now()] });
  } catch (e) {
    return { error: 'Impression already counted', status: 429 };
  }

  if (adId === 'adsterra') {
    const microReward = 0.000001;
    if (devId && devId !== 'null') {
      const ud = await adServe_getRawUser(devId);
      ud.wavy_coins = Number((ud.wavy_coins + microReward).toFixed(8));
      await adServe_saveUser(devId, ud);
      if (siteId && siteId !== 'null') {
        await client.execute({ sql: "UPDATE fa_sites SET total_views = total_views + 1, total_earned = total_earned + ? WHERE id = ?", args: [microReward, siteId] });
      }
    }
    return { success: true, reward: microReward };
  }

  const adRes = await client.execute({ sql: "SELECT cpv, budget, status FROM fa_ads WHERE id = ?", args: [adId] });
  if (adRes.rows.length === 0 || adRes.rows[0].status !== 'active') return { error: 'Ad inactive' };

  const cpv = parseFloat(adRes.rows[0].cpv || '0.1');
  const costWC = cpv * AD_DEV_REWARD_MULTIPLIER;

  await client.execute({ sql: "UPDATE fa_ads SET budget = CAST(CAST(budget AS REAL) - ? AS TEXT), views = views + 1 WHERE id = ?", args: [cpv, adId] });

  if (devId && devId !== 'null') {
    const ud = await adServe_getRawUser(devId);
    ud.wavy_coins = Number((ud.wavy_coins + costWC).toFixed(8));
    await adServe_saveUser(devId, ud);
    if (siteId && siteId !== 'null') {
      await client.execute({ sql: "UPDATE fa_sites SET total_views = total_views + 1, total_earned = total_earned + ? WHERE id = ?", args: [costWC, siteId] });
    }
  }
  return { success: true, reward: costWC };
}

// ── Создание кампании ───────────────────────────────────────────────────────
export async function createAdCampaign(ownerId, title, type, contentUrl, targetUrl, budget, cpv, cpc) {
  'use server';
  await ensureAdsServeTables();
  const reqBudget = Number(budget);
  const reqCpv = Number(cpv || 0.1);
  const reqCpc = Number(cpc || 0.5);

  const ud = await adServe_getRawUser(ownerId);
  if (ud.balance < reqBudget) return { success: false, error: 'Недостаточно PC' };

  ud.balance -= reqBudget;
  await adServe_saveUser(ownerId, ud);

  const adId = 'ad_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: `INSERT INTO fa_ads (id,owner_id,title,type,content_url,target_url,budget,initial_budget,cpv,cpc,views,clicks,status,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`,
    args: [adId, String(ownerId), adServe_sanitize(title, 200), type, contentUrl, targetUrl, String(reqBudget), String(reqBudget), String(reqCpv), String(reqCpc), 0, 0, Date.now()]
  });
  return { success: true, adId, newBalance_pc: ud.balance };
}

export async function adServe_activateDevAccount(username) {
  'use server';
  await ensureAdsServeTables();
  const ud = await adServe_getRawUser(username);
  if (ud.isDevAccount) return { success: false, error: 'Уже активирован' };
  if (ud.balance < AD_DEV_ACCOUNT_COST) return { success: false, error: `Нужно ${AD_DEV_ACCOUNT_COST} PC` };
  ud.balance -= AD_DEV_ACCOUNT_COST; ud.isDevAccount = true;
  await adServe_saveUser(username, ud);
  await adServe_addPlatformFee(AD_DEV_ACCOUNT_COST * AD_DEV_REWARD_MULTIPLIER);
  return { success: true };
}

export async function stopAdCampaign(adId, ownerId) {
  'use server';
  await ensureAdsServeTables();
  await client.execute({ sql: "UPDATE fa_ads SET status='ended' WHERE id=? AND owner_id=?", args: [String(adId), String(ownerId)] });
  return { success: true };
}

export async function deleteAdCampaign(adId, ownerId) {
  'use server';
  await ensureAdsServeTables();
  const adRes = await client.execute({ sql: 'SELECT budget,owner_id FROM fa_ads WHERE id=?', args: [String(adId)] });
  if (!adRes.rows.length || String(adRes.rows[0].owner_id) !== String(ownerId)) return { success: false };
  const refundPC = parseFloat(adRes.rows[0].budget || '0');
  if (refundPC > 0) {
    const ud = await adServe_getRawUser(ownerId);
    ud.balance = Number((ud.balance + refundPC).toFixed(6));
    await adServe_saveUser(ownerId, ud);
  }
  await client.execute({ sql: 'DELETE FROM fa_ads WHERE id=?', args: [String(adId)] });
  return { success: true, refunded_pc: refundPC };
}

export async function registerAdSite(username, name, url, description) {
  'use server';
  await ensureAdsServeTables();
  const siteId = 'site_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: `INSERT INTO fa_sites (id,owner_id,name,url,description,status,total_views,total_earned,timestamp) VALUES (?,?,?,?,?,'active',0,0,?)`,
    args: [siteId, String(username), adServe_sanitize(name, 100), url, adServe_sanitize(description), Date.now()]
  });
  return { success: true, siteId };
}

export async function deleteAdSite(siteId, username) {
  'use server';
  await ensureAdsServeTables();
  await client.execute({ sql: 'DELETE FROM fa_sites WHERE id=? AND owner_id=?', args: [String(siteId), String(username)] });
  return { success: true };
}

export async function requestAdWithdrawal(devId, amount, method, details) {
  'use server';
  await ensureAdsServeTables();
  const reqWC = Number(amount);
  const ud = await adServe_getRawUser(devId);
  if (ud.wavy_coins < reqWC) return { success: false, error: 'Недостаточно WC' };
  const feeWC = Number((reqWC * AD_WITHDRAWAL_FEE_PCT).toFixed(8));
  const payoutWC = Number((reqWC - feeWC).toFixed(8));
  ud.wavy_coins = Number((ud.wavy_coins - reqWC).toFixed(8));
  await adServe_saveUser(devId, ud);
  await adServe_addPlatformFee(feeWC);
  const wid = 'with_' + Math.random().toString(36).substring(2, 11);
  await client.execute({
    sql: `INSERT INTO fa_withdrawals (id,dev_id,amount_requested,amount_payout,fee,method,details,status,timestamp) VALUES (?,?,?,?,?,?,?,'pending',?)`,
    args: [wid, String(devId), reqWC, payoutWC, feeWC, adServe_sanitize(method, 50), adServe_sanitize(details), Date.now()]
  });
  return { success: true, withdrawalId: wid, requested_wc: reqWC, fee_wc: feeWC, payout_wc: payoutWC };
}


// ═════════════════════════════════════════════════════════════════════════
// OAUTH-ПРОВАЙДЕР ("Войти через ParrotSoft" для сторонних сайтов)
// ═════════════════════════════════════════════════════════════════════════
// Упрощённый authorization-code flow (пока без PKCE и без системы scopes —
// сторонний сайт получает только username). Поток:
//   1. registerOAuthClient — сторонний разработчик получает client_id + client_secret
//      (секрет показывается ОДИН раз при регистрации, дальше хранится только хэш)
//   2. Пользователя отправляют на /oauth/authorize?client_id=...&redirect_uri=...&state=...
//   3. Пользователь логинится/подтверждает → редирект на redirect_uri?code=...&state=...
//   4. Сторонний СЕРВЕР меняет code на access token: exchangeOAuthCode(...)
//   5. Сторонний сервер получает профиль: getOAuthUserInfo(accessToken) → { username }
//
// Реализовано целиком через db.* (get/upsert/update/remove/find) — ни одной
// строчки SQL в самой бизнес-логике, только миграция таблиц использует db.raw.

const ensureOAuthTables = once(async function ensureOAuthTables() {
  await db.raw(`CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY, owner_username TEXT, name TEXT, secret_hash TEXT, secret_salt TEXT,
    redirect_uris TEXT, created_at INTEGER
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT PRIMARY KEY, client_id TEXT, username TEXT, redirect_uri TEXT,
    created_at INTEGER, expires_at INTEGER, used INTEGER DEFAULT 0
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS oauth_tokens (
    token TEXT PRIMARY KEY, client_id TEXT, username TEXT, created_at INTEGER, expires_at INTEGER
  )`);
});

function randomId(prefix, bytes = 16) {
  return `${prefix}_${crypto.randomBytes(bytes).toString('hex')}`;
}

export async function registerOAuthClient(ownerUsername, name, redirectUris) {
  'use server';
  await ensureOAuthTables();
  if (!ownerUsername || !name || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return { success: false, error: 'Укажите имя приложения и хотя бы один redirect_uri' };
  }
  const clientId = randomId('client', 8);
  const clientSecret = randomId('secret', 24);
  const salt = crypto.randomBytes(16).toString('hex');
  const secretHash = hashPassword(clientSecret, salt);

  await db.upsert('oauth_clients', 'client_id', clientId, {
    owner_username: String(ownerUsername),
    name: adServe_sanitize(name, 100),
    secret_hash: secretHash,
    secret_salt: salt,
    redirect_uris: JSON.stringify(redirectUris),
    created_at: Date.now(),
  });

  // client_secret возвращается ТОЛЬКО СЕЙЧАС — дальше нигде не хранится в открытом виде.
  return { success: true, clientId, clientSecret };
}

export async function getMyOAuthClients(ownerUsername) {
  'use server';
  await ensureOAuthTables();
  const rows = await db.find('oauth_clients', { where: { owner_username: String(ownerUsername) }, orderBy: 'created_at DESC' });
  return rows.map(r => ({ clientId: r.client_id, name: r.name, redirectUris: JSON.parse(r.redirect_uris || '[]'), createdAt: r.created_at }));
}

export async function deleteOAuthClient(clientId, ownerUsername) {
  'use server';
  await ensureOAuthTables();
  const clientRow = await db.get('oauth_clients', clientId, 'client_id');
  if (!clientRow || String(clientRow.owner_username) !== String(ownerUsername)) {
    return { success: false, error: 'Не найдено или нет доступа' };
  }
  await db.remove('oauth_clients', { client_id: clientId });
  return { success: true };
}

// Публичная инфа для экрана согласия (без секрета). Заодно проверяет, что
// redirect_uri зарегистрирован для этого клиента (защита от open redirect).
export async function getOAuthClientPublic(clientId, redirectUri) {
  'use server';
  await ensureOAuthTables();
  const c = await db.get('oauth_clients', clientId, 'client_id');
  if (!c) return { valid: false, error: 'Приложение не найдено' };
  const uris = JSON.parse(c.redirect_uris || '[]');
  if (!uris.includes(redirectUri)) return { valid: false, error: 'redirect_uri не зарегистрирован для этого приложения' };
  return { valid: true, name: c.name };
}

// Экран согласия вызывает это после того, как пользователь ввёл логин/пароль
// и нажал "Разрешить".
export async function authorizeOAuthLogin(clientId, redirectUri, state, username, password) {
  'use server';
  await ensureOAuthTables();
  const check = await getOAuthClientPublic(clientId, redirectUri);
  if (!check.valid) return { success: false, error: check.error };

  const passOk = await verifyPassword(username, password);
  if (!passOk) return { success: false, error: 'Неверный логин или пароль' };

  return await issueOAuthCode(clientId, redirectUri, state, username);
}

// То же самое, но для пользователя, уже залогиненного на самом ParrotSoft
// (доверенная локальная сессия) — пароль второй раз вводить не нужно.
export async function authorizeOAuthLoginTrusted(clientId, redirectUri, state, username) {
  'use server';
  await ensureOAuthTables();
  const check = await getOAuthClientPublic(clientId, redirectUri);
  if (!check.valid) return { success: false, error: check.error };
  if (!username) return { success: false, error: 'Не залогинены' };

  return await issueOAuthCode(clientId, redirectUri, state, username);
}

async function issueOAuthCode(clientId, redirectUri, state, username) {
  const code = randomId('code', 20);
  await db.upsert('oauth_codes', 'code', code, {
    client_id: clientId,
    username: String(username),
    redirect_uri: redirectUri,
    created_at: Date.now(),
    expires_at: Date.now() + 5 * 60 * 1000, // код авторизации живёт 5 минут
    used: 0,
  });

  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return { success: true, redirectTo: url.toString() };
}

// Сторонний СЕРВЕР (не браузер пользователя!) меняет code на access token.
export async function exchangeOAuthCode(code, clientId, clientSecret, redirectUri) {
  'use server';
  await ensureOAuthTables();
  const clientRow = await db.get('oauth_clients', clientId, 'client_id');
  if (!clientRow) return { error: 'invalid_client' };
  const candidateHash = hashPassword(clientSecret, clientRow.secret_salt);
  if (candidateHash !== clientRow.secret_hash) return { error: 'invalid_client_secret' };

  const codeRow = await db.get('oauth_codes', code, 'code');
  if (!codeRow || Number(codeRow.used) === 1 || codeRow.client_id !== clientId || codeRow.redirect_uri !== redirectUri) {
    return { error: 'invalid_grant' };
  }
  if (Date.now() > codeRow.expires_at) return { error: 'expired_code' };

  await db.update('oauth_codes', 'code', code, { used: 1 });

  const token = randomId('tok', 24);
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // токен живёт 30 дней
  await db.upsert('oauth_tokens', 'token', token, {
    client_id: clientId,
    username: codeRow.username,
    created_at: Date.now(),
    expires_at: expiresAt,
  });

  return { access_token: token, token_type: 'Bearer', expires_in: 30 * 24 * 60 * 60, username: codeRow.username };
}

// Сторонний сервер получает профиль пользователя по access token.
export async function getOAuthUserInfo(accessToken) {
  'use server';
  await ensureOAuthTables();
  const row = await db.get('oauth_tokens', accessToken, 'token');
  if (!row) return { error: 'invalid_token' };
  if (Date.now() > row.expires_at) return { error: 'expired_token' };
  return { username: row.username };
}

// ═════════════════════════════════════════════════════════════════════════
// НОВОСТИ И АЛЬБОМЫ
// ═════════════════════════════════════════════════════════════════════════
// Модель:
//   news_albums          — сам альбом (владелец, публичность public/private, метаданные)
//   news_album_editors    — кто, кроме владельца, может публиковать новости в альбом
//   news_album_follows    — "мои альбомы": подписка (в т.ч. на приватный — по прямой ссылке)
//                            + звёздочка (избранное, поднимает альбом выше в списке)
//   news_posts             — сама новость. content — ГОТОВЫЙ HTML+CSS. Рендерится ТОЛЬКО в
//                             <iframe sandbox="allow-same-origin"> БЕЗ allow-scripts — то есть
//                             JS внутри новости не выполнится, даже если его туда впишут напрямую.
//                             Именно поэтому content НЕ фильтруется от HTML-тегов — это осознанно.
//                             builder_data — JSON блоков визуального редактора (нужен только чтобы
//                             повторно открыть новость в конструкторе; для показа не используется).
//   news_post_likes        — лайки (пара post_id+username уникальна — 1 лайк на человека)
//   news_post_views         — просмотры (пара post_id+username уникальна — честный, не накручиваемый счётчик)
//
// Правило доступа к приватному альбому: приватный альбом открыт по прямой ссылке
// (знание albumId = право доступа на чтение); подписаться/добавить в "мои альбомы"
// может любой, кто получил ссылку — followAlbum() ниже не требует ничего, кроме id.

const ensureNewsTables = once(async function ensureNewsTables() {
  await db.raw(`CREATE TABLE IF NOT EXISTS news_albums (
    id TEXT PRIMARY KEY,
    owner_username TEXT,
    title TEXT,
    description TEXT,
    cover TEXT,
    visibility TEXT DEFAULT 'public',
    created_at INTEGER
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_album_editors (
    album_id TEXT,
    username TEXT,
    added_at INTEGER,
    PRIMARY KEY (album_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_album_follows (
    album_id TEXT,
    username TEXT,
    starred INTEGER DEFAULT 0,
    followed_at INTEGER,
    PRIMARY KEY (album_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_posts (
    id TEXT PRIMARY KEY,
    album_id TEXT,
    author_username TEXT,
    title TEXT,
    cover TEXT,
    mode TEXT DEFAULT 'html',
    content TEXT,
    builder_data TEXT,
    status TEXT DEFAULT 'published',
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    created_at INTEGER
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_post_likes (
    post_id TEXT,
    username TEXT,
    created_at INTEGER,
    PRIMARY KEY (post_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_post_views (
    post_id TEXT,
    username TEXT,
    created_at INTEGER,
    PRIMARY KEY (post_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS news_post_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT,
    username TEXT,
    text TEXT,
    created_at INTEGER
  )`);
});

// Вставка/обновление по СОСТАВНОМУ ключу — db.upsert (см. выше) умеет только
// один id-столбец, поэтому для таблиц вида (album_id, username) нужен отдельный
// маленький helper поверх того же ON CONFLICT ... DO UPDATE.
async function dbUpsertComposite(struct, keyCols, keyVals, data = {}) {
  if (!db.config.writesEnabled) return null;
  const dataCols = Object.keys(data);
  const columns = [...keyCols, ...dataCols];
  const values = [...keyVals, ...dataCols.map(c => data[c])];
  const placeholders = columns.map(() => '?').join(', ');
  const updateSet = dataCols.length
    ? dataCols.map(c => `${c} = excluded.${c}`).join(', ')
    : `${keyCols[0]} = excluded.${keyCols[0]}`;
  await client.execute({
    sql: `INSERT INTO ${struct} (${columns.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(${keyCols.join(', ')}) DO UPDATE SET ${updateSet}`,
    args: values,
  });
  return true;
}

function newsSanitizeText(s, max = 300) {
  return typeof s === 'string' ? s.replace(/[<>`]/g, '').trim().slice(0, max) : '';
}

async function canPostToAlbum(albumId, username) {
  if (!username) return false;
  const album = await db.get('news_albums', albumId);
  if (!album) return false;
  if (album.owner_username === String(username)) return true;
  const editors = await db.find('news_album_editors', { where: { album_id: albumId, username: String(username) } });
  return editors.length > 0;
}

// ── Альбомы ──────────────────────────────────────────────────────────────

export async function createNewsAlbum(username, { title, description = '', cover = '', visibility = 'public' } = {}) {
  'use server';
  await ensureNewsTables();
  if (!username || !title) return { success: false, error: 'Укажите название альбома' };
  const id = randomId('album', 8);
  await db.upsert('news_albums', 'id', id, {
    owner_username: String(username),
    title: newsSanitizeText(title, 120),
    description: newsSanitizeText(description, 500),
    cover: String(cover || '').slice(0, 300000), // было 500 — обрезало base64-картинки обложки в мусор
    visibility: visibility === 'private' ? 'private' : 'public',
    created_at: Date.now(),
  });
  await dbUpsertComposite('news_album_follows', ['album_id', 'username'], [id, String(username)], {
    starred: 0, followed_at: Date.now(),
  });
  return { success: true, albumId: id };
}

export async function updateNewsAlbum(albumId, username, updates = {}) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album) return { success: false, error: 'Альбом не найден' };
  if (album.owner_username !== String(username)) return { success: false, error: 'Только владелец может изменить альбом' };
  const fields = {};
  if (updates.title !== undefined) fields.title = newsSanitizeText(updates.title, 120);
  if (updates.description !== undefined) fields.description = newsSanitizeText(updates.description, 500);
  if (updates.cover !== undefined) fields.cover = String(updates.cover).slice(0, 300000); // было 500 — та же причина
  if (updates.visibility !== undefined) fields.visibility = updates.visibility === 'private' ? 'private' : 'public';
  if (Object.keys(fields).length) await db.update('news_albums', 'id', albumId, fields);
  return { success: true };
}

export async function deleteNewsAlbum(albumId, username) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album) return { success: false, error: 'Альбом не найден' };
  if (album.owner_username !== String(username)) return { success: false, error: 'Только владелец может удалить альбом' };
  await db.remove('news_posts', { album_id: albumId });
  await db.remove('news_album_editors', { album_id: albumId });
  await db.remove('news_album_follows', { album_id: albumId });
  await db.remove('news_albums', { id: albumId });
  return { success: true };
}

export async function addAlbumEditor(albumId, ownerUsername, editorUsername) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album || album.owner_username !== String(ownerUsername)) return { success: false, error: 'Нет доступа' };
  if (!editorUsername) return { success: false, error: 'Укажите пользователя' };
  await dbUpsertComposite('news_album_editors', ['album_id', 'username'], [albumId, String(editorUsername)], {
    added_at: Date.now(),
  });
  return { success: true };
}

export async function removeAlbumEditor(albumId, ownerUsername, editorUsername) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album || album.owner_username !== String(ownerUsername)) return { success: false, error: 'Нет доступа' };
  await db.remove('news_album_editors', { album_id: albumId, username: String(editorUsername) });
  return { success: true };
}

// followAlbum: без проверки видимости — знание albumId (ссылка) само по себе
// даёт право подписаться, в т.ч. на приватный альбом. Публичные так же доступны всем.
export async function followAlbum(username, albumId) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album) return { success: false, error: 'Альбом не найден' };
  await dbUpsertComposite('news_album_follows', ['album_id', 'username'], [albumId, String(username)], {
    followed_at: Date.now(),
  });
  return { success: true };
}

export async function unfollowAlbum(username, albumId) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (album && album.owner_username === String(username)) {
    return { success: false, error: 'Владелец не может отписаться от своего альбома' };
  }
  await db.remove('news_album_follows', { album_id: albumId, username: String(username) });
  return { success: true };
}

export async function toggleAlbumStar(username, albumId) {
  'use server';
  await ensureNewsTables();
  const rows = await db.find('news_album_follows', { where: { album_id: albumId, username: String(username) } });
  const isStarred = rows.length > 0 && Number(rows[0].starred) === 1;
  await dbUpsertComposite('news_album_follows', ['album_id', 'username'], [albumId, String(username)], {
    starred: isStarred ? 0 : 1,
    followed_at: rows[0]?.followed_at || Date.now(),
  });
  return { success: true, starred: !isStarred };
}

// "Мои альбомы": свои + подписки/приватные-по-ссылке, звёздочка — выше в списке.
export async function getMyAlbums(username) {
  'use server';
  await ensureNewsTables();
  const follows = await db.find('news_album_follows', {
    where: { username: String(username) },
    orderBy: 'starred DESC, followed_at DESC',
  });
  const albums = [];
  for (const f of follows) {
    const album = await db.get('news_albums', f.album_id);
    if (album) albums.push({ ...album, starred: Number(f.starred) === 1, isOwner: album.owner_username === String(username) });
  }
  return albums;
}

export async function getPublicAlbums({ limit = 30 } = {}) {
  'use server';
  await ensureNewsTables();
  return await db.find('news_albums', { where: { visibility: 'public' }, orderBy: 'created_at DESC', limit });
}

export async function getAlbumForViewer(albumId, viewerUsername) {
  'use server';
  await ensureNewsTables();
  const album = await db.get('news_albums', albumId);
  if (!album) return { error: 'Альбом не найден' };
  const editors = await db.find('news_album_editors', { where: { album_id: albumId } });
  const followRows = viewerUsername
    ? await db.find('news_album_follows', { where: { album_id: albumId, username: String(viewerUsername) } })
    : [];
  return {
    ...album,
    editors: editors.map(e => e.username),
    canPost: album.owner_username === String(viewerUsername) || editors.some(e => e.username === String(viewerUsername)),
    isOwner: album.owner_username === String(viewerUsername),
    isFollowing: followRows.length > 0,
    isStarred: followRows.length > 0 && Number(followRows[0].starred) === 1,
  };
}

// ── Новости ──────────────────────────────────────────────────────────────

export async function createNewsPost(username, albumId, { title, cover = '', mode = 'html', content = '', builderData = null, status = 'published' } = {}) {
  'use server';
  await ensureNewsTables();
  if (!(await canPostToAlbum(albumId, username))) return { success: false, error: 'Нет прав публиковать в этот альбом' };
  if (!title || !content) return { success: false, error: 'Укажите заголовок и содержимое новости' };
  const id = randomId('news', 8);
  await db.upsert('news_posts', 'id', id, {
    album_id: albumId,
    author_username: String(username),
    title: newsSanitizeText(title, 200),
    cover: String(cover || '').slice(0, 300000), // было 500 — обрезало base64-картинки обложки в мусор
    mode: mode === 'builder' ? 'builder' : 'html',
    // Контент НЕ фильтруется от тегов намеренно — см. комментарий к таблице news_posts выше:
    // рендер идёт только в изолированный iframe sandbox без allow-scripts.
    content: String(content),
    builder_data: builderData ? JSON.stringify(builderData) : null,
    status: status === 'draft' ? 'draft' : 'published',
    views: 0,
    likes: 0,
    created_at: Date.now(),
  });
  return { success: true, postId: id };
}

export async function updateNewsPost(postId, username, updates = {}) {
  'use server';
  await ensureNewsTables();
  const post = await db.get('news_posts', postId);
  if (!post) return { success: false, error: 'Новость не найдена' };
  if (!(await canPostToAlbum(post.album_id, username))) return { success: false, error: 'Нет прав редактировать эту новость' };
  const fields = {};
  if (updates.title !== undefined) fields.title = newsSanitizeText(updates.title, 200);
  if (updates.cover !== undefined) fields.cover = String(updates.cover).slice(0, 300000); // было 500 — та же причина
  if (updates.content !== undefined) fields.content = String(updates.content);
  if (updates.builderData !== undefined) fields.builder_data = updates.builderData ? JSON.stringify(updates.builderData) : null;
  if (updates.mode !== undefined) fields.mode = updates.mode === 'builder' ? 'builder' : 'html';
  if (updates.status !== undefined) fields.status = updates.status === 'draft' ? 'draft' : 'published';
  if (Object.keys(fields).length) await db.update('news_posts', 'id', postId, fields);
  return { success: true };
}

export async function deleteNewsPost(postId, username) {
  'use server';
  await ensureNewsTables();
  const post = await db.get('news_posts', postId);
  if (!post) return { success: false, error: 'Новость не найдена' };
  if (!(await canPostToAlbum(post.album_id, username))) return { success: false, error: 'Нет прав удалить эту новость' };
  await db.remove('news_post_likes', { post_id: postId });
  await db.remove('news_post_views', { post_id: postId });
  await db.remove('news_posts', { id: postId });
  return { success: true };
}

// Отдаёт новость + засчитывает просмотр (не чаще одного раза на пользователя).
export async function getNewsPost(postId, viewerUsername) {
  'use server';
  await ensureNewsTables();
  const post = await db.get('news_posts', postId);
  if (!post) return { error: 'Новость не найдена' };
  const album = await db.get('news_albums', post.album_id);
  if (!album) return { error: 'Альбом не найден' };

  if (viewerUsername) {
    const res = await db.raw(
      `INSERT OR IGNORE INTO news_post_views (post_id, username, created_at) VALUES (?, ?, ?)`,
      [postId, String(viewerUsername), Date.now()]
    );
    if (res?.rowsAffected) {
      await db.update('news_posts', 'id', postId, { views: { raw: 'views + 1' } });
    }
  }
  const fresh = await db.get('news_posts', postId);
  const likeRows = viewerUsername
    ? await db.find('news_post_likes', { where: { post_id: postId, username: String(viewerUsername) } })
    : [];
  return {
    ...fresh,
    builderData: fresh.builder_data ? JSON.parse(fresh.builder_data) : null,
    album: { id: album.id, title: album.title, ownerUsername: album.owner_username, visibility: album.visibility },
    likedByViewer: likeRows.length > 0,
  };
}

export async function getAlbumPosts(albumId, { limit = 30 } = {}) {
  'use server';
  await ensureNewsTables();
  return await db.find('news_posts', { where: { album_id: albumId, status: 'published' }, orderBy: 'created_at DESC', limit });
}

export async function likeNewsPost(username, postId) {
  'use server';
  await ensureNewsTables();
  const res = await db.raw(
    `INSERT OR IGNORE INTO news_post_likes (post_id, username, created_at) VALUES (?, ?, ?)`,
    [postId, String(username), Date.now()]
  );
  if (res?.rowsAffected) {
    await db.update('news_posts', 'id', postId, { likes: { raw: 'likes + 1' } });
  }
  return { success: true };
}

export async function unlikeNewsPost(username, postId) {
  'use server';
  await ensureNewsTables();
  const rows = await db.find('news_post_likes', { where: { post_id: postId, username: String(username) } });
  if (rows.length) {
    await db.remove('news_post_likes', { post_id: postId, username: String(username) });
    await db.update('news_posts', 'id', postId, { likes: { raw: 'MAX(likes - 1, 0)' } });
  }
  return { success: true };
}

// ── Комментарии под новостями (news_post_comments) ─────────────────────────
export async function addNewsComment(username, postId, text) {
  'use server';
  if (!username) return { success: false, error: 'no_username' };
  const clean = newsSanitizeText(text, 2000);
  if (!clean) return { success: false, error: 'empty' };
  await ensureNewsTables();
  const post = await db.get('news_posts', postId);
  if (!post) return { success: false, error: 'not_found' };
  const id = randomId('nc', 10);
  await db.upsert('news_post_comments', 'id', id, {
    post_id: postId,
    username: String(username),
    text: clean,
    created_at: Date.now(),
  });
  return { success: true, id };
}

export async function getNewsComments(postId) {
  'use server';
  await ensureNewsTables();
  const rows = await db.find('news_post_comments', { where: { post_id: postId }, orderBy: 'created_at ASC', limit: 500 });
  return rows;
}

export async function deleteNewsComment(username, commentId) {
  'use server';
  await ensureNewsTables();
  const rows = await db.find('news_post_comments', { where: { id: commentId } });
  const comment = rows[0];
  if (!comment) return { success: false, error: 'not_found' };
  // Автор комментария ИЛИ владелец альбома/новости может удалить.
  const post = await db.get('news_posts', comment.post_id);
  const canModerate = post ? await canPostToAlbum(post.album_id, username) : false;
  if (comment.username !== String(username) && !canModerate) {
    return { success: false, error: 'no_access' };
  }
  await db.remove('news_post_comments', { id: commentId });
  return { success: true };
}

// Общая лента: публичные альбомы + приватные, на которые подписан viewer.
// sort: 'recent' (по умолчанию) | 'recommended' (лайки/просмотры с затуханием по времени).
export async function getNewsFeed(viewerUsername, { limit = 30, sort = 'recent' } = {}) {
  'use server';
  await ensureNewsTables();
  const follows = viewerUsername
    ? await db.find('news_album_follows', { where: { username: String(viewerUsername) } })
    : [];
  const publicAlbums = await db.find('news_albums', { where: { visibility: 'public' } });
  const visibleAlbumIds = new Set([...publicAlbums.map(a => a.id), ...follows.map(f => f.album_id)]);

  // db.find не умеет "WHERE album_id IN (...)" — набор постов обычно небольшой,
  // поэтому тянем недавние опубликованные и фильтруем в памяти вместо динамического SQL.
  const recentPosts = await db.find('news_posts', { where: { status: 'published' }, orderBy: 'created_at DESC', limit: 500 });
  let posts = recentPosts.filter(p => visibleAlbumIds.has(p.album_id));

  if (sort === 'recommended') {
    const now = Date.now();
    posts = posts
      .map(p => {
        const ageHours = Math.max(1, (now - p.created_at) / 3_600_000);
        const score = (Number(p.likes) * 3 + Number(p.views) * 0.2) / Math.pow(ageHours, 0.6);
        return { ...p, _score: score };
      })
      .sort((a, b) => b._score - a._score);
  }
  return posts.slice(0, limit);
}

// ═════════════════════════════════════════════════════════════════════════
// РАСШИРЕНИЯ МЕССЕНДЖЕРА (WavyChat): доп. админы, участники, прочитано, реакции
// ═════════════════════════════════════════════════════════════════════════
// Вставьте этот блок в конец вашего actions.js (там же, где остальные функции
// чата — sendMsg/getMsgs/createChat и т.д.), он использует тот же db.* API.
// Проверено по вашей реальной схеме: участники — wc_members(chat_id, username),
// чаты — wc_chats(id, title, admin, type, privacy, password, icon).

const ensureMessengerExtrasTables = once(async function ensureMessengerExtrasTables() {
  // Доп. администраторы группы, помимо единственного поля chats.admin (владелец).
  await db.raw(`CREATE TABLE IF NOT EXISTS chat_extra_admins (
    chat_id TEXT,
    username TEXT,
    added_at INTEGER,
    PRIMARY KEY (chat_id, username)
  )`);
  // До какого времени пользователь прочитал сообщения в чате — на основе этого
  // считаем «прочитано»/галочки, а не помечаем каждое сообщение отдельно.
  await db.raw(`CREATE TABLE IF NOT EXISTS chat_reads (
    chat_id TEXT,
    username TEXT,
    last_read_at INTEGER,
    PRIMARY KEY (chat_id, username)
  )`);
  // Реакции на сообщения (эмодзи), один эмодзи от одного пользователя на сообщение.
  await db.raw(`CREATE TABLE IF NOT EXISTS msg_reactions (
    msg_id TEXT,
    username TEXT,
    emoji TEXT,
    created_at INTEGER,
    PRIMARY KEY (msg_id, username)
  )`);
});

// Тот же helper на составной ключ, что и в блоке новостей — если он уже есть
// в вашем actions.js (из блока новостей), эту копию можно удалить.
async function dbUpsertComposite2(struct, keyCols, keyVals, data = {}) {
  if (!db.config.writesEnabled) return null;
  const dataCols = Object.keys(data);
  const columns = [...keyCols, ...dataCols];
  const values = [...keyVals, ...dataCols.map(c => data[c])];
  const placeholders = columns.map(() => '?').join(', ');
  const updateSet = dataCols.length
    ? dataCols.map(c => `${c} = excluded.${c}`).join(', ')
    : `${keyCols[0]} = excluded.${keyCols[0]}`;
  await client.execute({
    sql: `INSERT INTO ${struct} (${columns.join(', ')}) VALUES (${placeholders})
          ON CONFLICT(${keyCols.join(', ')}) DO UPDATE SET ${updateSet}`,
    args: values,
  });
  return true;
}

// ── Админы группы ───────────────────────────────────────────────────────

export async function isChatAdmin(chat, username) {
  'use server';
  await ensureMessengerExtrasTables();
  if (!chat || !username) return false;
  if (chat.admin === username) return true;
  const rows = await db.find('chat_extra_admins', { where: { chat_id: chat.id, username: String(username) } });
  return rows.length > 0;
}

export async function getChatAdmins(chatId, ownerUsername) {
  'use server';
  await ensureMessengerExtrasTables();
  const rows = await db.find('chat_extra_admins', { where: { chat_id: chatId } });
  const extra = rows.map(r => r.username);
  return ownerUsername ? [ownerUsername, ...extra] : extra;
}

export async function addChatAdmin(chatId, actingUsername, targetUsername, ownerUsername) {
  'use server';
  await ensureMessengerExtrasTables();
  if (actingUsername !== ownerUsername) {
    const already = await db.find('chat_extra_admins', { where: { chat_id: chatId, username: actingUsername } });
    if (!already.length) return { success: false, error: 'Нет прав администратора' };
  }
  await dbUpsertComposite2('chat_extra_admins', ['chat_id', 'username'], [chatId, String(targetUsername)], { added_at: Date.now() });
  return { success: true };
}

export async function removeChatAdmin(chatId, actingUsername, targetUsername, ownerUsername) {
  'use server';
  await ensureMessengerExtrasTables();
  if (actingUsername !== ownerUsername) return { success: false, error: 'Только владелец может снимать администраторов' };
  if (targetUsername === ownerUsername) return { success: false, error: 'Нельзя снять владельца' };
  await db.remove('chat_extra_admins', { chat_id: chatId, username: String(targetUsername) });
  return { success: true };
}

// ── Участники ────────────────────────────────────────────────────────────
// Список участников чата — таблица wc_members(chat_id, username), как в вашем createChat/joinChat/kickUser.
export async function getChatMembers(chatId) {
  'use server';
  try {
    const rs = await client.execute({ sql: `SELECT username FROM wc_members WHERE chat_id = ?`, args: [chatId] });
    return rs.rows.map(r => r.username);
  } catch (e) {
    return [];
  }
}

// ── Прочитано (read receipts) ───────────────────────────────────────────

export async function markChatRead(chatId, username) {
  'use server';
  await ensureMessengerExtrasTables();
  if (!chatId || !username) return { success: false };
  await dbUpsertComposite2('chat_reads', ['chat_id', 'username'], [chatId, String(username)], { last_read_at: Date.now() });
  return { success: true };
}

// Возвращает { username: lastReadAtTimestamp } для всех, кто читал этот чат —
// на клиенте сравниваем время сообщения с lastReadAt каждого участника, чтобы
// показать одну/две галочки.
export async function getChatReadState(chatId) {
  'use server';
  await ensureMessengerExtrasTables();
  const rows = await db.find('chat_reads', { where: { chat_id: chatId } });
  const state = {};
  for (const r of rows) state[r.username] = r.last_read_at;
  return state;
}

// ── Реакции ──────────────────────────────────────────────────────────────

export async function toggleReaction(msgId, username, emoji) {
  'use server';
  await ensureMessengerExtrasTables();
  const existing = await db.find('msg_reactions', { where: { msg_id: msgId, username: String(username) } });
  if (existing.length && existing[0].emoji === emoji) {
    // Повторный клик на ту же реакцию — снимаем её.
    await db.remove('msg_reactions', { msg_id: msgId, username: String(username) });
    return { success: true, removed: true };
  }
  // Один пользователь — одна реакция на сообщение; смена эмодзи заменяет старую.
  await dbUpsertComposite2('msg_reactions', ['msg_id', 'username'], [msgId, String(username)], { emoji, created_at: Date.now() });
  return { success: true, removed: false };
}

// Реакции сразу для целого чата (по списку id сообщений), чтобы не дёргать
// сервер отдельным запросом на каждое сообщение.
export async function getReactionsForChat(msgIds = []) {
  'use server';
  await ensureMessengerExtrasTables();
  if (!msgIds.length) return {};
  const placeholders = msgIds.map(() => '?').join(', ');
  const rs = await client.execute({
    sql: `SELECT msg_id, username, emoji FROM msg_reactions WHERE msg_id IN (${placeholders})`,
    args: msgIds,
  });
  const byMsg = {};
  for (const r of rs.rows) {
    const key = String(r.msg_id);
    if (!byMsg[key]) byMsg[key] = [];
    byMsg[key].push({ username: r.username, emoji: r.emoji });
  }
  return JSON.parse(JSON.stringify(byMsg));
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 2: опросы, превью ссылок, поиск пользователей и личные чаты
// ═════════════════════════════════════════════════════════════════════════
// Проверено по вашей реальной схеме: users(username, ...), createChat(title,
// admin, type, privacy, icon, password) — 'dm' проходит как обычная строка в type.

const ensurePollsTable = once(async function ensurePollsTable() {
  await db.raw(`CREATE TABLE IF NOT EXISTS poll_votes (
    msg_id TEXT,
    username TEXT,
    option_idx INTEGER,
    created_at INTEGER,
    PRIMARY KEY (msg_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS link_preview_cache (
    url TEXT PRIMARY KEY,
    title TEXT,
    favicon TEXT,
    cached_at INTEGER
  )`);
});

// ── Опросы ───────────────────────────────────────────────────────────────
// Сообщение-опрос хранится обычным текстом с маркером:
//   📊POLL:{"q":"Вопрос","options":["Вариант 1","Вариант 2"]}
// Голоса — отдельно, в poll_votes (один голос на пользователя, повторный клик
// на тот же вариант снимает голос).

export async function votePoll(msgId, username, optionIdx) {
  'use server';
  await ensurePollsTable();
  const existing = await db.find('poll_votes', { where: { msg_id: msgId, username: String(username) } });
  if (existing.length && Number(existing[0].option_idx) === Number(optionIdx)) {
    await db.remove('poll_votes', { msg_id: msgId, username: String(username) });
    return { success: true, removed: true };
  }
  await dbUpsertComposite2('poll_votes', ['msg_id', 'username'], [msgId, String(username)], {
    option_idx: optionIdx, created_at: Date.now(),
  });
  return { success: true, removed: false };
}

export async function getPollVotes(msgId) {
  'use server';
  await ensurePollsTable();
  const rows = await db.find('poll_votes', { where: { msg_id: msgId } });
  return rows.map(r => ({ username: r.username, optionIdx: Number(r.option_idx) }));
}

// ── Превью ссылок ────────────────────────────────────────────────────────
// Простой парсинг <title> и favicon без внешних зависимостей. Кэшируем на
// 6 часов, чтобы не дёргать чужие сайты на каждое открытие чата.

export async function getLinkPreview(url) {
  'use server';
  await ensurePollsTable();
  try {
    const cached = await db.get('link_preview_cache', url);
    if (cached && Date.now() - cached.cached_at < 6 * 3600 * 1000) {
      return { title: cached.title, favicon: cached.favicon, url };
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const html = await res.text();
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 200) : url;
    const u = new URL(url);
    const favicon = `${u.protocol}//${u.hostname}/favicon.ico`;
    await db.upsert('link_preview_cache', 'url', url, { title, favicon, cached_at: Date.now() });
    return { title, favicon, url };
  } catch (e) {
    return { title: url, favicon: null, url };
  }
}

// ── Поиск пользователей и личные чаты ───────────────────────────────────

export async function searchUsers(query) {
  'use server';
  if (!query || query.length < 2) return [];
  try {
    const rs = await client.execute({
      sql: `SELECT username FROM users WHERE username LIKE ? LIMIT 15`,
      args: [`%${query}%`],
    });
    return rs.rows.map(r => r.username);
  } catch (e) {
    return [];
  }
}

// Находит существующий личный чат между двумя пользователями или создаёт новый.
// ⚠️ Вызывает createChat/joinChat/searchGlobal НАПРЯМУЮ по имени — раз этот блок
// вставляется в тот же actions.js, они уже есть в области видимости модуля.
// Предполагаю сигнатуру createChat(title, creator, type, privacy, password, icon)
// и что type='dm' проходит без ошибок валидации — поправьте под вашу реализацию,
// если у вас фиксированный enum типов чата ('group'|'channel').
export async function startDirectChat(currentUser, targetUsername) {
  'use server';
  if (!currentUser || !targetUsername || currentUser === targetUsername) {
    return { success: false, error: 'Некорректный собеседник' };
  }
  try {
    await initDB();
    const dmTitle = [currentUser, targetUsername].sort().join('__dm__');
    const existing = await searchGlobal(dmTitle);
    const found = existing.find(c => c.title === dmTitle);
    let chatId;
    if (found) {
      chatId = found.id;
      // На случай, если чат уже был создан раньше, но собеседника туда почему-то
      // не добавили (например, старая версия кода) — доустанавливаем сейчас.
      await joinChat(chatId, targetUsername);
      await joinChat(chatId, currentUser);
    } else {
      const created = await createChat(dmTitle, currentUser, 'dm', 'public', '', '');
      chatId = created?.id || created?.chatId || created;
      if (!chatId) return { success: false, error: 'createChat не вернул id чата' };
      await joinChat(chatId, targetUsername);
    }
    // Проверяем, что оба реально числятся участниками — если нет, явно сообщаем об этом,
    // а не тихо "создаём чат в никуда".
    const members = await getChatMembers(chatId);
    if (!members.includes(targetUsername)) {
      return { success: false, error: `Чат создан (${chatId}), но не удалось добавить туда ${targetUsername}` };
    }
    return { success: true, chatId, existing: !!found };
  } catch (e) {
    return { success: false, error: 'startDirectChat: ' + e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 3: реальная иконка аккаунта из users.data
// ═════════════════════════════════════════════════════════════════════════
// В вашей таблице users(username, data) — data это JSON-блоб профиля. Учтены
// самые частые названия поля с картинкой; если у вас профильная иконка лежит
// под другим ключом — допишите его в список ниже, и всё заработает.

const AVATAR_FIELD_CANDIDATES = ['avatar', 'icon', 'photo', 'pfp', 'profilePic', 'picture', 'image'];

function extractAvatarFromUserData(dataStr) {
  try {
    const data = JSON.parse(dataStr || '{}');
    for (const key of AVATAR_FIELD_CANDIDATES) {
      if (data[key]) return data[key];
    }
  } catch (e) {}
  return null;
}

export async function getUserIcon(username) {
  'use server';
  if (!username) return null;
  try {
    await ensureWcAvatarsTable();
    const wcRs = await client.execute({ sql: `SELECT avatar FROM wc_avatars WHERE username = ?`, args: [username] });
    if (wcRs.rows[0]?.avatar) return wcRs.rows[0].avatar;
    const rs = await client.execute({ sql: `SELECT data FROM users WHERE username = ?`, args: [username] });
    if (rs.rows.length) {
      const icon = extractAvatarFromUserData(rs.rows[0].data);
      if (icon) return icon;
    }
    // "username" здесь иногда на самом деле хэндл канала WavyTube (@channel),
    // а не обычный аккаунт — у каналов своя колонка avatar в wt_channels.
    try {
      const chRs = await client.execute({ sql: `SELECT avatar FROM wt_channels WHERE username = ?`, args: [username] });
      const chAvatar = chRs.rows[0]?.avatar;
      // Дикберовских роботов-заглушек (дефолт при создании канала) не считаем
      // за настоящую иконку — иначе они снова вылезут, откуда их убирали.
      if (chAvatar && !chAvatar.includes('dicebear.com')) return chAvatar;
    } catch (e) { /* таблицы каналов может не быть — не критично */ }
    return null;
  } catch (e) {
    return null;
  }
}

// Пакетная версия — чтобы не дёргать сервер отдельным запросом на каждого
// автора сообщения в чате.
export async function getUserIcons(usernames = []) {
  'use server';
  if (!usernames.length) return {};
  const unique = [...new Set(usernames)];
  const placeholders = unique.map(() => '?').join(', ');
  try {
    await ensureWcAvatarsTable();
    const map = {};
    const wcRs = await client.execute({ sql: `SELECT username, avatar FROM wc_avatars WHERE username IN (${placeholders})`, args: unique });
    for (const row of wcRs.rows) {
      if (row.avatar) map[row.username] = row.avatar;
    }
    const remaining = unique.filter(u => !map[u]);
    if (remaining.length) {
      const ph2 = remaining.map(() => '?').join(', ');
      const rs = await client.execute({ sql: `SELECT username, data FROM users WHERE username IN (${ph2})`, args: remaining });
      for (const row of rs.rows) {
        const icon = extractAvatarFromUserData(row.data);
        if (icon) map[row.username] = icon;
      }
    }
    const stillRemaining = unique.filter(u => !map[u]);
    if (stillRemaining.length) {
      try {
        const ph3 = stillRemaining.map(() => '?').join(', ');
        const chRs = await client.execute({ sql: `SELECT username, avatar FROM wt_channels WHERE username IN (${ph3})`, args: stillRemaining });
        for (const row of chRs.rows) {
          if (row.avatar && !row.avatar.includes('dicebear.com')) map[row.username] = row.avatar;
        }
      } catch (e) { /* таблицы каналов может не быть — не критично */ }
    }
    return map;
  } catch (e) {
    return {};
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 4: приватность/пароль чата из панели информации о группе
// ═════════════════════════════════════════════════════════════════════════

export async function updateChatPrivacy(chatId, actingUsername, privacy, password) {
  'use server';
  try {
    const rs = await client.execute({ sql: `SELECT admin FROM wc_chats WHERE id = ?`, args: [chatId] });
    const chat = rs.rows[0];
    if (!chat) return { success: false, error: 'Чат не найден' };
    const isAdmin = chat.admin === actingUsername || (await getChatAdmins(chatId, chat.admin)).includes(actingUsername);
    if (!isAdmin) return { success: false, error: 'Нет прав администратора' };
    if (privacy === 'private' && !password) return { success: false, error: 'Укажите пароль для приватного режима' };
    // Хэшируем — как и в createChat/updateChatPassword, пароль сам по себе на сервере не хранится.
    await client.execute({
      sql: `UPDATE wc_chats SET privacy = ?, password = ? WHERE id = ?`,
      args: [privacy === 'private' ? 'private' : 'public', privacy === 'private' ? hashChatPassword(password) : null, chatId],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 5: файлы по хэшу (глобальная дедупликация + ленивая подгрузка) и
// лёгкий "что обновилось" сигнал вместо тяжёлого поллинга всех чатов целиком
// ═════════════════════════════════════════════════════════════════════════
// Идея: сообщение больше не хранит внутри себя полные байты картинки/видео/
// голосового — там лежит только маленький thumb (превью) + hash. Сами байты
// лежат один раз в file_store по content-hash (SHA-256 содержимого, считается
// на клиенте) — одинаковый файл, отправленный хоть 100 раз в разных чатах,
// физически хранится один раз. Полные байты подтягиваются через getFileBlob
// только когда пользователь реально нажал "открыть"/"смотреть видео".

const ensureFileStoreTable = once(async function ensureFileStoreTable() {
  await db.raw(`CREATE TABLE IF NOT EXISTS file_store (
    hash TEXT PRIMARY KEY,
    data TEXT,
    type TEXT,
    created_at INTEGER
  )`);
});

export async function hasFileBlob(hash) {
  'use server';
  await ensureFileStoreTable();
  try {
    const rs = await client.execute({ sql: `SELECT 1 FROM file_store WHERE hash = ?`, args: [hash] });
    return rs.rows.length > 0;
  } catch (e) {
    return false;
  }
}

export async function storeFileBlob(hash, data, type) {
  'use server';
  await ensureFileStoreTable();
  try {
    await client.execute({
      sql: `INSERT OR IGNORE INTO file_store (hash, data, type, created_at) VALUES (?, ?, ?, ?)`,
      args: [hash, data, type, Date.now()],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function getFileBlob(hash) {
  'use server';
  await ensureFileStoreTable();
  try {
    const rs = await client.execute({ sql: `SELECT data, type FROM file_store WHERE hash = ?`, args: [hash] });
    return rs.rows[0] ? { data: rs.rows[0].data, type: rs.rows[0].type } : null;
  } catch (e) {
    return null;
  }
}

// ── Лёгкий сигнал "что обновилось" ──────────────────────────────────────
// ОДИН вызов вместо: getMyChats + getMsgs(на каждый чат) + checkActiveCall(на
// каждый чат) на каждый тик поллинга. Возвращает только маленькие числа/id —
// клиент дотягивает тяжёлые данные (getMsgs с картинками и т.д.) ТОЛЬКО если
// что-то реально изменилось.
export async function getUpdatesSignal(username, activeChatId) {
  'use server';
  if (!username) return { chatsSignature: '0-0', perChat: {} };
  try {
    const chatsAgg = await client.execute({
      sql: `SELECT COUNT(*) as cnt, COALESCE(MAX(rowid), 0) as max_id FROM wc_members WHERE username = ?`,
      args: [username],
    });
    const chatIdsRs = await client.execute({
      sql: `SELECT chat_id FROM wc_members WHERE username = ?`,
      args: [username],
    });
    const chatIds = chatIdsRs.rows.map(r => r.chat_id);
    const perChat = {};
    for (const id of chatIds) perChat[id] = { lastMsgId: null, lastSender: null, lastPreview: null, call: null };

    if (chatIds.length) {
      const placeholders = chatIds.map(() => '?').join(', ');
      // Список запароленных чатов — их превью НЕ пытаемся расшифровать общим
      // серверным ключом (сообщения там зашифрованы ключом из ПАРОЛЯ чата,
      // которого у getUpdatesSignal нет — да и не должно быть в списке чатов).
      const privacyRs = await client.execute({
        sql: `SELECT id, privacy FROM wc_chats WHERE id IN (${placeholders})`,
        args: chatIds,
      });
      const lockedChatIds = new Set(privacyRs.rows.filter(r => r.privacy === 'private').map(r => r.id));
      // Последнее сообщение НА ЧАТ, без media — самое дорогое поле не тянем.
      const lastMsgRs = await client.execute({
        sql: `SELECT m.chat_id, m.id, m.sender, m.text FROM wc_msgs m
              INNER JOIN (SELECT chat_id, MAX(id) as max_id FROM wc_msgs WHERE chat_id IN (${placeholders}) GROUP BY chat_id) t
              ON m.chat_id = t.chat_id AND m.id = t.max_id`,
        args: chatIds,
      });
      for (const r of lastMsgRs.rows) {
        perChat[r.chat_id].lastMsgId = Number(r.id);
        perChat[r.chat_id].lastSender = r.sender;
        perChat[r.chat_id].lastPreview = lockedChatIds.has(r.chat_id) ? '🔒' : decryptText(r.text);
      }
      const callsRs = await client.execute({
        sql: `SELECT chat_id, caller, status, timestamp FROM active_calls WHERE chat_id IN (${placeholders})`,
        args: chatIds,
      });
      for (const r of callsRs.rows) {
        perChat[r.chat_id].call = { caller: r.caller, status: r.status, timestamp: String(r.timestamp) };
      }
    }

    // Подстраховка: libsql иногда отдаёт INTEGER-колонки как BigInt, а "сырые"
    // Row-объекты не всегда безопасно проходят через границу Server Action —
    // именно такие вещи обычно и стоят за ошибками сериализации ("array nesting"
    // и т.п.). Прогон через JSON гарантирует на выходе только плоские,
    // однозначно сериализуемые значения.
    return JSON.parse(JSON.stringify({
      chatsSignature: `${Number(chatsAgg.rows[0]?.cnt) || 0}-${Number(chatsAgg.rows[0]?.max_id) || 0}`,
      perChat,
    }));
  } catch (e) {
    return { chatsSignature: '0-0', perChat: {}, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 6: аватарка конкретно для WavyChat (360×360) + пагинация сообщений
// ═════════════════════════════════════════════════════════════════════════
// Отдельная от общего профиля таблица — так вы можете выставить себе одну
// аватарку в WavyChat, даже если "общий" профиль (users.data) её не содержит
// или содержит другую. getUserIcon/getUserIcons теперь проверяют СНАЧАЛА эту
// таблицу и только потом — общий профиль (см. изменения в getUserIcon ниже).

const ensureWcAvatarsTable = once(async function ensureWcAvatarsTable() {
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_avatars (
    username TEXT PRIMARY KEY,
    avatar TEXT,
    updated_at INTEGER
  )`);
});

export async function setWcAvatar(username, dataUrl) {
  'use server';
  await ensureWcAvatarsTable();
  if (!username || !dataUrl) return { success: false, error: 'Нет данных' };
  try {
    await client.execute({
      sql: `INSERT INTO wc_avatars (username, avatar, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET avatar = excluded.avatar, updated_at = excluded.updated_at`,
      args: [username, dataUrl, Date.now()],
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function getWcAvatar(username) {
  'use server';
  await ensureWcAvatarsTable();
  try {
    const rs = await client.execute({ sql: `SELECT avatar FROM wc_avatars WHERE username = ?`, args: [username] });
    return rs.rows[0]?.avatar || null;
  } catch (e) {
    return null;
  }
}

// ── Пагинация сообщений ─────────────────────────────────────────────────
// Раньше getMsgs всегда тянул ВСЮ историю чата целиком. Теперь по умолчанию —
// последние 100 сообщений; более старые подгружаются отдельным вызовом при
// прокрутке вверх (beforeId — id самого старого уже загруженного сообщения).
export async function getMsgsPage(chatId, { limit = 100, beforeId = null } = {}, chatPassword = null) {
  'use server';
  try {
    const cryptoKey = await resolveChatCryptoKey(chatId, chatPassword);
    const rs = beforeId
      ? await client.execute({
          sql: `SELECT * FROM wc_msgs WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
          args: [chatId, beforeId, limit],
        })
      : await client.execute({
          sql: `SELECT * FROM wc_msgs WHERE chat_id = ? ORDER BY id DESC LIMIT ?`,
          args: [chatId, limit],
        });
    const rows = rs.rows.map(r => ({ ...r, time: Number(r.time), id: Number(r.id), text: decryptText(r.text, cryptoKey), media: decryptText(r.media, cryptoKey) })).reverse(); // обратно в хронологический порядок
    return { messages: rows, hasMore: rows.length === limit };
  } catch (e) {
    return { messages: [], hasMore: false, error: e.message };
  }
}

// Только НОВЫЕ сообщения (id > afterId) — используется при обновлении по
// сигналу poll, чтобы не перекачивать всю уже загруженную историю чата.
export async function getMsgsSince(chatId, afterId, chatPassword = null) {
  'use server';
  try {
    const cryptoKey = await resolveChatCryptoKey(chatId, chatPassword);
    const rs = await client.execute({
      sql: `SELECT * FROM wc_msgs WHERE chat_id = ? AND id > ? ORDER BY id ASC`,
      args: [chatId, afterId || 0],
    });
    return rs.rows.map(r => ({ ...r, time: Number(r.time), id: Number(r.id), text: decryptText(r.text, cryptoKey), media: decryptText(r.media, cryptoKey) }));
  } catch (e) {
    return [];
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 7: удаление чата целиком (с чисткой файлов, если не используются
// больше нигде) + "умный" выход — авто-удаление личных чатов, передача
// владения группой/каналом следующему администратору/участнику
// ═════════════════════════════════════════════════════════════════════════

export async function deleteChatCompletely(chatId, chatPassword = null) {
  'use server';
  try {
    // Собираем все hash-ссылки на файлы из сообщений этого чата, чтобы потом
    // решить, какие байты в file_store больше никому не нужны.
    // media теперь хранится зашифрованным (см. lib/msgCrypto.js) — сначала
    // расшифровываем, потом уже парсим JSON со ссылками на файлы. Если ЭТОТ
    // чат запаролен — нужен его пароль (chatPassword), чтобы вывести тот же
    // ключ, которым были зашифрованы его сообщения.
    const ownKey = await resolveChatCryptoKey(chatId, chatPassword);
    const msgsRs = await client.execute({ sql: `SELECT media FROM wc_msgs WHERE chat_id = ?`, args: [chatId] });
    const hashes = new Set();
    for (const row of msgsRs.rows) {
      try {
        const files = JSON.parse(decryptText(row.media, ownKey) || '[]');
        files.forEach(f => { if (f.hash) hashes.add(f.hash); });
      } catch (e) {}
    }

    await client.execute({ sql: `DELETE FROM wc_msgs WHERE chat_id = ?`, args: [chatId] });
    await client.execute({ sql: `DELETE FROM wc_members WHERE chat_id = ?`, args: [chatId] });
    await client.execute({ sql: `DELETE FROM active_calls WHERE chat_id = ?`, args: [chatId] });
    await client.execute({ sql: `DELETE FROM chat_extra_admins WHERE chat_id = ?`, args: [chatId] }).catch(() => {});
    await client.execute({ sql: `DELETE FROM chat_reads WHERE chat_id = ?`, args: [chatId] }).catch(() => {});
    await client.execute({ sql: `DELETE FROM wc_chats WHERE id = ?`, args: [chatId] });

    // Чистим файлы, на которые больше никто (ни в одном чате) не ссылается.
    // ВАЖНО: раньше эта проверка делалась через `media LIKE '%hash%'` прямо в
    // SQL — с шифрованием media это больше не сработает (ищем подстроку в
    // шифртексте, который каждый раз разный даже для одинаковых данных из-за
    // случайного IV). Поэтому собираем множество всех используемых hash'ей
    // расшифровкой один раз, а не запросом на каждый hash.
    // ⚠️ Известное ограничение: у сообщений в ЧУЖИХ запароленных чатах здесь
    // нет пароля, поэтому расшифровать их media и учесть в "ещё используется"
    // не получится — крайне редкий кейс (один и тот же файл переслан и в
    // удаляемый чат, и в ДРУГОЙ отдельный запароленный чат) может привести к
    // тому, что файл всё равно удалится из file_store. Если это критично —
    // нужно хранить хэши файлов отдельной незашифрованной таблицей-индексом.
    if (hashes.size) {
      const allMediaRs = await client.execute({ sql: `SELECT media FROM wc_msgs WHERE media IS NOT NULL` });
      const stillUsedHashes = new Set();
      for (const row of allMediaRs.rows) {
        try {
          const files = JSON.parse(decryptText(row.media) || '[]');
          files.forEach(f => { if (f.hash) stillUsedHashes.add(f.hash); });
        } catch (e) {}
      }
      for (const hash of hashes) {
        if (!stillUsedHashes.has(hash)) {
          await client.execute({ sql: `DELETE FROM file_store WHERE hash = ?`, args: [hash] }).catch(() => {});
        }
      }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Выход из чата с учётом ваших правил:
//  • личный чат (DM) — выходит любой из двух → чат удаляется целиком, для обоих;
//  • группа/канал, выходит НЕ владелец — просто убираем из участников;
//  • группа/канал, выходит ВЛАДЕЛЕЦ — если остались другие участники, владение
//    передаётся следующему (сначала пытаемся выбрать уже назначенного админа,
//    иначе первого попавшегося участника); если участников больше не осталось —
//    чат удаляется целиком (как и с личным чатом).
export async function leaveChatSmart(chatId, username) {
  'use server';
  try {
    const chatRs = await client.execute({ sql: `SELECT * FROM wc_chats WHERE id = ?`, args: [chatId] });
    const chat = chatRs.rows[0];
    if (!chat) return { success: false, error: 'Чат не найден' };

    if (chat.type === 'dm') {
      await deleteChatCompletely(chatId);
      return { success: true, deleted: true };
    }

    if (chat.admin !== username) {
      await client.execute({ sql: `DELETE FROM wc_members WHERE chat_id = ? AND username = ?`, args: [chatId, username] });
      return { success: true, deleted: false };
    }

    // Уходит владелец — ищем, кому передать чат.
    const membersRs = await client.execute({ sql: `SELECT username FROM wc_members WHERE chat_id = ? AND username != ?`, args: [chatId, username] });
    const remaining = membersRs.rows.map(r => r.username);
    if (!remaining.length) {
      await deleteChatCompletely(chatId);
      return { success: true, deleted: true };
    }

    const adminsRs = await client.execute({ sql: `SELECT username FROM chat_extra_admins WHERE chat_id = ?`, args: [chatId] });
    const extraAdmins = adminsRs.rows.map(r => r.username).filter(u => remaining.includes(u));
    const newOwner = extraAdmins[0] || remaining[0];

    await client.execute({ sql: `UPDATE wc_chats SET admin = ? WHERE id = ?`, args: [newOwner, chatId] });
    await client.execute({ sql: `DELETE FROM chat_extra_admins WHERE chat_id = ? AND username = ?`, args: [chatId, newOwner] }).catch(() => {});
    await client.execute({ sql: `DELETE FROM wc_members WHERE chat_id = ? AND username = ?`, args: [chatId, username] });
    return { success: true, deleted: false, newOwner };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ЧАСТЬ 7: Посты (второй режим WavyChat — переключатель "Чаты / Посты"
// сверху). Простая лента в духе старого Facebook: текст + опциональная
// картинка, лайки. Никак не пересекается с таблицами чатов/сообщений выше —
// отдельные таблицы, отдельный набор функций.
// ═════════════════════════════════════════════════════════════════════════

const ensureWcPostsTables = once(async function ensureWcPostsTables() {
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_posts (
    id TEXT PRIMARY KEY,
    username TEXT,
    text TEXT,
    image TEXT,
    timestamp INTEGER
  )`);
  // visibility: 'public' (по умолчанию, видно всем) | 'followers' (видно только подписчикам автора)
  try { await client.execute(`ALTER TABLE wc_posts ADD COLUMN visibility TEXT DEFAULT 'public'`); } catch (e) {}
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_post_likes (
    post_id TEXT,
    username TEXT,
    PRIMARY KEY (post_id, username)
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_post_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT,
    username TEXT,
    text TEXT,
    timestamp INTEGER
  )`);

  // ── Паблики — каналы для публикаций (один/несколько авторов пишут,
  // остальные читают/подписаны). У каждого поста теперь есть paablik_id —
  // по умолчанию все посты попадают в общий паблик "general" (тот, что
  // существовал всегда, до пабликов), чтобы ничего старое не потерялось.
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_pabliks (
    id TEXT PRIMARY KEY,
    title TEXT,
    owner TEXT,
    privacy TEXT DEFAULT 'public',
    password TEXT,
    icon TEXT,
    created_at INTEGER
  )`);
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_paablik_subs (
    paablik_id TEXT,
    username TEXT,
    PRIMARY KEY (paablik_id, username)
  )`);
  try { await client.execute(`ALTER TABLE wc_posts ADD COLUMN paablik_id TEXT DEFAULT 'general'`); } catch (e) {}
  // Дефолтный общий паблик — если его ещё нет, создаём один раз.
  const generalExists = await client.execute({ sql: `SELECT 1 FROM wc_pabliks WHERE id = 'general'` });
  if (!generalExists.rows.length) {
    await client.execute({
      sql: `INSERT INTO wc_pabliks (id, title, owner, privacy, password, icon, created_at) VALUES ('general', 'Общая лента', '', 'public', NULL, '📰', ?)`,
      args: [Date.now()],
    });
  }
});

export async function createPaablik(username, title, privacy = 'public', password = '', icon = '📰') {
  'use server';
  if (!username) return { success: false, error: 'Не авторизован' };
  const clean = String(title || '').trim().slice(0, 100);
  if (!clean) return { success: false, error: 'Укажи название' };
  if (privacy === 'private' && !password) return { success: false, error: 'Для приватного паблика нужен пароль' };
  try {
    await ensureWcPostsTables();
    const id = 'pblk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await client.execute({
      sql: `INSERT INTO wc_pabliks (id, title, owner, privacy, password, icon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, clean, String(username), privacy === 'private' ? 'private' : 'public', privacy === 'private' ? hashChatPassword(password) : null, icon || '📰', Date.now()],
    });
    // Автор автоматически подписан на свой паблик.
    await client.execute({ sql: `INSERT OR IGNORE INTO wc_paablik_subs (paablik_id, username) VALUES (?, ?)`, args: [id, String(username)] });
    return { success: true, id };
  } catch (e) {
    console.error('[createPaablik] сбой создания паблика:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

// Список пабликов + подписан ли viewerUsername (чтобы сайдбар сразу знал,
// показывать ли "Подписаться" или "Отписаться"/открыт доступ или нет).
export async function getMyPabliks(viewerUsername) {
  'use server';
  try {
    await ensureWcPostsTables();
    const rs = await client.execute(`SELECT id, title, owner, privacy, icon, created_at FROM wc_pabliks ORDER BY created_at ASC`);
    const pabliks = toPlain(rs.rows);
    let subscribedIds = new Set();
    if (viewerUsername) {
      const subsRs = await client.execute({ sql: `SELECT paablik_id FROM wc_paablik_subs WHERE username = ?`, args: [String(viewerUsername)] });
      subscribedIds = new Set(subsRs.rows.map(r => r.paablik_id));
    }
    return pabliks.map(p => ({
      ...p,
      isSubscribed: p.id === 'general' || subscribedIds.has(p.id), // на общий паблик подписаны все автоматически
      isOwner: p.owner === viewerUsername,
    }));
  } catch (e) {
    console.error('[getMyPabliks] сбой чтения списка пабликов:', e);
    return [];
  }
}

// Вступление/подписка. Для приватного паблика нужен пароль (проверяется тем
// же способом, что и пароли приватных чатов).
export async function joinPaablik(username, paablikId, password = '') {
  'use server';
  if (!username) return { success: false, error: 'Не авторизован' };
  try {
    await ensureWcPostsTables();
    const rs = await client.execute({ sql: `SELECT privacy, password FROM wc_pabliks WHERE id = ?`, args: [paablikId] });
    if (!rs.rows.length) return { success: false, error: 'Паблик не найден' };
    const p = rs.rows[0];
    if (p.privacy === 'private' && !verifyChatPassword(password, p.password)) {
      return { success: false, error: 'Неверный пароль' };
    }
    await client.execute({ sql: `INSERT OR IGNORE INTO wc_paablik_subs (paablik_id, username) VALUES (?, ?)`, args: [paablikId, String(username)] });
    return { success: true };
  } catch (e) {
    console.error('[joinPaablik] сбой вступления в паблик:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

export async function leavePaablik(username, paablikId) {
  'use server';
  if (paablikId === 'general') return { success: false, error: 'Из общей ленты выйти нельзя' };
  await client.execute({ sql: `DELETE FROM wc_paablik_subs WHERE paablik_id = ? AND username = ?`, args: [paablikId, String(username)] });
  return { success: true };
}

export async function createPost(username, text, image, visibility = 'public', paablikId = 'general') {
  'use server';
  if (!username) return { success: false, error: 'Не авторизован' };
  if (!text?.trim() && !image) return { success: false, error: 'Пустой пост' };
  try {
    await ensureWcPostsTables();
    // Писать можно только туда, куда вступил (общий паблик открыт всем по умолчанию).
    if (paablikId !== 'general') {
      const subRs = await client.execute({ sql: `SELECT 1 FROM wc_paablik_subs WHERE paablik_id = ? AND username = ?`, args: [paablikId, username] });
      if (!subRs.rows.length) return { success: false, error: 'Сначала вступи в паблик, чтобы писать в него' };
    }
    const id = 'post_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await client.execute({
      sql: `INSERT INTO wc_posts (id, username, text, image, timestamp, visibility, paablik_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, username, (text || '').trim(), image || '', Date.now(), visibility === 'followers' ? 'followers' : 'public', paablikId || 'general'],
    });
    return { success: true, id };
  } catch (e) {
    console.error('[createPost] сбой создания поста:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

// Лента постов — сначала свежие, у каждого поста сразу подмешаны число лайков
// и лайкнул ли текущий пользователь (viewerUsername), чтобы кнопка сердечка
// сразу знала своё состояние без отдельного запроса на каждую карточку.
// paablikId — какой паблик показывать (по умолчанию общий, как и раньше).
export async function getPostsFeed(viewerUsername, limit = 50, paablikId = 'general') {
  'use server';
  try {
    await ensureWcPostsTables();
    const rs = await client.execute({ sql: `SELECT * FROM wc_posts WHERE paablik_id = ? ORDER BY timestamp DESC LIMIT ?`, args: [paablikId || 'general', limit] });
    let posts = toPlain(rs.rows);
    if (!posts.length) return [];

    const following = viewerUsername ? new Set(await getFollowing(viewerUsername)) : new Set();

    // Приватность: посты с visibility='followers' видны только автору и его подписчикам
    posts = posts.filter(p =>
      p.visibility !== 'followers' || p.username === viewerUsername || following.has(p.username)
    );
    if (!posts.length) return [];

    const ids = posts.map(p => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const likesRs = await client.execute({ sql: `SELECT post_id, COUNT(*) as cnt FROM wc_post_likes WHERE post_id IN (${placeholders}) GROUP BY post_id`, args: ids });
    const likeCounts = {};
    for (const r of likesRs.rows) likeCounts[r.post_id] = Number(r.cnt);

    let likedByMe = new Set();
    if (viewerUsername) {
      const mineRs = await client.execute({ sql: `SELECT post_id FROM wc_post_likes WHERE username = ? AND post_id IN (${placeholders})`, args: [viewerUsername, ...ids] });
      likedByMe = new Set(mineRs.rows.map(r => r.post_id));
    }

    // Аватарки авторов — берём той же логикой, что и в чате (wc_avatars → буква)
    const uniqueAuthors = [...new Set(posts.map(p => p.username))];
    const avatars = await getUserIcons(uniqueAuthors).catch(() => ({}));

    return posts.map(p => ({
      ...p,
      likes: likeCounts[p.id] || 0,
      likedByMe: likedByMe.has(p.id),
      avatar: avatars?.[p.username] || null,
      followedByMe: following.has(p.username),
    }));
  } catch (e) {
    console.error('[getPostsFeed] сбой загрузки ленты:', e);
    return [];
  }
}

export async function togglePostLike(postId, username) {
  'use server';
  if (!username || !postId) return { success: false };
  try {
    await ensureWcPostsTables();
    const existing = await client.execute({ sql: `SELECT 1 FROM wc_post_likes WHERE post_id = ? AND username = ?`, args: [postId, username] });
    let liked;
    if (existing.rows.length) {
      await client.execute({ sql: `DELETE FROM wc_post_likes WHERE post_id = ? AND username = ?`, args: [postId, username] });
      liked = false;
    } else {
      await client.execute({ sql: `INSERT INTO wc_post_likes (post_id, username) VALUES (?, ?)`, args: [postId, username] });
      liked = true;
    }
    const cnt = await client.execute({ sql: `SELECT COUNT(*) as cnt FROM wc_post_likes WHERE post_id = ?`, args: [postId] });
    return { success: true, liked, likes: Number(cnt.rows[0]?.cnt || 0) };
  } catch (e) {
    console.error('[togglePostLike] сбой лайка:', e);
    return { success: false, error: e?.message || String(e) };
  }
}

export async function getPostComments(postId) {
  'use server';
  try {
    await ensureWcPostsTables();
    const rs = await client.execute({ sql: `SELECT * FROM wc_post_comments WHERE post_id = ? ORDER BY timestamp ASC`, args: [postId] });
    return toPlain(rs.rows);
  } catch (e) {
    return [];
  }
}

export async function addPostComment(postId, username, text) {
  'use server';
  if (!username || !text?.trim()) return { success: false, error: 'Пустой комментарий' };
  try {
    await ensureWcPostsTables();
    const id = 'pc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await client.execute({ sql: `INSERT INTO wc_post_comments (id, post_id, username, text, timestamp) VALUES (?, ?, ?, ?, ?)`, args: [id, postId, username, text.trim(), Date.now()] });
    return { success: true, id };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function deletePost(postId, username) {
  'use server';
  try {
    await ensureWcPostsTables();
    const row = await client.execute({ sql: `SELECT username FROM wc_posts WHERE id = ?`, args: [postId] });
    if (!row.rows.length || row.rows[0].username !== username) return { success: false, error: 'Можно удалять только свои посты' };
    await client.execute({ sql: `DELETE FROM wc_posts WHERE id = ?`, args: [postId] });
    await client.execute({ sql: `DELETE FROM wc_post_likes WHERE post_id = ?`, args: [postId] });
    await client.execute({ sql: `DELETE FROM wc_post_comments WHERE post_id = ?`, args: [postId] });
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// ── Подписки (для ленты Постов) ───────────────────────────────────────────
const ensureWcFollowsTable = once(async function ensureWcFollowsTable() {
  await db.raw(`CREATE TABLE IF NOT EXISTS wc_follows (
    follower TEXT,
    followee TEXT,
    PRIMARY KEY (follower, followee)
  )`);
});

export async function followUser(follower, followee) {
  'use server';
  if (!follower || !followee || follower === followee) return { success: false, error: 'Некорректные параметры' };
  try {
    await ensureWcFollowsTable();
    await client.execute({ sql: `INSERT OR IGNORE INTO wc_follows (follower, followee) VALUES (?, ?)`, args: [follower, followee] });
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

export async function unfollowUser(follower, followee) {
  'use server';
  try {
    await ensureWcFollowsTable();
    await client.execute({ sql: `DELETE FROM wc_follows WHERE follower = ? AND followee = ?`, args: [follower, followee] });
    return { success: true };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}

// Кого читает viewerUsername — Set в виде массива, чтобы удобно проверять
// "подписан ли я" на каждого автора поста одним запросом на всю ленту.
export async function getFollowing(viewerUsername) {
  'use server';
  if (!viewerUsername) return [];
  try {
    await ensureWcFollowsTable();
    const rs = await client.execute({ sql: `SELECT followee FROM wc_follows WHERE follower = ?`, args: [viewerUsername] });
    return rs.rows.map(r => r.followee);
  } catch (e) {
    return [];
  }
}

export async function getFollowCounts(username) {
  'use server';
  try {
    await ensureWcFollowsTable();
    const [followers, following] = await Promise.all([
      client.execute({ sql: `SELECT COUNT(*) as cnt FROM wc_follows WHERE followee = ?`, args: [username] }),
      client.execute({ sql: `SELECT COUNT(*) as cnt FROM wc_follows WHERE follower = ?`, args: [username] }),
    ]);
    return { followers: Number(followers.rows[0]?.cnt || 0), following: Number(following.rows[0]?.cnt || 0) };
  } catch (e) {
    return { followers: 0, following: 0 };
  }
}
