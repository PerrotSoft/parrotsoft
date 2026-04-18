'use client';
import { useState, useEffect, useRef } from 'react';

// Функция для подсветки синтаксиса JSON
const highlightJSON = (jsonString) => {
    if (!jsonString) return "";
    let html = jsonString.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;
    
    html = html.replace(regex, (match) => {
        let color = '#ffb86c'; // Числа (Оранжевый)
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                color = '#ff79c6'; // Ключи (Розовый)
            } else {
                color = '#f1fa8c'; // Строки (Желтый)
            }
        } else if (/true|false/.test(match)) {
            color = '#8be9fd'; // Boolean (Голубой)
        } else if (/null/.test(match)) {
            color = '#bd93f9'; // Null (Фиолетовый)
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
    
    // Состояние для GUI-редактирования элементов
    const [guiEdit, setGuiEdit] = useState(null); // { key: string, type: 'edit' | 'rename', val: string }
    const [newGuiKey, setNewGuiKey] = useState('');
    const [newGuiVal, setNewGuiVal] = useState('');

    const preRef = useRef(null);

    const auth = { user: 'testoviy_account_2.2', pass: '1234' };

    const load = async () => {
        const r = await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=disk_ls`);
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
        const name = prompt("Название новой базы данных:");
        if (!name) return;
        await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_create&args=${name}`);
        load();
    };

    const handleSave = async (dbId, secretKey) => {
        try {
            const dataToSave = editingData[dbId];
            JSON.parse(dataToSave); // Проверка валидности JSON
            
            // ИСПОЛЬЗУЕМ POST, КАК ТРЕБУЕТ ТВОЙ ROUTE.JS (Устраняет ошибку 400/405 Bad Request)
            const r = await fetch(`/api/db/${dbId}/${secretKey}/write_all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: dataToSave
            });

            if (r.ok) {
                alert("✅ Данные ParrotDB успешно сохранены!");
                load();
            } else {
                const err = await r.json();
                alert("❌ Ошибка при сохранении: " + (err.error || "Неизвестная ошибка"));
            }
        } catch (e) {
            alert("⚠️ Ошибка: Неверный формат JSON. Проверьте синтаксис.");
        }
    };

    const handleDelete = async (dbId) => {
        if (!confirm("Вы уверены, что хотите полностью удалить эту базу?")) return;
        await fetch(`/api/pc?user=${auth.user}&pass=${auth.pass}&cmd=db_delete_db&args=${dbId}`);
        if (selectedDb?.id === dbId) setSelectedDb(null);
        load();
    };

    // --- ФУНКЦИИ GUI РЕДАКТОРА ---
    const handleAddGuiItem = () => {
        if (!newGuiKey) return alert("Введите ключ!");
        try {
            const currentObj = JSON.parse(editingData[selectedDb.id] || "{}");
            let parsedVal = newGuiVal;
            try { parsedVal = JSON.parse(newGuiVal); } catch(e) {}
            
            currentObj[newGuiKey] = parsedVal;
            setEditingData({ ...editingData, [selectedDb.id]: JSON.stringify(currentObj, null, 4) });
            setNewGuiKey('');
            setNewGuiVal('');
        } catch (e) { alert("Ошибка JSON"); }
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
        } catch (e) { alert("Ошибка структуры данных"); }
    };

    const handleDeleteGuiItem = (keyToRemove) => {
        if(!confirm(`Удалить ключ "${keyToRemove}"?`)) return;
        try {
            const currentObj = JSON.parse(editingData[selectedDb.id] || "{}");
            delete currentObj[keyToRemove];
            setEditingData({ ...editingData, [selectedDb.id]: JSON.stringify(currentObj, null, 4) });
        } catch (e) {}
    };

    // Синхронизация прокрутки между Textarea и подсветкой
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
            <div style={styles.container}>
                <header style={styles.header}>
                    <h1 style={{ margin: 0, fontSize: '24px' }}>🦜 PARROT CLOUD IDE <span style={{color: '#888', fontSize: '14px'}}>v4.0</span></h1>
                    <div style={{ display: 'flex', gap: '15px' }}>
                        <input 
                            placeholder="🔍 Поиск баз данных..." 
                            value={searchQuery} 
                            onChange={e => setSearchQuery(e.target.value)}
                            style={styles.input}
                        />
                        <button onClick={handleCreate} style={styles.btnPrimary}>[+] NEW DATABASE</button>
                    </div>
                </header>

                <div style={styles.grid}>
                    {filteredDbs.map(db => (
                        <div key={db.id} style={styles.card} onClick={() => { setSelectedDb(db); setActiveTab('info'); }}>
                            <div style={styles.cardHeader}>
                                <h3 style={{ margin: 0 }}>{db.name}</h3>
                                <span style={styles.badge}>{db.id}</span>
                            </div>
                            <p style={{ color: '#888', fontSize: '12px', margin: '10px 0 0 0' }}>Нажмите, чтобы открыть управление</p>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <header style={styles.header}>
                <div>
                    <button onClick={() => setSelectedDb(null)} style={styles.btnSecondary}>← НАЗАД К СПИСКУ</button>
                    <h1 style={{ display: 'inline-block', margin: '0 0 0 20px', fontSize: '20px' }}>
                        {selectedDb.name} <span style={{color: '#00ff41', fontSize: '14px'}}>[{selectedDb.id}]</span>
                    </h1>
                </div>
                <div>
                    <button onClick={() => handleSave(selectedDb.id, selectedDb.secretKey)} style={styles.btnPrimary}>💾 СОХРАНИТЬ В ОБЛАКО</button>
                </div>
            </header>

            <div style={styles.tabs}>
                <button style={activeTab === 'info' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('info')}>ℹ️ ИНФО & API</button>
                <button style={activeTab === 'json' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('json')}>{} RAW JSON</button>
                <button style={activeTab === 'gui' ? styles.tabActive : styles.tab} onClick={() => setActiveTab('gui')}>🗂️ GUI ИНТЕРФЕЙС</button>
            </div>

            <div style={styles.contentArea}>
                {activeTab === 'info' && (
                    <div style={{ animation: 'fadeIn 0.3s' }}>
                        <div style={styles.card}>
                            <h3 style={{ color: '#00ff41', borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: 0 }}>
                                📊 СОСТОЯНИЕ ХРАНИЛИЩА
                            </h3>
                            
                            {(() => {
                                const currentSize = JSON.stringify(currentParsedData).length;
                                const maxSize = selectedDb.maxSize || 2097152; // 2MB по умолчанию
                                const percent = Math.min((currentSize / maxSize) * 100, 100).toFixed(1);
                                
                                return (
                                    <>
                                        <div style={styles.statsGrid}>
                                            <div style={styles.statBox}>
                                                <div style={{ color: '#888', fontSize: '12px' }}>ИСПОЛЬЗОВАНО</div>
                                                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(currentSize / 1024).toFixed(2)} KB</div>
                                            </div>
                                            <div style={styles.statBox}>
                                                <div style={{ color: '#888', fontSize: '12px' }}>ЛИМИТ БАЗЫ</div>
                                                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{(maxSize / (1024 * 1024)).toFixed(0)} MB</div>
                                            </div>
                                        </div>

                                        <div style={{ marginTop: '20px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
                                                <span>Заполнение диска</span>
                                                <span>{percent}%</span>
                                            </div>
                                            <div style={styles.progressBg}>
                                                <div style={{ 
                                                    ...styles.progressFill, 
                                                    width: `${percent}%`, 
                                                    background: percent > 85 ? '#ff4444' : '#00ff41' 
                                                }} />
                                            </div>
                                        </div>

                                        <button 
                                            style={styles.btnUpgrade}
                                            onClick={() => alert("Заглушка: Запрос на расширение до " + ((maxSize / (1024*1024)) + 1) + " MB отправлен.")}
                                            onMouseOver={(e) => e.target.style.background = 'rgba(0, 255, 65, 0.1)'}
                                            onMouseOut={(e) => e.target.style.background = 'transparent'}
                                        >
                                            ⚡ УВЕЛИЧИТЬ РАЗМЕР (+1 MB)
                                        </button>
                                    </>
                                );
                            })()}
                        </div>

                        <div style={{ ...styles.card, marginTop: '20px' }}>
                            <h3 style={{ color: '#00ff41', borderBottom: '1px solid #333', paddingBottom: '10px', marginTop: 0 }}>
                                🔑 КЛЮЧИ ДОСТУПА
                            </h3>
                            <p style={{ fontSize: '14px' }}><strong>ID:</strong> <span style={styles.badge}>{selectedDb.id}</span></p>
                            <p><strong>Секретный ключ (Secret):</strong> <br/>
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
                            {/* Слой с подсветкой синтаксиса */}
                            <pre 
                                ref={preRef}
                                style={styles.syntaxLayer}
                                dangerouslySetInnerHTML={{ __html: highlightJSON(editingData[selectedDb.id] || "{}") }}
                            />
                            {/* Прозрачный Textarea для ввода */}
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
                        
                        {/* Панель добавления нового ключа */}
                        <div style={{ ...styles.card, display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid #333' }}>
                            <input 
                                placeholder="Новый ключ" 
                                value={newGuiKey} 
                                onChange={e => setNewGuiKey(e.target.value)} 
                                style={{ ...styles.input, flex: 1, height: '38px' }} 
                            />
                            <input 
                                placeholder="Значение" 
                                value={newGuiVal} 
                                onChange={e => setNewGuiVal(e.target.value)} 
                                style={{ ...styles.input, flex: 2, height: '38px' }} 
                            />
                            <button onClick={handleAddGuiItem} style={{ ...styles.btnPrimary, height: '38px', padding: '0 20px' }}>ДОБАВИТЬ</button>
                        </div>

                        {/* Список элементов с ограничителем высоты всей области */}
                        <div style={{ 
                            display: 'grid', 
                            gap: '12px', 
                            maxHeight: 'calc(100vh - 320px)', // Ограничитель, чтобы не вылезало за окно браузера
                            overflowY: 'auto',
                            paddingRight: '5px' 
                        }}>
                            {Object.keys(currentParsedData).map(key => (
                                <div key={key} style={{
                                    ...styles.guiItem,
                                    transition: '0.2s',
                                    border: '1px solid #222',
                                    padding: '12px 15px'
                                }}>
                                    
                                    {guiEdit?.key === key ? (
                                        /* РЕЖИМ РЕДАКТИРОВАНИЯ / ПЕРЕИМЕНОВАНИЯ (Небольшой редактор) */
                                        <div style={{ flex: 1, display: 'flex', gap: '10px', flexDirection: 'column', animation: 'fadeIn 0.2s' }}>
                                            <div style={{ color: '#00ff41', fontSize: '11px', fontWeight: 'bold', textTransform: 'uppercase' }}>
                                                {guiEdit.type === 'edit' ? `Изменение содержимого: ${key}` : `Новое имя для: ${key}`}
                                            </div>
                                            
                                            {guiEdit.type === 'edit' ? (
                                                <textarea 
                                                    value={guiEdit.val} 
                                                    onChange={(e) => setGuiEdit({...guiEdit, val: e.target.value})} 
                                                    style={{
                                                        width: '100%',
                                                        height: '120px',
                                                        background: '#050505',
                                                        color: '#00ff41',
                                                        border: '1px solid #00ff41',
                                                        borderRadius: '4px',
                                                        padding: '10px',
                                                        fontFamily: 'monospace',
                                                        fontSize: '13px',
                                                        outline: 'none'
                                                    }}
                                                    placeholder="Введите значение (JSON или текст)..."
                                                />
                                            ) : (
                                                <input 
                                                    value={guiEdit.val} 
                                                    onChange={(e) => setGuiEdit({...guiEdit, val: e.target.value})} 
                                                    style={{ ...styles.input, border: '1px solid #00ff41' }} 
                                                />
                                            )}
                                            
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={handleSaveGuiAction} style={{ ...styles.btnPrimary, padding: '6px 15px', fontSize: '12px' }}>Применить</button>
                                                <button onClick={() => setGuiEdit(null)} style={{ ...styles.btnSecondary, padding: '6px 15px', fontSize: '12px' }}>Отмена</button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* СТАНДАРТНОЕ ОТОБРАЖЕНИЕ (С точками ...) */
                                        <>
                                            <div style={{ flex: 1, overflow: 'hidden', paddingRight: '15px' }}>
                                                <div style={{ color: '#666', fontSize: '11px', marginBottom: '2px', fontWeight: 'bold' }}>{key}</div>
                                                    <div style={{ 
                                                        flex: 1, 
                                                        minWidth: 0, // КРИТИЧНО: позволяет контейнеру сжиматься меньше размера текста
                                                        paddingRight: '20px' 
                                                    }}>
                                                        <div style={{ color: '#888', fontSize: '12px', marginBottom: '4px' }}>
                                                            {key}
                                                        </div>
                                                        
                                                        <div 
                                                            style={styles.guiValue} 
                                                            title={typeof currentParsedData[key] === 'object' ? JSON.stringify(currentParsedData[key]) : String(currentParsedData[key])}
                                                        >
                                                            {typeof currentParsedData[key] === 'object' 
                                                                ? JSON.stringify(currentParsedData[key]) 
                                                                : String(currentParsedData[key])}
                                                        </div>
                                                    </div>
                                            </div>
                                            
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button 
                                                    onClick={() => setGuiEdit({key, type: 'edit', val: JSON.stringify(currentParsedData[key], null, 2)})} 
                                                    style={{ ...styles.actionBtn, background: '#111' }}
                                                >
                                                    Изменить
                                                </button>
                                                <button 
                                                    onClick={() => setGuiEdit({key, type: 'rename', val: key})} 
                                                    style={{ ...styles.actionBtn, background: '#111' }}
                                                >
                                                    Имя
                                                </button>
                                                <button 
                                                    onClick={() => handleDeleteGuiItem(key)} 
                                                    style={{ ...styles.actionBtn, color: '#ff4444', borderColor: '#442222' }}
                                                >
                                                    Удалить
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        
                        {/* Небольшой отступ снизу, чтобы не прилипало к краю */}
                        <div style={{ height: '20px' }}></div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Общие параметры для синхронизации слоев кода
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
    // Добавлен paddingTop: '80px', чтобы не было перекрытия с твоей шапкой сверху
    container: { padding: '30px', paddingTop: '80px', background: '#050505', color: '#e0e0e0', minHeight: '100vh', fontFamily: "'Segoe UI', sans-serif" },
    header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #222', paddingBottom: '20px', marginBottom: '20px' },
    input: { padding: '10px 15px', background: '#111', color: '#fff', border: '1px solid #333', borderRadius: '6px', outline: 'none' },
    btnPrimary: { padding: '10px 20px', background: '#00ff41', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
    btnSecondary: { padding: '10px 20px', background: '#1a1a1a', color: '#e0e0e0', border: '1px solid #333', borderRadius: '6px', cursor: 'pointer' },
    actionBtn: { padding: '6px 12px', background: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' },
    card: { border: '1px solid #222', padding: '20px', background: '#0a0a0a', borderRadius: '10px', cursor: 'pointer' },
    cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    badge: { background: '#111', color: '#00ff41', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', border: '1px solid #222' },
    tabs: { display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid #222', paddingBottom: '10px' },
    tab: { background: 'transparent', color: '#888', border: 'none', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' },
    tabActive: { background: '#111', color: '#00ff41', border: '1px solid #333', borderRadius: '6px', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold' },
    contentArea: { background: '#0a0a0a', border: '1px solid #222', borderRadius: '10px', padding: '20px', minHeight: '500px' },
    codeBlock: { display: 'block', background: '#000', padding: '10px', borderRadius: '6px', border: '1px solid #222', color: '#00ff41', fontFamily: 'monospace' },
    guiItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#111', padding: '15px', borderLeft: '3px solid #00ff41', borderRadius: '6px' },
    
    // Стили для редактора кода (Overlay подход)
    editorWrapper: { position: 'relative', width: '100%', height: '450px', background: '#050505', border: '1px solid #333', borderRadius: '6px', overflow: 'hidden' },
    syntaxLayer: { ...codeStyles, position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' },
    textareaLayer: { ...codeStyles, position: 'absolute', top: 0, left: 0, color: 'transparent', caretColor: '#00ff41', background: 'transparent', zIndex: 2, resize: 'none', overflow: 'auto' },
    
    statsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '20px' },
    statBox: { background: '#111', padding: '15px', borderRadius: '8px', border: '1px solid #222' },
    progressBg: { width: '100%', height: '8px', background: '#222', borderRadius: '4px', marginTop: '10px', overflow: 'hidden' },
    progressFill: { height: '100%', transition: 'width 0.3s ease' },
    btnUpgrade: { 
        marginTop: '15px', 
        width: '100%', 
        padding: '12px', 
        background: 'transparent', 
        color: '#00ff41', 
        border: '1px dashed #00ff41', 
        borderRadius: '6px', 
        cursor: 'pointer',
        fontWeight: 'bold',
        transition: '0.2s'
    },
    // Найти и заменить в объекте styles:
    contentArea: { 
        background: '#0a0a0a', 
        border: '1px solid #222', 
        borderRadius: '10px', 
        padding: '20px', 
        // НОВОЕ: ограничиваем высоту (минус шапка и табы) и добавляем прокрутку
        height: 'calc(100vh - 250px)', 
        overflowY: 'auto',
        position: 'relative'
    },

    // Добавить новый стиль для GUI элементов:
    valueContainer: { 
        maxHeight: '100px', // Высота одного элемента (текста) в списке
        overflowY: 'auto',   // Скролл если текст внутри элемента слишком длинный
        wordBreak: 'break-all',
        fontSize: '14px',
        color: '#ccc',
        padding: '5px',
        background: '#050505',
        borderRadius: '4px'
    },
    // В объекте styles найти:
    editorWrapper: { 
        position: 'relative', 
        width: '100%', 
        height: '100%', // Теперь он будет занимать всю высоту contentArea
        background: '#050505', 
        border: '1px solid #333', 
        borderRadius: '6px', 
        overflow: 'hidden' 
    },
    // Внутри объекта styles:
    truncate: {
        whiteSpace: 'nowrap',      // Запрещаем перенос строки
        overflow: 'hidden',        // Прячем всё, что не влезло
        textOverflow: 'ellipsis',  // Добавляем те самые три точки (...)
        maxWidth: '100%',          // Ограничиваем по ширине родителя
    },
    // Для элементов GUI, чтобы они не раздувались
    valueContainer: {
        maxWidth: '300px',         // Можешь настроить любую ширину
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        color: '#ccc',
        fontSize: '14px',
        fontFamily: 'monospace',
        background: '#050505',
        padding: '4px 8px',
        borderRadius: '4px'
    },
    contentArea: { 
        background: '#0a0a0a', 
        border: '1px solid #222', 
        borderRadius: '10px', 
        padding: '20px', 
        height: 'calc(100vh - 280px)', // Фиксируем высоту относительно окна браузера
        overflowY: 'auto',            // Включаем внутреннюю прокрутку
        display: 'flex',              // Помогает внутренним элементам правильно считать ширину
        flexDirection: 'column'
    },
};