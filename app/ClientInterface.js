'use client';
import { useState, useEffect } from 'react';

export default function ClientInterface({ children, serverDB, onSync, dbActions }) {
    const [user, setUser] = useState(null);
    const [isAuth, setIsAuth] = useState(false);
    const [loading, setLoading] = useState(true);
    const [launcherOpen, setLauncherOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [view, setView] = useState('main');
    const [draggedIdx, setDraggedIdx] = useState(null);
    const [authMode, setAuthMode] = useState('login');
    const [form, setForm] = useState({ username: '', pass: '' });
    const [newApp, setNewApp] = useState({ name: '', icon: '🌐', url: '' });
    const [editForm, setEditForm] = useState({ pass: '', avatar: '' });

    const cryptoAction = (key, input, mode = 'enc') => {
        try {
            if (mode === 'enc') {
                const str = JSON.stringify(input);
                const result = str.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join('');
                return btoa(unescape(encodeURIComponent(result)));
            } else {
                const decoded = decodeURIComponent(escape(atob(input)));
                const result = decoded.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join('');
                return JSON.parse(result);
            }
        } catch (e) { return null; }
    };

    const generateKey = async (password) => {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    useEffect(() => {
        if (typeof window !== 'undefined' && dbActions) {
            window.syncDrive = dbActions.syncDrive;
            window.getUserFiles = dbActions.getUserFiles;
            window.cryptoAction = cryptoAction;
        }
    }, [dbActions]);

    useEffect(() => {
        const init = async () => {
            const savedName = localStorage.getItem('p_user');
            const savedToken = localStorage.getItem('p_token');

            if (savedName && savedToken && serverDB[savedName]) {
                const entry = serverDB[savedName];
                let rawData = entry.data || entry;

                try {
                    const parsed = JSON.parse(rawData);
                    if (parsed.os) rawData = parsed.os;
                } catch (e) {}

                const data = cryptoAction(savedToken, rawData, 'dec');
                if (data) {
                    setUser({ ...data, username: savedName, token: savedToken });
                    setIsAuth(true);
                } else {
                    localStorage.clear();
                }
            }
            setLoading(false);
        };
        init();
    }, [serverDB]);

    const handleAuth = async (e) => {
        e.preventDefault();
        const token = await generateKey(form.pass);
        const name = form.username.trim();

        if (authMode === 'register') {
            if (serverDB[name]) return alert("Username taken!");
            const newUser = {
                balance: 1000,
                apps: [
                    { id: '1', name: 'Search', icon: '🔍', url: '/' },
                    { id: '2', name: 'Settings', icon: '⚙️', url: 'sys:settings' },
                    { id: '3', name: 'Drive', icon: '☁️', url: '/drive' }
                ],
                avatar: ""
            };
            await onSync(name, cryptoAction(token, newUser, 'enc'));
            complete(name, token, newUser);
        } else {
            const entry = serverDB[name];
            if (!entry) return alert("User not found!");
            let rawData = entry.data || entry;
            try {
                const parsed = JSON.parse(rawData);
                if (parsed.os) rawData = parsed.os;
            } catch (e) {}
            const data = cryptoAction(token, rawData, 'dec');
            if (data) complete(name, token, data);
            else alert("Wrong password!");
        }
    };

    const complete = (n, t, d) => {
        localStorage.setItem('p_user', n);
        localStorage.setItem('p_token', t);
        setUser({ ...d, username: n, token: t });
        setIsAuth(true);
    };

    const sync = async (updated) => {
        const { username, token, ...pure } = updated;
        await onSync(username, cryptoAction(token, pure, 'enc'));
        setUser(updated);
    };
    if (loading) return (
        <div className="parrot-loader">
            <style>{`
                .parrot-loader {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    color: var(--text);
                    font-family: 'Segoe UI Variable Text', sans-serif;
                    overflow: hidden;
                }

                .loader-box {
                    position: relative;
                    width: 120px;
                    height: 120px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .logo-p {
                    font-size: 60px;
                    font-weight: 800;
                    z-index: 2;
                }

                .ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border: 3px solid rgba(255, 255, 255, 0.1);
                    border-radius: 50%;
                }

                .ring-active {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border: 3px solid transparent;
                    border-top: 3px solid #fff;
                    border-radius: 50%;
                    animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                }

                .loader-text {
                    margin-top: 40px;
                    text-align: center;
                }

                .os-title {
                    font-size: 18px;
                    font-weight: 600;
                    letter-spacing: 4px;
                    text-transform: uppercase;
                    margin-bottom: 10px;
                }

                .loading-dots {
                    font-size: 12px;
                    opacity: 0.5;
                    font-weight: 400;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>

            <div className="loader-box">
                <div className="ring"></div>
                <div className="ring-active"></div>
                <div className="logo-p">P</div>
            </div>

            <div className="loader-text">
                <div className="os-title">Parrot Soft</div>
                <div className="loading-dots">Starting system...</div>
            </div>
        </div>
    );

    if (!isAuth) return (
        <div className="auth-page" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: "url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop') center/cover" }}>
            <div className="block-v1 animate-in" style={{ width: '100%', maxWidth: '350px', padding: '40px', borderRadius: '30px', textAlign: 'center', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="logo-sq" style={{ background: 'var(--accent)', width: '50px', height: '50px', borderRadius: '12px', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>P</div>
                <h2 style={{ marginBottom: '25px' }}>{authMode === 'login' ? 'Login' : 'Create Account'}</h2>
                <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <input className="inp-v1" placeholder="Username" required onChange={e => setForm({...form, username: e.target.value})} style={{ background: 'rgba(255,255,255,0.05)', color: 'black' }} />
                    <input className="inp-v1" type="password" placeholder="Password" required onChange={e => setForm({...form, pass: e.target.value})} style={{ background: 'rgba(255,255,255,0.05)', color: 'black' }} />
                    <button type="submit" className="btn-v4" style={{ marginTop: '10px' }}>Sign In</button>
                </form>
                <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.5, cursor: 'pointer', textDecoration: 'underline', color: 'black' }} onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
                    {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </p>
            </div>
        </div>
    );

    return (
        <div className="os-root">
            <style>{`
                .splash { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #000; }
                .splash-logo { width: 80px; height: 80px; background: var(--accent); border-radius: 22px; display: flex; align-items: center; justify-content: center; font-size: 42px; font-weight: 900; color: white; animation: pulse 2s infinite; }
                @keyframes loading { 0% { width: 0%; left: 0%; } 50% { width: 100%; left: 0%; } 100% { width: 0%; left: 100%; } }
                @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } }
                .island-nav { position: fixed; top: 15px; right: 15px; z-index: 1000; display: flex; align-items: center; gap: 12px; padding: 6px 15px; border-radius: 50px; }
                .launcher-grid { position: fixed; top: 75px; right: 15px; width: 300px; padding: 25px; border-radius: 25px; z-index: 999; }
                .app-card { display: flex; flex-direction: column; align-items: center; gap: 5px; position: relative; }
                .del-app { position: absolute; top: -5px; right: 5px; background: #ff4d4d; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; cursor: pointer; opacity: 0; transition: 0.2s; z-index: 10; }
                .app-card:hover .del-app { opacity: 1; }
                .animate-in { animation: slideUp 0.4s cubic-bezier(0, 0.55, 0.45, 1); }
                @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>

            <header className="island-nav block-v1" style={{ border: '1px solid var(--border-light)' }}>
                <div className="user-av" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', cursor: 'pointer', overflow: 'hidden' }} onClick={() => setView('settings')}>
                    {user.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.username[0].toUpperCase()}
                </div>
                <div style={{ lineHeight: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>{user.username}</div>
                    <div style={{ fontSize: 10, opacity: 0.5 }}>{user.balance} pc</div>
                </div>
                <button className="btn-v6" style={{ fontSize: 22 }} onClick={() => setLauncherOpen(!launcherOpen)}>⠿</button>
            </header>

            {launcherOpen && (
                <div className="block-v1 launcher-grid animate-in" style={{ border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-elevated)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                        {user.apps.map((app, i) => (
                            <div key={app.id} className="app-card" draggable onDragStart={() => setDraggedIdx(i)} onDragOver={e => e.preventDefault()} onDrop={() => onDrop(i)}>
                                <button className="del-app" onClick={(e) => { e.stopPropagation(); sync({...user, apps: user.apps.filter(a => a.id !== app.id)}); }}>×</button>
                                <div className="app-icon" style={{ width: 60, height: 60, background: 'white', borderRadius: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 26, boxShadow: 'var(--shadow-flat)', cursor: 'pointer' }} onClick={() => {
                                    if(app.url === 'sys:settings') setView('settings');
                                    else window.location.href = app.url;
                                    setLauncherOpen(false);
                                }}>{app.icon}</div>
                                <span style={{ fontSize: 10, fontWeight: 600 }}>{app.name}</span>
                            </div>
                        ))}
                    </div>
                    <button className="btn-v4" style={{ width: '100%', marginTop: 20, borderRadius: 12 }} onClick={() => { setModalOpen(true); setLauncherOpen(false); }}>+ Shortcut</button>
                </div>
            )}

            {modalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="block-v1 animate-in" style={{ width: 320, padding: 30, borderRadius: 30 }}>
                        <h3>New Item</h3>
                        <input className="inp-v1" placeholder="Name" value={newApp.name} onChange={e => setNewApp({...newApp, name: e.target.value})} style={{ marginBottom: 10 }} />
                        <input className="inp-v1" placeholder="URL" value={newApp.url} onChange={e => setNewApp({...newApp, url: e.target.value})} style={{ marginBottom: 15 }} />
                        <div style={{ display: 'flex', gap: 10, marginBottom: 20, justifyContent: 'center', fontSize: 24 }}>
                            {['🏠','🌐', '🧪', '📂', '🎮'].map(i => (
                                <span key={i} onClick={() => setNewApp({...newApp, icon: i})} style={{ cursor: 'pointer', opacity: newApp.icon === i ? 1 : 0.3 }}>{i}</span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button className="btn-v4" style={{ flex: 1 }} onClick={() => {
                                if(!newApp.name || !newApp.url) return;
                                sync({...user, apps: [...user.apps, {...newApp, id: Date.now().toString()}]});
                                setModalOpen(false);
                            }}>Create</button>
                            <button className="btn-v5" style={{ flex: 1 }} onClick={() => setModalOpen(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {view === 'settings' && (
                <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="block-v1 animate-in" style={{ width: '100%', maxWidth: 400, padding: 40, borderRadius: 35, textAlign: 'center' }}>
                        <h2>Settings</h2>
                        <div className="user-av" style={{ width: 80, height: 80, margin: '0 auto 20px', fontSize: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', overflow: 'hidden' }}>
                            {user.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.username[0].toUpperCase()}
                        </div>
                        <input className="inp-v1" placeholder="Avatar URL" value={editForm.avatar} onChange={e => setEditForm({...editForm, avatar: e.target.value})} style={{ marginBottom: 15 }} />
                        <input className="inp-v1" type="password" placeholder="New Password" onChange={e => setEditForm({...editForm, pass: e.target.value})} style={{ marginBottom: 20 }} />
                        <button className="btn-v4" style={{ width: '100%', marginBottom: 10 }} onClick={async () => {
                            let updated = { ...user, avatar: editForm.avatar || user.avatar };
                            if (editForm.pass) {
                                updated.token = await generateKey(editForm.pass);
                                localStorage.setItem('p_token', updated.token);
                            }
                            await sync(updated);
                            setView('main');
                        }}>Save</button>
                        <button className="btn-v5" style={{ width: '100%', color: 'red', marginBottom: 10 }} onClick={() => { localStorage.clear(); window.location.reload(); }}>Logout</button>
                        <button className="btn-v1" style={{ width: '100%' }} onClick={() => setView('main')}>Back</button>
                    </div>
                </div>
            )}

            <main style={{ filter: (launcherOpen || modalOpen) ? 'blur(10px)' : 'none', transition: '0.4s', paddingTop: 80 }}>
                {children}
            </main>
        </div>
    );
}