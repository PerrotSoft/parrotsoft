'use client';
import { useState, useEffect, useRef } from 'react';
import AdSlot from '../components/AdSlot';

const highlightJSON = (jsonString) => {
    if (!jsonString) return "";
    let html = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    
    html = html.replace(regex, (match) => {
        let color = 'var(--dbm-syn-num)';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                color = 'var(--dbm-syn-key)';
            } else {
                color = 'var(--dbm-syn-str)';
            }
        } else if (/true|false/.test(match)) {
            color = 'var(--dbm-syn-bool)';
        } else if (/null/.test(match)) {
            color = 'var(--dbm-syn-null)';
        }
        return `<span style="color: ${color}">${match}</span>`;
    });
    return html;
};

export default function DBManager() {
    const [dbs, setDbs] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [editingData, setEditingData] = useState({});
    
    const [selectedDb, setSelectedDb] = useState(null);
    const [activeTab, setActiveTab] = useState('info');
    
    const [guiEdit, setGuiEdit] = useState(null);
    const [newGuiKey, setNewGuiKey] = useState('');
    const [newGuiVal, setNewGuiVal] = useState('');

    const preRef = useRef(null);

    const auth = { user: localStorage.getItem('p_user'), pass: '1234' };

    const load = async () => {
        const r = await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_ls`);
        if (r.ok) {
            const data = await r.json();
            const filteredDbs = data.filter(d => d.type === 'v_db');
            setDbs(filteredDbs);
            
            const initialEditors = {};
            filteredDbs.forEach(db => {
                initialEditors[db.id] = JSON.stringify(db.content || {}, null, 4);
            });
            setEditingData(initialEditors);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        const name = prompt("Enter the name of the new database:");
        if (!name) return;
        await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_create&args=${name}`);
        load();
    };

    const handleSave = async (dbId, secretKey) => {
        try {
            const dataToSave = editingData[dbId];
            JSON.parse(dataToSave);
            
            const r = await fetch(`/api/db/${dbId}/${secretKey}/write_all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: dataToSave
            });

            if (r.ok) {
                alert("✅ Data saved successfully!");
                load();
            } else {
                const err = await r.json();
                alert("❌ Error saving data: " + (err.error || "Unknown error"));
            }
        } catch (e) {
            alert("⚠️ Error: Invalid JSON format. Check the syntax.");
        }
    };

    const handleDelete = async (dbId) => {
        if (!confirm("Are you sure you want to completely delete this database?")) return;
        await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_delete_db&args=${dbId}`);
        if (selectedDb?.id === dbId) setSelectedDb(null);
        load();
    };

    const EXPAND_COST_PC_PER_MB = 10;

    const handleExpandStorage = async (dbId, extraMB = 1) => {
        if (!confirm(`Увеличить лимит на ${extraMB} МБ за ${extraMB * EXPAND_COST_PC_PER_MB} PC?`)) return;
        const r = await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_expand&args=${dbId}:${extraMB}`);
        const result = await r.json();
        if (result.success) {
            alert(`✅ Лимит увеличен! Списано ${result.spent} PC, новый баланс: ${result.newBalance} PC`);
            load();
        } else {
            alert(`❌ ${result.error || 'Не удалось увеличить лимит'}`);
        }
    };

    const handleAddGuiItem = () => {
        if (!newGuiKey) return alert("Enter the key!");
        try {
            const currentObj = JSON.parse(editingData[selectedDb.id] || "{}");
            let parsedVal = newGuiVal;
            try { parsedVal = JSON.parse(newGuiVal); } catch(e) {}
            
            currentObj[newGuiKey] = parsedVal;
            setEditingData({ ...editingData, [selectedDb.id]: JSON.stringify(currentObj, null, 4) });
            setNewGuiKey('');
            setNewGuiVal('');
        } catch (e) { alert("JSON error"); }
    };

    const handleSaveGuiAction = () => {
        try {
            const currentObj = JSON.parse(editingData[selectedDb.id] || "{}");
            
            if (guiEdit.type === 'edit') {
                let parsedVal = guiEdit.val;
                try { parsedVal = JSON.parse(guiEdit.val); } catch(e) {}
                currentObj[guiEdit.key] = parsedVal;
            } else if (guiEdit.type === 'rename') {
                if (guiEdit.val && guiEdit.val !== guiEdit.key) {
                    currentObj[guiEdit.val] = currentObj[guiEdit.key];
                    delete currentObj[guiEdit.key];
                }
            }
            
            setEditingData({ ...editingData, [selectedDb.id]: JSON.stringify(currentObj, null, 4) });
            setGuiEdit(null);
        } catch (e) { alert("Data structure error"); }
    };

    const handleDeleteGuiItem = (keyToRemove) => {
        if(!confirm(`Delete key "${keyToRemove}"?`)) return;
        try {
            const currentObj = JSON.parse(editingData[selectedDb.id] || "{}");
            delete currentObj[keyToRemove];
            setEditingData({ ...editingData, [selectedDb.id]: JSON.stringify(currentObj, null, 4) });
        } catch (e) {}
    };

    const handleScroll = (e) => {
        if (preRef.current) {
            preRef.current.scrollTop = e.target.scrollTop;
            preRef.current.scrollLeft = e.target.scrollLeft;
        }
    };

    const filteredDbs = dbs.filter(db => 
        db.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        db.id.toLowerCase().includes(searchQuery.toLowerCase())
    );

    let currentParsedData = {};
    if (selectedDb) {
        try { currentParsedData = JSON.parse(editingData[selectedDb.id] || "{}"); } catch(e) {}
    }

    if (!selectedDb) {
        return (
            <div className="dbm-root" style={styles.container}>
                <header style={styles.header}>
                    <h1 style={{ margin: 0, fontSize: '24px' }}>🦜 PARROT CLOUD IDE <span style={{color: 'var(--dbm-text-dim)', fontSize: '14px'}}>v2.0</span></h1>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <input 
                            placeholder="🔍 Search databases..." 
                            value={searchQuery} 
                            onChange={e => setSearchQuery(e.target.value)}
                            style={styles.input}
                        />
                        <button onClick={handleCreate} style={styles.btnPrimary}>[+] NEW DATABASE</button>
                    </div>
                </header>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 20px' }}>
                    <AdSlot weight="more" type="468x60" />
                </div>

                <div style={styles.grid}>
                    {filteredDbs.map(db => (
                        <div key={db.id} style={styles.card} onClick={() => { setSelectedDb(db); setActiveTab('info'); }}>
                            <div style={styles.cardHeader}>
                                <h3 style={{ margin: 0 }}>{db.name}</h3>
                                <span style={styles.badge}>{db.id}</span>
                            </div>
                            <p style={{ color: 'var(--dbm-text-dim)', fontSize: '12px', margin: '10px 0 0 0' }}>Click to open management</p>
                        </div>
                    ))}
                </div>

                <style jsx global>{`
                    .dbm-root {
                        --dbm-bg: #f7f7f9;
                        --dbm-panel: #ffffff;
                        --dbm-panel-2: #f0f1f4;
                        --dbm-card: #ffffff;
                        --dbm-border: #e3e4e9;
                        --dbm-border-2: #d3d5dc;
                        --dbm-text: #17181c;
                        --dbm-text-dim: #6b6d78;
                        --dbm-text-dim-2: #8b8d97;
                        --dbm-accent: #0a8f2e;
                        --dbm-accent-text: #ffffff;
                        --dbm-danger: #d93a35;
                        --dbm-danger-border: #f3c9c7;
                        --dbm-syn-num: #b5651d;
                        --dbm-syn-key: #a3186e;
                        --dbm-syn-str: #7a6a00;
                        --dbm-syn-bool: #0072a3;
                        --dbm-syn-null: #6b3fa0;
                    }
                    [data-theme="dark"] .dbm-root {
                        --dbm-bg: #050505;
                        --dbm-panel: #111111;
                        --dbm-panel-2: #1a1a1a;
                        --dbm-card: #0a0a0a;
                        --dbm-border: #222222;
                        --dbm-border-2: #333333;
                        --dbm-text: #e0e0e0;
                        --dbm-text-dim: #888888;
                        --dbm-text-dim-2: #9fb0a8;
                        --dbm-accent: #00ff41;
                        --dbm-accent-text: #000000;
                        --dbm-danger: #ff5555;
                        --dbm-danger-border: #442222;
                        --dbm-syn-num: #ffb86c;
                        --dbm-syn-key: #ff79c6;
                        --dbm-syn-str: #f1fa8c;
                        --dbm-syn-bool: #8be9fd;
                        --dbm-syn-null: #bd93f9;
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div className="dbm-root" style={styles.container}>
            <header style={styles.header}>
                <div>
                    <button onClick={() => setSelectedDb(null)} style={styles.btnSecondary}>← BACK TO LIST</button>
                    <h1 style={{ display: 'inline-block', margin: '0 0 0 20px', fontSize: '20px' }}>
                        {selectedDb.name} <span style={{color: 'var(--dbm-accent)', fontSize: '14px'}}>[{selectedDb.id}]</span>
                    </h1>
                </div>
                <div>
                    <button onClick={() => handleSave(selectedDb.id, selectedDb.secretKey)} style={styles.btnPrimary}>💾 SAVE TO CLOUD</button>
                    <button
                        onClick={() => handleDelete(selectedDb.id)}
                        style={{ ...styles.btnSecondary, marginLeft: '10px', color: 'var(--dbm-danger)', borderColor: 'var(--dbm-danger-border)' }}
                        onMouseOver={(e) => { e.target.style.background = 'rgba(255, 68, 68, 0.1)'; e.target.style.borderColor = 'var(--dbm-danger)'; }}
                        onMouseOut={(e) => { e.target.style.background = 'transparent'; e.target.style.borderColor = 'var(--dbm-danger-border)'; }}
                    >
                        🗑️ DELETE DATABASE
                    </button>
                </div>
            </header>

            <div style={styles.tabs}>
                <button style={activeTab === 'info' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('info')}>ℹ️ INFO & API</button>
                <button style={activeTab === 'json' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('json')}>{} RAW JSON</button>
                <button style={activeTab === 'gui' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('gui')}>🗂️ GUI INTERFACE</button>
            </div>

            <div style={styles.contentArea}>
                {activeTab === 'info' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        <div style={styles.card}>
                            <h3 style={{ color: 'var(--dbm-accent)', borderBottom: '1px solid var(--dbm-border-2)', paddingBottom: '10px', marginTop: 0 }}>
                                📊 STORAGE STATUS
                            </h3>
                            
                            {(() => {
                                const currentSize = JSON.stringify(currentParsedData).length;
                                const maxSize = selectedDb.maxSize || 2097152;
                                const percent = Math.min((currentSize / maxSize) * 100, 100).toFixed(1);
                                
                                return (
                                    <>
                                        <div style={styles.statsGrid}>
                                            <div style={styles.statBox}>
                                                <div style={{ color: 'var(--dbm-text-dim)', fontSize: '12px' }}>USED</div>
                                                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(currentSize / 1024).toFixed(2)} KB</div>
                                            </div>
                                            <div style={styles.statBox}>
                                                <div style={{ color: 'var(--dbm-text-dim)', fontSize: '12px' }}>LIMIT</div>
                                                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(maxSize / (1024 * 1024)).toFixed(0)} MB</div>
                                            </div>
                                        </div>

                                        <div style={{ marginTop: '20px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                                                <span>Disk Fill</span>
                                                <span>{percent}%</span>
                                            </div>
                                            <div style={styles.progressBg}>
                                                <div style={{ 
                                                    ...styles.progressFill, 
                                                    width: `${percent}%`, 
                                                    background: percent > 85 ? 'var(--dbm-danger)' : 'var(--dbm-accent)' 
                                                }} />
                                            </div>
                                        </div>

                                        <button 
                                            style={styles.btnUpgrade}
                                            onClick={() => handleExpandStorage(selectedDb.id, 1)}
                                            onMouseOver={(e) => e.target.style.background = 'rgba(0, 255, 65, 0.1)'}
                                            onMouseOut={(e) => e.target.style.background = 'transparent'}
                                        >
                                            ⚡ INCREASE SIZE (+1 MB · 10 PC)
                                        </button>
                                    </>
                                );
                            })()}
                        </div>

                        <div style={{ ...styles.card, marginTop: '20px' }}>
                            <h3 style={{ color: 'var(--dbm-accent)', borderBottom: '1px solid var(--dbm-border-2)', paddingBottom: '10px', marginTop: 0 }}>
                                🔑 ACCESS KEYS
                            </h3>
                            <p style={{ fontSize: '14px' }}><strong>ID:</strong> <span style={styles.badge}>{selectedDb.id}</span></p>
                            <p><strong>Secret key (Secret):</strong> <br/>
                                <span style={{ ...styles.codeBlock, fontSize: '12px', wordBreak: 'break-all' }}>{selectedDb.secretKey}</span>
                            </p>
                            <p><strong>API Endpoint:</strong> <br/>
                                <span style={{ ...styles.codeBlock, fontSize: '12px' }}>/api/db/{selectedDb.id}/{selectedDb.secretKey}/[cmd]</span>
                            </p>
                        </div>
                    </div>
                )}
                {activeTab === 'json' && (
                    <div style={{ animation: 'fadeIn 0.3s', height: '100%' }}>
                        <div style={styles.editorWrapper}>
                            <pre 
                                ref={preRef}
                                style={styles.syntaxLayer}
                                dangerouslySetInnerHTML={{ __html: highlightJSON(editingData[selectedDb.id] || "{}") }}
                            />
                            <textarea
                                value={editingData[selectedDb.id] || "{}"}
                                onChange={(e) => setEditingData({...editingData, [selectedDb.id]: e.target.value})}
                                onScroll={handleScroll}
                                style={styles.textareaLayer}
                                spellCheck="false"
                            />
                        </div>
                    </div>
                )}
                {activeTab === 'gui' && (
                    <div style={{ animation: 'fadeIn 0.3s', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        
                        <div style={{ ...styles.card, display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid var(--dbm-border-2)' }}>
                            <input 
                                placeholder="New key" 
                                value={newGuiKey} 
                                onChange={e => setNewGuiKey(e.target.value)} 
                                style={{ ...styles.input, flex: 1, height: '38px' }} 
                            />
                            <input 
                                placeholder="Value" 
                                value={newGuiVal} 
                                onChange={e => setNewGuiVal(e.target.value)} 
                                style={{ ...styles.input, flex: 2, height: '38px' }} 
                            />
                            <button onClick={handleAddGuiItem} style={{ ...styles.btnPrimary, height: '38px', padding: '0 20px' }}>ADD</button>
                        </div>

                        <div style={{ 
                            display: 'grid', 
                            gap: '12px', 
                            maxHeight: 'calc(100vh - 320px)', 
                            overflowY: 'auto',
                            paddingRight: '5px' 
                        }}>
                            {Object.keys(currentParsedData).map(key => (
                                <div key={key} style={{
                                    ...styles.guiItem,
                                    transition: '0.2s',
                                    border: '1px solid var(--dbm-border)',
                                    padding: '12px 15px'
                                }}
                                    onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--dbm-accent)'}
                                    onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--dbm-border)'}
                                >
                                    {guiEdit?.key === key ? (
                                        <div style={{ flex: 1, display: 'flex', gap: '10px', flexDirection: 'column', animation: 'fadeIn 0.2s' }}>
                                            <div style={{ color: 'var(--dbm-accent)', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                                {guiEdit.type === 'edit' ? `Changing content: ${key}` : `New name for: ${key}`}
                                            </div>
                                            
                                            {guiEdit.type === 'edit' ? (
                                                <textarea 
                                                    value={guiEdit.val} 
                                                    onChange={(e) => setGuiEdit({...guiEdit, val: e.target.value})} 
                                                    style={{
                                                        width: '100%',
                                                        height: '120px',
                                                        background: 'var(--dbm-bg)',
                                                        color: 'var(--dbm-accent)',
                                                        border: '1px solid var(--dbm-accent)',
                                                        borderRadius: '4px',
                                                        padding: '10px',
                                                        fontFamily: 'monospace',
                                                        fontSize: '13px',
                                                        outline: 'none'
                                                    }}
                                                    placeholder="Enter value (JSON or text)..."
                                                />
                                            ) : (
                                                <input 
                                                    value={guiEdit.val} 
                                                    onChange={(e) => setGuiEdit({...guiEdit, val: e.target.value})} 
                                                    style={{ ...styles.input, border: '1px solid var(--dbm-accent)' }} 
                                                />
                                            )}
                                            
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={handleSaveGuiAction} style={{ ...styles.btnPrimary, padding: '6px 15px', fontSize: '12px' }}>Apply</button>
                                                <button onClick={() => setGuiEdit(null)} style={{ ...styles.btnSecondary, padding: '6px 15px', fontSize: '12px' }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ flex: 1, overflow: 'hidden', paddingRight: '15px' }}>
                                                    <div style={{
                                                        flex: 1,
                                                        minWidth: 0,
                                                        paddingRight: '20px'
                                                    }}>
                                                        <div style={{ color: 'var(--dbm-accent)', fontSize: '12px', marginBottom: '5px', fontWeight: 'bold', letterSpacing: '0.3px' }}>
                                                            {key}
                                                        </div>

                                                        <div 
                                                            style={styles.guiValue} 
                                                            title={typeof currentParsedData[key] === 'object' ? JSON.stringify(currentParsedData[key]) : String(currentParsedData[key])}
                                                        >
                                                            {(() => {
                                                                const raw = typeof currentParsedData[key] === 'object'
                                                                    ? JSON.stringify(currentParsedData[key])
                                                                    : String(currentParsedData[key]);
                                                                return raw.length > 260 ? raw.slice(0, 260) + '…' : raw;
                                                            })()}
                                                        </div>
                                                    </div>
                                            </div>
                                            
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button 
                                                    onClick={() => setGuiEdit({key, type: 'edit', val: JSON.stringify(currentParsedData[key], null, 2)})} 
                                                    style={{ ...styles.actionBtn, background: 'var(--dbm-panel)' }}
                                                >
                                                    Change Value
                                                </button>
                                                <button 
                                                    onClick={() => setGuiEdit({key, type: 'rename', val: key})} 
                                                    style={{ ...styles.actionBtn, background: 'var(--dbm-panel)' }}
                                                >
                                                    Change Name
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteGuiItem(key)} 
                                                    style={{ ...styles.actionBtn, color: 'var(--dbm-danger)', borderColor: 'var(--dbm-danger-border)' }}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        
                        <div style={{ height: '20px' }}></div>
                    </div>
                )}
            </div>

            <style jsx global>{`
                .dbm-root {
                    --dbm-bg: #f7f7f9;
                    --dbm-panel: #ffffff;
                    --dbm-panel-2: #f0f1f4;
                    --dbm-card: #ffffff;
                    --dbm-border: #e3e4e9;
                    --dbm-border-2: #d3d5dc;
                    --dbm-text: #17181c;
                    --dbm-text-dim: #6b6d78;
                    --dbm-text-dim-2: #8b8d97;
                    --dbm-accent: #0a8f2e;
                    --dbm-accent-text: #ffffff;
                    --dbm-danger: #d93a35;
                    --dbm-danger-border: #f3c9c7;
                    --dbm-syn-num: #b5651d;
                    --dbm-syn-key: #a3186e;
                    --dbm-syn-str: #7a6a00;
                    --dbm-syn-bool: #0072a3;
                    --dbm-syn-null: #6b3fa0;
                }
                [data-theme="dark"] .dbm-root {
                    --dbm-bg: #050505;
                    --dbm-panel: #111111;
                    --dbm-panel-2: #1a1a1a;
                    --dbm-card: #0a0a0a;
                    --dbm-border: #222222;
                    --dbm-border-2: #333333;
                    --dbm-text: #e0e0e0;
                    --dbm-text-dim: #888888;
                    --dbm-text-dim-2: #9fb0a8;
                    --dbm-accent: #00ff41;
                    --dbm-accent-text: #000000;
                    --dbm-danger: #ff5555;
                    --dbm-danger-border: #442222;
                    --dbm-syn-num: #ffb86c;
                    --dbm-syn-key: #ff79c6;
                    --dbm-syn-str: #f1fa8c;
                    --dbm-syn-bool: #8be9fd;
                    --dbm-syn-null: #bd93f9;
                }
            `}</style>
        </div>
    );
}

const codeStyles = {
    fontFamily: "'Fira Code', Consolas, monospace",
    fontSize: '14px',
    lineHeight: '1.5',
    padding: '20px',
    margin: 0,
    width: '100%',
    height: '100%',
    whiteSpace: 'pre-wrap',
    wordWrap: 'break-word',
    border: 'none',
    outline: 'none',
    boxSizing: 'border-box'
};

const styles = {
    container: { padding: '30px', paddingTop: '80px', background: 'var(--dbm-bg)', color: 'var(--dbm-text)', minHeight: '100vh', fontFamily: "'Segoe UI', sans-serif" },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--dbm-border)', paddingBottom: '20px', marginBottom: '20px' },
    input: { padding: '10px 15px', background: 'var(--dbm-panel)', color: 'var(--dbm-text)', border: '1px solid var(--dbm-border-2)', borderRadius: '6px', outline: 'none' },
    btnPrimary: { padding: '10px 20px', background: 'var(--dbm-accent)', color: 'var(--dbm-accent-text)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
    btnSecondary: { padding: '10px 20px', background: 'var(--dbm-panel-2)', color: 'var(--dbm-text)', border: '1px solid var(--dbm-border-2)', borderRadius: '6px', cursor: 'pointer' },
    actionBtn: { padding: '6px 12px', background: 'var(--dbm-panel-2)', color: 'var(--dbm-text-dim)', border: '1px solid var(--dbm-border-2)', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' },
    card: { border: '1px solid var(--dbm-border)', padding: '20px', background: 'var(--dbm-card)', borderRadius: '10px', cursor: 'pointer' },
    cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    badge: { background: 'var(--dbm-panel)', color: 'var(--dbm-accent)', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid var(--dbm-border)' },
    tabs: { display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--dbm-border)', paddingBottom: '10px' },
    tab: { background: 'transparent', color: 'var(--dbm-text-dim)', border: 'none', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' },
    tabActive: { background: 'var(--dbm-panel)', color: 'var(--dbm-accent)', border: '1px solid var(--dbm-border-2)', borderRadius: '6px', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' },
    contentArea: {
        background: 'var(--dbm-card)',
        border: '1px solid var(--dbm-border)',
        borderRadius: '10px',
        padding: '20px',
        height: 'calc(100vh - 280px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
    },
    codeBlock: { display: 'block', background: 'var(--dbm-bg)', padding: '10px', borderRadius: '6px', border: '1px solid var(--dbm-border)', color: 'var(--dbm-accent)', fontFamily: 'monospace' },
    guiItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--dbm-panel)', padding: '15px', borderLeft: '3px solid var(--dbm-accent)', borderRadius: '6px', transition: 'background 0.15s' },
    guiValue: {
        color: 'var(--dbm-text-dim-2)',
        fontFamily: "'SFMono-Regular', Consolas, monospace",
        fontSize: '12.5px',
        lineHeight: '1.5',
        wordBreak: 'break-all',
        whiteSpace: 'pre-wrap',
    },

    editorWrapper: {
        position: 'relative',
        width: '100%',
        height: '100%',
        background: 'var(--dbm-bg)',
        border: '1px solid var(--dbm-border-2)',
        borderRadius: '6px',
        overflow: 'hidden'
    },
    syntaxLayer: { ...codeStyles, position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' },
    textareaLayer: { ...codeStyles, position: 'absolute', top: 0, left: 0, color: 'transparent', caretColor: 'var(--dbm-accent)', background: 'transparent', zIndex: 2, resize: 'none', overflow: 'auto' },

    statsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' },
    statBox: { background: 'var(--dbm-panel)', padding: '15px', borderRadius: '8px', border: '1px solid var(--dbm-border)' },
    progressBg: { width: '100%', height: '8px', background: 'var(--dbm-border-2)', borderRadius: '4px', marginTop: '10px', overflow: 'hidden' },
    progressFill: { height: '100%', transition: 'width 0.3s ease' },
    btnUpgrade: {
        marginTop: '15px',
        width: '100%',
        padding: '12px',
        background: 'transparent',
        color: 'var(--dbm-accent)',
        border: '1px dashed var(--dbm-accent)',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: '0.2s'
    },

    valueContainer: {
        maxWidth: '300px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: 'var(--dbm-text-dim)',
        fontSize: '14px',
        fontFamily: 'monospace',
        background: 'var(--dbm-bg)',
        padding: '4px 8px',
        borderRadius: '4px'
    },
    truncate: {
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%',
    },
};
