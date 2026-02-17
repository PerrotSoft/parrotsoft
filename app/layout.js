import fs from 'fs';
import path from 'path';
import './globals.css';
import ClientInterface from './ClientInterface';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

function initDB() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(DB_PATH) || fs.readFileSync(DB_PATH, 'utf8').trim() === "") {
        fs.writeFileSync(DB_PATH, JSON.stringify({ users: {} }, null, 2));
    }
}

async function getDB() {
    initDB();
    try {
        const content = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(content || '{"users":{}}');
    } catch (e) { return { users: {} }; }
}

async function syncToDB(username, data) {
    'use server';
    initDB();
    let db;
    try {
        const content = fs.readFileSync(DB_PATH, 'utf8');
        db = JSON.parse(content || '{"users":{}}');
    } catch (e) { db = { users: {} }; }
    db.users[username] = data;
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return { success: true };
}

export default async function RootLayout({ children }) {
    const db = await getDB();
    return (
        <html lang="en">
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0"/>
            </head>
            <body>
                <ClientInterface serverDB={db.users} onSync={syncToDB}>
                    {children}
                </ClientInterface>
            </body>
        </html>
    );
}