// components/FireSoftAd.jsx
'use client';
import React, { useState } from 'react';

export default function FireSoftAd({ type = 'banner', devId = 'Icfg', siteId = 'test_site', style }) {
  const [loading, setLoading] = useState(true);
  
  const adUrl = `/api/ads?action=renderAd&type=${type}&devId=${devId}&siteId=${siteId}&t=${Date.now()}`;

  return (
    <div style={{ 
      position: 'relative', 
      width: '100%', 
      height: '100%', 
      minHeight: type === 'video' ? '250px' : '90px', 
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