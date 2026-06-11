import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(request, { params }) {
  try {
    const { username } = await params;
    
    const rs = await client.execute({
      sql: "SELECT data FROM users WHERE username = ?",
      args: [String(username)]
    });

    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`;

    if (rs.rows.length === 0 || !rs.rows[0].data) {
      return NextResponse.redirect(defaultAvatar);
    }

    const userData = JSON.parse(rs.rows[0].data);
    
    if (userData.avatar && userData.avatar.startsWith('data:image')) {
      const parts = userData.avatar.split(',');
      const mime = parts[0].split(';')[0].split(':')[1];
      const buffer = Buffer.from(parts[1], 'base64');
      
      return new Response(buffer, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' }
      });
    }

    return NextResponse.redirect(userData.avatar || defaultAvatar);
  } catch (e) {
    return new Response("Error loading avatar", { status: 500 });
  }
}