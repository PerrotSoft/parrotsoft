'use client';
import { useState, useMemo, useEffect } from 'react';
import AdBanner from '@/app/components/AdBanner';

export default function FullscreenInstaller() {
    const [theme, setTheme] = useState('dark');
    const [filter, setFilter] = useState('All');
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [config, setConfig] = useState({ edition: '', arch: '', format: '' });
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);

    // Счетчик кликов для регулирования частоты показов рекламы
    const [downloadClickCount, setDownloadClickCount] = useState(0);

    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const checkTheme = () => {
            const savedTheme = localStorage.getItem('p_theme_mode');
            if (savedTheme) setTheme(savedTheme);
        };

        checkTheme();

        // 'storage' — сработает, только если тему поменяли в ДРУГОЙ вкладке.
        const handleStorageChange = (e) => {
            if (e.key === 'p_theme_mode' && e.newValue) setTheme(e.newValue);
        };
        // 'parrot-theme-change' — кастомное событие, которое реально долетает
        // и в этой же вкладке (см. ClientInterface.js: changeThemeMode).
        const handleThemeEvent = (e) => {
            if (e.detail) setTheme(e.detail);
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('parrot-theme-change', handleThemeEvent);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('parrot-theme-change', handleThemeEvent);
        };
    }, []);

    const isLight = theme === 'light';

    const versions = [
        { id: 'posk_b31', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.3.1', icon: '🦜', tag: 'Beta', editions: ['Kernel'], archs: ['x64'], formats: ['ZIP'], filename: 'POSK-BETA_3.1.zip' },
        { id: 'posk_psdos_b1', cat: 'PS-DOS', name: 'PS-DOS (POSK Beta 1)', icon: '💾', tag: 'Beta', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'posk_ps_dos_beta1.img' },
        { id: 'so_posk_psdos_b1', cat: 'Source', name: 'Source Code POSK PS-DOS Beta 1', icon: '📂', tag: 'Beta', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'source_code_posk_ps_dos_beta1.zip' },
        { id: 'olds_all', cat: 'ParrotOS', name: 'ParrotOS Old Versions (All-in-One)', icon: '📦', tag: 'Archive', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'parrotos_olds_version.zip' },
        { id: 'source_old_universe', cat: 'Source', name: 'Source Code ParrotOS Old Universe', icon: '📂', tag: 'Archive', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'source_code_parrotos_old_univers.zip' },
    ];

    const filtered = useMemo(() => filter === 'All' ? versions : versions.filter(v => v.cat === filter), [filter, versions]);

    const onMouseDown = (e) => {
        if (e.target.closest('.panel-header')) {
            setIsDragging(true);
            const offsetX = e.clientX - pos.x;
            const offsetY = e.clientY - pos.y;
            const onMouseMove = (mE) => setPos({ x: mE.clientX - offsetX, y: mE.clientY - offsetY });
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                setIsDragging(false);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
    };

    const handleSelect = (v) => {
        setSelectedVersion(v);
        setConfig({ edition: v.editions[0], arch: v.archs[0], format: v.formats[0] });
        if (pos.x === 0 && pos.y === 0) setPos({ x: window.innerWidth / 2 - 170, y: 100 });
    };

    const handleDownload = async () => {
        if (!selectedVersion || isDownloading) return;

        // --- УПРАВЛЕНИЕ ЧАСТОТОЙ РЕКЛАМЫ ---
        // Открываем Smartlink только при каждом 3-м клике
        const nextCount = downloadClickCount + 1;
        setDownloadClickCount(nextCount);

        if (nextCount % 3 === 0) {
            window.open('https://www.effectivecpmnetwork.com/b4ct0i7z?key=05f3579b3e9ba48f92e518e95783f1ed', '_blank');
        }
        // ------------------------------------

        setIsDownloading(true);
        setDownloadProgress(0);

        // 10-секундная эмуляция подготовки (10 000 мс)
        const duration = 10000;
        const intervalTime = 100; // обновление каждые 100 мс
        const step = 100 / (duration / intervalTime);

        await new Promise((resolve) => {
            let currentProgress = 0;
            const timer = setInterval(() => {
                currentProgress += step;
                if (currentProgress >= 100) {
                    setDownloadProgress(100);
                    clearInterval(timer);
                    resolve();
                } else {
                    setDownloadProgress(currentProgress);
                }
            }, intervalTime);
        });

        // Старт реальной загрузки файла по истечении 10 секунд
        try {
            const filePath = `/dist/${selectedVersion.filename}`;
            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`File not found at path: ${filePath}`);

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = selectedVersion.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error("Path error:", error.message);
            alert('Deployment Error: Check that the file exists in public/dist and is named exactly ' + selectedVersion.filename);
        } finally {
            setTimeout(() => {
                setIsDownloading(false);
                setDownloadProgress(0);
            }, 1000);
        }
    };

    return (
        <div className={`os-installer-fullscreen ${isLight ? 'light' : 'dark'}`}>
            {/* Оставлен только ненавязчивый плавающий Socialbar */}
            <AdBanner type="socialbar" />

            <style>{`
                .os-installer-fullscreen {
                    width: 100vw;
                    height: 100vh;
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    transition: background 0.3s ease, color 0.3s ease;
                }
                .os-installer-fullscreen.dark {
                    background: radial-gradient(circle at 50% 10%, #0d1322 0%, #030712 100%);
                    color: #f3f4f6;
                }

                .os-installer-fullscreen.light {
                    background: radial-gradient(circle at 50% 10%, #ffffff 0%, #f1f5f9 100%);
                    color: #0f172a;
                }

                .top-nav {
                    height: 70px;
                    display: flex;
                    align-items: center;
                    padding: 0 40px;
                    gap: 12px;
                    transition: all 0.3s ease;
                }

                .dark .top-nav {
                    background: rgba(15, 23, 42, 0.75);
                    backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }

                .light .top-nav {
                    background: rgba(255, 255, 255, 0.85);
                    backdrop-filter: blur(12px);
                    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
                }

                .brand-title {
                    font-weight: 800;
                    font-size: 18px;
                    background: linear-gradient(135deg, #0284c7 0%, #6366f1 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    margin-right: 30px;
                    letter-spacing: -0.5px;
                }

                .nav-btn {
                    padding: 8px 18px;
                    border-radius: 12px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .dark .nav-btn { color: #94a3b8; }
                .light .nav-btn { color: #64748b; }

                .dark .nav-btn:hover { color: #f8fafc; background: rgba(255, 255, 255, 0.05); }
                .light .nav-btn:hover { color: #0f172a; background: rgba(0, 0, 0, 0.05); }

                .nav-btn.active {
                    color: #0284c7 !important;
                    background: rgba(2, 132, 199, 0.12) !important;
                    border: 1px solid rgba(2, 132, 199, 0.3);
                }

                .content-area {
                    flex: 1;
                    padding: 40px;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
                    gap: 24px;
                    overflow-y: auto;
                    position: relative;
                    align-content: start;
                }

                .version-card {
                    backdrop-filter: blur(8px);
                    border-radius: 20px;
                    padding: 32px 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    cursor: pointer;
                    position: relative;
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .dark .version-card {
                    background: rgba(15, 23, 42, 0.6);
                    border: 1px solid rgba(255, 255, 255, 0.06);
                }

                .light .version-card {
                    background: rgba(255, 255, 255, 0.7);
                    border: 1px solid rgba(0, 0, 0, 0.06);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.03);
                }

                .dark .version-card:hover {
                    transform: translateY(-4px);
                    border-color: rgba(56, 189, 248, 0.3);
                    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
                    background: rgba(30, 41, 59, 0.7);
                }

                .light .version-card:hover {
                    transform: translateY(-4px);
                    border-color: rgba(2, 132, 199, 0.4);
                    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.08);
                    background: #ffffff;
                }

                .version-card.selected {
                    border-color: #0284c7 !important;
                    background: rgba(2, 132, 199, 0.08) !important;
                }

                .card-icon {
                    font-size: 52px;
                    margin-bottom: 16px;
                }

                .card-name {
                    font-size: 14px;
                    text-align: center;
                    font-weight: 600;
                    line-height: 1.4;
                }

                .card-tag {
                    position: absolute;
                    top: 14px;
                    left: 14px;
                    font-size: 10px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    padding: 4px 8px;
                    border-radius: 6px;
                    background: rgba(2, 132, 199, 0.1);
                    color: #0284c7;
                    border: 1px solid rgba(2, 132, 199, 0.25);
                    font-weight: 700;
                }

                .floating-panel {
                    position: fixed;
                    width: 350px;
                    backdrop-filter: blur(16px);
                    border-radius: 20px;
                    z-index: 100;
                    overflow: hidden;
                    transition: background 0.3s, border-color 0.3s;
                }

                .dark .floating-panel {
                    background: rgba(15, 23, 42, 0.9);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.8);
                }

                .light .floating-panel {
                    background: rgba(255, 255, 255, 0.95);
                    border: 1px solid rgba(0, 0, 0, 0.12);
                    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.15);
                }

                .panel-header {
                    padding: 16px 20px;
                    cursor: move;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .dark .panel-header {
                    background: rgba(255, 255, 255, 0.03);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                }

                .light .panel-header {
                    background: rgba(0, 0, 0, 0.02);
                    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
                }

                .panel-title {
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 1px;
                    color: #0284c7;
                }

                .close-btn {
                    cursor: pointer;
                    color: #64748b;
                    transition: 0.2s;
                    font-size: 14px;
                }

                .close-btn:hover { color: #0284c7; }

                .panel-content {
                    padding: 24px;
                    display: flex;
                    flex-direction: column;
                    gap: 18px;
                }

                .config-item label {
                    font-size: 11px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                    margin-bottom: 8px;
                    display: block;
                    font-weight: 600;
                }

                .dark .config-item label { color: #94a3b8; }
                .light .config-item label { color: #64748b; }

                .config-item select {
                    width: 100%;
                    padding: 12px;
                    border-radius: 10px;
                    outline: none;
                    font-size: 13px;
                }

                .dark .config-item select {
                    background: #090d16;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #f8fafc;
                }

                .light .config-item select {
                    background: #f8fafc;
                    border: 1px solid rgba(0, 0, 0, 0.1);
                    color: #0f172a;
                }

                .install-btn {
                    width: 100%;
                    padding: 16px;
                    background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
                    border: none;
                    border-radius: 12px;
                    color: #fff;
                    font-weight: 700;
                    font-size: 13px;
                    letter-spacing: 0.5px;
                    cursor: pointer;
                    position: relative;
                    overflow: hidden;
                    transition: all 0.3s;
                    box-shadow: 0 4px 20px rgba(37, 99, 235, 0.35);
                }

                .install-btn:not(:disabled):hover {
                    box-shadow: 0 6px 24px rgba(2, 132, 199, 0.5);
                    transform: translateY(-1px);
                }

                .progress-bar {
                    position: absolute;
                    left: 0;
                    top: 0;
                    height: 100%;
                    background: linear-gradient(90deg, #38bdf8, #818cf8);
                    transition: width 0.15s ease-out;
                    z-index: 0;
                }

                .btn-text {
                    position: relative;
                    z-index: 1;
                }
            `}</style>

            <header className="top-nav">
                <div className="brand-title">ParrotOS Installer</div>
                {['All', 'ParrotOS', 'PS-DOS', 'Kernel', 'Source'].map(cat => (
                    <div 
                        key={cat} 
                        className={`nav-btn ${filter === cat ? 'active' : ''}`} 
                        onClick={() => { setFilter(cat); setSelectedVersion(null); }}
                    >
                        {cat}
                    </div>
                ))}
            </header>

            <main className="content-area">
                <div style={{ gridColumn: '1 / -1', width: '100%', display: 'flex', justifyContent: 'center', marginBottom: '10px' }}>
                    <AdBanner type="728x90" />
                </div>

                {filtered.map(v => (
                    <div 
                        key={v.id} 
                        className={`version-card ${selectedVersion?.id === v.id ? 'selected' : ''}`} 
                        onClick={() => handleSelect(v)}
                    >
                        <span className="card-tag">{v.tag}</span>
                        <div className="card-icon">{v.icon}</div>
                        <div className="card-name">{v.name}</div>
                    </div>
                ))}

                {selectedVersion && (
                    <div 
                        className="floating-panel" 
                        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} 
                        onMouseDown={onMouseDown}
                    >
                        <div className="panel-header">
                            <span className="panel-title">DEPLOYMENT CONFIG</span>
                            <span className="close-btn" onClick={() => setSelectedVersion(null)}>✕</span>
                        </div>
                        <div className="panel-content">
                            <AdBanner type="300x250" />

                            <div className="config-item">
                                <label>Target Architecture</label>
                                <select value={config.arch} onChange={e => setConfig({...config, arch: e.target.value})}>
                                    {selectedVersion.archs.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                            </div>
                            <div className="config-item">
                                <label>Format</label>
                                <select disabled><option>{config.format}</option></select>
                            </div>
                            
                            {/* Кнопка запускає скачування з 10-секундною анімацією */}
                            <button className="install-btn" onClick={handleDownload} disabled={isDownloading}>
                                {isDownloading && <div className="progress-bar" style={{ width: `${downloadProgress}%` }} />}
                                <span className="btn-text">
                                    {isDownloading 
                                        ? (downloadProgress < 100 ? `PREPARING SYSTEM... ${Math.round(downloadProgress)}%` : 'STARTING DOWNLOAD...') 
                                        : 'START DOWNLOAD'
                                    }
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}