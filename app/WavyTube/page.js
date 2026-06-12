'use client';

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import * as actions from '../actions'; 

export default function WavyTubePage() {
  const [currentUsername, setCurrentUsername] = useState('Guest');

  const [activeTab, setActiveTab] = useState('home'); 
  const [videos, setVideos] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  
  const [channelStats, setChannelStats] = useState(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  
  // Состояния для плеера
  const [isBuffering, setIsBuffering] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const ffmpegRef = useRef(new FFmpeg());
  const [qualityLevels, setQualityLevels] = useState([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const watchTimerRef = useRef(null);
  const watchSecondsRef = useRef(0);

  // Состояния загрузки
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [vidSettings, setVidSettings] = useState({ likes: true, dislikes: true, recs: true });
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [ffmpegProgress, setFfmpegProgress] = useState(0);

  const [editingVideo, setEditingVideo] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Драг-н-дроп логотипа
  const [logoPos, setLogoPos] = useState({ x: 20, y: 20 });
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const playerContainerRef = useRef(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('p_user');
    if (savedUser) setCurrentUsername(savedUser);
    initApp();
  }, []);

  async function initApp() {
    await actions.ensureVideoTables();
    const vids = await actions.getAllVideos();
    const recs = await actions.getRecommendedVideos();
    if (vids.success) setVideos(vids.data);
    if (recs.success) setRecommended(recs.data);
  }

  // === АВТООБНОВЛЕНИЕ РЕКОМЕНДАЦИЙ ===
  useEffect(() => {
    let interval;
    if (activeTab === 'home' || activeTab === 'player') {
      interval = setInterval(async () => {
        const recs = await actions.getRecommendedVideos();
        if (recs.success) setRecommended(recs.data);
      }, 15000); 
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  // === ПЛЕЕР И ЗАПРОС КАЧЕСТВА У СЕРВЕРА ===
  useEffect(() => {
    if (activeTab !== 'player') {
      clearInterval(watchTimerRef.current);
      return;
    }
    
    const video = videoRef.current;
    if (!video || !activeVideo) return;

    loadComments();
    checkSub(activeVideo.username);
    setIsBuffering(false);
    setIsFrozen(false);

    const settings = activeVideo.settings ? JSON.parse(activeVideo.settings) : { likes: true, dislikes: true, recs: true };
    activeVideo.parsedSettings = settings;

    const playlistUrl = `/api/videos/${activeVideo.id}/master.m3u8`;

    if (Hls.isSupported()) {
      if (hlsRef.current) hlsRef.current.destroy();
      
      // Оптимизация для слабых ПК и 1ГБ ОЗУ
      const hls = new Hls({
        autoStartLoad: true,
        startLevel: 0,
        maxBufferLength: 10, // Меньше буфер, чтобы не забивать память
        maxMaxBufferLength: 20,
        lowLatencyMode: true,
        enableWorker: true
      });
      hlsRef.current = hls;
      
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
      
      hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
        setQualityLevels(data.levels);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
        setCurrentQuality(data.level);
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setIsFrozen(true);
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else if (video.canPlayType('application/x-mpegURL')) {
      video.src = playlistUrl;
    }

    // Точная аналитика (считаем только когда реально играет)
    watchSecondsRef.current = 0;
    watchTimerRef.current = setInterval(() => {
      if (!video.paused && !video.ended && !isFrozen && !isBuffering) {
        watchSecondsRef.current += 1;
        if (watchSecondsRef.current % 10 === 0) {
          actions.addWatchTime(activeVideo.id, activeVideo.channel_id, 10);
        }
      }
    }, 1000);

    return () => { 
      if (hlsRef.current) hlsRef.current.destroy(); 
      clearInterval(watchTimerRef.current);
    };
  }, [activeVideo, activeTab]);

  const handleQualityChange = (e) => {
    const level = Number(e.target.value);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentQuality(level);
    }
  };

  // === ЛОГИКА ПЕРЕТАСКИВАНИЯ ЛОГОТИПА ===
  const handleLogoMouseDown = (e) => {
    setIsDraggingLogo(true);
    dragOffset.current = {
      x: e.clientX - logoPos.x,
      y: e.clientY - logoPos.y
    };
  };

  const handleLogoMouseMove = (e) => {
    if (!isDraggingLogo || !playerContainerRef.current) return;
    const containerRect = playerContainerRef.current.getBoundingClientRect();
    
    let newX = e.clientX - dragOffset.current.x;
    let newY = e.clientY - dragOffset.current.y;
    
    // Ограничиваем рамками плеера
    newX = Math.max(10, Math.min(newX, containerRect.width - 100));
    newY = Math.max(10, Math.min(newY, containerRect.height - 40));

    setLogoPos({ x: newX, y: newY });
  };

  const handleLogoMouseUp = () => {
    setIsDraggingLogo(false);
  };

  useEffect(() => {
    if (isDraggingLogo) {
      window.addEventListener('mousemove', handleLogoMouseMove);
      window.addEventListener('mouseup', handleLogoMouseUp);
    } else {
      window.removeEventListener('mousemove', handleLogoMouseMove);
      window.removeEventListener('mouseup', handleLogoMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleLogoMouseMove);
      window.removeEventListener('mouseup', handleLogoMouseUp);
    };
  }, [isDraggingLogo]);


  // === ИНТЕРАКТИВ ===
  const loadComments = async () => {
    if (!activeVideo) return;
    const res = await actions.getComments(activeVideo.id);
    if (res.success) setComments(res.data);
  };

  const submitComment = async () => {
    if (!newComment.trim() || currentUsername === 'Guest') return;
    await actions.addComment(activeVideo.id, currentUsername, newComment);
    setNewComment('');
    loadComments();
  };

  const checkSub = async (targetUser) => {
    if (currentUsername === 'Guest') return;
    const res = await actions.checkSubscription(targetUser, currentUsername);
    setIsSubscribed(res.subscribed);
  };

  const handleSubscribe = async () => {
    if (currentUsername === 'Guest' || !activeVideo) return alert("Авторизуйтесь!");
    const res = await actions.toggleSubscription(activeVideo.username, currentUsername);
    if (res.success) {
      setIsSubscribed(res.subscribed);
      setActiveVideo(prev => ({ ...prev, subscribers: prev.subscribers + (res.subscribed ? 1 : -1) }));
    } else {
      alert(res.error);
    }
  };

  const handleLike = async () => {
    await actions.incrementLike(activeVideo.id);
    setActiveVideo(prev => ({ ...prev, likes: prev.likes + 1 }));
  };

  const handleDislike = async () => {
    await actions.incrementDislike(activeVideo.id);
    setActiveVideo(prev => ({ ...prev, dislikes: prev.dislikes + 1 }));
  };

  const playVideo = async (vid) => {
    setActiveVideo(vid);
    setActiveTab('player');
    await actions.incrementViews(vid.id);
  };

  const loadMyChannel = async () => {
    setActiveTab('channel');
    setMobileMenuOpen(false);
    const stats = await actions.getChannelStats(currentUsername);
    if (stats.success) setChannelStats(stats.data);
  };

  const handleDeleteVideo = async (id) => {
    if (!confirm("Удалить видео навсегда?")) return;
    const res = await actions.deleteVideo(id, currentUsername);
    if (res.success) { alert("Удалено"); initApp(); } 
    else { alert("Ошибка: " + res.error); }
  };

  const saveEditVideo = async () => {
    if (!editingVideo) return;
    const res = await actions.updateVideoDetails(editingVideo.id, currentUsername, editingVideo.title, editingVideo.description);
    if (res.success) { setEditingVideo(null); initApp(); } 
    else { alert("Ошибка: " + res.error); }
  };

  const formatTime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}ч ${m}м`;
  };

  // === ЗАГРУЗКА И КОНВЕРТАЦИЯ ===
  const handleFileUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile) return setProcessStatus("Выберите видео!");
    setIsProcessing(true);
    setFfmpegProgress(0);

    try {
      const ffmpeg = ffmpegRef.current;
      if (!ffmpeg.loaded) {
        setProcessStatus("Подключение декодера...");
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
      }

      ffmpeg.on('progress', ({ progress }) => setFfmpegProgress(Math.round(progress * 100)));

      setProcessStatus("Чтение исходного файла...");
      await ffmpeg.writeFile('input.mp4', await fetchFile(selectedFile));

      // ИСПРАВЛЕНИЕ КАШИ: Принудительное транскодирование в совместимый формат!
      setProcessStatus(`Конвертация и нарезка сегментов...`);
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-g', '60', 
        '-sc_threshold', '0', 
        '-force_key_frames', 'expr:gte(t,n_forced*4)', 
        '-c:a', 'aac',
        '-b:a', '128k',
        '-hls_time', '4',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', 'segment_%03d.ts',
        '-f', 'hls',
        'master.m3u8'
      ]);

      const fsItems = await ffmpeg.listDir('/');
      const tsFiles = fsItems.filter(f => !f.isDir && f.name.endsWith('.ts'));

      const videoId = "vid_" + Math.random().toString(36).substring(2, 15);
      const settingsJSON = JSON.stringify(vidSettings);

      await actions.createVideoRecordEx(currentUsername, videoId, title, description, 0, settingsJSON);

      if (thumbnailFile) {
        setProcessStatus("Сохранение обложки...");
        const fd = new FormData();
        fd.append('videoId', videoId);
        fd.append('file', thumbnailFile);
        await fetch('/api/videos/upload-thumbnail', { method: 'POST', body: fd });
      }

      for (let i = 0; i < tsFiles.length; i++) {
        const filename = tsFiles[i].name; 
        setProcessStatus(`Отправка фрагментов на сервер: ${i + 1}/${tsFiles.length}`);
        
        const fileData = await ffmpeg.readFile(filename);
        const blob = new Blob([fileData.buffer], { type: 'video/MP2T' });
        
        const formData = new FormData();
        formData.append('file', blob, filename);

        await actions.uploadHlsFileAction(videoId, filename, formData);
      }

      setProcessStatus("Публикация успешно завершена!");
      setTimeout(() => { 
        setIsProcessing(false); 
        setTitle(''); setDescription(''); setSelectedFile(null); setThumbnailFile(null);
        loadMyChannel(); 
        initApp(); 
      }, 2000);

    } catch (err) {
      setProcessStatus(`Критический сбой загрузки: ${err.message}`);
      setIsProcessing(false);
    }
  };

  // SVG-заглушка для битых превью
  const fallbackThumbnail = 'data:image/svg+xml;charset=UTF-8,%3Csvg width="100%25" height="100%25" xmlns="http://www.w3.org/2000/svg"%3E%3Crect width="100%25" height="100%25" fill="%23222" /%3E%3Ctext x="50%25" y="50%25" font-family="sans-serif" font-size="14" fill="%23777" text-anchor="middle" dy=".3em"%3EНет превью%3C/text%3E%3C/svg%3E';

  return (
    <div className="wt-layout">
      <div className="wt-mobile-header">
        <button className="hamburger" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>☰</button>
        <div className="logo" onClick={() => setActiveTab('home')}>🌊 WavyTube</div>
      </div>

      <aside className={`wt-sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="wt-logo desktop-only" onClick={() => setActiveTab('home')}>🌊 WavyTube</div>
        
        <nav className="wt-nav">
          <button className={activeTab === 'home' ? 'active' : ''} onClick={() => { setActiveTab('home'); setMobileMenuOpen(false); }}>
            🏠 Главная
          </button>
          <button className={activeTab === 'channel' ? 'active' : ''} onClick={loadMyChannel}>
            👤 Мой Канал
          </button>
          <button className={activeTab === 'studio' ? 'active' : ''} onClick={() => { setActiveTab('studio'); setMobileMenuOpen(false); }}>
            ⬆️ Студия (Загрузить)
          </button>
        </nav>

        <div className="wt-user-badge">
          <div className="avatar">{currentUsername?.[0]?.toUpperCase() || 'U'}</div>
          <div className="info">
            <span className="name">{currentUsername}</span>
            <span className="role">ParrotSoft ID</span>
          </div>
        </div>
      </aside>

      <main className="wt-main">
        {activeTab === 'home' && (
          <div className="home-grid">
            <h2 className="page-title">Рекомендации для вас</h2>
            {recommended.length === 0 ? (
              <p className="empty-state">Видео не обнаружены. Будьте первыми!</p>
            ) : (
              <div className="video-grid">
                {recommended.map(vid => (
                  <div key={vid.id} className="video-card" onClick={() => playVideo(vid)}>
                    <div className="thumb-wrapper">
                      <img 
                        src={`/api/videos/${vid.id}/thumbnail`} 
                        alt="thumb" 
                        onError={(e) => { e.target.onerror = null; e.target.src = fallbackThumbnail; }} 
                      />
                      <span className="duration">HLS HD</span>
                    </div>
                    <div className="info">
                      <div className="channel-av">{vid.username?.[0]?.toUpperCase() || 'U'}</div>
                      <div className="text-data">
                        <h3>{vid.title}</h3>
                        <span className="meta">{vid.channel_name} • {vid.views} просмотров</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'player' && activeVideo && (
          <div className="player-layout">
            <div className="player-primary">
              <div className="video-wrapper" ref={playerContainerRef}>
                <video 
                  ref={videoRef} 
                  controls 
                  autoPlay 
                  className="main-video"
                  onWaiting={() => { setIsBuffering(true); setIsFrozen(true); }}
                  onPlaying={() => { setIsBuffering(false); setIsFrozen(false); }}
                  onPause={() => { setIsBuffering(false); setIsFrozen(false); }}
                  onStalled={() => setIsFrozen(true)}
                />
                
                {/* Индикатор зависания видео */}
                {(isBuffering || isFrozen) && (
                  <div className="buffering-overlay">
                    <div className="spinner"></div>
                    <span className="freeze-text">Видео зависло (Ожидание данных...)</span>
                  </div>
                )}

                {/* Перетаскиваемый логотип WavyTube */}
                <div 
                  className="draggable-logo"
                  style={{ left: logoPos.x, top: logoPos.y, cursor: isDraggingLogo ? 'grabbing' : 'grab' }}
                  onMouseDown={handleLogoMouseDown}
                  title="Удерживайте, чтобы переместить"
                >
                  🌊 WavyTube
                </div>

                <div className="quality-selector">
                  <select value={currentQuality} onChange={handleQualityChange}>
                    <option value={-1}>Авто</option>
                    {qualityLevels.map((lvl, i) => (
                      <option key={i} value={i}>{lvl.height}p</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="video-details">
                <h1 className="title">{activeVideo.title}</h1>
                <div className="action-row">
                  <div className="author">
                    <div className="channel-av">{activeVideo.username?.[0]?.toUpperCase() || 'U'}</div>
                    <div className="author-text">
                      <strong>{activeVideo.channel_name}</strong>
                      <div className="subscribers">{activeVideo.subscribers} подписчиков</div>
                    </div>
                    {currentUsername !== activeVideo.username && (
                      <button className={`btn-subscribe ${isSubscribed ? 'active' : ''}`} onClick={handleSubscribe}>
                        {isSubscribed ? 'Вы подписаны' : 'Подписаться'}
                      </button>
                    )}
                  </div>
                  
                  <div className="actions">
                    <div className="action-group">
                      {activeVideo.parsedSettings?.likes && (
                        <button className="btn-action left" onClick={handleLike}>👍 {activeVideo.likes}</button>
                      )}
                      {activeVideo.parsedSettings?.dislikes && (
                        <button className="btn-action right" onClick={handleDislike}>👎</button>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="description-box">
                  <span className="views-bold">{activeVideo.views} просмотров • Траст: {activeVideo.trust_rating}%</span>
                  <p>{activeVideo.description || "Описание отсутствует."}</p>
                </div>
              </div>

              <div className="comments-section">
                <h3>Комментарии ({comments.length})</h3>
                <div className="comment-input">
                  <div className="channel-av small">{currentUsername?.[0]?.toUpperCase() || 'U'}</div>
                  <input 
                    type="text" 
                    placeholder="Оставьте ваш комментарий..."
                    value={newComment}
                    onChange={e => setNewComment(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitComment()}
                  />
                  <button onClick={submitComment}>Отправить</button>
                </div>
                
                <div className="comments-list">
                  {comments.map(c => (
                    <div key={c.id} className="comment">
                      <div className="channel-av small">{c.username?.[0]?.toUpperCase() || 'U'}</div>
                      <div className="content">
                        <span className="author">@{c.username} <span className="date">{new Date(c.created_at).toLocaleDateString()}</span></span>
                        <p>{c.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {activeVideo.parsedSettings?.recs && (
              <div className="player-secondary">
                <h3>Следующее видео</h3>
                <div className="recs-list">
                  {recommended.filter(v => v.id !== activeVideo.id).slice(0, 8).map(vid => (
                    <div key={vid.id} className="rec-card" onClick={() => playVideo(vid)}>
                      <img 
                        src={`/api/videos/${vid.id}/thumbnail`} 
                        alt="thumb" 
                        onError={(e) => { e.target.onerror = null; e.target.src = fallbackThumbnail; }} 
                      />
                      <div className="info">
                        <h4>{vid.title}</h4>
                        <span>{vid.channel_name}</span>
                        <span>{vid.views} просм.</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'channel' && (
          <div className="channel-dashboard">
            <div className="channel-banner">
              <div className="channel-av huge">{currentUsername?.[0]?.toUpperCase() || 'U'}</div>
              <div className="channel-info-header">
                <h2>{currentUsername}</h2>
                <p>@{currentUsername} • Панель управления канала</p>
                <div className="stats-badges">
                  <span>👥 {channelStats?.subscribers || 0} Подписчиков</span>
                  <span>⏱️ {formatTime(channelStats?.total_watch_time || 0)} Время просмотров</span>
                </div>
              </div>
            </div>

            <h3 style={{marginTop: '30px', marginBottom: '15px'}}>Менеджер видеоконтента</h3>
            <div className="video-table-wrapper">
              <table className="video-table">
                <thead>
                  <tr>
                    <th>Превью</th>
                    <th>Метаданные</th>
                    <th className="hide-mobile">Метрика</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.filter(v => v.username === currentUsername).map(vid => (
                    <tr key={vid.id}>
                      <td width="120px">
                        <img 
                          src={`/api/videos/${vid.id}/thumbnail`} 
                          alt="thumb" 
                          className="table-thumb" 
                          onError={(e) => { e.target.onerror = null; e.target.src = fallbackThumbnail; }} 
                        />
                      </td>
                      <td>
                        {editingVideo?.id === vid.id ? (
                          <div className="edit-form">
                            <input type="text" value={editingVideo.title} onChange={e => setEditingVideo({...editingVideo, title: e.target.value})} />
                            <textarea value={editingVideo.description} onChange={e => setEditingVideo({...editingVideo, description: e.target.value})} />
                            <div className="edit-actions">
                              <button className="btn-save" onClick={saveEditVideo}>Сохранить</button>
                              <button className="btn-cancel" onClick={() => setEditingVideo(null)}>Отмена</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <strong className="td-title">{vid.title}</strong>
                            <p className="desc-preview hide-mobile">{vid.description}</p>
                          </>
                        )}
                      </td>
                      <td className="hide-mobile">
                        <div className="stat-line">👁️ {vid.views} просмотров</div>
                        <div className="stat-line">👍 {vid.likes} лайков</div>
                      </td>
                      <td className="actions-col">
                        <button className="btn-edit" onClick={() => setEditingVideo(vid)}>✏️</button>
                        <button className="btn-del" onClick={() => handleDeleteVideo(vid.id)}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'studio' && (
          <div className="studio-layout">
            <div className="upload-card">
              <h2 className="page-title">Студия публикации</h2>
              <form onSubmit={handleFileUpload} className="studio-form">
                
                <div className="form-row">
                  <div className="input-group">
                    <label>Название видео</label>
                    <input type="text" required value={title} onChange={e => setTitle(e.target.value)} disabled={isProcessing} />
                  </div>
                  <div className="input-group">
                    <label>Описание</label>
                    <textarea rows="3" value={description} onChange={e => setDescription(e.target.value)} disabled={isProcessing}></textarea>
                  </div>
                </div>

                <div className="form-row media-inputs">
                  <div className="input-group file-drop">
                    <label>Файл видео (.mp4, .mkv)</label>
                    <input type="file" accept="video/*" required onChange={e => setSelectedFile(e.target.files[0])} disabled={isProcessing} />
                  </div>
                  <div className="input-group file-drop">
                    <label>Обложка видео (.png, .jpg)</label>
                    <input type="file" accept="image/*" onChange={e => setThumbnailFile(e.target.files[0])} disabled={isProcessing} />
                  </div>
                </div>

                <div className="privacy-settings">
                  <label><input type="checkbox" checked={vidSettings.likes} onChange={e => setVidSettings({...vidSettings, likes: e.target.checked})} disabled={isProcessing} /> Разрешить лайки</label>
                  <label><input type="checkbox" checked={vidSettings.dislikes} onChange={e => setVidSettings({...vidSettings, dislikes: e.target.checked})} disabled={isProcessing} /> Разрешить дизлайки</label>
                  <label><input type="checkbox" checked={vidSettings.recs} onChange={e => setVidSettings({...vidSettings, recs: e.target.checked})} disabled={isProcessing} /> Включить в рекомендации</label>
                </div>

                <button type="submit" disabled={isProcessing} className="btn-upload-run">
                  {isProcessing ? 'Обработка и выгрузка...' : 'Опубликовать'}
                </button>
              </form>

              {isProcessing && (
                <div className="processing-status">
                  <div className="status-text">{processStatus}</div>
                  <div className="progress-bar"><div className="fill" style={{width: `${ffmpegProgress}%`}}></div></div>
                  <span>{ffmpegProgress}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .wt-layout { display: flex; height: 100vh; background: #0f0f0f; color: #f1f1f1; font-family: sans-serif; overflow: hidden; flex-direction: row; }
        .wt-mobile-header { display: none; background: #0f0f0f; padding: 15px; border-bottom: 1px solid #272727; align-items: center; justify-content: space-between; width: 100%; z-index: 100; }
        .hamburger { background: none; border: none; color: #fff; font-size: 24px; cursor: pointer; }
        .wt-sidebar { width: 240px; background: #0f0f0f; display: flex; flex-direction: column; border-right: 1px solid #272727; transition: transform 0.3s ease; }
        .wt-logo { padding: 20px; font-size: 22px; font-weight: 900; color: #fff; cursor: pointer; }
        .wt-nav { flex: 1; display: flex; flex-direction: column; padding: 10px; gap: 5px; }
        .wt-nav button { background: transparent; color: #aaa; border: none; padding: 12px 15px; text-align: left; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 500; transition: 0.2s; }
        .wt-nav button:hover, .wt-nav button.active { background: #272727; color: #fff; }
        .wt-user-badge { padding: 20px; border-top: 1px solid #272727; display: flex; align-items: center; gap: 12px; }
        .avatar, .channel-av { width: 40px; height: 40px; background: #3ea6ff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #000; flex-shrink: 0; }
        .channel-av.small { width: 32px; height: 32px; font-size: 14px; }
        .channel-av.huge { width: 80px; height: 80px; font-size: 32px; }
        .wt-user-badge .info { display: flex; flex-direction: column; }
        .wt-user-badge .name { font-weight: bold; font-size: 14px; }
        .wt-user-badge .role { font-size: 11px; color: #aaa; }
        .wt-main { flex: 1; overflow-y: auto; padding: 24px; background: #0f0f0f; }
        
        .video-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
        .video-card { cursor: pointer; transition: transform 0.2s; }
        .video-card:hover { transform: scale(1.02); }
        .thumb-wrapper { position: relative; width: 100%; aspect-ratio: 16/9; background: #222; border-radius: 12px; overflow: hidden; margin-bottom: 12px; }
        .thumb-wrapper img { width: 100%; height: 100%; object-fit: cover; }
        .duration { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.8); padding: 3px 6px; border-radius: 4px; font-size: 12px; }
        .video-card .info { display: flex; gap: 12px; }
        .text-data h3 { margin: 0 0 6px 0; font-size: 15px; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .text-data .meta { color: #aaa; font-size: 13px; }
        
        /* PLAYER UX IMPROVEMENTS */
        .player-layout { display: flex; gap: 24px; flex-wrap: wrap; }
        .player-primary { flex: 1; min-width: 60%; }
        .player-secondary { width: 360px; }
        
        .video-wrapper { 
          position: relative; 
          width: 100%; 
          background: #000; 
          border-radius: 16px; 
          overflow: hidden; 
          aspect-ratio: 16/9; 
          margin-bottom: 15px; 
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .main-video { width: 100%; height: 100%; display: block; outline: none; object-fit: contain; z-index: 1; }
        
        /* Логотип поверх видео */
        .draggable-logo {
          position: absolute;
          background: rgba(0, 0, 0, 0.6);
          color: rgba(255, 255, 255, 0.8);
          padding: 6px 12px;
          border-radius: 8px;
          font-weight: bold;
          font-size: 14px;
          z-index: 50;
          user-select: none;
          backdrop-filter: blur(4px);
          border: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 2px 10px rgba(0,0,0,0.5);
        }

        /* Индикатор зависания (плашка снизу или по центру) */
        .buffering-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.7);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 10;
          backdrop-filter: blur(4px);
        }
        .spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255,255,255,0.1);
          border-top-color: #ff4e4e; /* Красный, чтобы было видно, что тупит */
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }
        .freeze-text {
          font-size: 16px;
          font-weight: bold;
          color: #ff4e4e;
          background: rgba(0,0,0,0.8);
          padding: 8px 16px;
          border-radius: 8px;
        }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        
        .quality-selector { position: absolute; top: 12px; right: 12px; background: rgba(0,0,0,0.8); padding: 5px 10px; border-radius: 8px; z-index: 20; border: 1px solid rgba(255,255,255,0.1); }
        .quality-selector select { background: transparent; color: #fff; border: none; outline: none; font-size: 13px; cursor: pointer; font-weight: bold; }
        
        .video-details .title { font-size: 20px; font-weight: 600; margin: 0 0 16px 0; }
        .action-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px; margin-bottom: 20px; }
        .author { display: flex; align-items: center; gap: 12px; }
        .author-text { display: flex; flex-direction: column; }
        .subscribers { font-size: 12px; color: #aaa; }
        .btn-subscribe { background: #f1f1f1; color: #0f0f0f; border: none; padding: 10px 20px; border-radius: 20px; font-weight: bold; cursor: pointer; transition: 0.2s; }
        .btn-subscribe:hover { background: #e0e0e0; }
        .btn-subscribe.active { background: #272727; color: #f1f1f1; }
        .action-group { display: flex; background: #272727; border-radius: 24px; overflow: hidden; }
        .btn-action { background: transparent; color: #fff; border: none; padding: 10px 18px; cursor: pointer; font-weight: 500; transition: 0.2s; }
        .btn-action:hover { background: #3f3f3f; }
        .btn-action.left { border-right: 1px solid #3f3f3f; }
        
        .description-box { background: #272727; padding: 16px; border-radius: 12px; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
        .views-bold { font-weight: bold; display: block; margin-bottom: 8px; font-size: 15px; }
        
        .comment-input { display: flex; gap: 15px; margin-bottom: 24px; align-items: center; }
        .comment-input input { flex: 1; background: transparent; border: none; border-bottom: 1px solid #717171; color: #fff; padding: 10px 0; outline: none; transition: 0.2s; }
        .comment-input input:focus { border-bottom-color: #f1f1f1; }
        .comment-input button { background: transparent; color: #3ea6ff; border: none; font-weight: bold; cursor: pointer; padding: 10px; border-radius: 20px; transition: 0.2s; }
        .comment-input button:hover { background: rgba(62, 166, 255, 0.1); }
        .comment { display: flex; gap: 15px; margin-bottom: 16px; }
        .comment .author { font-weight: bold; font-size: 13px; }
        .comment .date { font-weight: normal; color: #aaa; margin-left: 8px; font-size: 12px; }
        
        .recs-list { display: flex; flex-direction: column; gap: 12px; }
        .rec-card { display: flex; gap: 10px; cursor: pointer; border-radius: 8px; padding: 4px; transition: 0.2s; }
        .rec-card:hover { background: #272727; }
        .rec-card img { width: 140px; height: 78px; border-radius: 8px; object-fit: cover; }
        .rec-card .info { display: flex; flex-direction: column; justify-content: center; }
        .rec-card h4 { margin: 0 0 4px 0; font-size: 14px; font-weight: 500; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .rec-card span { font-size: 12px; color: #aaa; }
        
        .channel-banner { display: flex; align-items: center; gap: 24px; padding: 32px; background: #1a1a1a; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .stats-badges { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
        .stats-badges span { background: #272727; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; }
        
        .video-table-wrapper { background: #1a1a1a; border-radius: 12px; overflow-x: auto; margin-top: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .video-table { width: 100%; border-collapse: collapse; text-align: left; }
        .video-table th, .video-table td { padding: 16px; border-bottom: 1px solid #272727; }
        .table-thumb { width: 120px; height: 68px; border-radius: 8px; object-fit: cover; }
        .actions-col button { width: 36px; height: 36px; margin-right: 8px; background: #272727; color: #fff; border: none; border-radius: 50%; cursor: pointer; transition: 0.2s; }
        .actions-col button:hover { background: #3ea6ff; }
        .actions-col .btn-del:hover { background: #ff4e4e; }
        
        .studio-layout { max-width: 800px; margin: 0 auto; }
        .upload-card { background: #1a1a1a; padding: 32px; border-radius: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .input-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
        .input-group label { font-weight: 500; color: #aaa; font-size: 14px; }
        .input-group input, .input-group textarea, .input-group select { background: #0f0f0f; border: 1px solid #272727; color: #fff; padding: 14px; border-radius: 8px; outline: none; transition: 0.2s; font-size: 15px; }
        .input-group input:focus, .input-group textarea:focus { border-color: #3ea6ff; }
        .file-drop { border: 2px dashed #3f3f3f; padding: 24px; background: #0f0f0f; text-align: center; border-radius: 12px; transition: 0.2s; }
        .file-drop:hover { border-color: #3ea6ff; background: rgba(62, 166, 255, 0.05); }
        .privacy-settings { display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 24px; background: #0f0f0f; padding: 16px; border-radius: 8px; }
        .btn-upload-run { width: 100%; background: #3ea6ff; color: #0f0f0f; font-size: 16px; font-weight: bold; border: none; padding: 16px; border-radius: 24px; cursor: pointer; transition: 0.2s; }
        .btn-upload-run:hover:not(:disabled) { background: #65b8ff; }
        .btn-upload-run:disabled { background: #272727; color: #717171; cursor: not-allowed; }
        .progress-bar { width: 100%; height: 8px; background: #272727; border-radius: 4px; overflow: hidden; margin: 12px 0; }
        .progress-bar .fill { height: 100%; background: #3ea6ff; transition: width 0.3s; }
        
        /* ПОЛНОСТЬЮ ПЕРЕРАБОТАННЫЕ МОБИЛЬНЫЕ СТИЛИ */
        @media (max-width: 900px) {
          .wt-layout { flex-direction: column; }
          .wt-mobile-header { display: flex; }
          .wt-sidebar { position: fixed; top: 0; left: 0; height: 100vh; z-index: 1000; transform: translateX(-100%); width: 260px; box-shadow: 5px 0 15px rgba(0,0,0,0.8); }
          .wt-sidebar.open { transform: translateX(0); }
          .desktop-only { display: none; }
          
          .wt-main { padding: 10px; width: 100%; box-sizing: border-box; }
          
          .player-layout { flex-direction: column; gap: 16px; }
          .player-primary { min-width: 100%; width: 100%; }
          .player-secondary { width: 100%; }
          
          .video-wrapper { border-radius: 8px; width: 100%; aspect-ratio: 16/9; max-height: auto; }
          .draggable-logo { font-size: 10px; padding: 4px 8px; }
          
          .video-details .title { font-size: 18px; margin-bottom: 12px; line-height: 1.3; }
          .action-row { flex-direction: column; align-items: flex-start; gap: 16px; }
          .author { width: 100%; justify-content: space-between; }
          .actions { width: 100%; display: flex; justify-content: center; }
          .action-group { width: 100%; display: flex; }
          .btn-action { flex: 1; text-align: center; }
          
          .quality-selector { top: 8px; right: 8px; padding: 3px 6px; }
          .quality-selector select { font-size: 12px; }
          
          .video-grid { grid-template-columns: 1fr; gap: 16px; }
          .thumb-wrapper { border-radius: 8px; }
          
          .channel-banner { flex-direction: column; text-align: center; padding: 20px; }
          .stats-badges { justify-content: center; }
          
          .rec-card img { width: 120px; height: 68px; }
          
          .upload-card { padding: 16px; }
          .form-row { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}