'use client';
import { useState, useMemo, useRef } from 'react';

export default function FullscreenInstaller() {
    const [filter, setFilter] = useState('All');
    const [selectedVersion, setSelectedVersion] = useState(null);
    const [config, setConfig] = useState({ edition: '', arch: '', format: '' });
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);

    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);

    const versions = [
        { id: 'k_v1', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.0.2', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'parrotos_kernel_posk_v0.0.2_kernel_x64.img' },
        { id: 'k_v2', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.0.3', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'parrotos_kernel_posk_v0.0.3_kernel_x64.img' },
        { id: 'k_v3', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.0.4', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'parrotos_kernel_posk_v0.0.4_kernel_x64.img' },
        { id: 'k_v4', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.1.0', icon: '🦜', tag: 'Beta', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'parrotos_kernel_posk_v0.1.0_kernel_x64.img' },
        //{ id: 'k_v5', cat: 'Kernel', name: 'ParrotOS Kernel (POSK) v0.2.0', icon: '🦜', tag: 'Beta', editions: ['Kernel'], archs: ['x64', 'x32'], formats: ['IMG'], filename: 'parrotos_kernel_posk_v0.2.0_kernel_x64.img' },
        { id: 'po_v2', cat: 'ParrotOS', name: 'PS-DOS BIOS v0.0.1', icon: '🦜', tag: 'Alpha', editions: ['Desktop'], archs: ['x32'], formats: ['ISO'], filename: 'psdos_bios_v0.0.1_desktop_x32.iso' },
        { id: 'so_v2', cat: 'Source', name: 'Source Code POSK v0.0.4', icon: '📂', tag: 'Alpha', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'source_posk_v0.0.4_full.zip' },
        { id: 'so_v2', cat: 'Source', name: 'Source Code PS-DOS BIOS v0.0.1', icon: '📂', tag: 'Alpha', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'source_psdos_bios_v0.0.1_full.zip' },
        { id: 'so_v1', cat: 'Source', name: 'Source Code ParrotOS BIOS v0.0.1', icon: '📂', tag: 'Alpha', editions: ['Full'], archs: ['Universal'], formats: ['ZIP'], filename: 'source_parrotos_bios_v0.0.1_full.zip' },
        { id: 'po_v1', cat: 'PS-DOS', name: 'ParrotOS BIOS v0.0.1', icon: '🦜', tag: 'Alpha', editions: ['Desktop'], archs: ['x32'], formats: ['ISO'], filename: 'parrotos_bios_v0.0.1_desktop_x32.iso' },
        { id: 'psd_v1', cat: 'PS-DOS', name: 'PS-DOS v0.0.2', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'psdos_v0.0.2_kernel_x64.img' },
        { id: 'psd_v2', cat: 'PS-DOS', name: 'PS-DOS v0.0.3', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'psdos_v0.0.3_kernel_x64.img' },
        { id: 'psd_v3', cat: 'PS-DOS', name: 'PS-DOS v0.0.4', icon: '🦜', tag: 'Alpha', editions: ['Kernel'], archs: ['x64'], formats: ['IMG'], filename: 'psdos_v0.0.4_kernel_x64.img' },
    ];

    const filtered = useMemo(() => filter === 'All' ? versions : versions.filter(v => v.cat === filter), [filter]);

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
        if (pos.x === 0 && pos.y === 0) setPos({ x: window.innerWidth / 2 - 160, y: 150 });
    };

    const handleDownload = async () => {
        if (!selectedVersion) return;
        setIsDownloading(true);
        setDownloadProgress(0);

        try {
            const filePath = `/dist/${selectedVersion.filename}`;

            const response = await fetch(filePath);
            if (!response.ok) throw new Error(`File not found at path: ${filePath}`);

            const total = response.headers.get('content-length');
            const reader = response.body.getReader();
            const chunks = [];
            let loaded = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (total) setDownloadProgress((loaded / parseInt(total)) * 100);
            }

            const blob = new Blob(chunks);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = selectedVersion.filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            setTimeout(() => {
                setIsDownloading(false);
                setDownloadProgress(0);
            }, 1000);
        } catch (error) {
            console.error("Path error:", error.message);
            alert('Deployment Error: Check that the file exists in public/dist and is named exactly ' + selectedVersion.filename);
            setIsDownloading(false);
        }
    };

    return (
        <div className="os-installer-fullscreen">
            <style>{`
                .os-installer-fullscreen { width: 100vw; height: 100vh; background: #000; color: #fff; font-family: 'Inter', sans-serif; display: flex; flex-direction: column; overflow: hidden; }
                .top-nav { height: 60px; background: #0a0a0a; border-bottom: 1px solid #222; display: flex; align-items: center; padding: 0 30px; gap: 15px; }
                .nav-btn { padding: 8px 18px; border-radius: 20px; font-size: 13px; cursor: pointer; color: #666; transition: 0.3s; }
                .nav-btn.active { color: #fff; background: #0070f3; }
                
                .content-area { flex: 1; padding: 40px; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 20px; overflow-y: auto; position: relative; }
                
                .version-card { background: #0d0d0d; border: 1px solid #1a1a1a; border-radius: 16px; padding: 30px; display: flex; flex-direction: column; align-items: center; cursor: pointer; position: relative; }
                .version-card.selected { border-color: #0070f3; background: #111; }
                .card-icon { font-size: 48px; margin-bottom: 10px; }
                .card-name { font-size: 13px; text-align: center; font-weight: 600; }
                .card-tag { position: absolute; top: 10px; left: 10px; font-size: 9px; color: #0070f3; font-weight: bold; }

                .floating-panel { position: absolute; width: 320px; background: #111; border: 1px solid #333; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.8); z-index: 100; }
                .panel-header { background: #1a1a1a; padding: 15px; cursor: move; display: flex; justify-content: space-between; border-radius: 16px 16px 0 0; }
                .panel-content { padding: 20px; display: flex; flex-direction: column; gap: 15px; }
                
                .config-item label { font-size: 10px; color: #555; text-transform: uppercase; margin-bottom: 5px; display: block; }
                .config-item select { width: 100%; background: #050505; border: 1px solid #222; color: #fff; padding: 10px; border-radius: 8px; }

                .install-btn { 
                    width: 100%; padding: 14px; background: #222; border: 1px solid #333; border-radius: 8px; color: #fff; font-weight: 800; cursor: pointer; 
                    position: relative; overflow: hidden; transition: 0.3s;
                }
                .install-btn:not(:disabled):hover { border-color: #0070f3; color: #0070f3; }
                
                .progress-bar { 
                    position: absolute; left: 0; top: 0; height: 100%; background: rgba(0, 112, 243, 0.3); 
                    transition: width 0.1s ease-out; z-index: 0;
                }
                .btn-text { position: relative; z-index: 1; }
            `}</style>

            <header className="top-nav">
                <div style={{ fontWeight: 900, color: '#0070f3', marginRight: '20px' }}>ParrotOS Installer</div>
                {['All', 'ParrotOS', 'PS-DOS', 'Kernel', 'Source'].map(cat => (
                    <div key={cat} className={`nav-btn ${filter === cat ? 'active' : ''}`} onClick={() => { setFilter(cat); setSelectedVersion(null); }}>{cat}</div>
                ))}
            </header>

            <main className="content-area">
                {filtered.map(v => (
                    <div key={v.id} className={`version-card ${selectedVersion?.id === v.id ? 'selected' : ''}`} onClick={() => handleSelect(v)}>
                        <span className="card-tag">{v.tag}</span>
                        <div className="card-icon">{v.icon}</div>
                        <div className="card-name">{v.name}</div>
                    </div>
                ))}

                {selectedVersion && (
                    <div className="floating-panel" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }} onMouseDown={onMouseDown}>
                        <div className="panel-header">
                            <span style={{ fontSize: '11px', fontWeight: 800 }}>DEPLOYMENT CONFIG</span>
                            <span style={{ cursor: 'pointer' }} onClick={() => setSelectedVersion(null)}>✕</span>
                        </div>
                        <div className="panel-content">
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
                            
                            <button className="install-btn" onClick={handleDownload} disabled={isDownloading}>
                                {isDownloading && <div className="progress-bar" style={{ width: `${downloadProgress}%` }} />}
                                <span className="btn-text">
                                    {isDownloading ? `INSTALLING ${Math.round(downloadProgress)}%` : 'START INSTALLATION'}
                                </span>
                            </button>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}