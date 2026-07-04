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
  const [adsEnabled, setAdsEnabled] = useState(false);
  const adsEnabledRef = useRef(false);
  useEffect(() => { adsEnabledRef.current = adsEnabled; }, [adsEnabled]);

  const getSegmentDuration = () => {
    if (!duration || duration <= 60) return 5; 
    if (duration <= 600) return 10;
    return 20;
  };

  useEffect(() => {
    if (!authorAdDevId) {
      // Автор не настроил рекламный аккаунт — реклама отключена, платформа не подставляет свою
      setAdsEnabled(false);
      setAdData(null);
      return;
    }

    const fetchAdData = async () => {
      try {
        let type = authorAdVideoId ? 'video' : 'banner';
        let siteId = type === 'video' ? authorAdVideoId : authorAdStaticId;

        const res = await fetch(`/api/ads?action=getAd&type=${type}&devId=${authorAdDevId}&siteId=${siteId}`);
        const data = await res.json();

        if (data && data.success && data.ad) {
          setAdData(data.ad);
          setAdsEnabled(true);
        } else {
          // Реклама не найдена — отключаем показ, без подмены на дефолтный баннер
          setAdData(null);
          setAdsEnabled(false);
        }
      } catch (e) {
        console.error("Ошибка загрузки рекламы:", e);
        setAdData(null);
        setAdsEnabled(false);
      }
    };

    fetchAdData();
  }, [authorAdDevId, authorAdStaticId, authorAdVideoId]);

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

      if (adsEnabledRef.current && currentTime > 15 && Math.floor(currentTime) % 40 === 0 && Math.floor(currentTime) !== lastAdTime.current) {
        lastAdTime.current = Math.floor(currentTime);
        video.pause();
        setAdTimeLeft(5);
        setShowMidroll(true);
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
      setShowMidroll(false);
      if (videoRef.current) videoRef.current.play().catch(() => {});
      return;
    }

    const interval = setInterval(() => {
      setAdTimeLeft(prev => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [showMidroll, adTimeLeft]);

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