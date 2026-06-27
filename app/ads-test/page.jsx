// components/FireSoftAdTest.jsx (React / Next.js)
'use client';
import React, { useState } from 'react';
import FireSoftAd from '../components/FireSoftAd.jsx';

export default function FireSoftAdTest() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Тестирование FireSoft Ads (React)</h1>
        <p style={styles.subtitle}>Проверка отображения рекламных блоков и интеграции безопасного фрейма</p>
        <button onClick={handleRefresh} style={styles.btn}>
          🔄 Перезагрузить рекламу
        </button>
      </header>

      <div style={styles.grid}>
        {/* Блок баннера */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🖼 Компонент: Banner (468x60)</h2>
          <div style={styles.adWrapperBanner}>
            <FireSoftAd 
              key={`banner-${refreshKey}`}
              type="banner" 
              devId="Icfg" 
              siteId="test_react_site" 
            />
          </div>
        </div>

        {/* Блок видео */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🎬 Компонент: Video (Плеер)</h2>
          <div style={styles.adWrapperVideo}>
            <FireSoftAd 
              key={`video-${refreshKey}`}
              type="video" 
              devId="Icfg" 
              siteId="test_react_site" 
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#090d16',
    color: '#ffffff',
    padding: '40px 20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    textAlign: 'center',
    marginBottom: '40px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#6366f1',
    margin: '0 0 10px 0',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: '15px',
    margin: '0 0 20px 0',
  },
  btn: {
    padding: '10px 20px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid #6366f1',
    borderRadius: '8px',
    color: '#a5b4fc',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'background 0.2s',
  },
  grid: {
    maxWidth: '1000px',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '30px',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '16px',
    padding: '24px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 0,
    marginBottom: '16px',
  },
  adWrapperBanner: {
    width: '468px',
    height: '60px',
    maxWidth: '100%',
    margin: '0 auto',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  adWrapperVideo: {
    width: '100%',
    maxWidth: '640px',
    height: '360px',
    margin: '0 auto',
    borderRadius: '12px',
    overflow: 'hidden',
  }
};