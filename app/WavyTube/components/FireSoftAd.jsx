'use client';
import React, { useState, useEffect } from 'react';

export default function FireSoftAd({ devId, staticSiteId, videoSiteId, isMidroll, style }) {
  const [loading, setLoading] = useState(true);
  const [adConfig, setAdConfig] = useState(null);

  useEffect(() => {
    // Проверяем, настроил ли автор монетизацию
    const hasCustomAdSystem = devId && devId !== 'Icfg' && devId.trim() !== '';

    if (!hasCustomAdSystem) {
      // Реклама отключена: у автора нет своего рекламного аккаунта — ничего не показываем
      setAdConfig(null);
      return;
    }

    // Распределение трафика: 60% видео, 35% платформа (Adsterra), 5% статика
    const rand = Math.random() * 100;
    if (rand < 60) {
      setAdConfig({ type: 'video', devId: devId, siteId: videoSiteId || 'default_video' });
    } else if (rand < 95) {
      setAdConfig({ type: 'banner', devId: 'Icfg', siteId: 'adsterra_default' });
    } else {
      setAdConfig({ type: 'banner', devId: devId, siteId: staticSiteId || 'default_static' });
    }
  }, [devId, staticSiteId, videoSiteId]);

  // Реклама отключена — канал не настроил рекламный аккаунт
  if (!adConfig) return null;

  // Если это мидролл внутри видео, принудительно запрашиваем видео-рекламу или баннер нужного формата
  const targetType = isMidroll ? 'video' : adConfig.type;
  const adUrl = `/api/ads?action=renderAd&type=${targetType}&devId=${adConfig.devId}&siteId=${adConfig.siteId}&t=${Date.now()}`;

  return (
    <div style={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%', 
      minHeight: targetType === 'video' || isMidroll ? '250px' : '90px', 
      overflow: 'hidden', 
      backgroundColor: '#0f172a', 
      borderRadius: 'inherit',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      ...style 
    }}>
      {loading && (
        <div style={{ position: 'absolute', color: '#6366f1', fontSize: '12px', zIndex: 1 }}>
          Загрузка защищенной рекламы...
        </div>
      )}

      <iframe
        src={adUrl}
        width="100%"
        height="100%"
        onLoad={() => setLoading(false)}
        style={{ 
          border: 'none', 
          overflow: 'hidden', 
          display: loading ? 'none' : 'block', 
          width: '100%', 
          height: '100%',
          position: 'relative',
          zIndex: 2
        }}
        scrolling="no"
        title="FireSoft Ads Secure Frame"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}