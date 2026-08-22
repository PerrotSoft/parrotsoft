'use client';
// Общий кэш "живого" конфига (site_config_kv, actions.js: getLiveConfig) для
// всех клиентских компонентов рекламы — без него ParrotSoftAd.jsx/WavyPlayer.js
// дёргали бы БД на КАЖДЫЙ показ рекламы (на видео с несколькими мидроллами
// это уже заметно). TTL небольшой (60 сек), чтобы правки из будущей
// admin-панели доезжали до пользователей быстро, но не на каждый чих.

const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;
let inFlight = null;

export function getCachedLiveConfig(fetcher) {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return Promise.resolve(cached);
  if (inFlight) return inFlight;

  inFlight = fetcher()
    .then((live) => {
      cached = live || {};
      cachedAt = Date.now();
      inFlight = null;
      return cached;
    })
    .catch((e) => {
      console.error('[liveConfigCache] сбой получения живого конфига, используем базовый:', e);
      inFlight = null;
      return cached || {}; // при сбое — старое значение из кэша или пусто (откат на дефолтный конфиг)
    });

  return inFlight;
}
