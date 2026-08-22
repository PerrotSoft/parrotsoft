'use client';
import { useEffect, useState } from 'react';
import AdBanner from './AdBanner';
import { getLiveConfig } from '../actions';
import { getCachedLiveConfig } from '../lib/liveConfigCache';
import { mergeConfig, shouldShowBannerAd, bannerCountFor } from '../lib/siteConfig';

// Обёртка над AdBanner.jsx, которая уважает adIntensity (см. site.config.json
// / живой конфиг через admin-панель, Site Config → ключ "adIntensity"):
//   'off'    — баннера вообще нет
//   'normal' — показываются только weight="light" места (по одному баннеру)
//   'ultra'  — показываются все места, weight="more" — сразу несколько
//
// weight: 'light' | 'more' — см. lib/siteConfig.js: shouldShowBannerAd/bannerCountFor
// type: тип баннера из AD_CONFIGS в components/AdBanner.jsx ('468x60' и т.д.)
export default function AdSlot({ weight = 'light', type = '468x60', style }) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        let cancelled = false;
        getCachedLiveConfig(getLiveConfig).then((live) => {
            if (cancelled) return;
            const cfg = mergeConfig(live);
            setCount(bannerCountFor(weight, cfg.adIntensity));
        }).catch(() => {
            // Живой конфиг недоступен — тихо откатываемся на adIntensity
            // из site.config.json (тот же дефолт, что и во всём остальном
            // рекламном коде при недоступности БД).
            if (!cancelled) setCount(bannerCountFor(weight));
        });
        return () => { cancelled = true; };
    }, [weight]);

    if (count <= 0) return null;
    return (
        <>
            {Array.from({ length: count }).map((_, i) => (
                <AdBanner key={i} type={type} style={style} />
            ))}
        </>
    );
}
