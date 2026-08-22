'use client';

import React, { useRef, useEffect, useState, useMemo } from 'react';
import * as actions from '../../actions';
import { ADSTERRA_GIF_URL, MIN_AD_SECONDS, STATIC_ROTATE_SECONDS, PREROLL_CHANCE, MIDROLL_ROTATE_GIF_CHANCE, pickAdCategory, mergeConfig, PLATFORM_DEV_ID, DEFAULT_BANNER_SITE_ID } from '../../lib/siteConfig';
import { getCachedLiveConfig } from '../../lib/liveConfigCache';

export default function WavyPlayer({ videoId, duration, username, authorAdDevId, authorAdStaticId, authorAdVideoId, adPositions: adPositionsStr, startAt = 0, onTimeUpdate }) {
  // БАГ (найден по репорту): раньше сюда передавали уже готовый МАССИВ, а
  // page.js пересчитывал (создавал НОВЫЙ массив, каждый раз новый объект в
  // памяти) на каждый ре-рендер — а page.js ре-рендерится каждую секунду
  // (onTimeUpdate). Эффект ниже, у которого adPositions был в зависимостях,
  // из-за этого срабатывал каждую секунду и сбрасывал midrollIndexRef.current
  // обратно в 0 — реклама, которая только что была показана, тут же снова
  // "имела право" сработать на следующий же тик timeupdate. Отсюда и
  // реклама через каждые несколько секунд подряд. Теперь сюда приходит
  // просто строка (примитив, сравнивается по значению, а не по ссылке) и
  // парсится один раз через useMemo — по-настоящему пересчитывается, только
  // когда сама строка реально поменялась.
  const adPositions = useMemo(
    () => adPositionsStr ? String(adPositionsStr).split(',').map(Number).filter(n => n > 0) : [],
    [adPositionsStr]
  );
  const videoRef = useRef(null);
  const lastLoggedSegment = useRef(-1);
  const lastReportedSecond = useRef(-1);
  const hasSeekedToStart = useRef(false);
  const [errorLog, setErrorLog] = useState('');
  
  const [showMidroll, setShowMidroll] = useState(false);
  const [adElapsed, setAdElapsed] = useState(0);
  const [adData, setAdData] = useState(null);

  // "Живой" конфиг рекламы (AD_SPLIT / PREROLL_CHANCE и т.д. из живых
  // оверрайдов в БД поверх базового lib/siteConfig.js) — грузится один раз
  // через общий кэш (lib/liveConfigCache.js), кладём в ref, т.к. читается
  // из обработчиков timeupdate/preroll, которым не нужен ре-рендер.
  const liveAdConfigRef = useRef(mergeConfig(null));
  useEffect(() => {
    let cancelled = false;
    getCachedLiveConfig(actions.getLiveConfig).then((live) => {
      if (!cancelled) liveAdConfigRef.current = mergeConfig(live);
    });
    return () => { cancelled = true; };
  }, []);

  // Держим актуальные пропсы в ref, чтобы обработчик timeupdate (созданный один раз на видео)
  // не работал с устаревшими значениями, если пропсы поменяются без смены videoId
  const adPropsRef = useRef({ authorAdDevId, authorAdStaticId, authorAdVideoId });
  useEffect(() => {
    adPropsRef.current = { authorAdDevId, authorAdStaticId, authorAdVideoId };
  }, [authorAdDevId, authorAdStaticId, authorAdVideoId]);

  const getSegmentDuration = () => {
    if (!duration || duration <= 60) return 5; 
    if (duration <= 600) return 10;
    return 20;
  };

  // ── Расписание мидроллов ────────────────────────────────────────────────
  // - короче 1 минуты: рекламы нет вообще
  // - от 1 минуты до 5:00: ровно 2 показа, делящие видео на 3 равные части
  // - длиннее: реклама каждые 5 минут, но не меньше 2 показов суммарно
  //   (если 5-минутный шаг даёт только 1 точку — тоже делим на 3 равные части)
  const getMidrollSchedule = (durationSeconds, customPositions) => {
    // Если владелец видео сам расставил позиции рекламы (см. adPositions —
    // до 4 таймкодов в секундах, настраивается при редактировании видео) —
    // используем их вместо автоматического расписания.
    if (Array.isArray(customPositions) && customPositions.length > 0) {
      return customPositions.filter(t => t > 0 && t < durationSeconds).sort((a, b) => a - b).slice(0, 4);
    }
    if (!durationSeconds || durationSeconds < 60) return [];
    const FIVE_MIN = 300;
    if (durationSeconds < FIVE_MIN + 1) {
      return [durationSeconds / 3, (durationSeconds / 3) * 2];
    }
    const schedule = [];
    for (let t = FIVE_MIN; t < durationSeconds; t += FIVE_MIN) schedule.push(t);
    if (schedule.length < 2) {
      return [durationSeconds / 3, (durationSeconds / 3) * 2];
    }
    return schedule;
  };

  const midrollScheduleRef = useRef([]);
  const midrollIndexRef = useRef(0);
  useEffect(() => {
    midrollScheduleRef.current = getMidrollSchedule(duration, adPositions);
    midrollIndexRef.current = 0;
  }, [duration, videoId, adPositions]);

  // Запрашивает рекламу непосредственно в момент, когда должен показаться мидролл.
  // Если у автора нет своего рекламного аккаунта или подходящей активной кампании нет —
  // реклама просто отключена: ролик продолжает играть без прерывания.
  // БАГ (найден по жалобе "вся реклама одного типа"): раньше тип рекламы
  // тут был жёстко привязан к наличию authorAdVideoId — либо всегда 'video',
  // либо всегда 'banner', без всякой рандомизации. AD_SPLIT в ParrotSoftAd.jsx
  // на это НИКАК не влиял — это два независимых места выбора рекламы, и
  // именно ЭТО, а не ParrotSoftAd, отвечает за настоящие мидроллы во время
  // просмотра. Теперь тут тоже есть разнообразие.
  const tryShowMidroll = async (video) => {
    const { authorAdDevId, authorAdStaticId, authorAdVideoId } = adPropsRef.current;
    // БАГ: раньше при отсутствии своего рекламного аккаунта у автора (обычное
    // дело — большинство каналов ничего не настраивали) функция просто молча
    // выходила — мидроллы не показывались ВООБЩЕ, ни ParrotSoft, ни Adsterra.
    // У баннеров (ParrotSoftAd.jsx) уже был дефолт на платформенный аккаунт
    // 'Icfg' — теперь и здесь так же: реклама всегда пытается показаться,
    // getAdForPlayer сам разберётся ParrotSoft-кампания это или Adsterra.
    const devId = authorAdDevId || PLATFORM_DEV_ID;
    const staticId = authorAdStaticId || DEFAULT_BANNER_SITE_ID;
    const videoSiteId = authorAdVideoId;

    // Общий разыгрыватель с ParrotSoftAd.jsx — см. lib/siteConfig.js
    // (pickAdCategory): честное колесо 37% видео / 37% гиф / 12.5%
    // Adsterra-баннер / 12.5% собственный баннер автора, а не приоритетный
    // каскад "если есть видео — всегда видео".
    const category = pickAdCategory(true, liveAdConfigRef.current.adSplit); // true = это настоящий мидролл, видео разрешено участвовать
    if (category === 'gif') {
      // Гиф — просто картинка по прямой ссылке, без похода на /api/ads вообще.
      setAdData({ use_gif: true, content_url: ADSTERRA_GIF_URL });
      video.pause();
      setAdElapsed(0);
      setShowMidroll(true);
      return;
    }

    try {
      const type = category === 'video' ? 'video' : 'banner';
      const siteId = category === 'video' ? (videoSiteId || staticId)
        : category === 'bannerAdsterra' ? DEFAULT_BANNER_SITE_ID
        : staticId;
      const reqDevId = category === 'bannerAdsterra' ? PLATFORM_DEV_ID : devId;
      const res = await fetch(`/api/ads?action=getAd&type=${type}&devId=${reqDevId}&siteId=${siteId || ''}`);
      const data = await res.json();

      if (data?.success && data.ad) {
        setAdData(data.ad);
        video.pause();
        setAdElapsed(0);
        setShowMidroll(true);
      }
      // Нет подходящей рекламы (и Adsterra почему-то тоже не отдался) —
      // ничего не делаем, видео продолжает играть без прерывания.
    } catch (e) {
      console.error('Ошибка загрузки рекламы:', e);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoId) return;

    video.src = `/api/video?id=${videoId}`;
    video.load();
    hasSeekedToStart.current = false;

    // Преролл: с шансом 50% реклама показывается ДО начала видео, не только
    // в середине. Переиспользуем ту же логику мидролла (пауза + оверлей) —
    // closeMidroll сам возобновит video.play() после закрытия рекламы.
    if (Math.random() < liveAdConfigRef.current.prerollChance) {
      video.pause();
      tryShowMidroll(video);
    }

    // Диплинк с таймкодом (?video=ID&t=СЕК): перематываем на нужную секунду один раз,
    // как только станет известна длительность/метаданные видео.
    const handleLoadedMetadata = () => {
      if (!hasSeekedToStart.current && startAt > 0) {
        hasSeekedToStart.current = true;
        try { video.currentTime = startAt; } catch (e) {}
      }
    };

    const handleTimeTracking = () => {
      const currentTime = video.currentTime;
      const segDuration = getSegmentDuration();
      const currentSegment = Math.floor(currentTime / segDuration);

      if (currentSegment !== lastLoggedSegment.current) {
        lastLoggedSegment.current = currentSegment;
        if (actions.logSegmentWatch) {
          actions.logSegmentWatch(videoId, currentSegment, username).catch(e => 
            console.error('Ошибка телеметрии:', e)
          );
        }
      }

      // Сообщаем текущую секунду родителю (throttled раз в секунду) — используется для ссылки "Поделиться"
      const wholeSecond = Math.floor(currentTime);
      if (onTimeUpdate && wholeSecond !== lastReportedSecond.current) {
        lastReportedSecond.current = wholeSecond;
        onTimeUpdate(wholeSecond);
      }

      const schedule = midrollScheduleRef.current;
      if (midrollIndexRef.current < schedule.length && currentTime >= schedule[midrollIndexRef.current]) {
        midrollIndexRef.current += 1;
        tryShowMidroll(video);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeTracking);
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeTracking);
    };
  }, [videoId, duration, startAt]);

  const isVideoAd = adData?.source === 'video' || adData?.content_url?.endsWith('.mp4');
  const canSkip = adElapsed >= MIN_AD_SECONDS;

  // Подтверждает показ текущей рекламы для биллинга (не для use_iframe —
  // Adsterra-фрейм репортит показ сам через IntersectionObserver, см.
  // renderAdHtml, иначе засчитали бы один и тот же показ дважды).
  const verifyCurrentImpression = (data) => {
    if (data?.payload && data?.signature && !data?.use_iframe) {
      fetch('/api/ads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verifyImpression', payload: data.payload, signature: data.signature })
      }).catch(() => {});
    }
  };

  const closeMidroll = () => {
    verifyCurrentImpression(adData);
    setShowMidroll(false);
    setAdData(null);
    if (videoRef.current) videoRef.current.play().catch(() => {});
  };

  // Клик по самой рекламе (не по кнопке "Пропустить") — переход на сайт
  // рекламодателя в новой вкладке, реклама при этом НЕ закрывается (ровно
  // как просили: "выйти нельзя", единственный способ закрыть — кнопка
  // "Пропустить", доступная не раньше MIN_AD_SECONDS).
  const handleAdContentClick = () => {
    if (adData?.target_url) window.open(adData.target_url, '_blank', 'noopener,noreferrer');
  };

  // Тикающий таймер, пока показана реклама.
  useEffect(() => {
    if (!showMidroll) return;
    const interval = setInterval(() => setAdElapsed(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, [showMidroll]);

  // Ротация статичной (не видео) рекламы каждые STATIC_ROTATE_SECONDS —
  // видео-реклама, наоборот, просто доигрывает до конца без ротации
  // (закрывается через onEnded у <video>, см. разметку ниже).
  useEffect(() => {
    if (!showMidroll || isVideoAd) return;
    if (adElapsed > 0 && adElapsed % STATIC_ROTATE_SECONDS === 0) {
      verifyCurrentImpression(adData);
      // На ротации тоже даём шанс гифке, а не только обычному баннеру.
      if (Math.random() < MIDROLL_ROTATE_GIF_CHANCE) {
        setAdData({ use_gif: true, content_url: ADSTERRA_GIF_URL });
        return;
      }
      const { authorAdDevId, authorAdStaticId, authorAdVideoId } = adPropsRef.current;
      const devId = authorAdDevId || PLATFORM_DEV_ID;
      const siteId = authorAdStaticId || DEFAULT_BANNER_SITE_ID;
      fetch(`/api/ads?action=getAd&type=banner&devId=${devId}&siteId=${siteId}`)
        .then(r => r.json())
        .then(data => { if (data?.success && data.ad) setAdData(data.ad); })
        .catch(() => {});
    }
  }, [adElapsed, showMidroll, isVideoAd]);

  return (
    <div className="wavy-player-wrapper" style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
      <video 
        ref={videoRef} 
        controls={!showMidroll} 
        autoPlay 
        playsInline
        preload="auto"
        style={{ width: '100%', height: '100%', objectFit: 'contain', filter: showMidroll ? 'blur(12px)' : 'none' }}
        onError={() => setErrorLog('Ошибка загрузки потока видео')}
      />
      
      {showMidroll && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: 'rgba(0,0,0,0.9)' }}>
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.95)', color: 'white', fontSize: '15px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <span>Реклама</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ color: '#6366f1', fontWeight: 400, fontSize: 13 }}>ParrotSoft Ads System</span>
              {canSkip ? (
                <button
                  onClick={closeMidroll}
                  style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >Пропустить ▶</button>
              ) : (
                <span style={{ opacity: 0.6, fontSize: 13, fontWeight: 400 }}>Пропустить через {MIN_AD_SECONDS - adElapsed} сек</span>
              )}
            </span>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', position: 'relative' }}>
             {/* Клик по самой рекламе — переход на сайт рекламодателя, реклама
                 при этом НЕ закрывается (закрыть можно только кнопкой
                 "Пропустить" выше, и только после MIN_AD_SECONDS). */}
             <div
               onClick={!adData?.use_iframe ? handleAdContentClick : undefined}
               style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: !adData?.use_iframe && adData?.target_url ? 'pointer' : 'default' }}
             >
               {adData?.use_iframe ? (
                 // Adsterra-фрейм сам по себе кликабелен (ссылка зашита внутри
                 // HTML, который отдаёт renderAdHtml) — обёртку не дублируем.
                 <iframe
                   src={adData.iframe_url}
                   style={{ width: '100%', height: '100%', border: 'none', borderRadius: '6px' }}
                   title="ParrotSoft Ads Secure Frame"
                   scrolling="no"
                   sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                 />
               ) : isVideoAd ? (
                 <video 
                   src={adData.content_url} 
                   autoPlay 
                   muted 
                   playsInline 
                   onEnded={closeMidroll}
                   style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                 />
               ) : (
                 <img 
                   src={adData?.content_url} 
                   alt="Рекламный пост" 
                   style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: '6px' }} 
                 />
               )}
             </div>
          </div>
        </div>
      )}

      {errorLog && (
        <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(239,68,68,0.9)', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '13px' }}>
          {errorLog}
        </div>
      )}
    </div>
  );
}