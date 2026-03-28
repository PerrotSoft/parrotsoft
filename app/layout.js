import './globals.css';
import ClientInterface from './ClientInterface';
import { createClient } from '@libsql/client';

// Инициализируем клиент вне функций для повторного использования
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

async function ensureTables() {
  try {
    // Используем простой execute, так как CREATE TABLE обычно не вызывает проблем с потоками
    await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
  } catch (e) {
    console.error("Database init error:", e);
  }
}

async function getRawUserData(username) {
  try {
    const rs = await client.execute({
      sql: "SELECT data FROM users WHERE username = ?",
      args: [String(username)]
    });
    
    if (rs.rows && rs.rows.length > 0) {
      const rawContent = rs.rows[0].data;
      try {
        const parsed = JSON.parse(rawContent);
        if (!parsed.drive) parsed.drive = { files: [], folders: [] };
        if (!parsed.projects) parsed.projects = []; 
        return parsed;
      } catch (e) {
        return { os: rawContent, drive: { files: [], folders: [] }, projects: [] };
      }
    }
  } catch (e) {
    console.error("Fetch error:", e);
  }
  return { os: null, drive: { files: [], folders: [] }, projects: [] };
}

export async function syncProjects(username, projectsData) {
  'use server';
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

export async function onSync(username, osData) {
  'use server';
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
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.drive = driveData;
  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function getUserFiles(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.drive;
}

export default async function RootLayout({ children }) {
  // Выполняем инициализацию таблиц
  await ensureTables();
  
  let users = {};
  try {
    // Получаем данные всех пользователей для начальной загрузки интерфейса
    const rs = await client.execute("SELECT username, data FROM users");
    if (rs.rows) {
      rs.rows.forEach(row => {
        users[row.username] = { data: String(row.data) };
      });
    }
  } catch (e) {
    // В случае ошибки (например, resp.body?.cancel) возвращаем пустой объект, чтобы билд не падал
    console.error("RootLayout fetch error (ignoring for build):", e);
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