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

    // Прямая отдача статического MP4 (Никаких зависаний API)
    video.src = `/videos/${videoId}.mp4`;
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
        onError={(e) => setErrorLog('Ошибка загрузки потока')}
      />
      {errorLog && <div style={{ position: 'absolute', bottom: '20px', left: '20px', background: 'rgba(239, 68, 68, 0.9)', padding: '10px 20px', borderRadius: '8px', fontWeight: 'bold' }}>{errorLog}</div>}
    </div>
  );
}