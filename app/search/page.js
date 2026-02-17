'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export default function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q')?.toLowerCase() || '';
  
  const [results, setResults] = useState([]);
  const [isExternal, setIsExternal] = useState(false);

  // Твоя база данных сайтов (можно расширять)
  const siteDatabase = [
    { id: 1, title: "Google", desc: "Поиск информации в интернете", url: "https://google.com", icon: "🌐" },
    { id: 2, title: "YouTube", desc: "Видеохостинг и развлечения", url: "https://youtube.com", icon: "📺" },
    { id: 3, title: "Лаборатория", desc: "Тестирование ParrotSoft компонентов", url: "/lab", icon: "🧪" },
    { id: 4, title: "Настройки", desc: "Управление вашим аккаунтом", url: "/settings", icon: "⚙️" },
  ];

  useEffect(() => {
    if (query) {
      // Логика "умного" поиска
      const filtered = siteDatabase.filter(item => 
        item.title.toLowerCase().includes(query) || 
        item.desc.toLowerCase().includes(query)
      );

      if (filtered.length > 0) {
        setResults(filtered);
        setIsExternal(false);
      } else {
        setIsExternal(true); // Если ничего не нашли в базе
      }
      
      // Сохраняем историю поиска для пользователя
      const user = JSON.parse(localStorage.getItem('parrot_user') || '{}');
      if (user.login) {
        const history = JSON.parse(localStorage.getItem(`history_${user.login}`) || '[]');
        const newHistory = [{q: query, date: new Date()}, ...history].slice(0, 10);
        localStorage.setItem(`history_${user.login}`, JSON.stringify(newHistory));
      }
    }
  }, [query]);

  return (
    <div style={{ minHeight: '100vh', padding: '40px' }}>
      <h2 style={{ marginBottom: '30px' }}>Результаты для: <span style={{color: 'var(--accent)'}}>{query}</span></h2>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {results.map(res => (
          <div key={res.id} className="block-v1" style={{ padding: '20px', borderRadius: '15px', display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span style={{ fontSize: '32px' }}>{res.icon}</span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: 0 }}><a href={res.url} target={res.url.startsWith('http') ? "_blank" : "_self"} style={{ color: 'inherit', textDecoration: 'none' }}>{res.title}</a></h3>
              <p style={{ margin: 0, opacity: 0.7, fontSize: '14px' }}>{res.desc}</p>
            </div>
            <button className="btn-v2" onClick={() => window.location.href = res.url}>Открыть</button>
          </div>
        ))}

        {isExternal && (
          <div className="block-v3" style={{ padding: '40px', textAlign: 'center', borderRadius: '20px', border: '2px dashed var(--border-dark)' }}>
            <p style={{ fontSize: '18px' }}>В локальной базе ParrotSoft ничего не найдено.</p>
            <button 
              className="btn-v4" 
              style={{ padding: '12px 30px', marginTop: '10px' }}
              onClick={() => window.open(`https://www.google.com/search?q=${query}`, '_blank')}
            >
              Искать "{query}" в глобальном Google
            </button>
          </div>
        )}
      </div>
    </div>
  );
}