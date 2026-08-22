// ── Единый конфиг сайта ──────────────────────────────────────────────────
// Первый кусок "глобального обновления конфигами": то, что раньше жило
// разрозненными числами внутри ParrotSoftAd.jsx и WavyPlayer.js, теперь в
// одном файле — config/site.config.json. Это базовый конфиг (правка = обычный
// деплой). "Живой" конфиг поверх него — actions.js: getLiveConfig()/
// setLiveConfigValue() — читает и пишет оверрайды в БД (site_config_kv), их
// можно менять без передеплоя (задел под будущую admin-панель). mergeConfig()
// ниже объединяет то и другое.
import siteConfigFile from '../config/site.config.json';

// Раскладываем вложенный JSON (ads/economy/limits/features) в один плоский
// объект — так mergeConfig() и весь остальной код, который уже ждёт
// DEFAULT_CONFIG.commissionRate, DEFAULT_CONFIG.adSplit и т.д. плоскими
// полями, продолжает работать без изменений.
export const DEFAULT_CONFIG = {
  adSplit: siteConfigFile.ads.adSplit,
  minAdSeconds: siteConfigFile.ads.minAdSeconds,
  staticRotateSeconds: siteConfigFile.ads.staticRotateSeconds,
  prerollChance: siteConfigFile.ads.prerollChance,
  midrollRotateGifChance: siteConfigFile.ads.midrollRotateGifChance,
  feedAdEveryN: siteConfigFile.ads.feedAdEveryN,
  platformDevId: siteConfigFile.ads.platformDevId,
  defaultBannerSiteId: siteConfigFile.ads.defaultBannerSiteId,
  defaultGifSiteId: siteConfigFile.ads.defaultGifSiteId,
  defaultVideoSiteId: siteConfigFile.ads.defaultVideoSiteId,
  defaultStaticSiteId: siteConfigFile.ads.defaultStaticSiteId,
  adsterraClickTarget: siteConfigFile.ads.adsterraClickTarget,
  adIntensity: siteConfigFile.ads.adIntensity || 'normal', // 'off' | 'normal' | 'ultra'
  commissionRate: siteConfigFile.economy.commissionRate,
  maxChannelsPerAccount: siteConfigFile.limits.maxChannelsPerAccount,
  maxCommentLength: siteConfigFile.limits.maxCommentLength,
  maxPostTextLength: siteConfigFile.limits.maxPostTextLength,
  driveQuotaBytes: siteConfigFile.limits.driveQuotaBytes || 104857600, // 100 МБ по умолчанию
  guestModeEnabled: siteConfigFile.features.guestModeEnabled,
  postsEnabled: siteConfigFile.features.postsEnabled,
  totpEnabled: siteConfigFile.features.totpEnabled,
};

// Слить базовый конфиг с "живыми" оверрайдами из БД (getLiveConfig() в
// actions.js) — оверрайды побеждают, но только по тем ключам, что реально
// заданы. adSplit сливается по отдельным секторам, а не заменяется целиком,
// чтобы можно было переопределить, например, только commissionRate, не
// трогая остальное, и наоборот.
export function mergeConfig(overrides) {
  const o = overrides || {};
  return {
    ...DEFAULT_CONFIG,
    ...o,
    adSplit: { ...DEFAULT_CONFIG.adSplit, ...(o.adSplit || {}) },
  };
}

// ── Обратная совместимость: старые именованные экспорты, которыми уже
// пользуются компоненты (ParrotSoftAd.jsx, WavyPlayer.js, WavyTube/page.js) —
// продолжают работать без изменений, просто теперь являются "снимком"
// DEFAULT_CONFIG на момент старта процесса. Новый код, которому нужны живые
// значения, пусть использует mergeConfig(await actions.getLiveConfig()).
export const AD_SPLIT = DEFAULT_CONFIG.adSplit;
export const MIN_AD_SECONDS = DEFAULT_CONFIG.minAdSeconds;
export const STATIC_ROTATE_SECONDS = DEFAULT_CONFIG.staticRotateSeconds;
export const PREROLL_CHANCE = DEFAULT_CONFIG.prerollChance;
export const MIDROLL_ROTATE_GIF_CHANCE = DEFAULT_CONFIG.midrollRotateGifChance;
export const FEED_AD_EVERY_N = DEFAULT_CONFIG.feedAdEveryN;
export const PLATFORM_DEV_ID = DEFAULT_CONFIG.platformDevId;
export const DEFAULT_BANNER_SITE_ID = DEFAULT_CONFIG.defaultBannerSiteId;
export const DEFAULT_GIF_SITE_ID = DEFAULT_CONFIG.defaultGifSiteId;
export const DEFAULT_VIDEO_SITE_ID = DEFAULT_CONFIG.defaultVideoSiteId;
export const DEFAULT_STATIC_SITE_ID = DEFAULT_CONFIG.defaultStaticSiteId;
export const ADSTERRA_CLICK_TARGET = DEFAULT_CONFIG.adsterraClickTarget;
export const AD_INTENSITY = DEFAULT_CONFIG.adIntensity;

