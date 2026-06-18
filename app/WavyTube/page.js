// page.js
'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import * as actions from '../actions';
import WavyPlayer from './components/WavyPlayer';
import { RecommendationSystem } from './components/recommendations';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

function ShortsPlayer({ short, isActive, isNear }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isActive) {
      if (!video.src || !video.src.includes(short.id)) { video.src = `/api/video?id=${short.id}`; video.load(); }
      video.play().catch(() => {});
    } else if (isNear) {
      if (!video.src || !video.src.includes(short.id)) { video.src = `/api/video?id=${short.id}`; video.load(); }
      video.pause();
    } else {
      video.pause(); video.src = ''; video.load();
    }
  }, [isActive, isNear, short.id]);
  // ДОБАВЛЕНО: controls={true} для паузы, перемотки и звука в шортсах
  return <video ref={videoRef} controls loop playsInline muted={!isActive} className="short-native-video" />;
}

function CommentsPopup({ video, currentChannel, onClose }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!video?.id) return;
    setLoading(true);
    actions.getComments(video.id).then(res => { setComments(res || []); setLoading(false); });
  }, [video?.id]);
  const submitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    const fresh = { id: Math.random().toString(), video_id: video.id, author: currentChannel, text: newComment, timestamp: Date.now() };
    setComments([fresh, ...comments]);
    setNewComment('');
    await actions.addComment(video.id, currentChannel, newComment);
  };
  return (
    <div className="comments-popup-backdrop" onClick={onClose}>
      <div className="comments-popup-panel" onClick={e => e.stopPropagation()}>
        <div className="comments-popup-header">
          <h3>Комментарии <span className="count-tag">{comments.length}</span></h3>
          <button className="popup-close-btn" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submitComment} className="popup-comment-form">
          <input type="text" placeholder={`Комментарий от @${currentChannel}…`} value={newComment} onChange={e => setNewComment(e.target.value)} autoFocus />
          <button type="submit" className="popup-submit-btn">↑</button>
        </form>
        <div className="popup-comments-list">
          {loading ? <div className="popup-loading">Загрузка…</div>
          : comments.length === 0 ? <div className="popup-empty">Будьте первым!</div>
          : comments.map(c => (
            <div key={c.id} className="popup-comment-item">
              <div className="popup-c-avatar">{c.author?.[0]?.toUpperCase()}</div>
              <div className="popup-c-body">
                <span className="popup-c-author">@{c.author}</span>
                <p>{c.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const EMOJI_ICONS = ['🎬','📺','🎵','🎮','💻','🚀','🎨','📚','🌍','⚡','🔥','💎','🎤','📡','🛸','🌙','🦋','🎯','🏆','🌊'];

function CreateChannelPopup({ accountId, accountKey, currentCount, onCreated, onClose }) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('🎬');
  const [customImageB64, setCustomImageB64] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setCustomImageB64(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setError('Введите уникальное имя канала'); return; }
    if (currentCount >= 5) { setError('Достигнут лимит 5 каналов'); return; }
    setLoading(true);
    setError('');

    const icon = customImageB64 || selectedIcon;
    const res = await actions.createAccountChannel(accountId, accountKey, name.trim(), displayName.trim() || name.trim(), icon);

    if (res?.error === 'name_taken') { setError('Это имя уже занято — попробуйте другое'); setLoading(false); return; }
    if (res?.error === 'limit_reached') { setError('Лимит 5 каналов на аккаунт'); setLoading(false); return; }
    if (res?.error === 'invalid_key') { setError('Ошибка аутентификации — перезайдите'); setLoading(false); return; }
    if (res?.error) { setError('Ошибка: ' + res.error); setLoading(false); return; }

    onCreated({ username: name.trim(), display_name: displayName.trim() || name.trim(), icon, owner_account: accountId });
    onClose();
  };

  return (
    <div className="comments-popup-backdrop" onClick={onClose}>
      <div className="create-ch-popup" onClick={e => e.stopPropagation()}>
        <div className="comments-popup-header">
          <h3>Новый канал <span className="count-tag">{currentCount}/5</span></h3>
          <button className="popup-close-btn" onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit} className="create-ch-form">
          <div className="ch-icon-section">
            <div className="ch-icon-preview">
              {customImageB64
                ? <img src={customImageB64} alt="icon" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : <span style={{ fontSize: 36 }}>{selectedIcon}</span>
              }
            </div>
            <div className="ch-icon-controls">
              <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--win25-text-dim)' }}>Выбери иконку или загрузи фото</p>
              <div className="emoji-grid">
                {EMOJI_ICONS.map(em => (
                  <span
                    key={em}
                    className={`emoji-option ${selectedIcon === em && !customImageB64 ? 'selected' : ''}`}
                    onClick={() => { setSelectedIcon(em); setCustomImageB64(''); }}
                  >{em}</span>
                ))}
              </div>
              <label className="upload-img-label">
                <input type="file" accept="image/*" onChange={handleImageUpload} style={{ display: 'none' }} />
                📷 Загрузить фото
              </label>
            </div>
          </div>

          <div className="create-ch-fields">
            <div className="field-group">
              <label>Отображаемое название</label>
              <input type="text" placeholder="Мой крутой канал" value={displayName} onChange={e => setDisplayName(e.target.value)} className="upload-input" maxLength={40} />
            </div>
            <div className="field-group">
              <label>Уникальное имя <span style={{ color: 'var(--win25-text-dim)' }}>(только латиница, цифры, _)</span></label>
              <div style={{ position: 'relative' }}>
                <span className="at-prefix">@</span>
                <input type="text" placeholder="mychannel_123" value={name} onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())} className="upload-input" style={{ paddingLeft: 28 }} maxLength={30} required />
              </div>
            </div>
          </div>

          {error && <div className="create-ch-error">{error}</div>}

          <button type="submit" className="btn-publish" disabled={loading} style={{ marginTop: 16 }}>
            {loading ? '⏳ Создание…' : '✨ Создать канал'}
          </button>
        </form>
      </div>
    </div>
  );
}

