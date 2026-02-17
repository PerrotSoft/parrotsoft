'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div style={{ 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center',
      background: "url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop') center/cover" 
    }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{ fontSize: '48px', fontWeight: '800', letterSpacing: '-1px', marginBottom: '10px' }}>
          Parrot<span style={{ color: 'var(--accent)' }}>Search</span>
        </h1>
        <p style={{ opacity: 0.6 }}>Intelligent search in the Sun Valley ecosystem</p>
      </div>

      <form onSubmit={handleSearch} style={{ width: '100%', maxWidth: '600px', padding: '0 20px' }}>
        <div className="block-v1" style={{ 
          display: 'flex', 
          padding: '8px', 
          borderRadius: '50px', 
          boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
          border: '1px solid rgba(255,255,255,0.5)'
        }}>
          <input 
            type="text" 
            className="input-base" 
            placeholder="What shall we search for today?..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ 
              background: 'transparent', 
              border: 'none', 
              paddingLeft: '25px',
              fontSize: '18px'
            }}
          />
          <button type="submit" className="btn-v4" style={{ padding: '10px 30px' }}>
            Поиск
          </button>
        </div>
      </form>

      <div style={{ marginTop: '30px', display: 'flex', gap: '15px' }}>
        <button className="btn-v2" style={{ fontSize: '13px' }}>История</button>
        <button className="btn-v2" style={{ fontSize: '13px' }}>Тренды</button>
      </div>
    </div>
  );
}