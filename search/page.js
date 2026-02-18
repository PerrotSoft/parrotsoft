'use client';
export const dynamic = 'force-dynamic';
import { useState, useMemo, useEffect, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SearchPage({ dbActions }) {
    const searchParams = useSearchParams();
    
    // --- СОСТОЯНИЯ ---
    const [query, setQuery] = useState(searchParams.get('q') || '');
    const [projects, setProjects] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPending, startTransition] = useTransition(); // Для плавности
    
    // Данные для новой метки (добавил описание!)
    const [newEntry, setNewEntry] = useState({ name: '', url: '', desc: '' });
    
    const username = "1";

    // 1. ЗАГРУЗКА БАЗЫ (Turso)
    useEffect(() => {
        let mounted = true;
        if (dbActions?.getProjects) {
            dbActions.getProjects(username).then(data => {
                if (mounted && Array.isArray(data)) setProjects(data);
            });
        }
        return () => { mounted = false };
    }, [dbActions]);

    // 2. УМНАЯ ФИЛЬТРАЦИЯ
    const results = useMemo(() => {
        const term = query.toLowerCase().trim();
        if (!term) return [];
        return projects.filter(p => 
            p.name?.toLowerCase().includes(term) || 
            p.url?.toLowerCase().includes(term) ||
            p.desc?.toLowerCase().includes(term)
        );
    }, [query, projects]);

    // Проверка: является ли запрос ссылкой?
    const isQueryUrl = useMemo(() => {
        return query.includes('.') && !query.includes(' ');
    }, [query]);

    // 3. ДОБАВЛЕНИЕ (Оптимистичное)
    const handleAdd = () => {
        if (!newEntry.name || !newEntry.url) return;

        // Нормализация URL
        let finalUrl = newEntry.url;
        if (!finalUrl.startsWith('http')) finalUrl = `https://${finalUrl}`;

        const optimisticItem = {
            id: Date.now(),
            name: newEntry.name,
            url: finalUrl,
            desc: newEntry.desc || 'Нет описания',
            type: 'turso_site'
        };

        const updatedList = [optimisticItem, ...projects]; // Новые сверху
        setProjects(updatedList);
        setIsModalOpen(false);
        setNewEntry({ name: '', url: '', desc: '' });

        // Фоновая запись в базу
        startTransition(async () => {
            if (dbActions?.syncProjects) {
                await dbActions.syncProjects(username, updatedList);
            }
        });
    };

    // Глобальный поиск (если локально пусто)
    const handleGlobalSearch = () => {
        window.open(`https://www.google.com/search?q=${query}`, '_blank');
    };

    return (
        <div className="google-shell">
            {/* --- ШАПКА --- */}
            <header className="search-header">
                <div className="brand">Parrot<span className="brand-light">Search</span></div>
                
                <div className="search-bar-wrapper block-v1">
                    <span className="search-icon">🔍</span>
                    <input 
                        className="main-input"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Поиск в системе или ввод URL..."
                        autoFocus
                    />
                    {query && <button className="clear-btn" onClick={() => setQuery('')}>✕</button>}
                </div>
            </header>

            {/* --- РЕЗУЛЬТАТЫ --- */}
            <main className="results-container">
                {/* 1. Если это URL - предлагаем перейти сразу */}
                {isQueryUrl && (
                    <div className="card result-card direct-link" onClick={() => window.open(query.startsWith('http') ? query : `https://${query}`)}>
                        <div className="icon-box">🌐</div>
                        <div className="content-box">
                            <div className="title">Перейти по адресу</div>
                            <div className="url-text">{query}</div>
                        </div>
                        <div className="action-arrow">➔</div>
                    </div>
                )}

                {/* 2. Локальные результаты из БД */}
                {results.map(item => (
                    <div key={item.id} className="card result-card" onClick={() => window.open(item.url)}>
                        {/* АВТОМАТИЧЕСКАЯ ИКОНКА (FAVICON) ОТ GOOGLE */}
                        <div className="favicon-wrapper">
                            <img 
                                src={`https://www.google.com/s2/favicons?domain=${item.url}&sz=128`} 
                                alt="icon" 
                                onError={(e) => e.target.style.display='none'}
                            />
                        </div>
                        
                        <div className="content-box">
                            <div className="site-info">
                                <span className="site-name">{item.name}</span>
                                <span className="site-url-mini">{new URL(item.url).hostname}</span>
                            </div>
                            <div className="site-url-full">{item.url}</div>
                            <div className="site-desc">{item.desc}</div>
                        </div>
                    </div>
                ))}

                {/* 3. ФУНКЦИЯ "ДО-ПОИСК" (Если локально мало или пусто) */}
                {query && (
                    <div className="global-search-section">
                        {results.length === 0 && <div className="no-local">В базе ParrotSoft ничего не найдено.</div>}
                        
                        <div className="card result-card global-card" onClick={handleGlobalSearch}>
                            <div className="icon-box google-g">G</div>
                            <div className="content-box">
                                <div className="title">Искать "{query}" в Интернете</div>
                                <div className="site-desc">Глобальный поиск по всем сайтам мира</div>
                            </div>
                        </div>
                    </div>
                )}
            </main>

            {/* --- ПЛАВАЮЩАЯ КНОПКА (FAB) --- */}
            <button className="fab-btn" onClick={() => setIsModalOpen(true)}>
                <span className="plus-icon">+</span>
            </button>

            {/* --- МОДАЛКА (Стеклянный стиль) --- */}
            {isModalOpen && (
                <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-glass" onClick={e => e.stopPropagation()}>
                        <h2 className="modal-title">Новая закладка</h2>
                        
                        <div className="input-group">
                            <label>Название сайта</label>
                            <input className="inp-glass" value={newEntry.name} onChange={e => setNewEntry({...newEntry, name: e.target.value})} placeholder="Например: YouTube" />
                        </div>

                        <div className="input-group">
                            <label>URL Адрес</label>
                            <input className="inp-glass" value={newEntry.url} onChange={e => setNewEntry({...newEntry, url: e.target.value})} placeholder="youtube.com" />
                        </div>

                        <div className="input-group">
                            <label>Описание (для поиска)</label>
                            <input className="inp-glass" value={newEntry.desc} onChange={e => setNewEntry({...newEntry, desc: e.target.value})} placeholder="Видеохостинг, клипы..." />
                        </div>

                        <div className="modal-footer">
                            <button className="btn-cancel" onClick={() => setIsModalOpen(false)}>Отмена</button>
                            <button className="btn-save" onClick={handleAdd}>Сохранить</button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                /* --- ГЛОБАЛЬНЫЙ ЛЕЙАУТ --- */
                .google-shell {
                    min-height: 100vh;
                    background: #111; /* Глубокий темный фон */
                    color: #e8eaed;
                    font-family: 'Roboto', sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    padding-bottom: 100px;
                }

                /* --- ПОИСКОВАЯ СТРОКА (КАК У GOOGLE) --- */
                .search-header {
                    width: 100%;
                    max-width: 650px;
                    padding: 40px 20px 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 20px;
                }
                .brand { font-size: 2rem; font-weight: 700; color: #fff; letter-spacing: -1px; }
                .brand-light { color: #8ab4f8; }

                .search-bar-wrapper {
                    width: 100%;
                    background: #303134;
                    border: 1px solid #5f6368;
                    border-radius: 24px;
                    display: flex;
                    align-items: center;
                    padding: 0 15px;
                    height: 50px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    transition: 0.2s;
                }
                .search-bar-wrapper:hover, .search-bar-wrapper:focus-within {
                    background: #3c4043;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.4);
                    border-color: rgba(255,255,255,0.3);
                }
                .search-icon { opacity: 0.5; margin-right: 10px; }
                .main-input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    color: white;
                    font-size: 16px;
                    outline: none;
                }
                .clear-btn { background: none; border: none; color: #9aa0a6; cursor: pointer; font-size: 16px; }

                /* --- СПИСОК РЕЗУЛЬТАТОВ --- */
                .results-container { width: 100%; max-width: 650px; padding: 0 20px; display: flex; flex-direction: column; gap: 15px; }
                
                .result-card {
                    background: #202124;
                    padding: 15px;
                    border-radius: 12px;
                    cursor: pointer;
                    display: flex;
                    gap: 15px;
                    align-items: center; /* Центрируем иконку и текст */
                    border: 1px solid rgba(255,255,255,0.05);
                    transition: transform 0.1s, background 0.2s;
                }
                .result-card:hover { background: #292a2d; }
                .result-card:active { transform: scale(0.99); }

                /* ИКОНКИ */
                .favicon-wrapper {
                    width: 32px; height: 32px;
                    background: #3c4043;
                    border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    overflow: hidden;
                    flex-shrink: 0;
                }
                .favicon-wrapper img { width: 20px; height: 20px; object-fit: contain; }

                /* ТЕКСТ РЕЗУЛЬТАТА */
                .content-box { flex: 1; display: flex; flex-direction: column; justify-content: center; }
                .site-info { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
                .site-name { font-size: 18px; color: #8ab4f8; font-weight: 500; }
                .site-url-mini { font-size: 12px; color: #9aa0a6; }
                .site-url-full { font-size: 12px; color: #9aa0a6; margin-bottom: 4px; display: none; } /* Скрываем полный URL для чистоты */
                .site-desc { font-size: 14px; color: #bdc1c6; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

                /* СПЕЦИАЛЬНЫЕ КАРТОЧКИ */
                .global-search-section { margin-top: 20px; border-top: 1px solid #3c4043; padding-top: 20px; }
                .no-local { text-align: center; color: #9aa0a6; margin-bottom: 15px; font-size: 14px; }
                .global-card { border: 1px dashed #5f6368; }
                .google-g { color: #fff; font-weight: bold; font-size: 20px; background: #4285F4; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; }

                .direct-link { background: rgba(138, 180, 248, 0.1); border-color: rgba(138, 180, 248, 0.3); }
                .icon-box { font-size: 20px; width: 32px; text-align: center; }

                /* --- FAB (КНОПКА +) --- */
                .fab-btn {
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    width: 60px; height: 60px;
                    border-radius: 20px; /* Квадрокруг, современно */
                    background: linear-gradient(135deg, #8ab4f8, #4285f4);
                    border: none;
                    box-shadow: 0 10px 25px rgba(66, 133, 244, 0.4);
                    cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    z-index: 100;
                }
                .fab-btn:hover { transform: scale(1.1) rotate(90deg); box-shadow: 0 15px 35px rgba(66, 133, 244, 0.6); }
                .plus-icon { font-size: 30px; color: #000; font-weight: bold; }

                /* --- МОДАЛКА --- */
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(10px); z-index: 200; display: flex; align-items: center; justify-content: center; }
                .modal-glass {
                    width: 400px;
                    background: #202124;
                    border: 1px solid #3c4043;
                    border-radius: 24px;
                    padding: 30px;
                    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
                }
                .modal-title { margin: 0 0 25px 0; font-weight: 500; color: #8ab4f8; }
                .input-group { margin-bottom: 20px; }
                .input-group label { display: block; font-size: 12px; color: #9aa0a6; margin-bottom: 8px; margin-left: 5px; }
                .inp-glass {
                    width: 100%;
                    padding: 12px 15px;
                    background: #303134;
                    border: 1px solid transparent;
                    border-radius: 12px;
                    color: white;
                    outline: none;
                    transition: 0.2s;
                }
                .inp-glass:focus { border-color: #8ab4f8; background: #3c4043; }
                
                .modal-footer { display: flex; justify-content: flex-end; gap: 15px; margin-top: 30px; }
                .btn-cancel { background: transparent; color: #9aa0a6; border: none; cursor: pointer; padding: 10px 20px; }
                .btn-save { 
                    background: #8ab4f8; color: #202124; 
                    border: none; border-radius: 20px; 
                    padding: 10px 25px; font-weight: bold; cursor: pointer;
                }
                .btn-save:hover { opacity: 0.9; }
            `}</style>
        </div>
    );
}