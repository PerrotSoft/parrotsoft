// recommendations.js
import React, { useState } from 'react';

export function getRecommendedVideos(videos, currentVideo, sortMode = 'recommended') {
  if (!currentVideo) return [];
  const playlistName = currentVideo?.playlist;
  
  if (playlistName && playlistName !== 'Общее' && sortMode !== 'recommended_all') {
      const playlistVideos = videos.filter(v => v.playlist === playlistName);
      return [...playlistVideos].sort((a,b) => {
         if (sortMode === 'sequential') return (a.timestamp || 0) - (b.timestamp || 0);
         const scoreA = ((a.views||0)*0.1) + ((a.likes||0)*0.5);
         const scoreB = ((b.views||0)*0.1) + ((b.likes||0)*0.5);
         return scoreB - scoreA;
      });
  }

  return [...videos].filter(v => v.id !== currentVideo.id).map(v => {
     let score = 0;
     if (v.channel === currentVideo.channel) score += 5;
     if (v.playlist === currentVideo.playlist && v.playlist !== 'Общее' && v.playlist) score += 10;
     score += (v.views || 0) * 0.1;
     score += (v.likes || 0) * 0.5;
     const ageDays = (Date.now() - (v.timestamp || 0)) / (1000 * 3600 * 24);
     score -= ageDays * 0.1;
     return { ...v, score };
  }).sort((a,b) => b.score - a.score);
}

export function RecommendationSystem({ videos, currentVideo, onPlay, onSelectChannel }) {
  const playlistName = currentVideo?.playlist;
  const [viewMode, setViewMode] = useState('recommendations');
  const [playlistSort, setPlaylistSort] = useState('recommended');

  const playlistVideos = playlistName && playlistName !== 'Общее' ? videos.filter(v => v.playlist === playlistName) : [];
  
  const recs = getRecommendedVideos(videos, currentVideo, viewMode === 'playlist' ? playlistSort : 'recommended_all');

  return (
     <div className="recommendations-panel">
        {playlistVideos.length > 0 && viewMode === 'recommendations' && (
           <button className="btn-view-playlist" onClick={() => setViewMode('playlist')}>
              📁 Посмотреть плейлист: {playlistName} ({playlistVideos.length})
           </button>
        )}

        {viewMode === 'playlist' && (
           <div className="playlist-view-header">
              <button className="btn-back-recs" onClick={() => setViewMode('recommendations')}>← Назад к рекомендациям</button>
              <h3>Плейлист: {playlistName}</h3>
              <div className="sort-toggles">
                 <button className={playlistSort === 'sequential' ? 'active' : ''} onClick={()=>setPlaylistSort('sequential')}>По порядку</button>
                 <button className={playlistSort === 'recommended' ? 'active' : ''} onClick={()=>setPlaylistSort('recommended')}>По рекомендации</button>
              </div>
           </div>
        )}

        <div className="recs-list">
           {recs.map(v => (
              <div key={v.id} className="rec-card" onClick={() => onPlay(v)}>
                 <div className={`rec-thumb ${v.is_short ? 'vertical' : ''}`}>
                    {v.thumbnail ? <img src={v.thumbnail} alt={v.title} /> : <div style={{width:'100%', height:'100%', background:'#222'}} />}
                    {v.is_short && <span className="duration-tag">⚡ Short</span>}
                 </div>
                 <div className="rec-info">
                    <h4>{v.title}</h4>
                    <p className="ch-link" onClick={(e) => { e.stopPropagation(); onSelectChannel(v.channel); }}>@{v.channel}</p>
                    <p>👁 {v.views||0} • {new Date(v.timestamp||Date.now()).toLocaleDateString()}</p>
                 </div>
              </div>
           ))}
        </div>
     </div>
  );
}