function RecommendationSystemg({ videos, currentVideo, onPlay, onSelectChannel }) {
  const playlistName = currentVideo?.playlist;
  const [viewMode, setViewMode] = useState('recommendations');
  const [playlistSort, setPlaylistSort] = useState('recommended');

  const recs = [...videos].filter(v => v.id !== currentVideo.id).map(v => {
     let score = 0;
     if (v.channel === currentVideo.channel) score += 5;
     if (v.playlist === currentVideo.playlist && v.playlist !== 'Общее' && v.playlist) score += 10;
     score += (v.views || 0) * 0.1;
     score += (v.likes || 0) * 0.5;
     const ageDays = (Date.now() - (v.timestamp || 0)) / (1000 * 3600 * 24);
     score -= ageDays * 0.1;
     return { ...v, score };
  }).sort((a,b) => b.score - a.score);

  const playlistVideos = playlistName && playlistName !== 'Общее' ? videos.filter(v => v.playlist === playlistName) : [];

  const sortedPlaylist = [...playlistVideos].sort((a,b) => {
     if (playlistSort === 'sequential') return (a.timestamp || 0) - (b.timestamp || 0);
     const scoreA = ((a.views||0)*0.1) + ((a.likes||0)*0.5);
     const scoreB = ((b.views||0)*0.1) + ((b.likes||0)*0.5);
     return scoreB - scoreA;
  });

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
           {(viewMode === 'playlist' ? sortedPlaylist : recs).map(v => (
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

function WavyTubeContent() {
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'home');
  const [activeVideo, setActiveVideo] = useState(null);
  const [selectedChannelName, setSelectedChannelName] = useState(null);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [accountId, setAccountId]   = useState('');
  const [accountKey, setAccountKey] = useState('');

  const [myChannels, setMyChannels]       = useState([]); 
  const [currentChannel, setCurrentChannel] = useState(null); 
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(true);

  const [videos, setVideos]       = useState([]);
  const [comments, setComments]   = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isShort, setIsShort]     = useState(false);
  const [analyticsVideo, setAnalyticsVideo] = useState(null);
  const [mockSegmentData, setMockSegmentData] = useState([]);
  const [channelStats, setChannelStats] = useState({ isSubscribed: false, subscribers: 0 });
  const [commentsPopupVideo, setCommentsPopupVideo] = useState(null);

  const [uploadTitle, setUploadTitle]   = useState('');
  const [uploadDesc, setUploadDesc]     = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [localVideoUrl, setLocalVideoUrl] = useState(null);
  const [thumbDataUrl, setThumbDataUrl]   = useState(null);
  const [playlists, setPlaylists]         = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState('');
  const [newPlaylistName, setNewPlaylistName]   = useState('');
  
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  
  // ДОБАВЛЕНО: Расширенные настройки сжатия
  const [compressLevel, setCompressLevel] = useState('veryfast');
  const [compressBitrate, setCompressBitrate] = useState('2500k');
  const [compressAudio, setCompressAudio] = useState('128k');
  const [compressScale, setCompressScale] = useState('-2:720');
  const [ffmpegProgress, setFfmpegProgress] = useState(0);

  const [isProcessing, setIsProcessing]         = useState(false);
  const [uploadStatus, setUploadStatus]         = useState('');
  const abortControllerRef = useRef(null);
  const previewVideoRef    = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());

  const [activeShortsIndex, setActiveShortsIndex] = useState(0);
  const shortsRefs = useRef([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const pUser = localStorage.getItem('p_user') || '';
    const pToken = localStorage.getItem('p_token') || '';
    setAccountId(pUser);
    setAccountKey(pToken);
    loadMyChannels(pUser, pToken);
    loadContent();
  }, []);

  const loadMyChannels = async (accId, accKey) => {
    if (!accId) { setChannelsLoading(false); return; }
    setChannelsLoading(true);
    try {
      const list = await actions.getMyAccountChannels(accId, accKey);
      if (Array.isArray(list)) {
        setMyChannels(list);
        const savedCh = localStorage.getItem(`wt_active_ch_${accId}`);
        const found = list.find(c => c.username === savedCh);
        if (found) {
          setCurrentChannel(found);
          loadPlaylists(found.username);
        } else if (list.length > 0) {
          setCurrentChannel(list[0]);
          loadPlaylists(list[0].username);
        } else {
          setCurrentChannel(null);
        }
      }
    } catch (e) { console.error('Ошибка загрузки каналов:', e); }
    setChannelsLoading(false);
  };

  useEffect(() => {
    if (activeTab !== 'shorts') return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) setActiveShortsIndex(Number(entry.target.dataset.idx)); });
    }, { threshold: 0.6 });
    shortsRefs.current.forEach(el => el && observer.observe(el));
    return () => observer.disconnect();
  }, [activeTab, videos]);

  const loadPlaylists = async (chName) => {
    if (!chName) return;
    const lists = await actions.getUserPlaylists(chName);
    if (lists) setPlaylists(lists);
  };

  const loadContent = async () => {
    try { setVideos((await actions.getVideos()) || []); } catch(e) { console.error(e); }
  };

  const switchChannel = (ch) => {
    setCurrentChannel(ch);
    localStorage.setItem(`wt_active_ch_${accountId}`, ch.username);
    loadPlaylists(ch.username);
    setMobileMenuOpen(false);
  };

  const handleChannelCreated = (newCh) => {
    const updated = [...myChannels, newCh];
    setMyChannels(updated);
    switchChannel(newCh);
  };

  const handleDeleteChannel = async (ch) => {
    if (!confirm(`Удалить канал @${ch.username}? Это удалит все его видео!`)) return;
    const res = await actions.deleteAccountChannel(accountId, accountKey, ch.username);
    if (res?.error === 'access_denied') { alert('Нет прав!'); return; }
    const updated = myChannels.filter(c => c.username !== ch.username);
    setMyChannels(updated);
    if (currentChannel?.username === ch.username) {
      const next = updated[0] || null;
      setCurrentChannel(next);
      if (next) loadPlaylists(next.username);
    }
  };

  const playVideo = async (video) => {
    setActiveVideo(video); setActiveTab('watch');
    if (video.id) {
      await actions.incrementViews(video.id);
      const comms = await actions.getComments(video.id);
      setComments(comms || []);
      const stats = await actions.checkChannelState(currentChannel?.username || '', video.channel);
      setChannelStats(stats);
    }
  };

  const toggleLike = async (type) => {
    if (!activeVideo || !currentChannel) return;
    const res = await actions.toggleLike(activeVideo.id, currentChannel.username, type);
    if (res.success) setActiveVideo(prev => ({ ...prev, likes: res.likes, dislikes: res.dislikes }));
  };

  const toggleSubscription = async () => {
    if (!activeVideo || !currentChannel) return;
    const res = await actions.toggleSubscription(currentChannel.username, activeVideo.channel);
    if (res.success) setChannelStats({ isSubscribed: res.isSubbed, subscribers: res.count });
  };

  const handleVideoSelect = (e) => {
    const file = e.target.files[0];
    if (file) { 
      setSelectedFile(file); 
      setLocalVideoUrl(URL.createObjectURL(file)); 
      setThumbDataUrl(null);
      setTrimStart('');
      setTrimEnd('');
    }
  };

  const captureFrameFromVideo = () => {
    const video = previewVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    setThumbDataUrl(canvas.toDataURL('image/jpeg', 0.6));
  };

  const handleCustomImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) { const r = new FileReader(); r.onload = ev => setThumbDataUrl(ev.target.result); r.readAsDataURL(file); }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !currentChannel) return;
    await actions.createPlaylist(newPlaylistName, currentChannel.username);
    setNewPlaylistName('');
    loadPlaylists(currentChannel.username);
  };
