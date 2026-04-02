import { getGlobalSearchList } from '../actions';
import Link from 'next/link';

export default async function SearchPage({ searchParams }) {
    const params = await searchParams;
    const query = (params?.q || "").toLowerCase().trim();
    const allData = await getGlobalSearchList();

    const results = allData.flatMap(user => 
        (user.projects || [])
            .filter(p => 
                p.name?.toLowerCase().includes(query) || 
                p.desc?.toLowerCase().includes(query)
            )
            .map(p => ({ ...p, owner: user.username }))
    );

    return (
        <div className="search-page">
            <div className="container">
                <h1 className="logo">Parrot<span>Search</span></h1>
                
                <form action="/search" method="GET" className="search-input-container">
                    <input 
                        name="q"
                        defaultValue={query} 
                        placeholder="Searching the database..."
                        autoFocus
                    />
                </form>

                <div className="results-list">
                    {results.map((item, i) => (
                        <a key={i} href={item.url.includes('http') ? item.url : `https://${item.url}`} className="result-item" target="_blank" rel="noreferrer">
                            <img src={`https://www.google.com/s2/favicons?domain=${item.url}&sz=64`} alt="ico" />
                            <div className="text">
                                <div className="title">{item.name} <span className="user">@{item.owner}</span></div>
                                <div className="description">{item.desc}</div>
                            </div>
                        </a>
                    ))}
                    
                    {query && results.length === 0 && (
                        <div className="not-found">
                            Nothing found for "{query}". <a href={`https://google.com/search?q=${query}`}>Search on Google</a>
                        </div>
                    )}
                </div>

                <Link href="/console" className="add-fab">+</Link>
            </div>

            <style>{`
                .search-page { min-height: 100vh; background: #000; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; }
                .container { width: 100%; max-width: 650px; padding: 50px 20px; text-align: center; }
                .logo { font-size: 3rem; margin-bottom: 2rem; font-weight: 800; letter-spacing: -1px; }
                .logo span { color: #8ab4f8; }
                .search-input-container input { width: 100%; padding: 16px 24px; border-radius: 30px; background: #202124; border: 1px solid #5f6368; color: #fff; font-size: 1.1rem; outline: none; transition: border-color 0.2s; }
                .search-input-container input:focus { border-color: #8ab4f8; }
                .results-list { margin-top: 2rem; display: flex; flex-direction: column; gap: 12px; text-align: left; }
                .result-item { background: #171717; padding: 16px; border-radius: 12px; display: flex; gap: 16px; text-decoration: none; color: inherit; border: 1px solid transparent; }
                .result-item:hover { background: #222; border-color: #333; }
                .result-item img { width: 32px; height: 32px; border-radius: 4px; background: #333; }
                .title { color: #8ab4f8; font-size: 1.1rem; font-weight: 600; }
                .user { color: #5f6368; font-size: 0.8rem; margin-left: 8px; font-weight: 400; }
                .description { color: #9aa0a6; font-size: 0.9rem; margin-top: 4px; }
                .not-found { margin-top: 3rem; color: #9aa0a6; text-align: center; }
                .not-found a { color: #8ab4f8; text-decoration: none; margin-left: 8px; }
                .add-fab { position: fixed; bottom: 40px; right: 40px; width: 56px; height: 56px; border-radius: 50%; background: #8ab4f8; color: #000; display: flex; align-items: center; justify-content: center; font-size: 28px; text-decoration: none; font-weight: bold; box-shadow: 0 4px 12px rgba(138, 180, 248, 0.4); }
            `}</style>
        </div>
    );
}