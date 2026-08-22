'use client';
import React, { useState, useEffect } from 'react';
import { pickAdCategory, ADSTERRA_GIF_URL, mergeConfig, PLATFORM_DEV_ID, DEFAULT_BANNER_SITE_ID, DEFAULT_GIF_SITE_ID, DEFAULT_VIDEO_SITE_ID, DEFAULT_STATIC_SITE_ID, ADSTERRA_CLICK_TARGET } from '../../lib/siteConfig';
import { getLiveConfig } from '../../actions';
import { getCachedLiveConfig } from '../../lib/liveConfigCache';

export default function ParrotSoftAd({ devId, staticSiteId, videoSiteId, isMidroll, style }) {
  const [loading, setLoading] = useState(true);
  const [adConfig, setAdConfig] = useState({ type: 'banner', devId: PLATFORM_DEV_ID, siteId: DEFAULT_BANNER_SITE_ID });

  useEffect(() => {
    let cancelled = false;
    // Проверяем, настроил ли автор монетизацию
    const hasCustomAdSystem = devId && devId !== PLATFORM_DEV_ID && devId.trim() !== '';

    if (!hasCustomAdSystem) {
      // 100% трафика на платформу, если у автора нет аккаунта разработчика
      setAdConfig({ type: 'banner', devId: PLATFORM_DEV_ID, siteId: DEFAULT_BANNER_SITE_ID });
      return;
    }

    // "Живой" AD_SPLIT (см. lib/liveConfigCache.js + actions.js getLiveConfig) —
    // если оверрайдов ещё нет / БД недоступна, mergeConfig() тихо откатывается
    // на базовый AD_SPLIT из lib/siteConfig.js.
    getCachedLiveConfig(getLiveConfig).then((live) => {
      if (cancelled) return;
      const cfg = mergeConfig(live);
      // Честный розыгрыш — см. lib/siteConfig.js (pickAdCategory). 'video' в
      // розыгрыше участвует, только если это реально мидролл (полноэкранный
      // плеер) — снаружи для него физически нет места.
      const category = pickAdCategory(isMidroll, cfg.adSplit);
      if (category === 'video') {
        setAdConfig({ type: 'video', devId: devId, siteId: videoSiteId || DEFAULT_VIDEO_SITE_ID });
      } else if (category === 'gif') {
        setAdConfig({ type: 'gif', devId: PLATFORM_DEV_ID, siteId: DEFAULT_GIF_SITE_ID });
      } else if (category === 'bannerAdsterra') {
        setAdConfig({ type: 'banner', devId: PLATFORM_DEV_ID, siteId: DEFAULT_BANNER_SITE_ID });
      } else {
        setAdConfig({ type: 'banner', devId: devId, siteId: staticSiteId || DEFAULT_STATIC_SITE_ID });
      }
    });
    return () => { cancelled = true; };
  }, [devId, staticSiteId, videoSiteId, isMidroll]);

  // Гиф-реклама рендерится прямо тут, без iframe/сервера — это просто
  // картинка по прямой ссылке Adsterra, сервер тут не нужен вообще.
  // БАГ (исправлено): раньше здесь стояло `&& !isMidroll` — гифка вообще не
  // могла показаться в мидролле, даже если честно выпала на кубике; ниже,
  // в targetType, тип для мидролла к тому же жёстко переписывался на
  // 'video' — то есть реального разнообразия в мидролле не было вообще.
  if (adConfig.type === 'gif') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '90px', overflow: 'hidden', backgroundColor: '#0f172a', borderRadius: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}>
        {/* ЗАМЕНИ target= на свою настоящую реферальную ссылку Adsterra — я
            её не знаю и не стал выдумывать; сейчас тут просто общий сайт. */}
        <a href={`/api/ads?action=click&adId=${DEFAULT_GIF_SITE_ID}&devId=${encodeURIComponent(devId || PLATFORM_DEV_ID)}&siteId=${DEFAULT_GIF_SITE_ID}&target=${encodeURIComponent(ADSTERRA_CLICK_TARGET)}`} target="_blank" rel="noopener noreferrer nofollow">
          <img src={ADSTERRA_GIF_URL} alt="Реклама" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        </a>
        <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: 'rgba(255,255,255,0.7)', fontSize: '10px', padding: '2px 6px', borderRadius: '4px' }}>ParrotSoft Ads</div>
      </div>
    );
  }

  // Тип берём из того, что реально выпало (adConfig.type) — раньше для
  // мидролла тут стояло жёсткое 'video' независимо от розыгрыша.
  const targetType = adConfig.type;
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
        title="ParrotSoft Ads Secure Frame"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}