async function uploadVideoInChunks(file, videoId) {
  const CHUNK_SIZE = 1024 * 1024; // 1 МБ
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const blob = file.slice(start, start + CHUNK_SIZE);
    
    // Превращаем только этот кусок в Base64
    const chunkBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });

    // Отправляем кусочек и ждем ответа (await)
    const response = await fetch('/api/video', { // убедитесь, что путь верный
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chunk: chunkBase64.replace(/^data:video\/\w+;base64,/, ""),
        videoId: videoId,
        isFirst: i === 0
      })
    });

    if (!response.ok) throw new Error('Ошибка загрузки куска');
    console.log(`Кусок ${i + 1}/${totalChunks} отправлен`);
  }
}
  const handleFastUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) { alert("Выберите видеофайл!"); return; }
    if (!uploadTitle || !currentChannel) return;
    
    const isOwner = await actions.verifyChannelOwnership(accountId, accountKey, currentChannel.username);
    if (!isOwner) { alert('Нет прав на этот канал!'); return; }

    setIsProcessing(true);
    setFfmpegProgress(0);
    abortControllerRef.current = new AbortController();

    try {
      setUploadStatus('Загрузка движка оптимизации (FFmpeg)...');
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg.loaded) {
        await ffmpeg.load();
      }

      ffmpeg.on('progress', ({ progress }) => {
        setFfmpegProgress(Math.round(progress * 100));
      });

      setUploadStatus('Чтение исходного файла...');
      await ffmpeg.writeFile('input.mp4', await fetchFile(selectedFile));

      setUploadStatus('Применение настроек сжатия и кодирование...');
      
      const tStart = parseFloat(trimStart);
      const tEnd = parseFloat(trimEnd);
      let args = [];
      
      if (!isNaN(tStart) && tStart > 0) args.push('-ss', tStart.toString());
      if (!isNaN(tEnd) && tEnd > 0) args.push('-to', tEnd.toString());
      
      args.push('-i', 'input.mp4');

      if (isShort) {
        const calculatedDur = (!isNaN(tEnd) ? tEnd : (previewVideoRef.current?.duration || 0)) - (!isNaN(tStart) ? tStart : 0);
        if (calculatedDur > 600) {
            alert("Ошибка: Shorts не может быть длиннее 10 минут (600 секунд)! Пожалуйста, обрежьте видео.");
            setIsProcessing(false);
            return;
        }
        args.push('-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2');
      } else {
        // ИСПРАВЛЕНО: Добавлен префикс "scale="
        args.push('-vf', `scale=${compressScale}`);
      }

      args.push(
        '-c:v', 'libx264',
        '-b:v', compressBitrate,
        '-preset', compressLevel,
        '-c:a', 'aac',
        '-b:a', compressAudio,
        '-movflags', '+faststart',
        'output.mp4'
      );

      // ДОБАВЛЕНО: Проверка на краш FFmpeg
      const exitCode = await ffmpeg.exec(args);
      if (exitCode !== 0) {
        throw new Error("FFmpeg вылетел с ошибкой. Попробуйте выбрать другие настройки разрешения или сжатия.");
      }

      setUploadStatus('Обработка завершена! Чтение оптимизированного видео...');
      const data = await ffmpeg.readFile('output.mp4');
      const fastStartBlob = new Blob([data.buffer], { type: 'video/mp4' });

      const maxSize = isShort ? 35 * 1024 * 1024 : 200 * 1024 * 1024;
      if (fastStartBlob.size > maxSize) {
        alert(`Итоговое видео слишком большое (${(fastStartBlob.size / 1024 / 1024).toFixed(2)} МБ)! Лимит для ${isShort ? 'Shorts — 35 МБ' : 'видео — 200 МБ'}. Попробуйте усилить сжатие или уменьшить битрейт.`);
        setIsProcessing(false);
        return;
      }

      setUploadStatus('Кодирование для отправки на сервер...');
      const reader = new FileReader();
      reader.readAsDataURL(fastStartBlob);
      reader.onloadend = async () => {
        try {
          const base64Video = reader.result;
          setUploadStatus('Сохранение информации о видео...');

          const finalDur = (!isNaN(tEnd) ? tEnd : (previewVideoRef.current?.duration || 0)) - (!isNaN(tStart) ? tStart : 0);
          const videoDuration = finalDur > 0 ? finalDur : 0;
          const videoId = 'v_' + Math.random().toString(36).substring(2, 14);
          
          await actions.saveVideoMetadata({
            id: videoId, channel: currentChannel.username,
            title: uploadTitle, description: uploadDesc,
            playlist: selectedPlaylist, thumbnail: thumbDataUrl,
            is_short: isShort, duration: videoDuration,
          }, { tags: '', audience_type: 'general' });

          setUploadStatus('Отправка медиафайла на сервер...');
          setFfmpegProgress(100);
          const fd = new FormData();
          fd.append('base64', base64Video);
          fd.append('videoId', videoId);
          
          await uploadVideoInChunks(fastStartBlob, videoId);

          setUploadStatus('✅ Опубликовано!');
          setTimeout(() => {
            setUploadTitle(''); setUploadDesc(''); setSelectedFile(null);
            setLocalVideoUrl(null); setThumbDataUrl(null); setIsProcessing(false);
            setTrimStart(''); setTrimEnd(''); setFfmpegProgress(0);
            loadContent(); setActiveTab('home');
          }, 1500);
        } catch (err) {
          alert('Сбой: ' + err.message); setIsProcessing(false);
        }
      };
    } catch (err) {
      if (err.name === 'AbortError') return;
      alert('Сбой: ' + err.message); setIsProcessing(false);
    }
  };

  const deleteVideo = async (id) => {
    if (!confirm('Удалить это видео?') || !currentChannel) return;
    const res = await actions.deleteVideoSecure(id, currentChannel.username, accountId, accountKey);
    if (res?.error === 'access_denied') { alert('Нет прав!'); return; }
    loadContent();
  };

  const openDeepAnalytics = async (video) => {
    setAnalyticsVideo(video);
    const dbStats = await actions.getVideoAnalytics(video.id);
    if (dbStats?.length > 0) {
      setMockSegmentData(dbStats.map(s => ({ segment: parseInt(s.segment_index), views: s.watch_count })));
    } else {
      setMockSegmentData(Array.from({ length: 20 }, (_, i) => ({ segment: i+1, views: Math.floor(Math.random() * (video.views || 100)) })));
    }
  };

  const filteredVideos = videos.filter(v =>
    v.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    v.playlist?.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const shortsList = videos.filter(v => v.is_short || v.playlist === 'Shorts').sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  const chIcon = (ch) => {
    if (!ch) return '?';
    if (ch.icon && ch.icon.startsWith('data:')) return <img src={ch.icon} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />;
    if (ch.icon && ch.icon.length <= 4) return ch.icon; 
    return (ch.display_name || ch.username || '?')[0].toUpperCase();
  };

  const noAccount = !accountId;

  return (
    <div className="wavy-app">
      {commentsPopupVideo && (
        <CommentsPopup video={commentsPopupVideo} currentChannel={currentChannel?.username || 'guest'} onClose={() => setCommentsPopupVideo(null)} />
      )}

      {showCreateChannel && (
        <CreateChannelPopup accountId={accountId} accountKey={accountKey} currentCount={myChannels.length} onCreated={handleChannelCreated} onClose={() => setShowCreateChannel(false)} />
      )}

      {mobileMenuOpen && <div className="mobile-backdrop" onClick={() => setMobileMenuOpen(false)}></div>}

      <aside className={`wavy-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header-row">
          <div className="brand" onClick={() => { setActiveTab('home'); setActiveVideo(null); setMobileMenuOpen(false); }}>
            <h2>WavyTube <span>v20.2</span></h2>
          </div>
          <button className="mobile-close-btn" onClick={() => setMobileMenuOpen(false)}>✕</button>
        </div>

        <nav className="nav-menu desktop-only">
          {['home','shorts','studio','upload'].map(tab => (
            <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => { setActiveTab(tab); setActiveVideo(null); }}>
              <span className="icon">{tab==='home'?'🏠':tab==='shorts'?'⚡':tab==='studio'?'📊':'📤'}</span>
              {tab==='home'?'Главная':tab==='shorts'?'Wavy Shorts':tab==='studio'?'Студия':'Загрузить'}
            </button>
          ))}
        </nav>

        <div className="channels-manager">
          <div className="channels-manager-header">
            <h3>Мои каналы</h3>
            {!noAccount && <span className="ch-count">{myChannels.length}/5</span>}
          </div>

          {noAccount ? (
            <div className="ch-no-account"><span style={{ fontSize: 28 }}>🔐</span><p>Войдите в аккаунт, чтобы управлять каналами</p></div>
          ) : channelsLoading ? (
            <div className="ch-loading"><div className="upload-spinner" /><p>Загрузка…</p></div>
          ) : (
            <>
              <div className="channels-list">
                {myChannels.length === 0 ? (
                  <div className="ch-empty-hint">
                    <span style={{ fontSize: 32 }}>🎬</span><p>У тебя пока нет каналов</p>
                  </div>
                ) : (
                  myChannels.map(ch => (
                    <div key={ch.username} className={`channel-pill ${currentChannel?.username === ch.username ? 'current' : ''}`} onClick={() => switchChannel(ch)}>
                      <div className="avatar-mini ch-icon-wrap">{chIcon(ch)}</div>
                      <div className="ch-text">
                        <span className="ch-name">{ch.display_name || ch.username}</span>
                        <span className="ch-handle">@{ch.username}</span>
                      </div>
                      {currentChannel?.username === ch.username && <span className="active-dot" />}
                      <button className="ch-delete-btn" onClick={e => { e.stopPropagation(); handleDeleteChannel(ch); }}>✕</button>
                    </div>
                  ))
                )}
              </div>
              {myChannels.length < 5 && (
                <button className="add-channel-btn" onClick={() => setShowCreateChannel(true)}><span>+</span> Создать канал</button>
              )}
            </>
          )}
        </div>

        <div className="account-badge">
          <div className="status-indicator online" />
          <span className="account-id-label">Аккаунт <strong>#{accountId || '?'}</strong></span>
        </div>
      </aside>

      <main className="wavy-main-content">
        <header className="wavy-header">
          <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)}>☰</button>
          <div className="mobile-brand" onClick={() => setActiveTab('home')}>Wavy</div>

          <div className="search-box">
            <input type="text" placeholder="Поиск видео…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery && <button onClick={() => setSearchQuery('')} className="clear-search">×</button>}
          </div>

          <div className="user-profile-badge">
            <div className="avatar-mini ch-icon-wrap" style={{ width: 32, height: 32, flexShrink: 0 }}>
              {currentChannel ? chIcon(currentChannel) : '?'}
            </div>
            <span className="desktop-only-text">{currentChannel ? (currentChannel.display_name || currentChannel.username) : '—'}</span>
          </div>
        </header>

        <div className="tab-container">

          {!channelsLoading && !noAccount && !currentChannel && activeTab !== 'home' && (
            <div className="empty-state">
              <span style={{ fontSize: 50 }}>🎬</span>
              <p style={{ fontSize: 18, color: '#ddd' }}>Сначала создайте канал</p>
              <button className="cta-upload-btn" onClick={() => setShowCreateChannel(true)}>+ Создать канал</button>
            </div>
          )}

          {activeTab === 'watch' && activeVideo && (
            <div className="watch-layout">
              <div className="watch-main-column">
                <div className="video-player-frame">
                  <WavyPlayer videoId={activeVideo.id} duration={activeVideo.duration} />
                </div>
                <div className="video-details-card">
                  <div className="details-header">
                    <h1>{activeVideo.title}</h1>
                    <div className="action-buttons">
                      <button className="like-btn" onClick={() => toggleLike('like')}>👍 {activeVideo.likes || 0}</button>
                      <button className="like-btn" onClick={() => toggleLike('dislike')}>👎 {activeVideo.dislikes || 0}</button>
                      <span className="views-count">👁 {activeVideo.views || 0}</span>
                    </div>
                  </div>
                  <div className="channel-author-row" onClick={() => { setSelectedChannelName(activeVideo.channel); setActiveTab('channel-view'); }}>
                    <div className="author-avatar">{activeVideo.channel?.[0]}</div>
                    <div style={{ flex: 1 }}>
                      <h3>{activeVideo.channel}</h3>
                      <p>{channelStats.subscribers} подписчиков</p>
                    </div>
                    {currentChannel?.username !== activeVideo.channel && (
                      <button className="subscribe-action-btn" onClick={e => { e.stopPropagation(); toggleSubscription(); }}>
                        {channelStats.isSubscribed ? 'Отписаться' : 'Подписаться'}
                      </button>
                    )}
                  </div>
                  <div className="video-description-box">
                    <p>{activeVideo.description || 'Описание отсутствует.'}</p>
                    <p style={{color: '#888', marginTop: 8, fontSize: 12}}>Опубликовано: {new Date(activeVideo.timestamp || Date.now()).toLocaleDateString()}</p>
                  </div>
                  <button className="open-comments-btn" onClick={() => setCommentsPopupVideo(activeVideo)}>
                    💬 Комментарии ({comments.length})
                  </button>
                </div>
              </div>

              <div className="watch-side-column">
                <RecommendationSystem 
                  videos={videos} 
                  currentVideo={activeVideo} 
                  onPlay={playVideo} 
                  onSelectChannel={(ch) => { setSelectedChannelName(ch); setActiveTab('channel-view'); }}
                />
              </div>
            </div>
          )}

          {activeTab === 'home' && (
            <div className="home-layout">
              {searchQuery && <div className="search-results-title">Поиск: «{searchQuery}»</div>}
              {filteredVideos.length === 0 ? (
                <div className="empty-state">
                  <span style={{ fontSize: 40 }}>📭</span>
                  <p>Видео ещё нет.</p>
                  {currentChannel && <button onClick={() => setActiveTab('upload')} className="cta-upload-btn">Загрузить видео</button>}
                </div>
              ) : (
                <div className="videos-compact-grid">
                  {filteredVideos.map(video => (
                    <div key={video.id} className="wavy-video-card" onClick={() => playVideo(video)}>
                      <div className="thumbnail-wrapper">
                        {video.thumbnail ? <img src={video.thumbnail} alt={video.title} /> : <div style={{width:'100%', height:'100%', background:'#222'}} />}
                        <span className="duration-tag">{video.is_short ? '⚡ Short' : 'HD'}</span>
                      </div>
                      <div className="card-info">
                        <h3>{video.title}</h3>
                        <p className="card-channel">@{video.channel}</p>
                        <div className="card-stats"><span>👁 {video.views||0}</span><span>•</span><span>👍 {video.likes||0}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'shorts' && (
            <div className="shorts-container-scroll">
              {shortsList.length === 0
                ? <div className="empty-state"><span style={{fontSize:40}}>⚡</span><p>Нет коротких видео.</p></div>
                : shortsList.map((short, idx) => {
                    const isActive = idx === activeShortsIndex;
                    const isNear   = Math.abs(idx - activeShortsIndex) === 1;
                    return (
                      <div key={short.id} className="short-vertical-slide" data-idx={idx} ref={el => (shortsRefs.current[idx] = el)}>
                        <div className="short-player-wrapper">
                          <ShortsPlayer short={short} isActive={isActive} isNear={isNear} />
                          <div className="short-overlay-details">
                            <div className="short-channel-row">
                              <div className="short-avatar">{short.channel?.[0]?.toUpperCase()}</div>
                              <div>
                                <div className="short-channel-name">@{short.channel}</div>
                                <div className="short-title">{short.title}</div>
                              </div>
                            </div>
                          </div>
                          <div className="short-side-actions">
                            <button className="short-action-btn"><span>❤️</span><span>{short.likes||0}</span></button>
                            <button className="short-action-btn"><span>👁️</span><span>{short.views||0}</span></button>
                            <button className="short-action-btn" onClick={() => setCommentsPopupVideo(short)}><span>💬</span><span>Чат</span></button>
                            <button className="short-action-btn" onClick={() => { setActiveVideo(short); setActiveTab('watch'); }}><span>▶️</span><span>Full</span></button>
                          </div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          )}

          {activeTab === 'studio' && (
            <div className="studio-layout">
              <div className="studio-top-bar">
                <div>
                  <h2>Творческая Студия</h2>
                  {currentChannel
                    ? <p className="studio-subtitle">Канал: <strong>{currentChannel.display_name || currentChannel.username}</strong></p>
                    : <p className="studio-subtitle" style={{color:'#e84545'}}>Выберите канал в боковом меню</p>
                  }
                </div>
              </div>

              {myChannels.length > 1 && (
                <div className="studio-ch-tabs">
                  {myChannels.map(ch => (
                    <button key={ch.username} className={`studio-ch-tab ${currentChannel?.username === ch.username ? 'active' : ''}`} onClick={() => switchChannel(ch)}>
                      <div className="avatar-mini ch-icon-wrap" style={{width:20,height:20,fontSize:12}}>{chIcon(ch)}</div>
                      {ch.display_name || ch.username}
                    </button>
                  ))}
                </div>
              )}

              <div className="studio-table-wrapper">
                <table className="studio-table">
                  <thead>
                    <tr><th>Видео</th><th className="desktop-td">Плейлист</th><th>Статистика</th><th>Опции</th></tr>
                  </thead>
                  <tbody>
                    {!currentChannel
                      ? <tr><td colSpan={4} style={{textAlign:'center',padding:'40px',color:'#666'}}>Выберите канал</td></tr>
                      : videos.filter(v => v.channel === currentChannel.username).length === 0
                        ? <tr><td colSpan={4} style={{textAlign:'center',padding:'40px',color:'#666'}}>На этом канале пока нет видео</td></tr>
                        : videos.filter(v => v.channel === currentChannel.username).map(video => (
                            <tr key={video.id}>
                              <td>
                                <div className="studio-title-cell">
                                  {video.thumbnail && <img src={video.thumbnail} alt="" className="studio-thumb" />}
                                  <div>
                                    <strong>{video.title}</strong>
                                    <div className="mobile-only-text" style={{fontSize:11, color:'#888', marginTop:4}}>{video.is_short ? '⚡ Short' : '📺 Видео'}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="desktop-td"><span className="playlist-badge">{video.playlist || 'Общее'}</span></td>
                              <td>👁 {video.views || 0}</td>
                              <td className="actions-cell">
                                <button onClick={() => openDeepAnalytics(video)} className="btn-analytics">📈</button>
                                <button onClick={() => deleteVideo(video.id)} className="btn-delete">🗑</button>
                              </td>
                            </tr>
                          ))
                    }
                  </tbody>
                </table>
              </div>

              {analyticsVideo && (
                <div className="analytics-modal-box-acrylic">
                  <div className="modal-header">
                    <div>
                      <h3>Аналитика: {analyticsVideo.title}</h3>
                      <p style={{fontSize:13, color:'#888', margin:'6px 0 0'}}>График показывает, сколько раз зрители посмотрели каждый отрезок видео. Если столбик высокий — этот момент пересматривали часто. Если низкий — его пропускали.</p>
                    </div>
                    <button onClick={() => setAnalyticsVideo(null)} className="close-modal">✕</button>
                  </div>
                  <h4 style={{margin:'20px 0 10px',fontSize:14,color:'#aaa'}}>Удержание по сегментам (по умолчанию каждые 10 сек)</h4>
                  <div className="chart-timeline-container">
                    {mockSegmentData.map((pt, idx) => (
                      <div key={idx} className="chart-bar-node" title={`Сегмент ${pt.segment} - Просмотры: ${pt.views}`}>
                        <div className="bar-label-tag">{pt.views} 👁</div>
                        <div className="bar-fill-indicator" style={{height:`${Math.max(5,(pt.views/200)*100)}%`}} />
                        <div className="bar-label-tag">#{pt.segment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'channel-view' && selectedChannelName && (
            <div className="channel-page-layout">
              <div className="channel-banner-acrylic">
                <div className="channel-profile-avatar-big">{selectedChannelName[0]}</div>
                <div className="channel-profile-meta-big">
                  <h2>{selectedChannelName}</h2>
                  <p style={{color:'#888',margin:'4px 0 0'}}>{videos.filter(v=>v.channel===selectedChannelName).length} видео</p>
                </div>
              </div>
              <div className="channel-tab-title">Видео автора</div>
              <div className="videos-compact-grid">
                {videos.filter(v=>v.channel===selectedChannelName).map(video=>(
                  <div key={video.id} className="wavy-video-card" onClick={()=>playVideo(video)}>
                    <div className="thumbnail-wrapper">
                      {video.thumbnail ? <img src={video.thumbnail} alt={video.title}/> : <div style={{width:'100%', height:'100%', background:'#222'}} />}
                    </div>
                    <div className="card-info">
                      <h3>{video.title}</h3>
                      <div className="card-stats"><span>👁 {video.views||0} просмотров</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="upload-layout-box">
              <h2>Загрузка видео (Продвинутое сжатие)</h2>
              {!currentChannel ? (
                <div className="empty-state">
                  <span style={{fontSize:40}}>🎬</span>
                  <p>Сначала создайте канал</p>
                  <button className="cta-upload-btn" onClick={()=>setShowCreateChannel(true)}>+ Создать канал</button>
                </div>
              ) : (
                <>
                  <p style={{color:'#888',marginTop:'-8px',marginBottom:'24px',fontSize:14}}>
                    Канал: <strong style={{color:'#fff'}}>{currentChannel.display_name||currentChannel.username}</strong>
                  </p>
                  <form onSubmit={handleFastUpload} className="wavy-upload-form">
                    <div className="upload-grid">
                      <div className="upload-left">
                        <label className="upload-file-zone">
                          <input type="file" accept="video/*" onChange={handleVideoSelect} />
                          {selectedFile ? <span style={{color:'#0078d4'}}>✓ {selectedFile.name}</span> : <span>📁 Выбрать видеофайл</span>}
                        </label>
                        <input type="text" placeholder="Название видеоролика" value={uploadTitle} onChange={e=>setUploadTitle(e.target.value)} required className="upload-input" />
                        <textarea placeholder="Описание" value={uploadDesc} onChange={e=>setUploadDesc(e.target.value)} rows={4} className="upload-input upload-textarea" />
                        
                        {/* ДОБАВЛЕНО: Расширенные настройки загрузки */}
                        <div className="advanced-settings-box">
                          <h4 style={{margin:'0 0 12px', fontSize:14, color:'#aaa'}}>Настройки сжатия</h4>
                          <div className="setting-row">
                            <label>Сила сжатия:</label>
                            <select value={compressLevel} onChange={e => setCompressLevel(e.target.value)} className="upload-select">
                              <option value="ultrafast">Слабая (Очень быстро)</option>
                              <option value="veryfast">Средняя (Баланс)</option>
                              <option value="fast">Сильная (Дольше)</option>
                              <option value="medium">Максимальная (Экономия места)</option>
                            </select>
                          </div>
                          <div className="setting-row">
                            <label>Качество / Битрейт:</label>
                            <select value={compressBitrate} onChange={e => {
                                setCompressBitrate(e.target.value);
                                setCompressAudio(e.target.value === '800k' ? '64k' : e.target.value === '2500k' ? '128k' : '192k');
                            }} className="upload-select">
                              <option value="800k">Минимальное (800k, мало весит)</option>
                              <option value="2500k">Среднее (2500k)</option>
                              <option value="4500k">Максимальное (4500k, HD)</option>
                            </select>
                          </div>
                          <div className="setting-row">
                            <label>Разрешение:</label>
                            <select value={compressScale} onChange={e => setCompressScale(e.target.value)} className="upload-select" disabled={isShort}>
                              <option value="-2:480">480p</option>
                              <option value="-2:720">720p (HD)</option>
                              <option value="-2:1080">1080p (Full HD)</option>
                            </select>
                          </div>
                        </div>

                        <div className="trim-controls">
                          <label>Обрезать с (сек): <input type="number" step="0.1" value={trimStart} onChange={e=>setTrimStart(e.target.value)} min="0" placeholder="0" /></label>
                          <label>Обрезать до (сек): <input type="number" step="0.1" value={trimEnd} onChange={e=>setTrimEnd(e.target.value)} min="0" placeholder="Длительность" /></label>
                        </div>

                        <div className="upload-playlist-block">
                          <label style={{fontSize:12,color:'#aaa',display:'block',marginBottom:8}}>Плейлист</label>
                          <select value={selectedPlaylist} onChange={e=>setSelectedPlaylist(e.target.value)} className="upload-select">
                            <option value="">— Без плейлиста —</option>
                            {playlists.map(pl=><option key={pl.id} value={pl.name}>{pl.name}</option>)}
                          </select>
                          <div className="upload-playlist-create">
                            <input type="text" placeholder="Создать новый…" value={newPlaylistName} onChange={e=>setNewPlaylistName(e.target.value)} className="upload-input" style={{marginTop:0}} />
                            <button type="button" onClick={handleCreatePlaylist} className="btn-create-playlist">+</button>
                          </div>
                        </div>
                        <label className="short-toggle">
                          <input type="checkbox" checked={isShort} onChange={e=>setIsShort(e.target.checked)} />
                          <span>⚡ Формат Short (Макс 10 мин, 720x1280)</span>
                        </label>
                      </div>
                      <div className="upload-right">
                        <h3 style={{margin:'0 0 12px',fontSize:14,color:'#aaa'}}>Обложка</h3>
                        {localVideoUrl ? (
                          <>
                            <video ref={previewVideoRef} src={localVideoUrl} controls className="upload-preview-video" />
                            <button type="button" onClick={captureFrameFromVideo} className="btn-capture-frame">📸 Кадр как обложка</button>
                          </>
                        ) : <div className="upload-video-placeholder">Выберите видео</div>}
                        <div className="upload-divider">или загрузите изображение</div>
                        <input type="file" accept="image/*" onChange={handleCustomImageUpload} className="upload-image-input" />
                        {thumbDataUrl && (
                          <div style={{marginTop:12}}>
                            <img src={thumbDataUrl} alt="Preview" style={{width:'100%',aspectRatio:'16/9',objectFit:'cover',borderRadius:8,border:'2px solid #0078d4'}} />
                          </div>
                        )}
                      </div>
                    </div>
                    {isProcessing
                      ? <div className="upload-processing">
                          <div className="wavy-progress-bar">
                             <div className="wavy-progress-fill" style={{width: `${ffmpegProgress}%`}}></div>
                          </div>
                          <p>{uploadStatus} {ffmpegProgress > 0 && ffmpegProgress < 100 ? `${ffmpegProgress}%` : ''}</p>
                          <button type="button" onClick={()=>{abortControllerRef.current?.abort();setIsProcessing(false);}} className="btn-cancel-upload">Отменить</button>
                        </div>
                      : <button type="submit" className="btn-publish">🚀 Оптимизировать и Опубликовать</button>
                    }
                  </form>
                </>
              )}
            </div>
          )}

        </div>
      </main>

      <nav className="mobile-bottom-nav">
        <button className={`m-nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => { setActiveTab('home'); setActiveVideo(null); }}>
          <span className="m-icon">🏠</span><span className="m-label">Главная</span>
        </button>
        <button className={`m-nav-item ${activeTab === 'shorts' ? 'active' : ''}`} onClick={() => { setActiveTab('shorts'); setActiveVideo(null); }}>
          <span className="m-icon">⚡</span><span className="m-label">Shorts</span>
        </button>
        <button className="m-nav-item upload-center-btn" onClick={() => { setActiveTab('upload'); setActiveVideo(null); }}>
          <div className="plus-circle">+</div>
        </button>
        <button className={`m-nav-item ${activeTab === 'studio' ? 'active' : ''}`} onClick={() => { setActiveTab('studio'); setActiveVideo(null); }}>
          <span className="m-icon">📊</span><span className="m-label">Студия</span>
        </button>
      </nav>

      <style dangerouslySetInnerHTML={{ __html: `
        :root {
          --win25-bg: #0b0b0c;
          --win25-panel: rgba(22, 23, 26, 0.75);
          --win25-panel-solid: #16171a;
          --win25-border: rgba(255, 255, 255, 0.08);
          --win25-accent: #0078d4;
          --win25-accent-gradient: linear-gradient(135deg, #0078d4, #8660a9);
          --win25-text: #f3f3f3;
          --win25-text-dim: #adadad;
        }

        *, *::before, *::after { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: var(--win25-bg);
          color: var(--win25-text);
          overflow-x: hidden;
        }

        .wavy-app { display: flex; height: 100dvh; background: radial-gradient(circle at 50% 0%, #1a1525 0%, #0b0b0c 70%); }
        .wavy-sidebar { width: 280px; background: var(--win25-panel); backdrop-filter: blur(20px); border-right: 1px solid var(--win25-border); padding: 24px; display: flex; flex-direction: column; gap: 30px; flex-shrink: 0; overflow-y: auto; z-index: 3000; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .sidebar-header-row { display: flex; align-items: center; justify-content: space-between; }
        .mobile-close-btn { display: none; background: transparent; border: none; color: #fff; font-size: 20px; cursor: pointer; }
        .mobile-backdrop { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 2900; backdrop-filter: blur(4px); }
        .brand h2 { margin: 0; font-size: 22px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
        .brand h2 span { font-size: 11px; padding: 3px 8px; background: var(--win25-accent-gradient); border-radius: 6px; color: #fff; font-weight: bold; }
        .nav-menu { display: flex; flex-direction: column; gap: 6px; }
        .nav-menu button { background: transparent; border: 1px solid transparent; color: var(--win25-text-dim); padding: 12px 16px; text-align: left; font-size: 15px; font-weight: 500; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: all 0.2s ease; }
        .nav-menu button:hover { background: rgba(255, 255, 255, 0.05); color: #fff; }
        .nav-menu button.active { background: rgba(255, 255, 255, 0.08); border-color: var(--win25-border); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.1); }
        .channels-manager { margin-top: auto; background: rgba(0, 0, 0, 0.2); padding: 16px; border-radius: 12px; border: 1px solid var(--win25-border); }
        .channels-manager-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .channels-manager h3 { margin: 0; font-size: 12px; color: var(--win25-text-dim); text-transform: uppercase; letter-spacing: 0.5px; }
        .ch-count { font-size: 11px; color: var(--win25-text-dim); background: rgba(255,255,255,0.07); padding: 2px 6px; border-radius: 4px; }
        .channels-list { display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
        .channel-pill { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; transition: background 0.2s, border 0.2s; border: 1px solid transparent; position: relative; }
        .channel-pill:hover { background: rgba(255, 255, 255, 0.05); }
        .channel-pill:hover .ch-delete-btn { opacity: 1; }
        .channel-pill.current { background: rgba(0, 120, 212, 0.15); border-color: rgba(0, 120, 212, 0.3); }
        .avatar-mini { width: 28px; height: 28px; background: var(--win25-accent-gradient); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; flex-shrink: 0; }
        .ch-text { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .ch-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ch-handle { font-size: 11px; color: var(--win25-text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .active-dot { position: absolute; right: 12px; width: 6px; height: 6px; background: var(--win25-accent); border-radius: 50%; }
        .ch-delete-btn { background: transparent; border: none; color: #888; cursor: pointer; font-size: 12px; padding: 4px; border-radius: 4px; opacity: 0; transition: 0.2s; position: absolute; right: 6px; }
        .ch-delete-btn:hover { color: #e84545; background: rgba(232,17,35,0.15); }
        .add-channel-btn { width: 100%; margin-top: 12px; background: rgba(0,120,212,0.1); border: 1px dashed rgba(0,120,212,0.4); color: #6ab4f5; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .add-channel-btn:hover { background: rgba(0,120,212,0.2); border-color: rgba(0,120,212,0.6); }
        .account-badge { display: flex; align-items: center; gap: 8px; padding: 12px 6px 0; }
        .account-id-label { font-size: 12px; color: #888; }
        .status-indicator { width: 8px; height: 8px; border-radius: 50%; }
        .status-indicator.online { background: #30d158; box-shadow: 0 0 6px rgba(48,209,88,.5); }
        .ch-empty-hint, .ch-no-account { text-align: center; padding: 16px 8px; color: #666; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .ch-empty-hint p, .ch-no-account p { margin: 0; font-size: 13px; }
        .ch-loading { display: flex; align-items: center; gap: 10px; padding: 12px; color: #666; font-size: 14px; }
        .wavy-main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .tab-container { padding: 30px 40px; flex: 1; overflow-y: auto; }
        .wavy-header { height: 70px; border-bottom: 1px solid var(--win25-border); display: flex; align-items: center; justify-content: space-between; padding: 0 40px; background: rgba(11, 11, 12, 0.5); backdrop-filter: blur(12px); flex-shrink: 0; }
        .mobile-menu-btn, .mobile-brand { display: none; }
        .search-box { position: relative; width: 450px; }
        .search-box input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--win25-border); padding: 12px 40px 12px 20px; border-radius: 24px; color: white; outline: none; font-size: 14px; transition: 0.2s; }
        .search-box input:focus { border-color: rgba(0,120,212,0.5); background: rgba(255,255,255,0.08); }
        .clear-search { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); background: transparent; border: none; color: #888; font-size: 18px; cursor: pointer; }
        .user-profile-badge { display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; color: #ccc; }
        
        .watch-layout { display: grid; grid-template-columns: 1fr 380px; gap: 24px; align-items: start; }
        .watch-main-column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
        .watch-side-column { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

        .recommendations-panel { background: var(--win25-panel-solid); border: 1px solid var(--win25-border); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .recs-list { display: flex; flex-direction: column; gap: 12px; }
        .rec-card { display: flex; gap: 12px; cursor: pointer; border-radius: 8px; transition: 0.2s; padding: 8px; }
        .rec-card:hover { background: rgba(255,255,255,0.05); }
        .rec-thumb { width: 140px; aspect-ratio: 16/9; background: #000; border-radius: 8px; overflow: hidden; position: relative; flex-shrink: 0; }
        .rec-thumb.vertical { aspect-ratio: 9/16; width: 80px; }
        .rec-thumb img, .rec-thumb video { width: 100%; height: 100%; object-fit: cover; }
        .rec-info { flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
        .rec-info h4 { margin: 0; font-size: 14px; color: #fff; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .rec-info p { margin: 0; font-size: 12px; color: #aaa; }
        .rec-info p.ch-link { cursor: pointer; color: #ccc; transition: 0.2s; }
        .rec-info p.ch-link:hover { color: #fff; text-decoration: underline; }
        .btn-view-playlist { background: rgba(0,120,212,0.15); color: #6ab4f5; border: 1px solid rgba(0,120,212,0.3); padding: 10px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: 0.2s; }
        .btn-view-playlist:hover { background: rgba(0,120,212,0.25); }
        .playlist-view-header { display: flex; flex-direction: column; gap: 12px; border-bottom: 1px solid var(--win25-border); padding-bottom: 12px; }
        .btn-back-recs { align-self: flex-start; background: transparent; border: none; color: #aaa; cursor: pointer; font-size: 13px; transition: 0.2s; }
        .btn-back-recs:hover { color: #fff; }
        .playlist-view-header h3 { margin: 0; font-size: 16px; }
        .sort-toggles { display: flex; gap: 8px; }
        .sort-toggles button { flex: 1; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--win25-border); color: #ccc; border-radius: 6px; cursor: pointer; font-size: 12px; transition: 0.2s; }
        .sort-toggles button.active { background: rgba(0,120,212,0.2); border-color: rgba(0,120,212,0.4); color: #fff; }

        .trim-controls { display: flex; gap: 12px; margin-top: 12px; }
        .trim-controls label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #aaa; flex: 1; }
        .trim-controls input { background: rgba(0,0,0,0.4); border: 1px solid var(--win25-border); padding: 8px 12px; border-radius: 6px; color: #fff; width: 100%; outline: none; }
        .trim-controls input:focus { border-color: var(--win25-accent); }

        .advanced-settings-box { background: rgba(0,0,0,0.2); border: 1px solid var(--win25-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
        .setting-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #ccc; gap: 10px; }
        .setting-row select { width: 60%; }

        .videos-compact-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; margin-bottom: 40px; }
        .wavy-video-card { background: rgba(255,255,255,0.02); border: 1px solid var(--win25-border); border-radius: 12px; overflow: hidden; cursor: pointer; transition: transform 0.2s, border 0.2s, box-shadow: 0.2s; }
        .wavy-video-card:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.15); box-shadow: 0 10px 20px rgba(0,0,0,0.3); }
        .thumbnail-wrapper { position: relative; aspect-ratio: 16/9; background: #121316; }
        .thumbnail-wrapper img, .thumbnail-wrapper video { width: 100%; height: 100%; object-fit: cover; position: absolute; top: 0; left: 0; }
        .duration-tag { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.8); color: #fff; font-size: 11px; padding: 4px 8px; border-radius: 6px; z-index: 10; font-weight: 600; }
        .card-info { padding: 14px; }
        .card-info h3 { margin: 0 0 6px 0; font-size: 15px; line-height: 1.4; color: #fff; }
        .card-channel { margin: 0 0 8px 0; font-size: 13px; color: var(--win25-text-dim); }
        .card-stats { display: flex; gap: 10px; font-size: 12px; color: #888; }
        .empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; height: 400px; color: #777; text-align: center; }
        .cta-upload-btn { background: var(--win25-accent); color: #fff; border: none; padding: 12px 28px; border-radius: 8px; cursor: pointer; font-size: 15px; font-weight: 600; transition: 0.2s; }
        .cta-upload-btn:hover { background: #0086f0; }
        .video-player-frame { width: 100%; }
        .video-details-card { background: var(--win25-panel-solid); padding: 24px; border-radius: 16px; border: 1px solid var(--win25-border); display: flex; flex-direction: column; gap: 16px; }
        .details-header h1 { margin: 0 0 12px 0; font-size: 22px; line-height: 1.4; }
        .action-buttons { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .like-btn { background: rgba(255,255,255,0.06); color: #fff; border: 1px solid var(--win25-border); padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 14px; font-weight: 600; transition: 0.2s; }
        .like-btn:hover { background: rgba(255,255,255,0.12); }
        .views-count { font-size: 14px; color: #888; font-weight: 500; margin-left: auto; }
        .channel-author-row { display: flex; align-items: center; gap: 14px; padding: 16px 0; border-top: 1px solid var(--win25-border); border-bottom: 1px solid var(--win25-border); cursor: pointer; }
        .author-avatar { width: 44px; height: 44px; background: var(--win25-accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: bold; flex-shrink: 0; }
        .channel-author-row h3 { margin: 0; font-size: 16px; color: #fff; }
        .channel-author-row p { margin: 4px 0 0; font-size: 13px; color: #888; }
        .subscribe-action-btn { background: #fff; color: #000; border: none; padding: 10px 20px; border-radius: 24px; font-weight: 700; font-size: 14px; cursor: pointer; transition: 0.2s; }
        .subscribe-action-btn:hover { opacity: 0.9; transform: scale(0.98); }
        .video-description-box { font-size: 14px; color: #ccc; line-height: 1.6; }
        .open-comments-btn { width: 100%; background: rgba(255,255,255,0.06); border: 1px solid var(--win25-border); color: #fff; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; transition: 0.2s; }
        .open-comments-btn:hover { background: rgba(255,255,255,0.1); }
        .comments-popup-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 4000; display: flex; align-items: flex-end; justify-content: center; animation: fadeIn 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .comments-popup-panel, .create-ch-popup { background: var(--win25-panel-solid); border: 1px solid var(--win25-border); border-radius: 24px 24px 0 0; width: 100%; max-width: 700px; max-height: 75vh; display: flex; flex-direction: column; animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .create-ch-popup { max-width: 560px; max-height: 90vh; border-radius: 24px; align-self: center; margin-bottom: 5vh; } 
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .comments-popup-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 28px; border-bottom: 1px solid var(--win25-border); }
        .comments-popup-header h3 { margin: 0; font-size: 18px; display: flex; align-items: center; gap: 10px; }
        .popup-close-btn { background: rgba(255,255,255,0.08); border: none; color: #fff; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; transition: 0.2s; }
        .popup-close-btn:hover { background: rgba(255,255,255,0.15); }
        .popup-comment-form { display: flex; gap: 12px; padding: 16px 28px; border-bottom: 1px solid var(--win25-border); background: rgba(0,0,0,0.2); }
        .popup-comment-form input { flex: 1; background: rgba(255,255,255,0.05); border: 1px solid var(--win25-border); border-radius: 24px; padding: 12px 20px; color: #fff; font-size: 15px; outline: none; transition: 0.2s; }
        .popup-comment-form input:focus { border-color: var(--win25-accent); background: rgba(255,255,255,0.08); }
        .popup-submit-btn { width: 44px; height: 44px; background: var(--win25-accent); border: none; border-radius: 50%; color: white; cursor: pointer; font-size: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: 0.2s; }
        .popup-submit-btn:hover { background: #0086f0; }
        .popup-comments-list { overflow-y: auto; padding: 20px 28px; display: flex; flex-direction: column; gap: 20px; flex: 1; }
        .popup-comment-item { display: flex; gap: 14px; }
        .popup-c-avatar { width: 40px; height: 40px; background: #444; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; flex-shrink: 0; }
        .popup-c-body { flex: 1; }
        .popup-c-author { font-size: 14px; font-weight: 600; color: #eee; }
        .popup-c-body p { margin: 6px 0 0; font-size: 15px; color: #ccc; line-height: 1.5; }
        .popup-loading, .popup-empty { text-align: center; color: #777; padding: 30px; font-size: 15px; }
        .create-ch-form { padding: 24px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; }
        .ch-icon-section { display: flex; gap: 20px; align-items: flex-start; }
        .ch-icon-preview { width: 80px; height: 80px; background: rgba(0,0,0,0.4); border-radius: 50%; border: 2px solid var(--win25-border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; }
        .ch-icon-controls { flex: 1; }
        .emoji-grid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 6px; margin-bottom: 12px; }
        .emoji-option { font-size: 20px; text-align: center; padding: 6px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; transition: 0.2s; }
        .emoji-option:hover { background: rgba(255,255,255,0.08); }
        .emoji-option.selected { background: rgba(0,120,212,0.15); border-color: rgba(0,120,212,0.4); }
        .upload-img-label { display: inline-block; background: rgba(255,255,255,0.08); border: 1px solid var(--win25-border); color: #ccc; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; transition: 0.2s; }
        .upload-img-label:hover { background: rgba(255,255,255,0.12); }
        .create-ch-fields { display: flex; flex-direction: column; gap: 16px; }
        .field-group { display: flex; flex-direction: column; gap: 8px; }
        .field-group label { font-size: 14px; color: #ccc; font-weight: 500; }
        .at-prefix { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #888; font-size: 16px; pointer-events: none; }
        .create-ch-error { background: rgba(232,17,35,0.1); border: 1px solid rgba(232,17,35,0.3); color: #ff6b6b; padding: 12px 16px; border-radius: 8px; font-size: 14px; }
        .shorts-container-scroll { display: flex; flex-direction: column; align-items: center; height: calc(100vh - 70px); overflow-y: scroll; scroll-snap-type: y mandatory; padding-bottom: 100px; }
        .short-vertical-slide { scroll-snap-align: start; width: 420px; height: calc(100vh - 70px); min-height: calc(100vh - 70px); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .short-player-wrapper { position: relative; width: 380px; height: 680px; background: #000; border-radius: 24px; overflow: hidden; border: 1px solid var(--win25-border); box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
        .short-native-video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .short-overlay-details { position: absolute; bottom: 0; left: 0; right: 0; padding: 24px 20px; background: linear-gradient(transparent, rgba(0,0,0,0.9)); pointer-events: none; }
        .short-channel-row { display: flex; align-items: center; gap: 12px; }
        .short-avatar { width: 40px; height: 40px; background: var(--win25-accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 15px; border: 2px solid #fff; flex-shrink: 0; }
        .short-channel-name { font-size: 15px; font-weight: 700; color: #fff; }
        .short-title { font-size: 14px; color: #ddd; margin-top: 4px; line-height: 1.4; }
        .short-side-actions { position: absolute; right: 12px; bottom: 90px; display: flex; flex-direction: column; gap: 16px; }
        .short-action-btn { background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15); width: 54px; height: 58px; border-radius: 14px; color: white; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; font-size: 12px; gap: 4px; backdrop-filter: blur(8px); transition: 0.2s; }
        .short-action-btn:hover { background: rgba(255,255,255,0.15); transform: scale(1.05); }
        .studio-layout { display: flex; flex-direction: column; gap: 24px; max-width: 1200px; margin: 0 auto; width: 100%; }
        .studio-top-bar { display: flex; align-items: flex-start; justify-content: space-between; }
        .studio-top-bar h2 { margin: 0; font-size: 26px; font-weight: 700; }
        .studio-subtitle { margin: 6px 0 0; font-size: 15px; color: #888; }
        .btn-create-ch-top { background: rgba(255,255,255,0.08); border: 1px solid var(--win25-border); color: #fff; padding: 12px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: 0.2s; }
        .btn-create-ch-top:hover { background: rgba(255,255,255,0.15); }
        .upload-shortcut-btn { background: var(--win25-accent-gradient); color: #fff; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; white-space: nowrap; transition: 0.2s; box-shadow: 0 4px 12px rgba(0,120,212,0.3); }
        .upload-shortcut-btn:hover { opacity: 0.9; transform: translateY(-2px); }
        .studio-ch-tabs { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
        .studio-ch-tab { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.05); border: 1px solid var(--win25-border); color: var(--win25-text-dim); padding: 10px 18px; border-radius: 24px; cursor: pointer; font-size: 14px; font-weight: 500; transition: 0.2s; }
        .studio-ch-tab:hover { background: rgba(255,255,255,0.1); }
        .studio-ch-tab.active { background: rgba(0,120,212,0.15); border-color: rgba(0,120,212,0.4); color: #fff; }
        .studio-table-wrapper { background: var(--win25-panel-solid); border: 1px solid var(--win25-border); border-radius: 16px; overflow-x: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        .studio-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 15px; min-width: 600px; }
        .studio-table th { padding: 16px 24px; border-bottom: 1px solid var(--win25-border); font-size: 13px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; background: rgba(0,0,0,0.2); }
        .studio-table td { padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.04); vertical-align: middle; }
        .studio-table tr:last-child td { border-bottom: none; }
        .studio-table tr:hover td { background: rgba(255,255,255,0.03); }
        .studio-title-cell { display: flex; align-items: center; gap: 16px; }
        .studio-thumb { width: 80px; height: 45px; object-fit: cover; border-radius: 6px; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.1); }
        .playlist-badge { background: rgba(0,120,212,0.15); border: 1px solid rgba(0,120,212,0.3); color: #6ab4f5; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 500; }
        .actions-cell { display: flex; gap: 10px; }
        .btn-analytics { background: rgba(0,120,212,0.15); color: #6ab4f5; border: 1px solid rgba(0,120,212,0.3); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.2s; }
        .btn-analytics:hover { background: rgba(0,120,212,0.25); }
        .btn-delete { background: rgba(232,17,35,0.1); color: #ff6b6b; border: 1px solid rgba(232,17,35,0.25); padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: 0.2s; }
        .btn-delete:hover { background: rgba(232,17,35,0.2); border-color: rgba(232,17,35,0.4); }
        .analytics-modal-box-acrylic { background: var(--win25-panel-solid); border: 1px solid var(--win25-border); padding: 30px; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .chart-timeline-container { display: flex; align-items: flex-end; gap: 8px; height: 200px; background: rgba(0,0,0,0.4); padding: 24px; border-radius: 12px; overflow-x: auto; border: 1px inset rgba(255,255,255,0.05); }
        .chart-bar-node { flex: 1; min-width: 40px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
        .bar-fill-indicator { width: 100%; background: var(--win25-accent-gradient); border-radius: 4px 4px 0 0; min-height: 4px; transition: height 0.4s ease; box-shadow: 0 0 10px rgba(0,120,212,0.3); }
        .bar-label-tag { font-size: 11px; color: #888; margin: 6px 0; font-weight: 500; }
        .channel-page-layout { display: flex; flex-direction: column; gap: 30px; max-width: 1200px; margin: 0 auto; width: 100%; }
        .channel-banner-acrylic { background: var(--win25-panel); border: 1px solid var(--win25-border); border-radius: 20px; padding: 40px; display: flex; align-items: center; gap: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
        .channel-profile-avatar-big { width: 90px; height: 90px; background: var(--win25-accent-gradient); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 700; box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
        .channel-profile-meta-big h2 { margin: 0; font-size: 28px; font-weight: 700; }
        .channel-tab-title { font-size: 15px; color: #fff; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; border-bottom: 2px solid var(--win25-accent); padding-bottom: 10px; display: inline-block; }
        .upload-layout-box { max-width: 900px; margin: 0 auto; width: 100%; }
        .upload-layout-box h2 { margin: 0 0 8px; font-size: 26px; font-weight: 700; }
        .wavy-upload-form { margin-top: 24px; }
        .upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 24px; }
        .upload-left, .upload-right { display: flex; flex-direction: column; gap: 16px; }
        .upload-right { background: rgba(0,0,0,0.2); border: 1px dashed rgba(255,255,255,0.15); padding: 24px; border-radius: 16px; }
        .upload-file-zone { display: flex; align-items: center; justify-content: center; background: rgba(0,120,212,0.05); border: 2px dashed rgba(0,120,212,0.4); border-radius: 12px; padding: 24px; cursor: pointer; font-size: 16px; color: #aaa; text-align: center; transition: 0.2s; font-weight: 500; }
        .upload-file-zone:hover { background: rgba(0,120,212,0.1); border-color: rgba(0,120,212,0.6); color: #fff; }
        .upload-file-zone input { display: none; }
        .upload-input { background: rgba(0,0,0,0.4); border: 1px solid var(--win25-border); border-radius: 10px; padding: 14px 16px; color: #fff; font-size: 15px; width: 100%; outline: none; font-family: inherit; transition: 0.2s; }
        .upload-input:focus { border-color: var(--win25-accent); background: rgba(0,0,0,0.6); box-shadow: 0 0 0 3px rgba(0,120,212,0.15); }
        .upload-textarea { resize: vertical; min-height: 120px; line-height: 1.5; }
        .upload-playlist-block { background: rgba(0,0,0,0.2); border: 1px solid var(--win25-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .upload-select { width: 100%; padding: 12px 14px; background: rgba(0,0,0,0.6); border: 1px solid var(--win25-border); border-radius: 8px; color: #fff; font-size: 15px; outline: none; cursor: pointer; }
        .upload-select:focus { border-color: var(--win25-accent); }
        .upload-playlist-create { display: flex; gap: 10px; }
        .btn-create-playlist { background: var(--win25-accent); color: #fff; border: none; padding: 0 18px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; white-space: nowrap; transition: 0.2s; }
        .btn-create-playlist:hover { background: #0086f0; }
        .short-toggle { display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 15px; color: #ddd; font-weight: 500; background: rgba(255,255,255,0.03); padding: 14px 16px; border-radius: 10px; border: 1px solid var(--win25-border); transition: 0.2s; }
        .short-toggle:hover { background: rgba(255,255,255,0.06); }
        .short-toggle input { width: 18px; height: 18px; accent-color: var(--win25-accent); cursor: pointer; }
        .upload-preview-video { width: 100%; border-radius: 10px; background: #000; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .btn-capture-frame { width: 100%; background: rgba(255,255,255,0.08); border: 1px solid var(--win25-border); color: #fff; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 600; transition: 0.2s; margin-top: 12px; }
        .btn-capture-frame:hover { background: rgba(255,255,255,0.15); }
        .upload-video-placeholder { height: 160px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); border-radius: 10px; color: #555; font-size: 14px; font-weight: 500; border: 1px inset rgba(255,255,255,0.05); }
        .upload-divider { font-size: 13px; color: #666; text-align: center; margin: 8px 0; text-transform: uppercase; letter-spacing: 1px; }
        .upload-image-input { font-size: 13px; color: #aaa; width: 100%; background: rgba(255,255,255,0.03); padding: 10px; border-radius: 8px; border: 1px dashed rgba(255,255,255,0.1); cursor: pointer; }
        .upload-processing { background: rgba(0,0,0,0.5); border: 1px solid var(--win25-border); border-radius: 12px; padding: 24px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; backdrop-filter: blur(10px); }
        .upload-processing p { margin: 0; color: #6ab4f5; font-weight: 600; font-size: 16px; }
        
        /* ДОБАВЛЕНО: Стили для прогресс-бара и настроек сжатия */
        .wavy-progress-bar { width: 100%; height: 12px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; position: relative; }
        .wavy-progress-fill { height: 100%; background: var(--win25-accent-gradient); transition: width 0.3s ease; }
        .advanced-settings-box { background: rgba(0,0,0,0.2); border: 1px solid var(--win25-border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
        .setting-row { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: #ccc; gap: 10px; }
        .setting-row select { width: 60%; }

        .upload-spinner { width: 36px; height: 36px; border: 4px solid rgba(0,120,212,0.2); border-top-color: #0078d4; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg) } }
        .btn-cancel-upload { background: rgba(232,17,35,0.1); color: #ff6b6b; border: 1px solid rgba(232,17,35,0.3); padding: 12px 24px; border-radius: 8px; cursor: pointer; width: 100%; font-weight: 600; font-size: 15px; transition: 0.2s; }
        .btn-cancel-upload:hover { background: rgba(232,17,35,0.2); }
        .btn-publish { width: 100%; background: var(--win25-accent-gradient); color: #fff; border: none; padding: 16px; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 16px; letter-spacing: 0.5px; transition: transform 0.2s, box-shadow 0.2s; box-shadow: 0 8px 20px rgba(0,120,212,0.3); }
        .btn-publish:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(0,120,212,0.4); }
        .btn-publish:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        .search-results-title { font-size: 16px; color: #fff; margin-bottom: 24px; background: rgba(0,120,212,0.1); border: 1px solid rgba(0,120,212,0.2); padding: 12px 20px; border-radius: 10px; font-weight: 500; }
        .mobile-only-text { display: none; }
        .desktop-only { display: flex; }
        .desktop-only-text { display: inline; }
        .desktop-td { display: table-cell; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
        .mobile-bottom-nav { display: none; }

        @media (max-width: 1000px) {
          .watch-layout { grid-template-columns: 1fr; }
        }

        @media (max-width: 800px) {
          .desktop-only { display: none !important; }
          .desktop-only-text { display: none !important; }
          .desktop-td { display: none !important; }
          .mobile-only-text { display: block; }
          .wavy-sidebar { position: fixed; top: 0; left: 0; bottom: 0; width: 280px; z-index: 3000; transform: translateX(-100%); padding-bottom: 80px; }
          .wavy-sidebar.open { transform: translateX(0); }
          .mobile-close-btn { display: block; }
          .mobile-backdrop { display: block; }
          .wavy-header { padding: 0 16px; gap: 12px; justify-content: flex-start; }
          .mobile-menu-btn { display: block; background: transparent; border: none; color: white; font-size: 24px; padding: 0; cursor: pointer; }
          .mobile-brand { display: block; font-size: 18px; font-weight: bold; background: var(--win25-accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          .search-box { flex: 1; width: auto; }
          .search-box input { padding: 8px 30px 8px 16px; font-size: 14px; border-radius: 12px; }
          .user-profile-badge { margin-left: auto; }
          .wavy-main-content { padding-bottom: 60px; }
          .tab-container { padding: 16px; }
          .upload-grid { grid-template-columns: 1fr; gap: 16px; }
          .videos-compact-grid { grid-template-columns: 1fr; gap: 16px; }
          .studio-table { min-width: 100%; }
          .shorts-container-scroll { height: calc(100dvh - 64px - 60px); padding-bottom: 0; }
          .short-vertical-slide { height: calc(100dvh - 64px - 60px); min-height: calc(100dvh - 64px - 60px); width: 100vw; max-width: 100%; padding: 0; }
          .short-player-wrapper { border-radius: 0; border: none; width: 100%; height: 100%; }
          .mobile-bottom-nav { display: flex; position: fixed; bottom: 0; left: 0; right: 0; height: 60px; background: rgba(11, 11, 12, 0.95); backdrop-filter: blur(15px); border-top: 1px solid var(--win25-border); z-index: 2500; justify-content: space-around; align-items: center; padding: 0 10px; }
          .m-nav-item { background: transparent; border: none; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--win25-text-dim); gap: 4px; padding: 4px; cursor: pointer; flex: 1; }
          .m-nav-item.active { color: #fff; }
          .m-icon { font-size: 22px; }
          .m-label { font-size: 10px; font-weight: 500; }
          .upload-center-btn { position: relative; top: -12px; }
          .plus-circle { width: 48px; height: 48px; background: var(--win25-accent-gradient); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 300; box-shadow: 0 4px 16px rgba(0,120,212,0.4); }
          .studio-top-bar { flex-direction: column; gap: 12px; }
          .channel-banner-acrylic { flex-direction: column; text-align: center; padding: 24px; }
          .comments-popup-panel { border-radius: 20px 20px 0 0; max-height: 85dvh; }
          .create-ch-popup { max-width: 100%; border-radius: 20px 20px 0 0; margin-bottom: 0; max-height: 90dvh; }
        }
      `}} />
    </div>
  );
}

export default function WavyTubePage() {
  return (
    <Suspense fallback={<div style={{color:'#fff',padding:'40px',fontFamily:'sans-serif'}}>Загрузка WavyTube…</div>}>
      <WavyTubeContent />
    </Suspense>
  );
}