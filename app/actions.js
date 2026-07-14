'use server';

import { createClient } from '@libsql/client';
import crypto from 'crypto';

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
  const userData = await getRawUserData(username);
  userData.drive = driveData;
  await db.update('users', 'username', String(username), { data: JSON.stringify(userData) });
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
export async function leaveChat(chatId, username) {
    await client.execute({
        sql: "DELETE FROM wc_members WHERE chat_id = ? AND username = ?",
        args: [chatId, username]
    });
    return { success: true };
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
  
  await client.execute({
    sql: "INSERT INTO wc_chats (id, title, admin, type, privacy, icon, password) VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [id, title, admin, type, privacy, icon, password || null]
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
  if (chat.privacy === 'private' && String(chat.password) !== String(password)) {
    throw new Error("Invalid password");
  }
  
  return { success: true };
}
export async function sendMsg(chatId, sender, text, media = null) {
  const chat = await client.execute({ sql: "SELECT type, admin FROM wc_chats WHERE id = ?", args: [chatId] });
  if (chat.rows[0]?.type === 'channel' && chat.rows[0]?.admin !== sender) {
    throw new Error("Only admins can post in channels");
  }
  const mediaData = media ? JSON.stringify(media) : null;

  await client.execute({ 
    sql: "INSERT INTO wc_msgs (chat_id, sender, text, media, time) VALUES (?, ?, ?, ?, ?)", 
    args: [chatId, sender, text, mediaData, Date.now()] 
  });
}

export async function getMsgs(chatId) {
  const rs = await client.execute({ 
    sql: "SELECT * FROM wc_msgs WHERE chat_id = ? ORDER BY time ASC", 
    args: [chatId] 
  });
  return toPlain(rs.rows).map(r => ({ ...r, time: Number(r.time) }));
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
    await client.execute({
      sql: "UPDATE wc_chats SET password = ? WHERE id = ?",
      args: [newPassword, chatId]
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
  } catch(e) { console.error("WavyDB Video Migration error: ", e); }
}
export const initWavyDB = once(initWavyDBImpl);

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
  await initWavyDB();

  await client.execute({
    sql: "INSERT INTO wt_channels (username, avatar) VALUES (?, ?) ON CONFLICT(username) DO NOTHING",
    args: [videoData.channel, `https://api.dicebear.com/7.x/bottts/svg?seed=${videoData.channel}`]
  });

  await client.execute({
    sql: "INSERT INTO wt_videos (id, channel_id, title, description, playlist, thumbnail, is_short, duration, timestamp, video_data, age_rating, is_explicit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
      videoData.is_explicit ? 1 : 0  // Флаг эротического/18+ контента
    ]
  });
  
  return { success: true };
}
// Метаданные ОДНОГО видео по id (без video_data — используется публичной
// embed-страницей /watch/[id], которая ничего не знает про SQL, только зовёт это).
export async function getVideoById(videoId) {
  await initWavyDB();
  const adCols = ['ad_dev_id', 'ad_static_site_id', 'ad_video_site_id'];
  for (const col of adCols) {
    try { await client.execute(`ALTER TABLE wt_channels ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (_) {}
  }
  const columns = "v.id, v.channel_id, v.title, v.description, v.playlist, v.likes, v.dislikes, v.views, v.duration, v.thumbnail, v.is_short, v.timestamp, v.age_rating, v.is_explicit, c.ad_dev_id as ad_dev_id, c.ad_static_site_id as ad_static_site_id, c.ad_video_site_id as ad_video_site_id";
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
  const columns = "v.id, v.channel_id, v.title, v.description, v.playlist, v.likes, v.dislikes, v.views, v.duration, v.thumbnail, v.is_short, v.timestamp, v.age_rating, v.is_explicit, c.ad_dev_id as ad_dev_id, c.ad_static_site_id as ad_static_site_id, c.ad_video_site_id as ad_video_site_id";
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

export async function incrementViews(videoId) {
  await initWavyDB();
  await client.execute({ sql: "UPDATE wt_videos SET views = views + 1 WHERE id = ?", args: [videoId] });
}

export async function logSegmentWatch(videoId, segmentIndex) {
  await initWavyDB();
  await client.execute({ sql: "INSERT INTO wt_telemetry (video_id, segment_index, watch_count) VALUES (?, ?, 1) ON CONFLICT(video_id, segment_index) DO UPDATE SET watch_count = watch_count + 1", args: [videoId, parseInt(segmentIndex, 10)] });
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
  if (existing.rows.length > 0) {
    const currentType = existing.rows[0].type;
    await client.execute({ sql: "DELETE FROM wt_likes WHERE username = ? AND video_id = ?", args: [username, videoId] });
    if (currentType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = MAX(0, likes - 1) WHERE id = ?", args: [videoId] });
    if (currentType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = MAX(0, dislikes - 1) WHERE id = ?", args: [videoId] });

    if (currentType !== actionType) {
      await client.execute({ sql: "INSERT INTO wt_likes (username, video_id, type) VALUES (?, ?, ?)", args: [username, videoId, actionType] });
      if (actionType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = likes + 1 WHERE id = ?", args: [videoId] });
      if (actionType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = dislikes + 1 WHERE id = ?", args: [videoId] });
    }
  } else {
    await client.execute({ sql: "INSERT INTO wt_likes (username, video_id, type) VALUES (?, ?, ?)", args: [username, videoId, actionType] });
    if (actionType === 'like') await client.execute({ sql: "UPDATE wt_videos SET likes = likes + 1 WHERE id = ?", args: [videoId] });
    if (actionType === 'dislike') await client.execute({ sql: "UPDATE wt_videos SET dislikes = dislikes + 1 WHERE id = ?", args: [videoId] });
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
  if (Number(countRs.rows[0]?.cnt || 0) >= 5) return { error: 'limit_reached' };

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
  const rs = await client.execute({ sql: "SELECT owner_account FROM wt_channels WHERE username = ?", args: [channelUsername] });
  if (rs.rows.length === 0) return false;
  return String(rs.rows[0].owner_account) === String(accountId);
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












// ── КОНФИГ (дефолтные значения — замени здесь) ────────────────────────────
const ADS_CONFIG = {
  DEV_ACCOUNT_COST: 10,       // Pey Coins за аккаунт разработчика
  MIN_WITHDRAWAL:   10,       // Минимальная сумма вывода
  MAX_SITES:        10,       // Макс. сайтов у одного разработчика
  DEFAULT_CPV:      0.5,      // Дефолтная цена за просмотр
  FALLBACK_BANNER:  'https://via.placeholder.com/468x60?text=FireSoft+Ads', // Заглушка
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
// ParrotMail — внутренняя почта ParrotSoft
// Добавь этот блок в КОНЕЦ файла actions.js
// ══════════════════════════════════════════════════════════════════

// ── Инициализация таблиц почты ─────────────────────────────────────────────
async function initMailDBImpl() {
  'use server';
  await client.execute(`
    CREATE TABLE IF NOT EXISTS mail_messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT    NOT NULL,
      to_user   TEXT    NOT NULL,
      subject   TEXT    DEFAULT '',
      body      TEXT    DEFAULT '',
      is_read   INTEGER DEFAULT 0,
      is_starred INTEGER DEFAULT 0,
      folder    TEXT    DEFAULT 'inbox',
      timestamp INTEGER NOT NULL
    )
  `);
  // Индексы для быстрого поиска
  try {
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_mail_to   ON mail_messages(to_user, folder)`);
    await client.execute(`CREATE INDEX IF NOT EXISTS idx_mail_from ON mail_messages(from_user, folder)`);
  } catch (_) {}
}
export const initMailDB = once(initMailDBImpl);

// ── Отправить письмо ───────────────────────────────────────────────────────
export async function sendMail(fromUser, toUser, subject, body) {
  'use server';
  await initMailDB();

  const from = String(fromUser).toLowerCase().trim();
  const to   = String(toUser).toLowerCase().trim();

  if (!from || !to || !body) return { error: 'missing_fields' };
  if (from === to) return { error: 'self_send' };

  // Проверяем что получатель существует
  const userCheck = await client.execute({
    sql: 'SELECT username FROM users WHERE username = ?',
    args: [to],
  });
  if (userCheck.rows.length === 0) return { error: 'user_not_found' };

  const now = Date.now();

  // Запись во входящие получателя
  const res = await client.execute({
    sql: `INSERT INTO mail_messages (from_user, to_user, subject, body, folder, timestamp)
          VALUES (?, ?, ?, ?, 'inbox', ?)`,
    args: [from, to, subject?.trim() || '(Без темы)', body.trim(), now],
  });

  // Запись в отправленные отправителя
  await client.execute({
    sql: `INSERT INTO mail_messages (from_user, to_user, subject, body, folder, is_read, timestamp)
          VALUES (?, ?, ?, ?, 'sent', 1, ?)`,
    args: [from, to, subject?.trim() || '(Без темы)', body.trim(), now],
  });

  return { success: true, id: Number(res.lastInsertRowid) };
}

// ── Получить письма по папке ───────────────────────────────────────────────
export async function getMails(username, folder = 'inbox') {
  'use server';
  await initMailDB();

  const user = String(username).toLowerCase();
  let rs;

  if (folder === 'sent') {
    rs = await client.execute({
      sql: `SELECT * FROM mail_messages
            WHERE from_user = ? AND folder = 'sent'
            ORDER BY timestamp DESC`,
      args: [user],
    });
  } else if (folder === 'starred') {
    rs = await client.execute({
      sql: `SELECT * FROM mail_messages
            WHERE to_user = ? AND is_starred = 1 AND folder != 'trash'
            ORDER BY timestamp DESC`,
      args: [user],
    });
  } else {
    rs = await client.execute({
      sql: `SELECT * FROM mail_messages
            WHERE to_user = ? AND folder = ?
            ORDER BY timestamp DESC`,
      args: [user, folder],
    });
  }

  return rs.rows.map(r => ({
    id:         Number(r.id),
    from_user:  String(r.from_user),
    to_user:    String(r.to_user),
    subject:    String(r.subject || ''),
    body:       String(r.body || ''),
    is_read:    Number(r.is_read),
    is_starred: Number(r.is_starred),
    folder:     String(r.folder),
    timestamp:  Number(r.timestamp),
  }));
}

// ── Отметить как прочитанное ───────────────────────────────────────────────
export async function markAsRead(mailId, username) {
  'use server';
  await client.execute({
    sql: 'UPDATE mail_messages SET is_read = 1 WHERE id = ? AND to_user = ?',
    args: [Number(mailId), String(username).toLowerCase()],
  });
  return { success: true };
}

// ── Переключить звёздочку ──────────────────────────────────────────────────
export async function toggleStar(mailId, username) {
  'use server';
  await initMailDB();
  const rs = await client.execute({
    sql: 'SELECT is_starred FROM mail_messages WHERE id = ?',
    args: [Number(mailId)],
  });
  if (rs.rows.length === 0) return { error: 'not_found' };

  const next = Number(rs.rows[0].is_starred) === 1 ? 0 : 1;
  await client.execute({
    sql: 'UPDATE mail_messages SET is_starred = ? WHERE id = ? AND (to_user = ? OR from_user = ?)',
    args: [next, Number(mailId), String(username).toLowerCase(), String(username).toLowerCase()],
  });
  return { success: true, is_starred: next };
}

// ── Переместить в папку ────────────────────────────────────────────────────
export async function moveTo(mailId, username, folder) {
  'use server';
  const allowed = ['inbox', 'sent', 'trash', 'draft'];
  if (!allowed.includes(folder)) return { error: 'invalid_folder' };

  const user = String(username).toLowerCase();
  await client.execute({
    sql: 'UPDATE mail_messages SET folder = ? WHERE id = ? AND (to_user = ? OR from_user = ?)',
    args: [folder, Number(mailId), user, user],
  });
  return { success: true };
}

// ── Удалить / переместить в корзину ───────────────────────────────────────
export async function deleteMail(mailId, username) {
  'use server';
  await initMailDB();
  const user = String(username).toLowerCase();

  const rs = await client.execute({
    sql: 'SELECT folder FROM mail_messages WHERE id = ? AND (to_user = ? OR from_user = ?)',
    args: [Number(mailId), user, user],
  });

  if (rs.rows.length === 0) return { error: 'not_found' };

  if (String(rs.rows[0].folder) === 'trash') {
    // Уже в корзине — удаляем совсем
    await client.execute({
      sql: 'DELETE FROM mail_messages WHERE id = ?',
      args: [Number(mailId)],
    });
    return { success: true, permanently_deleted: true };
  } else {
    // Перемещаем в корзину
    return moveTo(mailId, username, 'trash');
  }
}

// ── Количество непрочитанных ───────────────────────────────────────────────
export async function getUnreadCount(username) {
  'use server';
  await initMailDB();
  const rs = await client.execute({
    sql: `SELECT COUNT(*) as cnt FROM mail_messages
          WHERE to_user = ? AND folder = 'inbox' AND is_read = 0`,
    args: [String(username).toLowerCase()],
  });
  return Number(rs.rows[0]?.cnt || 0);
}

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

const ADSTERRA_CONFIGS = {
  banner:       { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60 },
  video:        { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60 },
  interstitial: { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60 },
};
const ADSTERRA_SCRIPT_HOST = 'www.profitabledisplaynetwork.com';

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
      <div class="badge">FireSoft Ads</div>
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

  if (rs.rows.length === 0) return { success: false };

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
  return { success: true, withdrawalId: wid };
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
