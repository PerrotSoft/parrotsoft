'use server';

import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

async function ensureTables() {
  await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
}
export async function syncDocs(username, docsData) {
  'use server';
  const userData = await getRawUserData(username);
  userData.docs = docsData;
  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function getDocs(username) {
  'use server';
  const data = await getRawUserData(username);
  return data.docs || [];
}
export async function getRawUserData(username) {
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
  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
  return { success: true };
}

export async function syncProjects(username, projectsData) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.projects = projectsData;
  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function getProjects(username) {
  return (await getRawUserData(username)).projects || [];
}

export async function onSync(username, osData) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.os = osData;
  await client.execute({
    sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
    args: [String(username), JSON.stringify(userData)]
  });
}

export async function syncDrive(username, driveData) {
  await ensureTables();
  const userData = await getRawUserData(username);
  userData.drive = driveData;
  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), String(username)]
  });
}

export async function getUserFiles(username) {
  return (await getRawUserData(username)).drive;
}


export async function initDB() {
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






export async function initParrotDB() {
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
  if (adminName !== 'testoviy_account_2.2') return { error: "DENIED" };

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

    await client.execute(`
      CREATE TABLE IF NOT EXISTS wavytube_videos (
        id TEXT PRIMARY KEY,
        title TEXT,
        author TEXT,
        description TEXT,
        category TEXT,
        video_url TEXT,
        thumbnail_url TEXT,
        views INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
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

export async function getVideos(category = 'all') {
  const sql = category === 'all' 
    ? "SELECT * FROM wavytube_videos ORDER BY timestamp DESC" 
    : "SELECT * FROM wavytube_videos WHERE category = ? ORDER BY timestamp DESC";
  const rs = await client.execute({ sql, args: category === 'all' ? [] : [category] });
  return rs.rows;
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
export async function admin_getDashboardData() {
  try {
    const userRs = await client.execute("SELECT username, data FROM users");
    const users = userRs.rows.map(row => {
      const data = JSON.parse(row.data || "{}");
      return {
        username: row.username,
        balance: data.balance || 0,
        isBlocked: data.isBlocked || false,
        email: data.email || "no-email@example.com",
        dbCount: (data.docs || []).length,
        rawDocs: data.docs || []
      };
    });

    const transRs = await client.execute("SELECT * FROM transactions ORDER BY timestamp DESC LIMIT 100");
    const transactions = transRs.rows;

    const totalCoins = users.reduce((sum, u) => sum + u.balance, 0);
    const totalPaid = transactions
        .filter(t => t.status === 'completed' || t.status === 'success')
        .reduce((sum, t) => sum + Number(t.amount), 0);

    return { success: true, users, transactions, stats: { totalCoins, totalPaid, totalUsers: users.length } };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function admin_toggleUserBlock(username, blockStatus) {
  const userData = await getRawUserData(username);
  userData.isBlocked = blockStatus;
  
  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), username]
  });
  return { success: true, isBlocked: blockStatus };
}

export async function admin_updateBalance(username, amount) {
  const userData = await getRawUserData(username);
  userData.balance = (Number(userData.balance) || 0) + Number(amount);
  
  await client.execute({
    sql: "UPDATE users SET data = ? WHERE username = ?",
    args: [JSON.stringify(userData), username]
  });
  return { success: true, newBalance: userData.balance };
}

export async function admin_resetUserAccount(targetUsername) {
  return await syncDocs(targetUsername, []);
}

export async function admin_getUserFullContext(targetUsername) {
  const row = await client.execute({
    sql: "SELECT data FROM users WHERE username = ?",
    args: [targetUsername]
  });
  
  if (row.rows.length === 0) return { error: "User not found" };
  const userData = JSON.parse(row.rows[0].data || "{}");
  
  return { 
    username: targetUsername,
    balance: userData.balance || 0,
    docs: userData.docs || [],
    email: userData.email || "no-email@example.com",
    isBlocked: userData.isBlocked || false
  };
}

export async function admin_deleteUserDoc(targetUsername, docId) {
  const userData = await getRawUserData(targetUsername);
  const filteredDocs = (userData.docs || []).filter(d => d.id !== docId);
  return await syncDocs(targetUsername, filteredDocs);
}

export async function admin_deleteUserFile(targetUsername, dbId, fileKey) {
  const userData = await getRawUserData(targetUsername);
  userData.docs = userData.docs.map(doc => {
    if (doc.id === dbId && doc.content) {
      const newContent = { ...doc.content };
      delete newContent[fileKey];
      return { ...doc, content: newContent };
    }
    return doc;
  });
  return await syncDocs(targetUsername, userData.docs);
}

export async function admin_masqueradeAsUser(targetUsername) {
  console.log(`🛡️ ADMIN LOGS IN UNDER THE NAME: ${targetUsername}`);
  return { success: true, target: targetUsername };
}
export async function admin_exportFullBackup() {
  try {
    const usersRs = await client.execute("SELECT * FROM users");
    const transRs = await client.execute("SELECT * FROM transactions");
    
    const backupData = {
      timestamp: Date.now(),
      tables: {
        users: usersRs.rows,
        transactions: transRs.rows
      }
    };
    return { success: true, payload: JSON.stringify(backupData, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function admin_importFullBackup(jsonString) {
  try {
    const data = JSON.parse(jsonString);
    if (!data.tables) throw new Error("Неверный формат .gsm файла");

    await client.execute("DELETE FROM users");
    for (const row of data.tables.users) {
      await client.execute({
        sql: "INSERT INTO users (username, data) VALUES (?, ?)",
        args: [row.username, row.data]
      });
    }

    await client.execute("DELETE FROM transactions");
    for (const row of data.tables.transactions) {
      await client.execute({
        sql: "INSERT INTO transactions (id, user, amount, status, timestamp) VALUES (?, ?, ?, ?, ?)",
        args: [row.id, row.user, row.amount, row.status, row.timestamp]
      });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

export async function adminModifyUser(username, newData) {
  'use server';
  try {
    const userData = await getRawUserData(username);
    const updatedData = { ...userData, ...newData };
    
    await client.execute({
      sql: "INSERT INTO users (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data",
      args: [String(username), JSON.stringify(updatedData)]
    });
    
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
export async function generateFullBackup() {
  'use server';
  try {
    const usersRs = await client.execute("SELECT * FROM users");
    const transRs = await client.execute("SELECT * FROM transactions");
    
    const backupData = {
      timestamp: Date.now(),
      tables: {
        users: usersRs.rows,
        transactions: transRs.rows
      }
    };
    return { success: true, payload: JSON.stringify(backupData, null, 2) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}