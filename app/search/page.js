'use client';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SearchPage({ dbActions }) {
    const searchParams = useSearchParams();
    
    // Состояния
    const [query, setQuery] = useState(searchParams.get('q') || '');
    const [projects, setProjects] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [newLabel, setNewLabel] = useState({ name: '', url: '' });

    const username = "1";

    // Загрузка данных из Turso
    useEffect(() => {
        async function loadData() {
            if (dbActions?.getProjects) {
                try {
                    const data = await dbActions.getProjects(username);
                    setProjects(Array.isArray(data) ? data : []);
                } catch (e) {
                    console.error("Ошибка загрузки:", e);
                }
            }
        }
        loadData();
    }, [dbActions]);

    // Поиск
    const filteredResults = useMemo(() => {
        const term = query.toLowerCase().trim();
        if (!term) return [];
        return projects.filter(p => 
            p.name?.toLowerCase().includes(term) || 
            p.url?.toLowerCase().includes(term)
        );
    }, [query, projects]);

    // Исправленная функция добавления
    const handleAddProject = async () => {
        if (!newLabel.name || !newLabel.url) return;
        setLoading(true);

        const newEntry = {
            id: Date.now(),
            name: newLabel.name,
            url: newLabel.url.startsWith('http') ? newLabel.url : `https://${newLabel.url}`,
            type: 'turso_label'
        };

        const updatedProjects = [...projects, newEntry];

        try {
            if (dbActions?.syncProjects) {
                await dbActions.syncProjects(username, updatedProjects);
                setProjects(updatedProjects); 
                setIsModalOpen(false);
                setNewLabel({ name: '', url: '' });
            }
        } catch (e) {
            alert("Ошибка сохранения в Turso");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="os-page">
            {/* Скрытая кнопка сбоку (появляется при наведении на край экрана) */}
            <div className="side-trigger">
                <button className="side-add-btn" onClick={() => setIsModalOpen(true)}>+</button>
            </div>

            <header className="os-search-bar block-v1">
                <div className="os-logo">Parrot<span>Search</span></div>
                <input 
                    className="inp-v1" 
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Поиск по Turso DB..."
                />
            </header>

            <main className="os-content">
                {query && (
                    <div className="results-grid">
                        {filteredResults.map(item => (
                            <div key={item.id} className="os-card block-v2" onClick={() => window.open(item.url)}>
                                <div className="card-url">{item.url}</div>
                                <div className="card-name">{item.name}</div>
                            </div>
                        ))}
                        
                        {filteredResults.length === 0 && (
                            <div className="block-v10 empty-box">
                                <p>Ничего не найдено в базе.</p>
                            </div>
                        )}
                    </div>
                )}
            </main>

            {isModalOpen && (
                <div className="modal-bg" onClick={() => setIsModalOpen(false)}>
                    <div className="modal-win block-v6" onClick={e => e.stopPropagation()}>
                        <h2>Добавить проект</h2>
                        <input 
                            className="inp-v5" 
                            placeholder="Название" 
                            value={newLabel.name}
                            onChange={e => setNewLabel({...newLabel, name: e.target.value})}
                        />
                        <input 
                            className="inp-v8" 
                            placeholder="URL" 
                            value={newLabel.url}
                            onChange={e => setNewLabel({...newLabel, url: e.target.value})}
                            style={{marginTop: '15px'}}
                        />
                        <div className="btns">
                            <button className="btn-v4" onClick={handleAddProject} disabled={loading}>
                                {loading ? 'Сохранение...' : 'Добавить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                .os-page { min-height: 100vh; padding: 20px; position: relative; }
                
                /* Скрытая кнопка сбоку */
                .side-trigger {
                    position: fixed;
                    right: 0;
                    top: 0;
                    bottom: 0;
                    width: 20px; /* Тонкая полоска для наведения */
                    z-index: 999;
                    display: flex;
                    align-items: center;
                }
                .side-add-btn {
                    transform: translateX(100%);
                    transition: transform 0.3s ease;
                    background: #00d1ff;
                    color: black;
                    border: none;
                    width: 50px;
                    height: 50px;
                    border-radius: 50% 0 0 50%;
                    cursor: pointer;
                    font-size: 24px;
                    font-weight: bold;
                }
                .side-trigger:hover .side-add-btn {
                    transform: translateX(0);
                }

                .os-search-bar { max-width: 900px; margin: 0 auto; display: flex; align-items: center; gap: 20px; padding: 15px 30px; border-radius: 20px; }
                .os-logo { font-weight: 900; color: #00d1ff; }
                .os-logo span { color: white; opacity: 0.5; }
                
                .os-content { max-width: 800px; margin: 50px auto; }
                .results-grid { display: flex; flex-direction: column; gap: 15px; }
                .os-card { padding: 25px; border-radius: 15px; cursor: pointer; }
                .card-url { font-size: 11px; color: #00d1ff; }
                .card-name { font-size: 20px; }

                .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(15px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
                .modal-win { width: 380px; padding: 30px; border-radius: 25px; }
                .btns { display: flex; justify-content: flex-end; margin-top: 30px; }
            `}</style>
        </div>
    );
}