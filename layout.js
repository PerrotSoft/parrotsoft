import './globals.css';
import ClientInterface from './ClientInterface';
import { createClient } from '@libsql/client';

// 1. Обязательно для Vercel: отключаем статический пререндеринг, так как есть работа с БД
export const dynamic = 'force-dynamic';

// 2. Настройка подключения (локально возьмет из .env, на хостинге из настроек Vercel)
const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

// Создаем клиент только если есть ключи, иначе билд упадет на этапе "Generating static pages"
export const client = (url && authToken) 
  ? createClient({ url, authToken }) 
  : null;

// Вспомогательная функция: проверяет готовность клиента перед любым запросом
const checkClient = () => {
  if (!client) {
    console.warn("DB Client is not initialized. Check your environment variables.");
    return false;
  }
  return true;
};

// 3. Инициализация таблиц (безопасная для тестов и первого запуска)
async function ensureTables() {
  if (!checkClient()) return;
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY, 
        data TEXT
      )
    `);
  } catch (e) {
    console.error("Table creation error:", e);
  }
}

async function getRawUserData(username) {
  if (!checkClient()) return { os: null, drive: { files: [], folders: [] }, projects: [] };

  const rs = await client.execute({
    sql: "SELECT data FROM users WHERE username = ?",
    args: [String(username)]
  });

  if (rs.rows.length > 0 && rs.rows[0].data) {
    const rawContent = rs.rows[0].data;
    try {
      const parsed = JSON.parse(rawContent);
      if (!parsed.drive) parsed.drive = { files: [], folders: [] };
      if (!parsed.projects) parsed.projects = []; 
      return parsed;
    } catch (e) {
      return { 
        os: rawContent, 
        drive: { files: [], folders: [] },
        projects: []
      };
    }
  }
  return { os: null, drive: { files: [], folders: [] }, projects: [] };
}

// --- ФУНКЦИИ ДЛЯ РАБОТЫ С ПРОЕКТАМИ ---

export async function syncProjects(username, projectsData) {
  'use server';
  if (!checkClient()) return;
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.projects = projectsData;

  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function getProjects(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.projects || [];
}

// --- ФУНКЦИИ СИНХРОНИЗАЦИИ ---

export async function onSync(username, osData) {
  'use server';
  if (!checkClient()) return;
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.os = osData;

  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function syncDrive(username, driveData) {
  'use server';
  if (!checkClient()) return;
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.drive = driveData;

  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), String(username)]
  });
}

export async function getUserFiles(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.drive;
}

// --- ГЛАВНЫЙ LAYOUT ---

export default async function RootLayout({ children }) {
  const users = {};

  // Безопасное получение данных при рендере
  if (client) {
    try {
      await ensureTables();
      const rs = await client.execute("SELECT * FROM users");
      rs.rows.forEach(row => {
        users[row.username] = { data: String(row.data) };
      });
    } catch (e) {
      console.error("Failed to fetch users for Layout:", e);
    }
  }

  return (
    <html lang="ru">
      <head>
        <title>ParrotSoft</title>
      </head>
      <body>
        <ClientInterface 
          serverDB={users} 
          onSync={onSync}
          dbActions={{ 
            syncDrive, 
            getUserFiles, 
            syncProjects,
            getProjects 
          }}
        >
          {children}
        </ClientInterface>
      </body>
    </html>
  );
}