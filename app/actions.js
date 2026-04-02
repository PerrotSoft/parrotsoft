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
async function getRawUserData(username) {
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