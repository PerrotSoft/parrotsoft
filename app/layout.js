import './globals.css';
import ClientInterface from './ClientInterface';
import { createClient } from '@libsql/client';

const client = createClient({
  url: "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});
async function ensureTables() {
  try {
    await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
    await client.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY, 
        user TEXT, 
        amount REAL, 
        status TEXT, 
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
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
export async function getBalance(user) {
  'use server';
  if (!user) return 0;

  try {
    await ensureTables();

    const rs = await client.execute({ 
      sql: "SELECT data FROM users WHERE username = ?", 
      args: [String(user)] 
    });

    if (rs.rows.length > 0) {
      try {
        const userData = JSON.parse(rs.rows[0].data);
        const balance = userData.balance ?? userData.os?.balance ?? 0;
        return Number(balance);
      } catch (e) {
        console.error("Error parsing user data in getBalance:", e);
        return 0;
      }
    }
  } catch (e) {
    console.error("Error executing getBalance query:", e);
    return 0;
  }
  return 0;
}
export async function setBalance(username, newBalance) {
  'use server';
  if (!username) return { success: false, error: "No username" };

  try {
    await ensureTables();
    
    // 1. Сначала получаем текущие данные пользователя
    const userData = await getRawUserData(username);
    
    // 2. Обновляем значение баланса
    userData.balance = Number(newBalance);
    
    // 3. Сохраняем обратно в БД
    await client.execute({
      sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
      args: [String(username), JSON.stringify(userData)]
    });

    return { success: true, newBalance: userData.balance };
  } catch (e) {
    console.error("Error setting balance:", e);
    return { success: false, error: e.message };
  }
}
export async function addBalance(username, amount) {
  'use server';
  await ensureTables();
  // Создаем ID транзакции
  const tid = Math.random().toString(36).substring(7);
  
  // Сохраняем в БД временную запись (нужно добавить таблицу transactions)
  await client.execute({
    sql: "INSERT INTO transactions (id, user, amount, status) VALUES (?, ?, ?, 'pending')",
    args: [tid, username, Number(amount)]
  });

  // Возвращаем ссылку на страницу, которая будет в окошке
  return { success: true, payUrl: `/pay?id=${tid}&amount=${amount}` };
}
// Эту функцию будет вызывать страница оплаты ПОСЛЕ того, как "деньги получены"
export async function finalizePayment(transactionId) {
  'use server';
  try {
    // Проверяем, существует ли транзакция и не оплачена ли она уже
    const res = await client.execute({
      sql: "SELECT * FROM transactions WHERE id = ? AND status = 'pending'",
      args: [transactionId]
    });

    if (res.rows.length === 0) return { success: false, error: "Invalid or already paid" };
    
    const trans = res.rows[0];
    const username = trans.user;
    const amount = Number(trans.amount);

    // НАЧИСЛЯЕМ ДЕНЬГИ
    const userData = await getRawUserData(username);
    userData.balance = (Number(userData.balance) || 0) + amount;

    // Обновляем пользователя
    await client.execute({
      sql: "UPDATE users SET data = ? WHERE username = ?",
      args: [JSON.stringify(userData), username]
    });

    // Закрываем транзакцию
    await client.execute({
      sql: "UPDATE transactions SET status = 'completed' WHERE id = ?",
      args: [transactionId]
    });

    return { success: true, newBalance: userData.balance };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
export default async function RootLayout({ children }) {
  await ensureTables();
  
  let users = {};
  try {
    const rs = await client.execute("SELECT username, data FROM users");
    if (rs.rows) {
      rs.rows.forEach(row => {
        users[row.username] = { data: String(row.data) };
      });
    }
  } catch (e) {
    console.error("RootLayout fetch error (ignoring for build):", e);
  }

  return (
    <html lang="en">
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
            getProjects,
            getBalance,
            setBalance,
            addBalance
          }}
        >
          {children}
        </ClientInterface>
      </body>
    </html>
  );
}