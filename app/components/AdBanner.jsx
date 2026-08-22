'use client';
import { useEffect, useRef } from 'react';

const SHOW_ADS = true;

const AD_CONFIGS = {
  '468x60': { type: 'iframe', key: '3680ffe122e759a51ccf2ff1a1662602', width: 468, height: 60 },
  '728x90': { type: 'iframe', key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 728, height: 90 },
  '300x250': { type: 'iframe', key: 'e12a683813d15c90e3c07907f05208ae', width: 300, height: 250 },
  '160x600': { type: 'iframe', key: 'd71db1cd94f0a3399638192633a371f8', width: 160, height: 600 },
  '160x300': { type: 'iframe', key: 'b2312ac9065b8b87b55577dbc2beb78c', width: 160, height: 300 },
  '320x50': { type: 'iframe', key: '0ca50568787b69ef337ca6b93a51efd2', width: 320, height: 50 },

  'native': { type: 'script', src: 'https://pl29118206.effectivecpmnetwork.com/85b46e333d284b01d0364138acfb1728/invoke.js' },
  'popunder': { type: 'script', src: 'https://pl29118207.effectivecpmnetwork.com/e9/ee/d9/e9eed918d050b9e313285e38c8565753.js' },
  'socialbar': { type: 'script', src: 'https://pl29118208.effectivecpmnetwork.com/b1/ba/f2/b1baf2cad84c7e220f34550ff409b77b.js' },
  'smartlink': { type: 'direct', url: 'https://www.effectivecpmnetwork.com/b4ct0i7z?key=05f3579b3e9ba48f92e518e95783f1ed' }
};

export default function AdBanner({ type = '468x60', children, className = '', style = {} }) {
  const bannerRef = useRef(null);

  // useEffect отвечает ТОЛЬКО за динамическую загрузку сторонних скриптов (Popunder, Socialbar, Native)
  useEffect(() => {
    if (!SHOW_ADS) return;

    const config = AD_CONFIGS[type];
    if (!config || config.type !== 'script' || !bannerRef.current) return;

    bannerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = config.src;
    script.async = true;

    bannerRef.current.appendChild(script);

    return () => {
      if (bannerRef.current) {
        bannerRef.current.innerHTML = '';
      }
    };
  }, [type]);

  if (!SHOW_ADS) return children ? <>{children}</> : null;

  const config = AD_CONFIGS[type];
  if (!config) return null;

  // 1. Smartlink (переход по клику)
  if (config.type === 'direct') {
    const handleClick = () => {
      if (config.url) window.open(config.url, '_blank');
    };

    return (
      <div onClick={handleClick} className={className} style={{ cursor: 'pointer', ...style }}>
        {children}
      </div>
    );
  }

  // 2. Iframe баннеры (используется srcDoc для изоляции контекста и точного выполнения)
  if (config.type === 'iframe') {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; }
          </style>
        </head>
        <body>
          <script type="text/javascript">
            var atOptions = {
              'key' : '${config.key}',
              'format' : 'iframe',
              'height' : ${config.height},
              'width' : ${config.width},
              'params' : {}
            };
          </script>
          <script type="text/javascript" src="https://www.highperformanceformat.com/${config.key}/invoke.js"></script>
        </body>
      </html>
    `;

    return (
      <div
        className={`ad-container ${className}`}
        style={{
          width: `${config.width}px`,
          height: `${config.height}px`,
          margin: '12px auto',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
          ...style
        }}
      >
        <iframe
          title={`ad-${type}`}
          srcDoc={htmlContent}
          width={config.width}
          height={config.height}
          style={{ border: 'none', overflow: 'hidden' }}
          scrolling="no"
        />
      </div>
    );
  }

  // 3. Popunder, Socialbar, Native
  return <div ref={bannerRef} style={{ display: type === 'native' ? 'block' : 'none' }} />;
}