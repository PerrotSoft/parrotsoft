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
    
    const [isSideOpen, setIsSideOpen] = useState(false);
    const [allDocs, setAllDocs] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [editingDoc, setEditingDoc] = useState(null);

    // Состояния для сайдбара и комментариев
    const [searchText, setSearchText] = useState('');
    const [expandedNodes, setExpandedNodes] = useState([]);
    const [sidebarStack, setSidebarStack] = useState([]);
    const [commentText, setCommentText] = useState('');

    const [form, setForm] = useState({ 
        name: '', 
        content: '', 
        icon: '📄', 
        parentId: '', 
        publishToSearch: true 
    });

    const loadData = async () => {
        setLoading(true);
        try {
            const allUsers = await getGlobalSearchList();
            const combined = [];
            allUsers.forEach(user => {
                if (user.docs && Array.isArray(user.docs)) {
                    user.docs.forEach(d => {
                        combined.push({ ...d, owner: user.username, id: d.id || d.name });
                    });
                }
            });
            setAllDocs(combined);
        } catch (e) { console.error(e); }
        setLoading(false);
    };

    useEffect(() => {
        const saved = localStorage.getItem('p_user');
        if (saved) setCurrentUser(saved);
        loadData();
    }, []);

    const allArticles = useMemo(() => [
        { name: "Home", icon: "🏠", content: "# Datapedia\nGeneral knowledge base.", owner: "System", id: "home", comments: [] },
        ...allDocs
    ], [allDocs]);

    const currentDoc = useMemo(() => {
        return allArticles.find(a => a.name === docName) || allArticles[0];
    }, [allArticles, docName]);

    // Сохранение (Создание/Обновление)
    const handleSave = async () => {
        if (!form.name.trim() || !currentUser) return;
        
        const newDoc = { 
            ...form,
            name: form.name.trim(),
            owner: currentUser,
            id: editingDoc ? editingDoc.id : Date.now().toString(),
            comments: editingDoc ? editingDoc.comments || [] : [] // Сохраняем комменты при редактировании
        };
        
        try {
            let updatedDocs;
            if (editingDoc) {
                updatedDocs = allDocs.map(d => (d.id === editingDoc.id && d.owner === currentUser) ? newDoc : d)
                    .filter(d => d.owner === currentUser);
            } else {
                updatedDocs = [...allDocs.filter(d => d.owner === currentUser), newDoc];
            }

            await syncDocs(currentUser, updatedDocs);
            
            if (form.publishToSearch) {
                await addSearchItem(currentUser, {
                    name: newDoc.name,
                    desc: form.content.substring(0, 150).replace(/[#*`]/g, '') + "...",
                    url: `https://parrotsoft.vercel.app/datapedia?doc=${encodeURIComponent(newDoc.name)}`
                });
            }

            await loadData();
            setIsModalOpen(false);
            setEditingDoc(null);
            setForm({ name: '', content: '', icon: '📄', parentId: '', publishToSearch: true });
            router.push(`?doc=${encodeURIComponent(newDoc.name)}`);
        } catch (e) { alert("Ошибка при сохранении"); }
    };

    // Удаление статьи
    const handleDelete = async () => {
        if (!confirm(`Вы точно хотите удалить статью "${currentDoc.name}"? Это действие необратимо.`)) return;
        
        try {
            // Оставляем только те документы текущего юзера, которые НЕ совпадают с удаляемым ID
            const updatedDocs = allDocs.filter(d => d.owner === currentUser && d.id !== currentDoc.id);
            await syncDocs(currentUser, updatedDocs);
            
            await loadData();
            router.push('/datapedia'); // Возвращаемся на главную
        } catch (e) { alert("Ошибка при удалении"); }
    };

    // Добавление комментария
    const handleAddComment = async () => {
        if (!commentText.trim() || !currentUser || currentDoc.id === 'home') return;

        const newComment = {
            id: Date.now().toString(),
            author: currentUser,
            text: commentText.trim(),
            date: new Date().toISOString()
        };

        const updatedDoc = {
            ...currentDoc,
            comments: [...(currentDoc.comments || []), newComment]
        };

        try {
            // Обновляем общий стейт для мгновенного отображения
            const newAllDocs = allDocs.map(d => d.id === currentDoc.id ? updatedDoc : d);
            setAllDocs(newAllDocs);
            setCommentText('');

            // Отправляем изменения владельцу статьи (чтобы сохранить коммент в его базу)
            const ownerDocs = newAllDocs.filter(d => d.owner === currentDoc.owner);
            await syncDocs(currentDoc.owner, ownerDocs);
        } catch (e) { alert("Ошибка отправки комментария"); }
    };

    const openEdit = () => {
        setEditingDoc(currentDoc);
        setForm({
            name: currentDoc.name,
            content: currentDoc.content,
            icon: currentDoc.icon,
            parentId: currentDoc.parentId || '',
            publishToSearch: true
        });
        setIsModalOpen(true);
    };

    const handleArticleClick = (article) => {
        router.push(`?doc=${encodeURIComponent(article.name)}`);
        setSearchText(''); 

        const children = allArticles.filter(a => a.parentId === article.id);
        
        if (children.length > 0) {
            if (children.length <= 3) {
                setExpandedNodes(prev => 
                    prev.includes(article.id) ? prev.filter(id => id !== article.id) : [...prev, article.id]
                );
            } else {
                setSidebarStack(prev => [...prev, article]);
            }
        } else {
            if (window.innerWidth <= 850) setIsSideOpen(false);
        }
    };

    const NavTree = ({ parentId = '', level = 0 }) => {
        const children = allArticles.filter(a => 
            parentId === '' ? !a.parentId : a.parentId === parentId
        );

        if (children.length === 0) return null;

        return (
            <div className="dp-nav-level" style={{ marginLeft: level > 0 ? '12px' : '0' }}>
                {children.map((a) => {
                    const childCount = allArticles.filter(child => child.parentId === a.id).length;
                    const hasChildren = childCount > 0;
                    const isExpanded = expandedNodes.includes(a.id);
                    
                    return (
                        <div key={a.id}>
                            <div 
                                className={`dp-nav-item ${docName === a.name ? 'active' : ''}`}
                                onClick={() => handleArticleClick(a)}
                            >
                                <span className="dp-nav-icon">{a.icon}</span>
                                <div className="dp-nav-txt">
                                    <div className="dp-nav-name">{a.name}</div>
                                    {level === 0 && <div className="dp-nav-owner">@{a.owner}</div>}
                                </div>
                                {hasChildren && (
                                    <span className="dp-nav-chevron">
                                        {childCount > 3 ? '⮞' : isExpanded ? '▼' : '▶'}
                                    </span>
                                )}
                            </div>
                            {isExpanded && <NavTree parentId={a.id} level={level + 1} />}
                        </div>
                    );
                })}
            </div>
        );
    };

    if (loading) return <div className="dp-loader">ЗАГРУЗКА...</div>;

    return (
        <div className="dp-root">
            <button className="dp-mobile-menu-btn" onClick={() => setIsSideOpen(true)}>☰</button>
            
            <aside className={`dp-sidebar ${isSideOpen ? 'open' : ''}`}>
                <div className="dp-side-top">
                    <div className="dp-brand" onClick={() => {
                        setSidebarStack([]); 
                        setSearchText('');
                        router.push('/datapedia');
                    }}>
                        <div className="dp-logo-cube">P</div>
                        <span>Datapedia</span>
                    </div>
                    <div className="dp-search-bar">
                        <input 
                            placeholder="Поиск статей..." 
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)} 
                        />
                    </div>
                    
                    <nav className="dp-nav">
                        {searchText ? (
                            allArticles
                                .filter(a => a.name.toLowerCase().includes(searchText.toLowerCase()) || a.owner.toLowerCase().includes(searchText.toLowerCase()))
                                .map(a => (
                                    <div key={a.id} className={`dp-nav-item ${docName === a.name ? 'active' : ''}`} onClick={() => handleArticleClick(a)}>
                                        <span className="dp-nav-icon">{a.icon}</span>
                                        <div className="dp-nav-txt">
                                            <div className="dp-nav-name">{a.name}</div>
                                            <div className="dp-nav-owner">@{a.owner}</div>
                                        </div>
                                    </div>
                                ))
                        ) : sidebarStack.length > 0 ? (
                            <>
                                <button className="dp-back-btn" onClick={() => setSidebarStack(prev => prev.slice(0, -1))}>⬅ Назад</button>
                                <div className="dp-stack-title">Папка: {sidebarStack[sidebarStack.length - 1].name}</div>
                                <NavTree parentId={sidebarStack[sidebarStack.length - 1].id} level={0} />
                            </>
                        ) : (
                            <NavTree parentId="" level={0} />
                        )}
                    </nav>
                </div>
                <div className="dp-side-bottom">
                    {currentUser && (
                        <button className="dp-btn-new" onClick={() => { setEditingDoc(null); setIsModalOpen(true); }}>
                            + Новая статья
                        </button>
                    )}
                </div>
            </aside>

            <main className="dp-main">
                <div className="dp-content-wrap">
                    <div className="dp-doc-header">
                        <div className="dp-header-meta">
                            <div className="dp-doc-path">Библиотека / {currentDoc.owner}</div>
                            {/* Кнопки теперь выровнены по левому краю внизу мета-блока */}
                            {currentUser === currentDoc.owner && currentDoc.id !== 'home' && (
                                <div className="dp-doc-actions">
                                    <button className="dp-edit-btn" onClick={openEdit}>✎ Редактировать</button>
                                    <button className="dp-delete-btn" onClick={handleDelete}>🗑 Удалить</button>
                                </div>
                            )}
                        </div>
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

                    {/* БЛОК КОММЕНТАРИЕВ */}
                    {currentDoc.id !== 'home' && (
                        <div className="dp-comments-section">
                            <h3>Комментарии ({currentDoc.comments?.length || 0})</h3>
                            
                            <div className="dp-comments-list">
                                {currentDoc.comments?.map(c => (
                                    <div key={c.id} className="dp-comment">
                                        <div className="dp-comment-head">
                                            <strong>@{c.author}</strong>
                                            <span>{new Date(c.date).toLocaleString('ru-RU')}</span>
                                        </div>
                                        <div className="dp-comment-text">{c.text}</div>
                                    </div>
                                ))}
                            </div>

                            {currentUser ? (
                                <div className="dp-comment-input">
                                    <textarea 
                                        value={commentText} 
                                        onChange={e => setCommentText(e.target.value)} 
                                        placeholder="Написать комментарий..." 
                                    />
                                    <button onClick={handleAddComment}>Отправить</button>
                                </div>
                            ) : (
                                <div className="dp-login-prompt">Войдите в систему, чтобы оставить комментарий.</div>
                            )}
                        </div>
                    )}
                </div>
            </main>

            {/* МОДАЛЬНОЕ ОКНО СОЗДАНИЯ/РЕДАКТИРОВАНИЯ */}
            {isModalOpen && (
                <div className="dp-modal-overlay">
                    <div className="dp-modal">
                        <div className="dp-modal-head">
                            <h2>{editingDoc ? 'Редактировать статью' : 'Новая статья'}</h2>
                            <button className="dp-close" onClick={() => setIsModalOpen(false)}>×</button>
                        </div>
                        <div className="dp-modal-body">
                            <div className="dp-input-row">
                                <input placeholder="Название" value={form.name} onChange={e=>setForm({...form, name: e.target.value})} />
                                <input placeholder="Иконка" style={{width: 60}} value={form.icon} onChange={e=>setForm({...form, icon: e.target.value})} />
                                <select 
                                    value={form.parentId} 
                                    onChange={e => setForm({...form, parentId: e.target.value})}
                                    className="dp-select-parent"
                                >
                                    <option value="">Без родителя (Главная)</option>
                                    {allArticles.filter(a => a.id !== editingDoc?.id && a.owner === currentUser).map(a => (
                                        <option key={a.id} value={a.id}>{a.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="dp-editor-split">
                                <textarea placeholder="Markdown текст..." value={form.content} onChange={e=>setForm({...form, content: e.target.value})} />
                                <div className="dp-preview markdown-body">
                                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{form.content || "*Предпросмотр*"}</ReactMarkdown>
                                </div>
                            </div>
                        </div>
                        <div className="dp-modal-foot">
                            <button className="dp-btn-pri" onClick={handleSave}>
                                {editingDoc ? 'Обновить' : 'Опубликовать'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
                .dp-root { display: flex; height: 100vh; background: #080808; color: #eee; font-family: 'Inter', system-ui, sans-serif; }
                .dp-sidebar { width: 280px; background: #111; border-right: 1px solid #222; display: flex; flex-direction: column; }
                .dp-side-top { flex: 1; overflow-y: auto; padding: 20px 10px; }
                
                .dp-brand { display: flex; align-items: center; gap: 10px; font-weight: 800; margin-bottom: 25px; cursor: pointer; padding: 0 10px; }
                .dp-logo-cube { width: 24px; height: 24px; background: #fff; color: #000; display: flex; align-items: center; justify-content: center; border-radius: 4px; font-size: 0.8rem; }
                
                .dp-search-bar { padding: 0 10px 20px; }
                .dp-search-bar input { width: 100%; background: #1a1a1a; border: 1px solid #333; padding: 10px; border-radius: 8px; color: #fff; outline: none; font-size: 0.85rem; }
                
                .dp-nav-item { display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 8px; cursor: pointer; transition: 0.2s; margin-bottom: 2px; }
                .dp-nav-item:hover { background: #1a1a1a; }
                .dp-nav-item.active { background: #fff; color: #000; }
                .dp-nav-name { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .dp-nav-owner { font-size: 0.7rem; color: #555; }
                .dp-nav-item.active .dp-nav-owner { color: #888; }
                
                .dp-nav-level { border-left: 1px solid #222; margin-top: 5px; margin-bottom: 5px; }
                .dp-nav-chevron { margin-left: auto; font-size: 0.7rem; color: #555; }
                .dp-back-btn { background: #1a1a1a; border: 1px solid #333; color: #aaa; cursor: pointer; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; margin-bottom: 10px; display: inline-flex; transition: 0.2s; margin-left: 10px; }
                .dp-back-btn:hover { color: #fff; background: #222; }
                .dp-stack-title { font-size: 0.7rem; color: #777; text-transform: uppercase; padding: 0 10px 10px; border-bottom: 1px solid #222; margin-bottom: 10px; margin-left: 10px; font-weight: 700; letter-spacing: 1px; }

                .dp-side-bottom { padding: 20px; border-top: 1px solid #222; }
                .dp-btn-new { width: 100%; background: #fff; color: #000; border: none; padding: 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.9rem; transition: 0.2s; }
                .dp-btn-new:hover { opacity: 0.8; }

                .dp-main { flex: 1; overflow-y: auto; padding: 60px 40px; background: radial-gradient(circle at 0% 0%, #151515, #080808); }
                .dp-content-wrap { max-width: 800px; margin: 0 auto; }
                .dp-doc-header { margin-bottom: 40px; border-bottom: 1px solid #222; padding-bottom: 30px; }
                
                /* НОВОЕ РАСПОЛОЖЕНИЕ КНОПОК */
                .dp-header-meta { display: flex; flex-direction: column; gap: 12px; margin-bottom: 15px; }
                .dp-doc-path { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 1px; }
                .dp-doc-actions { display: flex; gap: 10px; align-items: center; justify-content: flex-start; }
                
                .dp-edit-btn, .dp-delete-btn { background: #1a1a1a; border: 1px solid #333; color: #aaa; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.8rem; transition: 0.2s; display: flex; align-items: center; gap: 5px;}
                .dp-edit-btn:hover { color: #fff; border-color: #555; background: #222; }
                .dp-delete-btn:hover { color: #ff4d4d; border-color: #ff4d4d; background: rgba(255, 77, 77, 0.1); }
                
                .dp-doc-title { display: flex; align-items: center; gap: 20px; margin-top: 10px; }
                .dp-huge-icon { font-size: 3.5rem; }
                h1 { font-size: 3.5rem; font-weight: 900; margin: 0; letter-spacing: -2px; line-height: 1; }

                .markdown-body { color: #aaa; line-height: 1.8; font-size: 1.1rem; }
                .markdown-body h2 { color: #fff; border-bottom: 1px solid #222; padding-bottom: 8px; margin-top: 2em; }

                /* СТИЛИ КОММЕНТАРИЕВ */
                .dp-comments-section { margin-top: 60px; padding-top: 30px; border-top: 1px solid #222; }
                .dp-comments-section h3 { font-size: 1.2rem; margin-bottom: 20px; color: #fff; }
                .dp-comments-list { display: flex; flex-direction: column; gap: 15px; margin-bottom: 25px; }
                .dp-comment { background: #111; border: 1px solid #222; padding: 15px; border-radius: 10px; }
                .dp-comment-head { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 0.85rem; color: #888; }
                .dp-comment-head strong { color: #0070f3; }
                .dp-comment-text { color: #ddd; font-size: 0.95rem; line-height: 1.5; white-space: pre-wrap; }
                
                .dp-comment-input { display: flex; flex-direction: column; gap: 10px; }
                .dp-comment-input textarea { width: 100%; height: 80px; background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 12px; border-radius: 8px; resize: vertical; outline: none; font-family: inherit; }
                .dp-comment-input textarea:focus { border-color: #555; }
                .dp-comment-input button { align-self: flex-end; background: #fff; color: #000; border: none; padding: 8px 20px; border-radius: 6px; font-weight: 600; cursor: pointer; transition: 0.2s; }
                .dp-comment-input button:hover { opacity: 0.8; }
                .dp-login-prompt { background: #1a1a1a; padding: 15px; text-align: center; border-radius: 8px; color: #888; font-size: 0.9rem; }

                .dp-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); backdrop-filter: blur(10px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
                .dp-modal { background: #111; width: 90vw; height: 85vh; border: 1px solid #333; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
                .dp-modal-head { padding: 20px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; align-items: center; }
                .dp-close { background: none; border: none; color: #555; font-size: 2rem; cursor: pointer; transition: 0.2s; }
                .dp-close:hover { color: #fff; }
                .dp-modal-body { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 15px; min-height: 0; }
                .dp-input-row { display: flex; gap: 10px; }
                .dp-input-row input { background: #1a1a1a; border: 1px solid #333; color: #fff; padding: 12px; border-radius: 8px; outline: none; flex: 1; }
                .dp-select-parent { background: #1a1a1a; border: 1px solid #333; color: #fff; border-radius: 8px; padding: 0 10px; outline: none; }
                .dp-editor-split { display: flex; flex: 1; gap: 20px; min-height: 0; }
                .dp-editor-split textarea { flex: 1; background: #0a0a0a; border: 1px solid #333; color: #fff; padding: 15px; border-radius: 8px; resize: none; font-family: monospace; outline: none; }
                .dp-preview { flex: 1; border: 1px solid #222; border-radius: 8px; padding: 15px; overflow-y: auto; background: #050505; }
                
                .dp-modal-foot { padding: 20px; border-top: 1px solid #222; display: flex; justify-content: flex-end; }
                .dp-btn-pri { background: #fff; color: #000; border: none; padding: 10px 25px; border-radius: 6px; font-weight: 700; cursor: pointer; transition: 0.2s; }
                .dp-btn-pri:hover { background: #ddd; }

                .dp-mobile-menu-btn { display: none; position: fixed; top: 15px; left: 15px; z-index: 90; background: #fff; color: #000; border: none; border-radius: 8px; width: 40px; height: 40px; font-size: 20px; cursor: pointer; }

                @media (max-width: 850px) {
                    .dp-mobile-menu-btn { display: block; }
                    .dp-sidebar { position: fixed; left: -100%; top: 0; bottom: 0; width: 85% !important; z-index: 1000; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 20px 0 50px rgba(0,0,0,0.5); }
                    .dp-sidebar.open { left: 0; }
                    /* Больший отступ сверху на мобилке, чтобы кнопки не налезли на бургер */
                    .dp-main { padding: 80px 20px 30px; }
                    h1 { font-size: 2.5rem; }
                    .dp-editor-split { flex-direction: column; }
                }
            `}</style>
        </div>
    );
}