import './globals.css';
import ClientInterface from './ClientInterface';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

async function ensureTables() {
  await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
}

async function getRawUserData(username) {
  const rs = await client.execute({
    sql: "SELECT data FROM users WHERE username = ?",
    args: [String(username)]
  });
  if (rs.rows.length > 0 && rs.rows[0].data) {
    const rawContent = rs.rows[0].data;
    try {
      const parsed = JSON.parse(rawContent);
      // Инициализация структур, если их нет
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

// --- ФУНКЦИИ ДЛЯ РАБОТЫ С ПРОЕКТАМИ (PROJECTS) ---

export async function syncProjects(username, projectsData) {
  'use server';
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.projects = projectsData; // Записываем массив проектов в JSON

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

// --- СТАНДАРТНЫЕ ФУНКЦИИ СИНХРОНИЗАЦИИ ---

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
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), String(username)]
  });
}

export async function getUserFiles(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.drive;
}

export default async function RootLayout({ children }) {
  const users = {};

  // Добавляем проверку try-catch. Если база недоступна при сборке, 
  // билд не упадет, а просто создаст пустой объект пользователей.
  try {
    // Выполняем только на сервере
    if (typeof window === 'undefined') {
      await ensureTables();
      const rs = await client.execute("SELECT * FROM users");
      
      if (rs && rs.rows) {
        rs.rows.forEach(row => {
          users[row.username] = { data: String(row.data) };
        });
      }
    }
  } catch (e) {
    console.warn("[Build Update] База данных недоступна при сборке, пропускаем пререндеринг пользователей.");
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