// ── Видимость баннеров вне видео/фида (Datapedia, WavyChat-посты,
// DB-менеджер, ADS Dashboard и т.п.) — управляется adIntensity, живой
// оверрайд берём тем же путём, что и остальной живой конфиг (mergeConfig).
//   'off'    — нигде ни одного баннера
//   'normal' — только места с weight 'light' (по одному баннеру по месту)
//   'ultra'  — 'light' И 'more' места, плюс 'more' показывает несколько штук
// weight: 'light' | 'more'
export function shouldShowBannerAd(weight, intensity = AD_INTENSITY) {
  if (intensity === 'off') return false;
  if (intensity === 'ultra') return true;
  // normal (по умолчанию)
  return weight === 'light';
}

// Сколько баннеров показать в месте с weight 'more' (DB-менеджер и т.п.) —
// в normal туда вообще не попадаем (shouldShowBannerAd вернёт false раньше),
// а в ultra — несколько штук подряд, а не один.
export function bannerCountFor(weight, intensity = AD_INTENSITY) {
  if (!shouldShowBannerAd(weight, intensity)) return 0;
  if (weight === 'more' && intensity === 'ultra') return 3;
  return 1;
}
export const COMMISSION_RATE = DEFAULT_CONFIG.commissionRate;
export const MAX_CHANNELS_PER_ACCOUNT = DEFAULT_CONFIG.maxChannelsPerAccount;
export const DRIVE_QUOTA_BYTES = DEFAULT_CONFIG.driveQuotaBytes;
export const MAX_COMMENT_LENGTH = DEFAULT_CONFIG.maxCommentLength;
export const MAX_POST_TEXT_LENGTH = DEFAULT_CONFIG.maxPostTextLength;
export const GUEST_MODE_ENABLED = DEFAULT_CONFIG.guestModeEnabled;
export const POSTS_ENABLED = DEFAULT_CONFIG.postsEnabled;
export const TOTP_ENABLED = DEFAULT_CONFIG.totpEnabled;

// Тот самый рабочий реферальный GIF-баннер Adsterra. ЗАМЕНИ ссылку клика в
// местах, где она используется (ParrotSoftAd.jsx, WavyPlayer.js) на свою
// настоящую реферальную — этого я не знаю и не стал выдумывать.
export const ADSTERRA_GIF_URL = siteConfigFile.ads.adsterraGifUrl;

// Один разыгрывающий на оба места (ParrotSoftAd.jsx и WavyPlayer.js) — раньше
// у каждого была СВОЯ копия похожей, но чуть разной логики, и в одной из
// них (ParrotSoftAd.jsx) было ДВЕ ошибки: гифка была физически недостижима
// для мидролла (условие `&& !isMidroll` на её ветке рендера), а тип рекламы
// для мидролла жёстко переписывался на 'video' независимо от того, что
// реально выпало на кубике — то есть честного розыгрыша там не было вообще,
// какой бы ни была AD_SPLIT. Обе ошибки были только в отрисовке, не в самом
// проценте — отсюда и ощущение "то же самое почти всегда".
//
// Используем crypto.getRandomValues, когда доступен (в браузере — всегда) —
// качественнее обычного Math.random для такого рода розыгрыша.
function cryptoRandom100() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return (buf[0] / 0xFFFFFFFF) * 100;
  }
  return Math.random() * 100;
}

// allowVideo — false для мест в форме баннера (лента, карточки), где для
// видео физически нет пространства; true — только для настоящего мидролла.
// splitOverride — необязательный "живой" AD_SPLIT (см. mergeConfig выше);
// по умолчанию — базовый AD_SPLIT, как и раньше.
export function pickAdCategory(allowVideo, splitOverride) {
  const split = splitOverride || AD_SPLIT;
  const r = cryptoRandom100();
  if (allowVideo && r < split.video) return 'video';
  // Доля video (когда розыгрыш идёт без неё) пропорционально перераспределяется
  // между оставшимися тремя категориями — те же соотношения друг к другу.
  const rest = allowVideo ? (r - split.video) : r * (100 / (100 - split.video));
  if (rest < split.gif) return 'gif';
  if (rest < split.gif + split.bannerAdsterra) return 'bannerAdsterra';
  return 'bannerOwn';
}

