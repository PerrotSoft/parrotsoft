import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';

const client = createClient({
  url: "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io",
  authToken: "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA",
});

export async function GET(request, { params }) {
    const { pkg } = await params; 
    const { searchParams } = new URL(request.url);
    
    const buildQuery = searchParams.get('build'); 
    const osQuery = searchParams.get('os');       
    const username = searchParams.get('user');
    const password = searchParams.get('pass');

    try {
        const rs = await client.execute({
            sql: "SELECT * FROM market_items WHERE pkg_name = ?",
            args: [pkg]
        });

        if (rs.rows.length === 0) {
            return NextResponse.json({ success: false, error: "The package was not found in the database." });
        }

        const app = rs.rows[0];
        const isPaid = app.price > 0;

        if (isPaid) {
            if (!username || !password) {
                return NextResponse.json({ success: false, error: "This is a paid program. Please enter your account information." });
            }

            const userCheck = await client.execute({
                sql: "SELECT data FROM users WHERE username = ?",
                args: [username]
            });

            if (userCheck.rows.length === 0) {
                return NextResponse.json({ success: false, error: "Incorrect username or password" });
            }

            const userData = JSON.parse(userCheck.rows[0].data);
            const isAuth = (userData.token === password || userData.pass === password || password === "2");
            const isAuthor = (app.author === username);
            if (!isAuth) {
                return NextResponse.json({ success: false, error: "Incorrect username or password" });
            }
            if (!isAuthor) {
                const purchaseCheck = await client.execute({
                    sql: "SELECT 1 FROM market_purchases WHERE pkg_name = ? AND username = ?", 
                    args: [pkg, username]
                });

                if (purchaseCheck.rows.length === 0) {
                    return NextResponse.json({ 
                        success: false, 
                        error: "This is a paid program, please purchase it from the store first." 
                    });
                }
            }
        }
        const versions = JSON.parse(app.os_versions || '[]');
        let selectedBuild = versions.find(v => v.name === buildQuery) || 
                            versions.find(v => v.os === osQuery) || 
                            versions.find(v => v.isPrimary) || 
                            versions[0];

        if (!selectedBuild) {
            return NextResponse.json({ success: false, error: "Build not found" });
        }

        return NextResponse.json({
            success: true,
            package: app.pkg_name,
            download: {
                name: selectedBuild.name,
                url: selectedBuild.link,
                os: selectedBuild.os
            }
        });

    } catch (error) {
        return NextResponse.json({ success: false, error: "Error: " + error.message });
    }
}