'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as actions from '../../actions';

export default function WavyPlayer({ videoId, duration, authorAdDevId, authorAdStaticId, authorAdVideoId }) {
  const videoRef = useRef(null);
  const lastLoggedSegment = useRef(-1);
  const lastAdTime = useRef(0);
  const [errorLog, setErrorLog] = useState('');
  
  const [showMidroll, setShowMidroll] = useState(false);
  const [adTimeLeft, setAdTimeLeft] = useState(5); 
  const [adData, setAdData] = useState(null);

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

  // Запрашивает рекламу непосредственно в момент, когда должен показаться мидролл.
  // Если у автора нет своего рекламного аккаунта или подходящей активной кампании нет —
  // реклама просто отключена: ролик продолжает играть без прерывания.
  const tryShowMidroll = async (video) => {
    const { authorAdDevId: devId, authorAdStaticId: staticId, authorAdVideoId: videoSiteId } = adPropsRef.current;
    if (!devId) return;

    try {
      const type = videoSiteId ? 'video' : 'banner';
      const siteId = type === 'video' ? videoSiteId : staticId;
      const res = await fetch(`/api/ads?action=getAd&type=${type}&devId=${devId}&siteId=${siteId || ''}`);
      const data = await res.json();

      if (data?.success && data.ad) {
        setAdData(data.ad);
        video.pause();
        setAdTimeLeft(5);
        setShowMidroll(true);
      }
      // Нет подходящей рекламы — ничего не делаем, видео продолжает играть без прерывания
    } catch (e) {
      console.error('Ошибка загрузки рекламы:', e);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoId) return;

    video.src = `/api/video?id=${videoId}`;
    video.load();

    const handleTimeTracking = () => {
      const currentTime = video.currentTime;
      const segDuration = getSegmentDuration();
      const currentSegment = Math.floor(currentTime / segDuration);

      if (currentSegment !== lastLoggedSegment.current) {
        lastLoggedSegment.current = currentSegment;
        if (actions.logSegmentWatch) {
          actions.logSegmentWatch(videoId, currentSegment).catch(e => 
            console.error('Ошибка телеметрии:', e)
          );
        }
      }

      if (currentTime > 15 && Math.floor(currentTime) % 40 === 0 && Math.floor(currentTime) !== lastAdTime.current) {
        lastAdTime.current = Math.floor(currentTime);
        tryShowMidroll(video);
      }
    };

    video.addEventListener('timeupdate', handleTimeTracking);
    return () => {
      video.removeEventListener('timeupdate', handleTimeTracking);
    };
  }, [videoId, duration]);

  useEffect(() => {
    if (!showMidroll) return;
    if (adTimeLeft <= 0) {
      // Реклама реально показана до конца — подтверждаем показ для биллинга
      if (adData?.payload && adData?.signature) {
        fetch('/api/ads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verifyImpression', payload: adData.payload, signature: adData.signature })
        }).catch(() => {});
      }
      setShowMidroll(false);
      setAdData(null);
      if (videoRef.current) videoRef.current.play().catch(() => {});
      return;
    }

    const interval = setInterval(() => {
      setAdTimeLeft(prev => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [showMidroll, adTimeLeft, adData]);

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
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.95)', color: 'white', fontSize: '15px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <span>Реклама закроется через {adTimeLeft} сек...</span>
            <span style={{ color: '#6366f1' }}>FireSoft Ads System</span>
          </div>

          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', position: 'relative' }}>
             <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
               {adData?.source === 'video' || adData?.content_url?.endsWith('.mp4') ? (
                 <video 
                   src={adData.content_url} 
                   autoPlay 
                   loop 
                   muted 
                   playsInline 
                   style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
                 />
               ) : (
                 <a href={adData?.target_url || '#'} target="_blank" rel="noopener noreferrer">
                   <img 
                     src={adData?.content_url} 
                     alt="Рекламный пост" 
                     style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: '6px' }} 
                   />
                 </a>
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