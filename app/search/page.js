import { getGlobalSearchList } from '../actions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

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
                    <input name="q" defaultValue={query} placeholder="Поиск в базе..." autoFocus />
                </form>
                <div className="results-list">
                    {results.map((item, i) => (
                        <a key={i} href={item.url} className="result-item" target="_blank">
                            <div className="text">
                                <div className="title">{item.name} <span className="user">@{item.owner}</span></div>
                                <div className="description">{item.desc}</div>
                            </div>
                        </a>
                    ))}
                </div>
                <Link href="/console" className="add-fab">+</Link>
            </div>
            <style>{`
                .search-page { min-height: 100vh; background: #000; color: #fff; display: flex; justify-content: center; font-family: sans-serif; }
                .container { width: 100%; max-width: 650px; padding: 50px 20px; text-align: center; }
                .logo span { color: #8ab4f8; }
                .search-input-container input { width: 100%; padding: 16px 24px; border-radius: 30px; background: #202124; border: 1px solid #5f6368; color: #fff; outline: none; }
                .results-list { margin-top: 2rem; display: flex; flex-direction: column; gap: 12px; text-align: left; }
                .result-item { background: #171717; padding: 16px; border-radius: 12px; text-decoration: none; color: inherit; border: 1px solid transparent; display: block; }
                .title { color: #8ab4f8; font-weight: 600; }
                .add-fab { position: fixed; bottom: 40px; right: 40px; width: 56px; height: 56px; border-radius: 50%; background: #8ab4f8; color: #000; display: flex; align-items: center; justify-content: center; font-size: 28px; text-decoration: none; }
            `}</style>
        </div>
    );
}