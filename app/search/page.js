'use client';
export const dynamic = 'force-dynamic';

import { useState, useMemo, useEffect, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
// Импортируем функции напрямую, чтобы не зависеть от пропсов layout
import { getGlobalSearchList, addSearchItem } from '../layout';

export default function SearchPage() {
    const searchParams = useSearchParams();
    const [query, setQuery] = useState(searchParams.get('q') || '');
    const [allData, setAllData] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPending, startTransition] = useTransition();
    const [newEntry, setNewEntry] = useState({ name: '', url: '', desc: '' });

    // ID пользователя "2" из твоей базы данных
    const currentUserID = "2"; 

    // Функция загрузки данных
    const load = async () => {
        try {
            const data = await getGlobalSearchList();
            if (data) setAllData(data);
        } catch (e) {
            console.error("Ошибка загрузки данных:", e);
        }
    };

    // Загружаем при старте
    useEffect(() => {
        load();
    }, []);

    // Логика поиска
    const results = useMemo(() => {
        const term = query.toLowerCase().trim();
        if (!term) return [];
        let found = [];
        allData.forEach(user => {
            (user.projects || []).forEach(p => {
                if (
                    p.name?.toLowerCase().includes(term) || 
                    p.desc?.toLowerCase().includes(term)
                ) {
                    found.push({ ...p, owner: user.username });
                }
            });
        });
        return found;
    }, [query, allData]);

    // Функция сохранения
    const handleSave = () => {
        if (!newEntry.name || !newEntry.url) return;
        
        startTransition(async () => {
            try {
                // Вызываем импортированную функцию напрямую
                const res = await addSearchItem(currentUserID, newEntry);
                if (res && res.success) {
                    await load(); // Обновляем список
                    setIsModalOpen(false);
                    setNewEntry({ name: '', url: '', desc: '' });
                }
            } catch (e) {
                console.error("Ошибка при сохранении:", e);
            }
        });
    };

    return (
        <div className="search-page">
            <div className="container">
                <h1 className="logo">Parrot<span>Search</span></h1>
                
                <div className="search-input-container">
                    <input 
                        value={query} 
                        onChange={e => setQuery(e.target.value)} 
                        placeholder="Поиск в базе..."
                        autoFocus
                    />
                </div>

                <div className="results-list">
                    {results.map((item, i) => (
                        <div key={i} className="result-item" onClick={() => window.open(item.url.includes('http') ? item.url : `https://${item.url}`)}>
                            <img src={`https://www.google.com/s2/favicons?domain=${item.url}&sz=64`} alt="ico" />
                            <div className="text">
                                <div className="title">{item.name} <span className="user">@{item.owner}</span></div>
                                <div className="description">{item.desc}</div>
                            </div>
                        </div>
                    ))}
                    
                    {query && results.length === 0 && (
                        <div className="not-found">
                            В базе ParrotSoft ничего не найдено для "{query}".
                            <button onClick={() => window.open(`https://google.com/search?q=${query}`)}>Искать в Google</button>
                        </div>
                    )}
                </div>

                <button className="add-fab" onClick={() => setIsModalOpen(true)}>+</button>
            </div>

            {isModalOpen && (
                <div className="modal-wrap">
                    <div className="modal-box">
                        <h3>Новая запись</h3>
                        <input 
                            placeholder="Название проекта" 
                            value={newEntry.name} 
                            onChange={e => setNewEntry({...newEntry, name: e.target.value})} 
                        />
                        <input 
                            placeholder="Ссылка (URL)" 
                            value={newEntry.url} 
                            onChange={e => setNewEntry({...newEntry, url: e.target.value})} 
                        />
                        <textarea 
                            placeholder="Описание" 
                            value={newEntry.desc} 
                            onChange={e => setNewEntry({...newEntry, desc: e.target.value})} 
                        />
                        <div className="modal-btns">
                            <button className="cancel" onClick={() => setIsModalOpen(false)}>Отмена</button>
                            <button className="save" onClick={handleSave} disabled={isPending}>
                                {isPending ? 'Запись...' : 'Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .search-page { min-height: 100vh; background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; }
                .container { width: 100%; max-width: 650px; padding: 50px 20px; text-align: center; }
                .logo { font-size: 3rem; margin-bottom: 2rem; font-weight: 800; letter-spacing: -1px; }
                .logo span { color: #8ab4f8; }
                .search-input-container input { width: 100%; padding: 16px 24px; border-radius: 30px; background: #202124; border: 1px solid #5f6368; color: #fff; font-size: 1.1rem; outline: none; transition: border-color 0.2s; }
                .search-input-container input:focus { border-color: #8ab4f8; }
                .results-list { margin-top: 2rem; display: flex; flex-direction: column; gap: 12px; text-align: left; }
                .result-item { background: #171717; padding: 16px; border-radius: 12px; display: flex; gap: 16px; cursor: pointer; border: 1px solid transparent; }
                .result-item:hover { background: #222; border-color: #333; }
                .result-item img { width: 32px; height: 32px; border-radius: 4px; background: #333; }
                .title { color: #8ab4f8; font-size: 1.1rem; font-weight: 600; }
                .user { color: #5f6368; font-size: 0.8rem; margin-left: 8px; font-weight: 400; }
                .description { color: #9aa0a6; font-size: 0.9rem; margin-top: 4px; }
                .not-found { margin-top: 3rem; color: #9aa0a6; }
                .not-found button { display: block; margin: 15px auto; padding: 10px 20px; border-radius: 20px; background: transparent; border: 1px solid #5f6368; color: #8ab4f8; cursor: pointer; }
                .add-fab { position: fixed; bottom: 40px; right: 40px; width: 56px; height: 56px; border-radius: 50%; background: #8ab4f8; border: none; font-size: 28px; cursor: pointer; box-shadow: 0 4px 12px rgba(138, 180, 248, 0.4); color: #000; font-weight: bold; }
                .modal-wrap { position: fixed; inset: 0; background: rgba(0,0,0,0.85); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 100; }
                .modal-box { background: #202124; padding: 24px; border-radius: 16px; width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; border: 1px solid #3c4043; }
                .modal-box h3 { margin: 0 0 8px 0; }
                .modal-box input, .modal-box textarea { background: #303134; border: 1px solid #5f6368; color: #fff; padding: 12px; border-radius: 8px; outline: none; font-size: 1rem; }
                .modal-box textarea { min-height: 80px; resize: vertical; }
                .modal-btns { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
                .modal-btns button { padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; border: none; }
                .cancel { background: transparent; color: #8ab4f8; }
                .save { background: #8ab4f8; color: #000; }
                .save:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>
        </div>
    );
}