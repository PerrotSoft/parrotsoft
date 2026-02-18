'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e) => {
    e.preventDefault();
    if (query.trim()) router.push(`/search?q=${encodeURIComponent(query)}`);
  };

  return (
    <div style={{ minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 20px' }}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ fontSize: '72px', fontWeight: '800', margin: 0, letterSpacing: '-3px' }}>
          Parrot<span style={{ color: 'var(--accent)' }}>Search</span>
        </h1>
        <p style={{ opacity: 0.5, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '2px' }}>Explore the ecosystem</p>
      </div>

      <form onSubmit={handleSearch} style={{ width: '100%', maxWidth: '650px' }}>
        <div className="block-v1" style={{ display: 'flex', padding: '10px 10px 10px 25px', borderRadius: '50px', border: '1px solid var(--border-dark)', background: 'var(--mica-high)' }}>
          <input 
            autoFocus
            placeholder="Search the web..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: '20px' }}
          />
          <button type="submit" className="btn-v4" style={{ borderRadius: '50px', padding: '12px 25px' }}>🔎</button>
        </div>
      </form>

      <div style={{ marginTop: 30, display: 'flex', gap: 15 }}>
        <button className="btn-v2" onClick={() => router.push('/drive')}>☁️ Cloud Drive</button>
        <button className="btn-v2" onClick={() => router.push('/search?q=parrot')}>🎲 Feeling Lucky</button>
      </div>
    </div>
  );
}