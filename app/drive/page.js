'use client';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
import { useState, useEffect, useCallback, useRef } from 'react';
import { zipSync, unzipSync } from 'fflate';

export default function ParrotDrive() {
    const [drive, setDrive] = useState({ files: [], folders: [] });
    const [currentPath, setCurrentPath] = useState(null);
    const [user, setUser] = useState(null);
    const [preview, setPreview] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [search, setSearch] = useState('');
    const [editor, setEditor] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [dragOverId, setDragOverId] = useState(null);

    const refresh = useCallback(async (u) => {
        if (window.getUserFiles) {
            const data = await window.getUserFiles(u || user);
            if (data) setDrive({ files: data.files || [], folders: data.folders || [] });
        }
    }, [user]);
    const renderRaw = async (file) => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem('p_token');
        try {
            let rawData;
            // Декодирование (ваша текущая логика fflate + crypt)
            const decrypted = file.access === 'private' ? crypt(file.data, token) : new Uint8Array(file.data);
            const unzipped = unzipSync(decrypted);
            rawData = unzipped[Object.keys(unzipped)[0]];

            const isImg = file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i);
            const blob = new Blob([rawData], { type: isImg ? 'image/png' : 'text/html' });
            const url = URL.createObjectURL(blob);

            // Если это raw-запрос, перенаправляем браузер на blob или заменяем body
            window.location.replace(url); 
        } catch (e) {
            document.body.innerHTML = "Access Denied / Error";
        }
    };
    useEffect(() => {
        if (typeof window === "undefined") return;
            const u = localStorage.getItem('p_user');
        if (u) {
            setUser(u);
            refresh(u).then(() => {
                const params = new URLSearchParams(window.location.search);
                const fileId = params.get('file');
                const isRaw = params.get('raw') === 'true'; // Проверяем флаг raw

                if (fileId) {
                    window.getUserFiles(u).then(d => {
                        const f = (d?.files || []).find(x => x.id == fileId);
                        if (f) {
                            
                                renderRaw(f); // Вызываем функцию прямого вывода
                            
                        }
                    });
                }
            });
        }
    }, [refresh]);

    const crypt = (data, token) => {
        const uint8 = new Uint8Array(data);
        const t = token || "default";
        return uint8.map((b, i) => b ^ t.charCodeAt(i % t.length));
    };

    const save = async (newData) => {
        setDrive(newData);
        if (window.syncDrive) await window.syncDrive(user, newData);
    };

    const handleView = async (file) => {
        if (typeof window === "undefined") return;
            const token = localStorage.getItem('p_token');
        try {
            let raw;
            const access = file.access || 'private';
            if (access === 'private') {
                const decrypted = crypt(file.data, token);
                const unzipped = unzipSync(decrypted);
                raw = unzipped[Object.keys(unzipped)[0]];
            } else {
                const unzipped = unzipSync(new Uint8Array(file.data));
                raw = unzipped[Object.keys(unzipped)[0]];
            }
            const isImg = file.name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i);
            const blob = new Blob([raw], { type: isImg ? 'image/generic' : (file.name.endsWith('.html') ? 'text/html' : 'text/plain') });
            const url = URL.createObjectURL(blob);
            setPreview({ url, name: file.name, id: file.id, isHtml: file.name.endsWith('.html'), isImg });
        } catch (e) { alert("Ошибка доступа или неверный ключ"); }
    };

    const onDragStart = (e, id, isFolder) => {
        e.dataTransfer.setData("itemId", id);
        e.dataTransfer.setData("isFolder", isFolder);
    };

    const onDrop = async (e, targetId) => {
        e.preventDefault();
        setDragOverId(null);
        const itemId = Number(e.dataTransfer.getData("itemId"));
        const isFolder = e.dataTransfer.getData("isFolder") === "true";
        if (itemId === targetId) return;

        const nd = { ...drive };
        if (isFolder) {
            nd.folders = (nd.folders || []).map(f => f.id === itemId ? { ...f, parentId: targetId } : f);
        } else {
            nd.files = (nd.files || []).map(f => f.id === itemId ? { ...f, parentId: targetId } : f);
        }
        save(nd);
    };

    const handleContextMenu = (e, id, isFolder) => {
        e.preventDefault();
        setSelected(new Set([id]));
        setContextMenu({ x: e.pageX, y: e.pageY, id, isFolder });
    };

    const deleteItem = (id, isFolder) => {
        if (!confirm("Delete object?")) return;
        const nd = {
            folders: (drive?.folders || []).filter(f => f.id !== id),
            files: (drive?.files || []).filter(f => f.id !== id)
        };
        save(nd);
        setSelected(new Set());
    };

    const toggleAccess = (id) => {
        const nd = { ...drive };
        nd.files = (nd.files || []).map(f => {
            if (f.id === id) {
                const isPub = f.access === 'published';
                return { ...f, access: isPub ? 'private' : 'published' };
            }
            return f;
        });
        save(nd);
    };

    const renameItem = (id, isFolder) => {
        const item = isFolder ? (drive?.folders || []).find(f=>f.id===id) : (drive?.files || []).find(f=>f.id===id);
        if (!item) return;
        const name = prompt("New name:", item.name);
        if (!name) return;
        const nd = { ...drive };
        if (isFolder) nd.folders = (nd.folders || []).map(f => f.id === id ? { ...f, name } : f);
        else nd.files = (nd.files || []).map(f => f.id === id ? { ...f, name } : f);
        save(nd);
    };

    const getPathArr = () => {
        let path = [];
        let curr = currentPath;
        while (curr) {
            const f = (drive?.folders || []).find(x => x.id === curr);
            if (f) { path.unshift(f); curr = f.parentId; } else break;
        }
        return path;
    };

    const selectedItem = (drive?.files || []).find(f => selected.has(f.id)) || (drive?.folders || []).find(f => selected.has(f.id));

    return (
        <div className="p-drive">
            <header className="p-header">
                <div className="p-logo">Parrot<span> Drive</span></div>
                
                <div className="p-tools">
                    <button className="p-btn-new" onClick={() => setEditor("")}>📄 Create file</button>
                    <button className="p-btn-new" onClick={() => {
                        const n = prompt("New folder name:");
                        if(n) save({...drive, folders: [...(drive?.folders || []), {id: Date.now(), name: n, parentId: currentPath}]});
                    }}>📁 + New folder</button>
                    <label className="p-btn-up">
                        ☁️ Upload <input type="file" hidden onChange={async (e) => {
                            const f = e.target.files[0]; if(!f) return;
                            const buf = await f.arrayBuffer();
                            const token = localStorage.getItem('p_token');
                            const comp = zipSync({ [f.name]: new Uint8Array(buf) });
                            const encrypted = crypt(comp, token);
                            save({...drive, files: [...(drive?.files || []), {id: Date.now(), name: f.name, data: Array.from(encrypted), parentId: currentPath, access: 'private'}]});
                        }} />
                    </label>
                    <input className="p-search" placeholder="Searching for files..." onChange={e => setSearch(e.target.value)} />
                </div>
                        
                {selected.size === 1 && selectedItem && (
                    <div className="p-selection-tools">
                        <button onClick={() => selectedItem.data ? handleView(selectedItem) : setCurrentPath(selectedItem.id)}>👁️ View</button>
                        <button onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?file=${selectedItem.id}`);
                            alert("Link copied");
                        }}>🔗 Link</button>
                        <button onClick={() => renameItem(selectedItem.id, !selectedItem.data)}>✏️ Rename</button>
                        <button onClick={() => deleteItem(selectedItem.id, !selectedItem.data)} className="red">🗑️ Delete</button>
                    </div>
                )}
                
                
            </header>

            <nav className="p-breadcrumb">
                <span onClick={() => setCurrentPath(null)}>Мой диск</span>
                {getPathArr().map(p => (
                    <span key={p.id} onClick={() => setCurrentPath(p.id)}> / {p.name}</span>
                ))}
            </nav>

            <div className="p-main-content">
                <aside className="p-sidebar">
                    <div className={!currentPath ? 'active' : ''} onClick={() => setCurrentPath(null)}>🏠 Main</div>
                    <div onDragOver={e => e.preventDefault()} onDrop={e => onDrop(e, null)}>📥 Root (Here)</div>
                </aside>

                <main className="p-grid">
                    {(drive?.folders || []).filter(f => f.parentId === currentPath).map(f => (
                        <div key={f.id} 
                             className={`p-item ${selected.has(f.id) ? 'active' : ''} ${dragOverId === f.id ? 'drag' : ''}`}
                             draggable onDragStart={e => onDragStart(e, f.id, true)}
                             onDragOver={e => { e.preventDefault(); setDragOverId(f.id); }}
                             onDragLeave={() => setDragOverId(null)}
                             onDrop={e => onDrop(e, f.id)}
                             onClick={() => setSelected(new Set([f.id]))}
                             onContextMenu={e => handleContextMenu(e, f.id, true)}
                             onDoubleClick={() => setCurrentPath(f.id)}>
                            <div className="p-icon">📂</div>
                            <div className="p-name">{f.name}</div>
                        </div>
                    ))}

                    {(drive?.files || []).filter(f => search ? f.name.toLowerCase().includes(search.toLowerCase()) : f.parentId === currentPath).map(f => (
                        <div key={f.id} 
                             className={`p-item ${selected.has(f.id) ? 'active' : ''}`}
                             draggable onDragStart={e => onDragStart(e, f.id, false)}
                             onClick={() => setSelected(new Set([f.id]))}
                             onContextMenu={e => handleContextMenu(e, f.id, false)}
                             onDoubleClick={() => handleView(f)}>
                            <div className="p-icon">
                                {f.name.endsWith('.html') ? '🌐' : '📄'}
                                <div className={`p-badge ${f.access || 'private'}`}></div>
                            </div>
                            <div className="p-name">{f.name}</div>
                        </div>
                    ))}
                </main>
            </div>
            {contextMenu && (
                <div className="p-ctx" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    <button onClick={() => renameItem(contextMenu.id, contextMenu.isFolder)}>✏️ Rename</button>
                    {!contextMenu.isFolder && <button onClick={() => toggleAccess(contextMenu.id)}>🌐 Access (Toggle)</button>}
                    <button onClick={() => deleteItem(contextMenu.id, contextMenu.isFolder)} className="red">🗑️ Delete</button>
                </div>
            )}
            {editor !== null && (
                <div className="p-modal">
                    <div className="p-editor-box">
                        <div className="p-ed-header">Creating file <button onClick={() => setEditor(null)}>✕</button></div>
                        <input id="new_fname" placeholder="Name (index.html)" className="p-ed-input" />
                        <textarea onChange={e => setEditor(e.target.value)} className="p-ed-area" placeholder="HTML or Text..." />
                        <button className="p-ed-save" onClick={async () => {
                            const n = document.getElementById('new_fname').value || 'file.txt';
                            const comp = zipSync({ [n]: new TextEncoder().encode(editor) });
                            save({...drive, files: [...(drive?.files || []), {id: Date.now(), name: n, data: Array.from(comp), parentId: currentPath, access: 'published'}]});
                            setEditor(null);
                        }}>Save as Public</button>
                    </div>
                </div>
            )}
            {preview && (
                <div className="p-preview-overlay" onClick={() => setPreview(null)}>
                    <div className="p-preview-window" onClick={e => e.stopPropagation()}>
                        <div className="p-preview-top">{preview.name} <button onClick={() => setPreview(null)}>✕</button></div>
                        <div className="p-preview-body">
                            {preview.isImg ? <img src={preview.url} /> : <iframe src={preview.url} sandbox="allow-scripts" />}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}