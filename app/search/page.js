import { getGlobalSearchList } from '../actions';
import Link from 'next/link';

// Словари для исправления раскладки клавиатуры
const ru2en = {'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':"'",'я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.','.':'/'};
const en2ru = {};
Object.keys(ru2en).forEach(key => en2ru[ru2en[key]] = key);

function fixLayout(text) {
    if (!text) return text;
    // Определяем, на каком языке набран текст (есть ли русские символы)
    const isRu = /[а-яА-Я]/.test(text);
    const map = isRu ? ru2en : en2ru;
    
    return text.split('').map(char => {
        const lowerChar = char.toLowerCase();
        const mappedChar = map[lowerChar];
        if (!mappedChar) return char;
        // Сохраняем регистр
        return char === lowerChar ? mappedChar : mappedChar.toUpperCase();
    }).join('');
}

export default async function SearchPage({ searchParams }) {
    const params = await searchParams;
    const query = (params?.q || "").trim();
    const queryLower = query.toLowerCase();
    
    // Получаем исправленный запрос (переведенная раскладка)
    const fixedQuery = fixLayout(query);
    const fixedQueryLower = fixedQuery.toLowerCase();

    const allData = await getGlobalSearchList();

    // 1. Поиск по локальной базе
    const localResults = allData.flatMap(user => 
        (user.projects || [])
            .filter(p => {
                const name = p.name?.toLowerCase() || "";
                const desc = p.desc?.toLowerCase() || "";
                
                // Ищем совпадения либо по оригинальному тексту, либо по исправленной раскладке
                return name.includes(queryLower) || desc.includes(queryLower) ||
                       (fixedQueryLower !== queryLower && (name.includes(fixedQueryLower) || desc.includes(fixedQueryLower)));
            })
            .map(p => ({ ...p, owner: user.username }))
    );

    // 2. Поиск через Google API
    let googleResults = [];
    if (query) {
        // ВНИМАНИЕ: Для работы этого блока добавь переменные в файл .env.local:
        // GOOGLE_API_KEY=твой_ключ_от_google_cloud
        // GOOGLE_CX=твой_id_поисковой_системы_custom_search
        const apiKey = process.env.GOOGLE_API_KEY; 
        const cx = process.env.GOOGLE_CX; 
        
        if (apiKey && cx) {
            try {
                // Если запрос был набран не в той раскладке, ищем в гугле по исправленному
                const searchQuery = (fixedQueryLower !== queryLower) ? fixedQuery : query;
                const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(searchQuery)}`;
                
                const res = await fetch(url);
                const data = await res.json();
                
                if (data.items) {
                    googleResults = data.items.map(item => ({
                        title: item.title,
                        link: item.link,
                        snippet: item.snippet,
                        domain: new URL(item.link).hostname
                    }));
                }
            } catch (error) {
                console.error("Ошибка при поиске в Google:", error);
            }
        }
    }

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
                    {/* Подсказка автоисправления раскладки */}
                    {fixedQuery && fixedQuery !== query && (
                        <div className="layout-hint">
                            Возможно, вы имели в виду: <strong><Link href={`/search?q=${encodeURIComponent(fixedQuery)}`}>{fixedQuery}</Link></strong>
                        </div>
                    )}
                </form>

                <div className="results-list">
                    {/* Вывод результатов из локальной базы */}
                    {localResults.map((item, i) => (
                        <a key={`loc-${i}`} href={item.url.includes('http') ? item.url : `https://${item.url}`} className="result-item" target="_blank" rel="noreferrer">
                            <img src={`https://www.google.com/s2/favicons?domain=${item.url}&sz=64`} alt="ico" />
                            <div className="text">
                                <div className="title">{item.name} <span className="user">@{item.owner}</span></div>
                                <div className="description">{item.desc}</div>
                            </div>
                        </a>
                    ))}

                    {/* Вывод результатов из Google (EasyGuru) */}
                    {googleResults.length > 0 && (
                        <div className="google-section">
                            <div className="guru-badge">✨ EasyGuru нашёл данные в Google:</div>
                            {googleResults.map((item, i) => (
                                <a key={`ggl-${i}`} href={item.link} className="result-item google-item" target="_blank" rel="noreferrer">
                                    <img src={`https://www.google.com/s2/favicons?domain=${item.domain}&sz=64`} alt="ico" />
                                    <div className="text">
                                        <div className="title">{item.title}</div>
                                        <div className="description">{item.snippet}</div>
                                    </div>
                                </a>
                            ))}
                        </div>
                    )}
                    
                    {query && localResults.length === 0 && googleResults.length === 0 && (
                        <div className="not-found">
                            Ничего не найдено по запросу "{query}". 
                            <a href={`https://google.com/search?q=${encodeURIComponent(query)}`}>Искать в браузере Google</a>
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
                .layout-hint { margin-top: 12px; color: #9aa0a6; font-size: 0.95rem; text-align: left; padding-left: 16px; }
                .layout-hint a { color: #8ab4f8; text-decoration: none; }
                .results-list { margin-top: 2rem; display: flex; flex-direction: column; gap: 12px; text-align: left; }
                .result-item { background: #171717; padding: 16px; border-radius: 12px; display: flex; gap: 16px; text-decoration: none; color: inherit; border: 1px solid transparent; }
                .result-item:hover { background: #222; border-color: #333; }
                
                /* Стили для блока от Google/EasyGuru */
                .google-section { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
                .guru-badge { color: #8ab4f8; font-size: 0.95rem; font-weight: 600; padding: 10px 0 4px 8px; }
                .result-item.google-item { background: rgba(138, 180, 248, 0.05); border: 1px solid rgba(138, 180, 248, 0.2); }
                .result-item.google-item:hover { background: rgba(138, 180, 248, 0.1); }
                
                .result-item img { width: 32px; height: 32px; border-radius: 4px; background: #333; }
                .title { color: #8ab4f8; font-size: 1.1rem; font-weight: 600; }
                .user { color: #5f6368; font-size: 0.8rem; margin-left: 8px; font-weight: 400; }
                .description { color: #9aa0a6; font-size: 0.9rem; margin-top: 4px; line-height: 1.4; }
                .not-found { margin-top: 3rem; color: #9aa0a6; text-align: center; }
                .not-found a { color: #8ab4f8; text-decoration: none; margin-left: 8px; }
                .add-fab { position: fixed; bottom: 40px; right: 40px; width: 56px; height: 56px; border-radius: 50%; background: #8ab4f8; color: #000; display: flex; align-items: center; justify-content: center; font-size: 28px; text-decoration: none; font-weight: bold; box-shadow: 0 4px 12px rgba(138, 180, 248, 0.4); }
            `}</style>
        </div>
    );
}