'use client';

import React, { useRef, useEffect, useState } from 'react';
import * as actions from '../../actions';

export default function WavyPlayer({ videoId, duration }) {
  const videoRef = useRef(null);
  const lastLoggedSegment = useRef(-1);
  const [errorLog, setErrorLog] = useState('');

  const getSegmentDuration = () => {
    if (!duration || duration <= 60) return 5; 
    if (duration <= 600) return 10;
    return 20;
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoId) return;

    video.src = `/api/video?id=${videoId}`;
    video.load();

    const handleTimeTracking = () => {
      const segDuration = getSegmentDuration();
      const currentSegment = Math.floor(video.currentTime / segDuration);

      if (currentSegment !== lastLoggedSegment.current) {
        lastLoggedSegment.current = currentSegment;
        if (actions.logSegmentWatch) {
          actions.logSegmentWatch(videoId, currentSegment).catch(e => 
            console.error('Ошибка телеметрии:', e)
          );
        }
      }
    };

    video.addEventListener('timeupdate', handleTimeTracking);
    return () => {
      video.removeEventListener('timeupdate', handleTimeTracking);
    };
  }, [videoId, duration]);

  return (
    <div className="wavy-player-wrapper" style={{ width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
      <video 
        ref={videoRef} 
        controls 
        autoPlay 
        playsInline
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={() => setErrorLog('Ошибка загрузки потока видео')}
      />
      {errorLog && (
        <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(232,17,35,0.9)', color: '#fff', padding: '6px 12px', borderRadius: '6px', fontSize: '12px' }}>
          {errorLog}
        </div>
      )}
    </div>
  );
}