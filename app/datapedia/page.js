'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { getGlobalSearchList, syncDocs, addSearchItem } from '../actions';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';

export default function DatapediaPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const docName = searchParams.get('doc') || "Home";
    const sidebarQuery = (searchParams.get('dq') || "").toLowerCase();
    const [isSideOpen, setIsSideOpen] = useState(false);
    const [allDocs, setAllDocs] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    
    // Поля формы + галочка для поисковика
    const [form, setForm] = useState({ 
        name: '', 
        content: '', 
        icon: '📄', 
        publishToSearch: true 
    });

    const loadData = async () => {
        setLoading(true);
        try {
            const allUsers = await getGlobalSearchList();
            const combined = [];
            allUsers.forEach(user => {
                // Теперь в user.docs точно будут данные из базы
                if (user.docs && Array.isArray(user.docs)) {
                    user.docs.forEach(d => {
                        combined.push({ ...d, owner: user.username });
                    });
                }
            });
            setAllDocs(combined);
        } catch (e) { 
            console.error("Load data error:", e); 
        }
        setLoading(false);
    };

    useEffect(() => {
        const saved = localStorage.getItem('p_user');
        if (saved) setCurrentUser(saved);
        loadData(); // Вызываем при загрузке страницы
    }, []);

    const allArticles = useMemo(() => [
        { name: "Home", icon: "🏠", content: "# Datapedia\nОбщая база знаний.", owner: "System" },
        ...allDocs
    ], [allDocs]);

    const currentDoc = useMemo(() => {
        return allArticles.find(a => a.name === docName) || allArticles[0];
    }, [allArticles, docName]);

    const filteredSidebar = allArticles.filter(a => 
        a.name.toLowerCase().includes(sidebarQuery) || a.owner.toLowerCase().includes(sidebarQuery)
    );

    // ФУНКЦИЯ СОХРАНЕНИЯ (ИСПРАВЛЕННАЯ)
    const handleSave = async () => {
        if (!form.name.trim() || !currentUser) return;
        
        const newDoc = { 
            name: form.name.trim(), 
            content: form.content, 
            icon: form.icon, 
            owner: currentUser 
        };
        
        try {
            // 1. Сохраняем в личные документы (чтобы видеть в Datapedia)
            const myOldDocs = allDocs.filter(d => d.owner === currentUser);
            await syncDocs(currentUser, [...myOldDocs, newDoc]);

            // 2. ДОБАВЛЯЕМ В ПОИСКОВИК (Если стоит галочка)
            if (form.publishToSearch) {
                await addSearchItem(currentUser, {
                    name: newDoc.name,
                    desc: form.content.substring(0, 150).replace(/[#*`]/g, '') + "...",
                    url: `https://parrotsoft.vercel.app/datapedia?doc=${encodeURIComponent(newDoc.name)}`
                });
            }

            // Обновляем локальное состояние и закрываем
            setAllDocs(prev => [...prev, newDoc]);
            setIsModalOpen(false);
            setForm({ name: '', content: '', icon: '📄', publishToSearch: true });
            router.push(`?doc=${encodeURIComponent(newDoc.name)}`);
        } catch (e) { 
            console.error(e);
            alert("Ошибка при публикации"); 
        }
    };

    if (loading) return <div className="dp-loader">LOADING DATAPEDIA...</div>;

    return (
        <div className="dp-root">
            <button className="dp-mobile-menu-btn" onClick={() => setIsSideOpen(true)}>☰</button>
            {/* Сайдбар */}
            <aside className={`dp-sidebar ${isSideOpen ? 'open' : ''}`}>
                <div className="dp-side-top">
                    <div className="dp-brand">
                        <div className="dp-logo-cube" onClick={() => router.push('/datapedia')}>P</div>
                        <span>Datapedia</span>
                        <button className="dp-close-sidebar" onClick={() => setIsSideOpen(false)}>×</button>
                    </div>
                    
                    <div className="dp-search-bar">
                        <input placeholder="Search docs..." onChange={e => router.push(`?dq=${e.target.value}`)} />
                    </div>
                    <div className="dp-nav">
                        {filteredSidebar.map((a, i) => (
                            <div 
                                key={i} 
                                className={`dp-nav-item ${docName === a.name ? 'active' : ''}`}
                                onClick={() => {
                                    router.push(`?doc=${encodeURIComponent(a.name)}`);
                                    setIsSideOpen(false); // АВТО-ЗАКРЫТИЕ после выбора
                                }}
                            >
                                <span className="dp-nav-icon">{a.icon}</span>
                                <div className="dp-nav-txt">
                                    <div className="dp-nav-name">{a.name}</div>
                                    <div className="dp-nav-owner">@{a.owner}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="dp-side-bottom">
                    {currentUser && (
                        <button className="dp-btn-new" onClick={() => setIsModalOpen(true)}>
                            <span>+</span> New Article
                        </button>
                    )}
                </div>
            </aside>

            {/* Контент */}
            <main className="dp-main">
                <div className="dp-content-wrap">
                    <div className="dp-doc-header">
                        <div className="dp-doc-path">Library / {currentDoc.owner}</div>
                        <div className="dp-doc-title">
                            <span className="dp-huge-icon">{currentDoc.icon}</span>
                            <h1>{currentDoc.name}</h1>
                        </div>
                    </div>
                    <div className="markdown-body">
                        <ReactMarkdown rehypePlugins={[rehypeRaw]} remarkPlugins={[remarkGfm]}>
                            {currentDoc.content}
                        </ReactMarkdown>
                    </div>
                </div>
            </main>

            {/* Модалка с кнопкой "Добавить в поисковик" */}
            {isModalOpen && (
                <div className="dp-modal-overlay">
                    <div className="dp-modal">
                        <div className="dp-modal-head">
                            <h2>Write Documentation</h2>
                            <button className="dp-close" onClick={() => setIsModalOpen(false)}>×</button>
                        </div>
                        <div className="dp-modal-body">
                            <div className="dp-input-row">
                                <input placeholder="Article Title" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} />
                                <input placeholder="Icon" style={{width: 60}} value={form.icon} onChange={e=>setForm({...form, icon: e.target.value})} />
                            </div>
                            <div className="dp-editor-split">
                                <textarea placeholder="Markdown content..." value={form.content} onChange={e=>setForm({...form, content: e.target.value})} />
                                <div className="dp-preview markdown-body">
                                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{form.content || "*Preview here*"}</ReactMarkdown>
                                </div>
                            </div>
                        </div>
                        <div className="dp-modal-foot">
                            {/* ТА САМАЯ КНОПКА/ГАЛОЧКА */}
                            <label className="dp-toggle">
                                <input type="checkbox" checked={form.publishToSearch} onChange={e=>setForm({...form, publishToSearch: e.target.checked})} />
                                <span>Add to ParrotSearch index</span>
                            </label>
                            <div className="dp-foot-btns">
                                <button className="dp-btn-sec" onClick={() => setIsModalOpen(false)}>Cancel</button>
                                <button className="dp-btn-pri" onClick={handleSave}>Publish</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                .dp-root { display: flex; height: 100vh; background: #080808; color: #eee; font-family: 'Inter', sans-serif; }
                .dp-sidebar { width: 260px; background: #111; border-right: 1px solid #222; display: flex; flex-direction: column; }
                .dp-side-top { flex: 1; overflow-y: auto; padding: 20px 10px; }
                .dp-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; margin-bottom: 25px; cursor: pointer; padding: 0 10px; }
                .dp-logo-cube { width: 24px; height: 24px; background: #fff; color: #000; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 0.8rem; }
                .dp-search-bar { padding: 0 10px 20px; }
                .dp-search-bar input { width: 100%; background: #1a1a1a; border: 1px solid #333; padding: 8px; border-radius: 6px; color: #fff; outline: none; font-size: 0.85rem; }
                
                .dp-nav-item { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; cursor: pointer; transition: 0.2s; margin-bottom: 2px; }
                .dp-nav-item:hover { background: #1a1a1a; }
                .dp-nav-item.active { background: #fff; color: #000; }
                .dp-nav-name { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .dp-nav-owner { font-size: 0.7rem; color: #555; }
                .dp-nav-item.active .dp-nav-owner { color: #888; }

                .dp-side-bottom { padding: 20px; border-top: 1px solid #222; }
                .dp-btn-new { width: 100%; background: #fff; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem; transition: 0.2s; }
                .dp-btn-new:hover { opacity: 0.8; }

                .dp-main { flex: 1; overflow-y: auto; padding: 60px 40px; background: radial-gradient(circle at 0% 0%, #151515, #080808); }
                .dp-content-wrap { max-width: 800px; margin: 0 auto; }
                .dp-doc-header { margin-bottom: 40px; border-bottom: 1px solid #222; padding-bottom: 30px; }
                .dp-doc-path { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px; }
                .dp-doc-title { display: flex; align-items: center; gap: 20px; }
                .dp-huge-icon { font-size: 3.5rem; }
                h1 { font-size: 3.5rem; font-weight: 900; margin: 0; letter-spacing: -2px; line-height: 1; }

                .markdown-body { color: #aaa; line-height: 1.8; font-size: 1.1rem; }
                .markdown-body h2 { color: #fff; border-bottom: 1px solid #222; padding-bottom: 8px; margin-top: 2em; }

                .dp-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
                .dp-modal { background: #111; width: 90vw; height: 85vh; border: 1px solid #333; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
                .dp-modal-head { padding: 20px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
                .dp-close { background: none; border: none; color: #555; font-size: 2rem; cursor: pointer; }
                .dp-modal-body { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 15px; min-height: 0; }
                .dp-input-row { display: flex; gap: 10px; }
                .dp-input-row input { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 12px; border-radius: 8px; outline: none; flex: 1; }
                .dp-editor-split { display: flex; flex: 1; gap: 20px; min-height: 0; }
                .dp-editor-split textarea { flex: 1; background: #0a0a0a; border: 1px solid #333; color: #fff; padding: 15px; border-radius: 8px; resize: none; font-family: monospace; outline: none; }
                .dp-preview { flex: 1; border: 1px solid #222; border-radius: 8px; padding: 15px; overflow-y: auto; background: #050505; }
                
                .dp-modal-foot { padding: 20px; border-top: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
                .dp-toggle { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: #888; cursor: pointer; }
                .dp-foot-btns { display: flex; gap: 15px; }
                .dp-btn-pri { background: #fff; color: #000; border: none; padding: 10px 25px; border-radius: 6px; font-weight: 700; cursor: pointer; }
                .dp-btn-sec { background: transparent; color: #555; border: none; cursor: pointer; }
                /* Кнопка меню (по умолчанию скрыта) */
.dp-mobile-menu-btn {
    display: none;
    position: fixed;
    top: 15px;
    left: 15px;
    z-index: 90;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 8px;
    width: 40px;
    height: 40px;
    font-size: 20px;
    cursor: pointer;
}

.dp-close-sidebar { display: none; }

@media (max-width: 850px) {
    .dp-mobile-menu-btn { display: block; }

    .dp-sidebar {
        position: fixed;
        left: -100%; /* Прячем за экран */
        top: 0;
        bottom: 0;
        width: 85% !important; /* На весь экран (почти) */
        z-index: 1000;
        transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 20px 0 50px rgba(0,0,0,0.5);
    }

    .dp-sidebar.open {
        left: 0; /* Выезжает */
    }

    .dp-close-sidebar {
        display: block;
        margin-left: auto;
        background: none;
        border: none;
        color: #555;
        font-size: 24px;
    }

    .dp-sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        backdrop-filter: blur(4px);
        z-index: 999;
    }

    .dp-main {
        padding: 80px 20px 30px; /* Отступ сверху для кнопки */
    }

    h1 {
        font-size: 2.5rem;
    }

    .dp-nav-txt {
        display: block !important; /* Возвращаем текст в мобильном меню */
    }
}


@media (max-width: 850px) {
    /* Базовый стиль для заголовка сайдбара */
.dp-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 25px;
    padding: 0 10px;
}

/* На ПК кнопка закрытия нам не нужна */
.dp-close-sidebar {
    display: none;
}

/* Убираем старый маргин у бренда, так как он теперь в контейнере */
.dp-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 800;
    cursor: pointer;
    margin-bottom: 0 !important; 
}
    .dp-close-sidebar {
        display: flex; /* Показываем только на мобилках */
        align-items: center;
        justify-content: center;
        background: #1a1a1a;
        border: none;
        color: #888;
        font-size: 24px;
        width: 32px;
        height: 32px;
        border-radius: 6px;
        cursor: pointer;
        line-height: 1;
        padding-bottom: 4px; /* Небольшая корректировка центровки крестика */
    }

    .dp-close-sidebar:active {
        background: #333;
        color: #fff;
    }
}
            `}</style>
        </div>
    );
}