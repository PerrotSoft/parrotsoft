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










export async function initWavyDB() {
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_channels (username TEXT PRIMARY KEY, avatar TEXT, description TEXT, subscribers INTEGER DEFAULT 0, owner_account TEXT DEFAULT '', icon TEXT DEFAULT '', display_name TEXT DEFAULT '')`);
  await client.execute(`CREATE TABLE IF NOT EXISTS wt_videos (id TEXT PRIMARY KEY, channel_id TEXT, title TEXT, description TEXT, playlist TEXT DEFAULT '', likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, views INTEGER DEFAULT 0, duration REAL DEFAULT 0, thumbnail TEXT, is_short INTEGER DEFAULT 0, timestamp INTEGER, video_data TEXT)`);
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
  } catch(e) { console.error("WavyDB Video Migration error: ", e); }
}

export async function saveVideoMetadata(videoData, analyticsData) {
  'use server';
  await initWavyDB();

  await client.execute({
    sql: "INSERT INTO wt_channels (username, avatar) VALUES (?, ?) ON CONFLICT(username) DO NOTHING",
    args: [videoData.channel, `https://api.dicebear.com/7.x/bottts/svg?seed=${videoData.channel}`]
  });

  await client.execute({
    sql: "INSERT INTO wt_videos (id, channel_id, title, description, playlist, thumbnail, is_short, duration, timestamp, video_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [videoData.id, videoData.channel, videoData.title, videoData.description, videoData.playlist, videoData.thumbnail || '', videoData.is_short ? 1 : 0, videoData.duration || 0, Date.now(), '']
  });
  
  return { success: true };
}

export async function getVideos(searchQuery = '') {
  await initWavyDB();
  let rs;
  // КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ ДЛЯ СКОРОСТИ: НЕ ЗАГРУЖАЕМ video_data ПРИ ОТКРЫТИИ ЛЕНТЫ! (Снижает загрузку с 10+ сек до <1 сек)
  const columns = "id, channel_id, title, description, playlist, likes, dislikes, views, duration, thumbnail, is_short, timestamp";
  
  if (searchQuery) {
    rs = await client.execute({ sql: `SELECT ${columns} FROM wt_videos WHERE title LIKE ? OR description LIKE ? ORDER BY timestamp DESC`, args: [`%${searchQuery}%`, `%${searchQuery}%`] });
  } else {
    rs = await client.execute(`SELECT ${columns} FROM wt_videos ORDER BY timestamp DESC`);
  }
  return toPlain(rs.rows).map(v => ({...v, channel: v.channel_id}));
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
  const countCheck = await client.execute({ sql: "SELECT subscribers FROM wt_channels WHERE username = ?", args: [channel] });
  return { isSubscribed: subCheck.rows.length > 0, subscribers: countCheck.rows[0]?.subscribers || 0 };
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