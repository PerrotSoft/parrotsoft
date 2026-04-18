'use client';
import { useState } from 'react';
import * as actions from '@/app/actions'; // Импортируем твои защищенные функции

export default function AdminPage() {
    const [logs, setLogs] = useState(["System Ready..."]);
    const [targetUser, setTargetUser] = useState("");

    const addLog = (msg) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);

    // Функция Инициализации (Регистрация всех таблиц с нуля)
    const handleInit = async () => {
        const res = await actions.setupSystemDatabases('testoviy_account_2.2');
        addLog(res.success ? "✅ ТАБЛИЦЫ СОЗДАНЫ И ЗАРЕГИСТРИРОВАНЫ" : "❌ ОШИБКА РЕГИСТРАЦИИ");
    };

    // Функция Бэкапа (Скачивание всей базы в JSON)
    const handleBackup = async () => {
        addLog("⏳ Подготовка бэкапа...");
        const json = await actions.generateFullBackup('testoviy_account_2.2');
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ParrotOS_FullBackup_${Date.now()}.json`;
        a.click();
        addLog("💾 ФАЙЛ БЭКАПА СКАЧАН");
    };

    return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#00ff00', padding: '40px', fontFamily: 'monospace' }}>
            <h1 style={{ borderBottom: '2px solid #00ff00', textShadow: '0 0 10px #00ff00' }}>
                🦜 PARROT CORE ADMINISTRATION v2.2
            </h1>

            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '30px', marginTop: '30px' }}>
                
                {/* Левая колонка: Кнопки управления */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div style={{ border: '1px solid #00ff00', padding: '15px' }}>
                        <h3 style={{ color: '#fff' }}>DATABASE</h3>
                        <button onClick={handleInit} style={btnStyle("#00ff00")}>REGISTER ALL TABLES</button>
                        <button onClick={handleBackup} style={btnStyle("#00ff00")}>DOWNLOAD FULL BACKUP</button>
                    </div>

                    <div style={{ border: '1px solid #ff0000', padding: '15px' }}>
                        <h3 style={{ color: '#ff0000' }}>MODERATION</h3>
                        <input 
                            placeholder="Username..." 
                            style={inputStyle} 
                            onChange={(e) => setTargetUser(e.target.value)}
                        />
                        <button onClick={() => actions.adminModifyUser(targetUser, 'ban')} style={btnStyle("#ff0000")}>BAN USER</button>
                        <button onClick={() => actions.adminModifyUser(targetUser, 'strike')} style={btnStyle("#ffa500")}>GIVE STRIKE</button>
                    </div>
                </div>

                {/* Правая колонка: Терминал */}
                <div style={{ background: '#000', border: '1px solid #333', padding: '20px', height: '500px', overflowY: 'auto', boxShadow: 'inset 0 0 20px #00ff0022' }}>
                    <h4 style={{ color: '#555', marginTop: 0 }}>SERVER LOGS</h4>
                    {logs.map((log, i) => (
                        <div key={i} style={{ marginBottom: '5px', color: log.includes('✅') ? '#0f0' : '#888' }}>
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Стилизация (inline чтобы не плодить CSS файлы)
const btnStyle = (color) => ({
    width: '100%', padding: '10px', marginBottom: '10px', background: 'transparent',
    border: `1px solid ${color}`, color: color, cursor: 'pointer', fontWeight: 'bold',
    transition: '0.3s'
});

const inputStyle = {
    width: '90%', padding: '10px', background: '#111', border: '1px solid #333',
    color: '#0f0', marginBottom: '10px', outline: 'none'
};