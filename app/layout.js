import './globals.css';
import ClientInterface from './ClientInterface';
import { createClient } from '@libsql/client';
export const dynamic = 'force-dynamic';
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
// Используйте эти ключи (исправлены опечатки n->N, l->I, c->C)
const PAYPAL_CLIENT = 'AQuNzjMd1mxmH7Q9wItXnsric6qHa-N84XEA-YsiJqLU_h-AweQ50AmtHrQcCLni3WiNJb9QsveBdnDU';
const PAYPAL_SECRET = 'EKGTwjxL3qYZXqpyL5lFaMgK029sa4XCwH_nn_Wi4VgPiYGCtx1h9cWT3YgXi7OFB9HOSMi7wLU1IB0v';
const PAYPAL_API = 'https://api-m.sandbox.paypal.com';

async function getPayPalToken() {
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
            
            // Здесь ваша логика обновления БД (ensureTables, getRawUserData и т.д.)
            // Пример:
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
createPaySession,
    finalizeAndAddBalance
          }}
        >
          {children}
        </ClientInterface>
      </body>
    </html>
  );
}