'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import * as actions from '../actions'; 

// ==========================================
// ЛОКАЛЬНАЯ БД (IndexedDB) ДЛЯ ОФФЛАЙНА
// ==========================================
const initOfflineDB = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve(null);
    const request = indexedDB.open('WavyTubeOffline', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveVideoOffline = async (videoMeta, blob) => {
  const db = await initOfflineDB();
  if(!db) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').put({ ...videoMeta, blobData: blob, downloadedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

const getOfflineVideos = async () => {
  const db = await initOfflineDB();
  if(!db) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction('videos', 'readonly');
    const request = tx.objectStore('videos').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

// ==========================================
// ГЛАВНЫЙ КОМПОНЕНТ ВИДЕОХОСТИНГА
// ==========================================
export default function WavyTubePage() {
  // Авторизация и профиль
  const [currentUsername, setCurrentUsername] = useState('Guest');
  const [userAvatar, setUserAvatar] = useState(null);
  const [userHandle, setUserHandle] = useState('');
  
  // Навигация
  const [activeTab, setActiveTab] = useState('home'); 
  const [sidebarOpen, setSidebarOpen] = useState(false); // YouTube-стиль: скрыто по умолчанию
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  
  // Данные
  const [videos, setVideos] = useState([]);
  const [recommended, setRecommended] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [likedVideoIds, setLikedVideoIds] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [downloadedVideos, setDownloadedVideos] = useState([]);
  
  // Настройки
  const [theme, setTheme] = useState('dark');
  const [adultContentAllowed, setAdultContentAllowed] = useState(true);
  
  // Плеер
  const [activeVideo, setActiveVideo] = useState(null);
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const ffmpegRef = useRef(null);
  const watchTimerRef = useRef(null);
  const watchSecondsRef = useRef(0);

  // Студия загрузки
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [isShort, setIsShort] = useState(false);
  const [uploadQuality, setUploadQuality] = useState('360p'); // 480p, 360p, 180p
  const [videoSettings, setVideoSettings] = useState({ likes: true, dislikes: true, recs: true, isAdult: false });
  
  // Статусы
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState('');
  const [ffmpegProgress, setFfmpegProgress] = useState(0);

  // Модалки
  const [playlistModalVideo, setPlaylistModalVideo] = useState(null);

  useEffect(() => {
    const savedUser = localStorage.getItem('p_user') || 'Guest';
    setCurrentUsername(savedUser);
    
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => { setIsOnline(false); setActiveTab('downloads'); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Подгрузка системной аватарки пользователя (из ParrotOS/ClientInterface logic)
    actions.getRawUserData(savedUser).then(data => {
      if(data && data.avatar) setUserAvatar(data.avatar);
    });

    // Инициализация системного плейлиста "Смотреть позже"
    let savedPlaylists = JSON.parse(localStorage.getItem('wt_playlists') || '[]');
    if (!savedPlaylists.some(p => p.id === 'watch_later')) {
      savedPlaylists.unshift({ id: 'watch_later', name: 'Смотреть позже', videos: [], isPrivate: true, pinned: true });
      localStorage.setItem('wt_playlists', JSON.stringify(savedPlaylists));
    }
    setPlaylists(savedPlaylists);
    setLikedVideoIds(JSON.parse(localStorage.getItem('wt_liked') || '[]'));
    setSubscriptions(JSON.parse(localStorage.getItem('wt_subs') || '[]'));
    setTheme(localStorage.getItem('wt_theme') || 'dark');
    setAdultContentAllowed(localStorage.getItem('wt_adult') === 'true');

    getOfflineVideos().then(vids => setDownloadedVideos(vids));
    initApp(savedUser);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  async function initApp(username) {
    if (!navigator.onLine) return;
    await actions.ensureVideoTables();
    const vids = await actions.getAllVideos();
    const recs = await actions.getRecommendedVideos();
    if (vids.success) setVideos(vids.data);
    if (recs.success) setRecommended(recs.data);

    const stats = await actions.getChannelStats(username);
    if (stats.success && stats.handle) setUserHandle(stats.handle);
  }

  // === УМНЫЙ ПОИСК И МАРШРУТИЗАЦИЯ ===
  const handleSearchSubmit = async (e) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    let startTime = 0;
    const timeMatch = q.match(/s:(\d+)/);
    if (timeMatch) startTime = parseInt(timeMatch[1], 10);

    // Команды маршрутизации
    if (q.startsWith('@') || q.startsWith('channel:')) {
      const handle = q.replace('channel:', '').split(' ')[0].replace('@', '');
      const res = await actions.getChannelStats(handle);
      if (res) {
        setSearchQuery(`Канал: @${handle}`);
        setVideos(videos.filter(v => v.username === handle));
        setActiveTab('home');
      }
      return;
    }

    if (q.startsWith('video:')) {
      const vidId = q.match(/video:([^\s]+)/)?.[1];
      const target = videos.find(v => v.id === vidId);
      if (target) playVideo(target, startTime);
      return;
    }

    if (q.startsWith('playlist:')) {
      const plId = q.match(/playlist:([^\s]+)/)?.[1];
      setActiveTab(`playlist_${plId}`);
      return;
    }

    // Обычный поиск
    const res = await actions.searchVideos(q.replace(/s:\d+/, '').trim());
    if (res.success) {
      setVideos(res.data);
      setActiveTab('home');
    }
  };

  // === АНАЛИТИКА И ПЛЕЕР ===
  useEffect(() => {
    if (activeVideo && !isOfflinePlayback) {
      watchSecondsRef.current = 0;
      watchTimerRef.current = setInterval(() => {
        watchSecondsRef.current += 1;
        // Отправка аналитики каждые 10 секунд реального просмотра
        if (watchSecondsRef.current % 10 === 0) {
          actions.addWatchTime(activeVideo.id, activeVideo.channel_id, 10);
          actions.incrementViews(activeVideo.id);
        }
      }, 1000);
    }
    return () => { if (watchTimerRef.current) clearInterval(watchTimerRef.current); };
  }, [activeVideo, isOfflinePlayback]);

  const playVideo = (video, startTime = 0) => {
    if (video.settings && JSON.parse(video.settings).isAdult && !adultContentAllowed) {
      alert("Этот контент имеет возрастные ограничения. Включите 18+ в настройках.");
      return;
    }

    setActiveVideo(video);
    setActiveTab('player');
    
    setTimeout(() => {
      if (videoRef.current) {
        if (video.blobData) {
          setIsOfflinePlayback(true);
          videoRef.current.src = URL.createObjectURL(video.blobData);
        } else {
          setIsOfflinePlayback(false);
          // Инициализация HLS с ускоренным стартом
          if (Hls.isSupported()) {
            if (hlsRef.current) hlsRef.current.destroy();
            const hls = new Hls({
              autoStartLoad: true,
              startLevel: -1, // Авто-определение скорости
              maxBufferLength: 15,
              maxMaxBufferLength: 30,
              enableWorker: true, // Использование Web Worker для ускорения
              lowLatencyMode: true
            });
            hlsRef.current = hls;
            hls.loadSource(`/api/videos/${video.id}/master.m3u8`);
            hls.attachMedia(videoRef.current);
          } else {
            videoRef.current.src = `/api/videos/${video.id}/master.m3u8`;
          }
        }
        videoRef.current.currentTime = startTime;
        videoRef.current.play().catch(() => {});
        loadComments(video.id);
      }
    }, 150);
  };

  const loadComments = async (vidId) => {
    const res = await actions.getComments(vidId);
    if (res.success) setComments(res.data);
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newCommentText.trim() || !isOnline) return;
    const res = await actions.addComment(activeVideo.id, currentUsername, newCommentText);
    if (res.success) {
      setComments([res.data, ...comments]);
      setNewCommentText('');
    }
  };

  // === ИНИЦИАЛИЗАЦИЯ FFMPEG ===
  const initFFmpeg = async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    setProcessStatus('Загрузка многопоточного ядра FFmpeg WASM...');
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL('https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.wasm', 'application/wasm'),
      workerURL: await toBlobURL('https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/umd/ffmpeg-core.worker.js', 'text/javascript'),
    });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  };

  // === ЭКСТРЕМАЛЬНАЯ КОМПРЕССИЯ И ЗАГРУЗКА (РЕШЕНИЕ ПРОБЛЕМЫ БЛОАТА И ОЖИДАНИЯ) ===
  const processAndUploadVideo = async (e) => {
    e.preventDefault();
    if (!selectedFile || !thumbnailFile || !title) return alert('Заполните все поля!');
    
    // Ограничитель 500 МБ
    if (selectedFile.size > 500 * 1024 * 1024) {
      alert("Извините, Ваше видео слишком большое. Лимит загрузки — 500 МБ.");
      return;
    }

    try {
      setIsProcessing(true);
      setFfmpegProgress(0);
      const ffmpeg = await initFFmpeg();

      ffmpeg.on('progress', ({ progress }) => setFfmpegProgress(Math.round(progress * 100)));

      // 1. КОНВЕРТАЦИЯ ПРЕВЬЮ В СВЕРХЛЕГКИЙ WEBP 16:9
      setProcessStatus('Оптимизация превью в формат WebP...');
      await ffmpeg.writeFile('thumb_in', await fetchFile(thumbnailFile));
      await ffmpeg.exec([
        '-i', 'thumb_in',
        '-vf', 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libwebp',
        '-quality', '60', // Сильное сжатие картинки
        'thumb_out.webp'
      ]);
      const thumbData = await ffmpeg.readFile('thumb_out.webp');
      const base64Thumb = await new Promise(res => {
        const r = new FileReader();
        r.onloadend = () => res(r.result);
        r.readAsDataURL(new Blob([thumbData], { type: 'image/webp' }));
      });

      // 2. МНОГОПОТОЧНОЕ ЖЕСТКОЕ СЖАТИЕ ВИДЕО
      setProcessStatus(`Сжатие видео потока (${uploadQuality})...`);
      await ffmpeg.writeFile('vid_in', await fetchFile(selectedFile));

      // Настройка пресетов битрейта (SD форматы для макс. экономии БД)
      let scaleFilter = '';
      let bitrate = '';
      if (uploadQuality === '480p') { scaleFilter = '854:480'; bitrate = '500k'; }
      else if (uploadQuality === '360p') { scaleFilter = '640:360'; bitrate = '300k'; }
      else { scaleFilter = '320:180'; bitrate = '150k'; } // 180p

      const aspectPad = isShort ? `scale=-2:${scaleFilter.split(':')[1]}` : `scale=${scaleFilter}:force_original_aspect_ratio=decrease,pad=${scaleFilter}:(ow-iw)/2:(oh-ih)/2`;

      // Используем аппаратные треды браузера (navigator.hardwareConcurrency)
      const threads = navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : '4';

      await ffmpeg.exec([
        '-i', 'vid_in',
        '-threads', threads,
        '-vf', aspectPad,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '35', // ЭКСТРЕМАЛЬНОЕ СЖАТИЕ (Решает проблему раздувания базы!)
        '-maxrate', bitrate,
        '-bufsize', String(parseInt(bitrate) * 2) + 'k',
        '-c:a', 'aac',
        '-b:a', '48k', // Урезаем звук
        '-hls_time', '6', // Оптимальная длина чанка
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', 'segment_%03d.ts',
        '-f', 'hls',
        'master.m3u8'
      ]);

      const fsItems = await ffmpeg.listDir('/');
      const tsFiles = fsItems.filter(f => !f.isDir && f.name.endsWith('.ts'));

      const videoId = "vid_" + Math.random().toString(36).substring(2, 15);
      const settingsJSON = JSON.stringify(videoSettings);

      setProcessStatus("Регистрация манифеста...");
      await actions.createVideoRecordEx(currentUsername, videoId, title, description, 0, settingsJSON);

      // Отправляем обложку
      const fdThumb = new FormData();
      fdThumb.append('videoId', videoId);
      fdThumb.append('file', base64Thumb);
      await fetch('/api/videos/upload-thumbnail', { method: 'POST', body: fdThumb });

      // Загрузка сегментов
      for (let i = 0; i < tsFiles.length; i++) {
        setProcessStatus(`Отправка фрагментов в базу: ${i + 1}/${tsFiles.length}`);
        const fileData = await ffmpeg.readFile(tsFiles[i].name);
        const fd = new FormData();
        fd.append('file', new Blob([fileData.buffer], { type: 'video/MP2T' }), tsFiles[i].name);
        await actions.uploadHlsFileAction(videoId, tsFiles[i].name, fd);
      }

      alert("Видео успешно сжато и опубликовано!");
      setTitle(''); setDescription(''); setSelectedFile(null); setThumbnailFile(null);
      initApp(currentUsername);
      setActiveTab('home');

    } catch (err) {
      alert("Ошибка кодирования: " + err.message);
    } finally {
      setIsProcessing(false);
      setFfmpegProgress(0);
    }
  };

  // === ОФФЛАЙН СКАЧИВАНИЕ ===
  const downloadForOffline = async (video, format) => {
    try {
      alert(`Начато скачивание ${format.toUpperCase()}...`);
      const response = await fetch(`/api/videos/${video.id}/file.mp4`);
      const blob = await response.blob();
      
      await saveVideoOffline({
        id: video.id + '_' + format,
        title: video.title,
        username: video.username,
        thumbnail: video.thumbnail,
        description: video.description,
        format: format,
        isOfflineCopy: true
      }, blob);
      
      const list = await getOfflineVideos();
      setDownloadedVideos(list);
      alert('Успешно сохранено в оффлайн-кэш!');
    } catch (e) {
      alert('Ошибка скачивания: ' + e.message);
    }
  };

  // === ИНТЕРАКТИВ И ПЛЕЙЛИСТЫ ===
  const handleLike = () => {
    if(!isOnline) return;
    actions.toggleLike(activeVideo.id, currentUsername).then(res => {
      if(res.success) {
        setActiveVideo({...activeVideo, likes: res.likes});
        if(res.hasLiked) setLikedVideoIds([...likedVideoIds, activeVideo.id]);
        else setLikedVideoIds(likedVideoIds.filter(id => id !== activeVideo.id));
      }
    });
  };

  const handleSubscribe = () => {
    if(!isOnline) return;
    actions.toggleSubscription(currentUsername, activeVideo.username).then(res => {
      if(res.success) {
        if(res.isSubscribed) setSubscriptions([...subscriptions, activeVideo.username]);
        else setSubscriptions(subscriptions.filter(s => s !== activeVideo.username));
      }
    });
  };

  const createPlaylist = () => {
    const name = prompt("Название нового приватного плейлиста:");
    if (!name) return;
    const newPl = { id: 'pl_' + Date.now(), name, videos: [], isPrivate: true, pinned: false };
    const updated = [...playlists, newPl];
    setPlaylists(updated);
    localStorage.setItem('wt_playlists', JSON.stringify(updated));
  };

  const addToPlaylist = (playlistId, videoId) => {
    const updated = playlists.map(p => {
      if (p.id === playlistId && !p.videos.includes(videoId)) {
        return { ...p, videos: [...p.videos, videoId] };
      }
      return p;
    });
    setPlaylists(updated);
    localStorage.setItem('wt_playlists', JSON.stringify(updated));
    setPlaylistModalVideo(null);
    alert("Добавлено в плейлист!");
  };

  return (
    <div className={`wt-app ${theme}`}>
      {/* ХЕДЕР */}
      <header className="wt-header">
        <div className="header-left">
          <button className="burger-btn" onClick={() => setSidebarOpen(!sidebarOpen)}>☰</button>
          <div className="logo-box" onClick={() => setActiveTab('home')}>
            <span className="logo-icon">▶</span>
            <h2>WavyTube</h2>
          </div>
          {!isOnline && <span className="offline-badge">OFFLINE</span>}
        </div>

        <form className="search-bar" onSubmit={handleSearchSubmit}>
          <input 
            type="text" 
            placeholder="Поиск (канал:имя, video:ID, s:сек)..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit">🔍</button>
        </form>

        <div className="header-right">
          <div className="avatar" title={currentUsername}>
            {userAvatar ? <img src={userAvatar} alt="avatar" /> : currentUsername[0].toUpperCase()}
          </div>
        </div>
      </header>

      <div className="wt-main-container">
        
        {/* СКРЫВАЕМЫЙ САЙДБАР КАК В YOUTUBE */}
        <aside className={`wt-sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <div className="sidebar-content">
            {isOnline && (
              <>
                <button className={`nav-item ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>🏠 Главная</button>
                <button className={`nav-item ${activeTab === 'shorts' ? 'active' : ''}`} onClick={() => setActiveTab('shorts')}>⚡ Shorts</button>
                <button className={`nav-item ${activeTab === 'subs' ? 'active' : ''}`} onClick={() => setActiveTab('subs')}>👥 Подписки</button>
                <hr className="divider" />
              </>
            )}

            <div className="sidebar-title">Вы</div>
            <button className={`nav-item ${activeTab === 'downloads' ? 'active' : ''}`} onClick={() => setActiveTab('downloads')}>💾 Скачанные ({downloadedVideos.length})</button>
            
            {isOnline && (
              <>
                <button className={`nav-item ${activeTab === 'liked' ? 'active' : ''}`} onClick={() => setActiveTab('liked')}>👍 Понравившиеся</button>
                <button className={`nav-item ${activeTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveTab('upload')}>📤 Студия</button>
                
                <hr className="divider" />
                <div className="sidebar-title flex-between">
                  Плейлисты <button onClick={createPlaylist} className="add-pl-btn">+</button>
                </div>
                {playlists.map(pl => (
                  <button key={pl.id} className="nav-item" onClick={() => { 
                    setVideos(videos.filter(v => pl.videos.includes(v.id))); 
                    setActiveTab('home'); 
                    setSearchQuery(`Плейлист: ${pl.name}`);
                  }}>
                    {pl.id === 'watch_later' ? '🕒' : '📁'} {pl.name}
                  </button>
                ))}

                <hr className="divider" />
                <div className="sidebar-title">Настройки</div>
                <button className="nav-item" onClick={() => {
                  const newTheme = theme === 'dark' ? 'light' : 'dark';
                  setTheme(newTheme);
                  localStorage.setItem('wt_theme', newTheme);
                }}>🌗 Тема: {theme === 'dark' ? 'Темная' : 'Светлая'}</button>
                <button className="nav-item" onClick={() => {
                  const val = !adultContentAllowed;
                  setAdultContentAllowed(val);
                  localStorage.setItem('wt_adult', val);
                }}>🔞 Контент 18+: {adultContentAllowed ? 'ВКЛ' : 'ВЫКЛ'}</button>
              </>
            )}
          </div>
        </aside>

        {/* ОСНОВНАЯ ЗОНА */}
        <main className="wt-content">
          
          {isProcessing && (
            <div className="progress-banner">
              <strong>ОБРАБОТКА:</strong> {processStatus} ({ffmpegProgress}%)
              <div className="progress-bar"><div className="fill" style={{width: `${ffmpegProgress}%`}}></div></div>
            </div>
          )}

          {/* ГЛАВНАЯ / ПОИСК */}
          {activeTab === 'home' && (
            <div className="grid-feed">
              {videos.map((vid, i) => (
                <div key={vid.id} className="video-card">
                  <div className="thumbnail-box" onClick={() => playVideo(vid)}>
                    <img src={vid.thumbnail} alt="thumb" />
                    <span className="badge-time">{vid.isShort ? 'Short' : 'HD'}</span>
                  </div>
                  <div className="video-meta-grid">
                    <div className="author-avatar">{vid.username[0].toUpperCase()}</div>
                    <div className="text-info">
                      <h4 onClick={() => playVideo(vid)}>{vid.title}</h4>
                      <p onClick={() => setSearchQuery(`channel:${vid.username}`)}>{vid.username}</p>
                      <p>{vid.views} просмотров</p>
                    </div>
                    <button className="menu-dots" onClick={() => setPlaylistModalVideo(vid)}>⋮</button>
                  </div>
                </div>
              ))}
              {videos.length === 0 && <p className="empty">Контент не найден.</p>}
            </div>
          )}

          {/* SHORTS */}
          {activeTab === 'shorts' && (
            <div className="shorts-container">
              {videos.filter(v => parseInt(v.isShort, 10) === 1).map(vid => (
                <div key={vid.id} className="short-player-card">
                  <img src={vid.thumbnail} alt="short" onClick={() => playVideo(vid)} />
                  <div className="short-overlay">
                    <h4>{vid.title}</h4>
                    <button className="play-short-btn" onClick={() => playVideo(vid)}>▶ Смотреть</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ОФФЛАЙН ЗАГРУЗКИ */}
          {activeTab === 'downloads' && (
            <div className="grid-feed">
              {downloadedVideos.map((vid, i) => (
                <div key={vid.id} className="video-card">
                  <div className="thumbnail-box" onClick={() => playVideo(vid)}>
                    <img src={vid.thumbnail} alt="thumb" />
                    <span className="badge-time">{vid.format.toUpperCase()}</span>
                  </div>
                  <div className="video-meta-grid">
                    <div className="text-info">
                      <h4 onClick={() => playVideo(vid)}>{vid.title}</h4>
                      <p className="offline-txt">✅ Сохранено на устройстве</p>
                    </div>
                  </div>
                </div>
              ))}
              {downloadedVideos.length === 0 && <p className="empty">Нет скачанных видео.</p>}
            </div>
          )}

          {/* ПЛЕЕР */}
          {activeTab === 'player' && activeVideo && (
            <div className="player-grid-layout">
              <div className="player-column">
                <div className="video-wrapper">
                  <video ref={videoRef} controls autoPlay className="main-video" />
                </div>

                <div className="video-details-section">
                  <h1>{activeVideo.title}</h1>
                  
                  {isOfflinePlayback ? (
                    <div className="offline-alert">🔒 Вы смотрите локальную копию. Сетевые функции отключены.</div>
                  ) : (
                    <div className="player-action-row">
                      <div className="author-block">
                        <div className="author-avatar large">{activeVideo.username[0].toUpperCase()}</div>
                        <div className="author-texts">
                          <strong>{activeVideo.username}</strong>
                          <span>{channelStats.subscribers} подписчиков</span>
                        </div>
                        {activeVideo.username !== currentUsername && (
                          <button className={`sub-btn ${subscriptions.includes(activeVideo.username) ? 'active' : ''}`} onClick={handleSubscribe}>
                            {subscriptions.includes(activeVideo.username) ? 'Вы подписаны' : 'Подписаться'}
                          </button>
                        )}
                      </div>

                      <div className="interaction-block">
                        <button className="pill-btn" onClick={handleLike}>👍 {activeVideo.likes || 0}</button>
                        <button className="pill-btn" onClick={() => downloadForOffline(activeVideo, 'mp4')}>📥 Сохранить</button>
                        <button className="pill-btn" onClick={() => setPlaylistModalVideo(activeVideo)}>➕ В плейлист</button>
                      </div>
                    </div>
                  )}

                  <div className="desc-box">
                    <strong>{activeVideo.views} просмотров</strong>
                    <p>{activeVideo.description}</p>
                  </div>

                  {!isOfflinePlayback && (
                    <div className="comments-block">
                      <h3>Комментарии</h3>
                      <form onSubmit={handleAddComment} className="comment-form">
                        <input type="text" value={newCommentText} onChange={e=>setNewCommentText(e.target.value)} placeholder="Введите комментарий..." />
                        <button type="submit">Оставить</button>
                      </form>
                      {comments.map(c => (
                        <div key={c.id} className="comment-item">
                          <div className="author-avatar small">{c.username[0].toUpperCase()}</div>
                          <div>
                            <strong>{c.username}</strong>
                            <p>{c.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* БОКОВЫЕ РЕКОМЕНДАЦИИ И РЕКЛАМА */}
              {!isOfflinePlayback && (
                <div className="recommendations-column">
                  {recommended.filter(r => r.id !== activeVideo.id).map((vid, idx) => (
                    <React.Fragment key={vid.id}>
                      <div className="rec-mini-card" onClick={() => playVideo(vid)}>
                        <img src={vid.thumbnail} alt="thumb" />
                        <div className="rec-texts">
                          <h4>{vid.title}</h4>
                          <p>{vid.username}</p>
                          <p>{vid.views} просмотров</p>
                        </div>
                      </div>
                      
                      {/* Рекламный блок каждые 6 видео */}
                      {(idx + 1) % 6 === 0 && (
                        <div className="ad-banner">
                          <span className="ad-badge">Реклама</span>
                          <h4>ParrotOS Market</h4>
                          <p>Покупай лучшие приложения за PyCoins!</p>
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* СТУДИЯ ЗАГРУЗКИ */}
          {activeTab === 'upload' && (
            <div className="studio-container">
              <h2>Творческая студия (Оптимизация X2)</h2>
              <p className="studio-hint">Ваше видео будет жестко сжато для экономии места на сервере и мгновенного запуска. Лимит 500 МБ.</p>
              
              <form onSubmit={processAndUploadVideo} className="upload-form">
                <input type="text" placeholder="Название видео" value={title} onChange={e=>setTitle(e.target.value)} required />
                <textarea placeholder="Описание (Хэштеги, таймкоды...)" value={description} onChange={e=>setDescription(e.target.value)} rows="4" />
                
                <div className="file-inputs">
                  <label>
                    Видеофайл (MP4/MKV):
                    <input type="file" accept="video/*" onChange={e=>setSelectedFile(e.target.files[0])} required />
                  </label>
                  <label>
                    Обложка (сконвертируется в WebP):
                    <input type="file" accept="image/*" onChange={e=>setThumbnailFile(e.target.files[0])} required />
                  </label>
                </div>

                <div className="settings-grid">
                  <label>
                    Качество сжатия:
                    <select value={uploadQuality} onChange={e=>setUploadQuality(e.target.value)}>
                      <option value="480p">480p (Стандарт SD)</option>
                      <option value="360p">360p (Быстрая загрузка)</option>
                      <option value="180p">180p (Максимальное сжатие)</option>
                    </select>
                  </label>
                  
                  <label className="checkbox-lbl">
                    <input type="checkbox" checked={isShort} onChange={e=>setIsShort(e.target.checked)} />
                    Формат Shorts (Вертикальное)
                  </label>
                  <label className="checkbox-lbl">
                    <input type="checkbox" checked={videoSettings.isAdult} onChange={e=>setVideoSettings({...videoSettings, isAdult: e.target.checked})} />
                    Контент 18+
                  </label>
                </div>

                <button type="submit" disabled={isProcessing} className="upload-btn">
                  {isProcessing ? 'Рендеринг и загрузка...' : 'Опубликовать видео'}
                </button>
              </form>
            </div>
          )}
        </main>
      </div>

      {/* МОДАЛКА ПЛЕЙЛИСТОВ */}
      {playlistModalVideo && (
        <div className="modal-overlay" onClick={() => setPlaylistModalVideo(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Сохранить видео</h3>
            {playlists.map(pl => (
              <button key={pl.id} className="modal-pl-btn" onClick={() => addToPlaylist(pl.id, playlistModalVideo.id)}>
                {pl.id === 'watch_later' ? '🕒' : '📁'} {pl.name} {pl.videos.includes(playlistModalVideo.id) ? '(Добавлено)' : ''}
              </button>
            ))}
            <button className="modal-close-btn" onClick={() => setPlaylistModalVideo(null)}>Закрыть</button>
          </div>
        </div>
      )}

      <style jsx global>{`
        /* CSS ПЕРЕМЕННЫЕ И ТЕМЫ */
        :root {
          --bg-main: #0f0f0f;
          --bg-surface: #212121;
          --text-primary: #f1f1f1;
          --text-secondary: #aaa;
          --accent: #ff0000;
          --accent-hover: #cc0000;
          --border: #3d3d3d;
        }
        .light {
          --bg-main: #f9f9f9;
          --bg-surface: #ffffff;
          --text-primary: #0f0f0f;
          --text-secondary: #606060;
          --border: #e5e5e5;
        }

        .wt-app {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: var(--bg-main);
          color: var(--text-primary);
          font-family: Roboto, Arial, sans-serif;
          overflow: hidden;
        }

        /* HEADER */
        .wt-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          height: 56px;
          background: var(--bg-main);
          border-bottom: 1px solid var(--border);
          z-index: 100;
        }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .burger-btn { background: none; border: none; color: var(--text-primary); font-size: 24px; cursor: pointer; padding: 8px; border-radius: 50%; }
        .burger-btn:hover { background: var(--bg-surface); }
        .logo-box { display: flex; align-items: center; gap: 4px; cursor: pointer; }
        .logo-icon { color: var(--accent); font-size: 20px; }
        .logo-box h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -1px; }
        .offline-badge { background: #ff4e4e; color: #fff; font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; }
        
        .search-bar { display: flex; width: 40%; max-width: 600px; }
        .search-bar input { flex: 1; background: var(--bg-main); border: 1px solid var(--border); color: var(--text-primary); padding: 8px 16px; border-radius: 20px 0 0 20px; outline: none; font-size: 16px; }
        .search-bar input:focus { border-color: #1c62b9; }
        .search-bar button { background: var(--bg-surface); border: 1px solid var(--border); border-left: none; padding: 0 20px; border-radius: 0 20px 20px 0; cursor: pointer; color: var(--text-primary); }
        
        .avatar { width: 32px; height: 32px; background: #1c62b9; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff; overflow: hidden; }
        .avatar img { width: 100%; height: 100%; object-fit: cover; }

        /* LAYOUT & SIDEBAR */
        .wt-main-container { display: flex; flex: 1; overflow: hidden; }
        .wt-sidebar { background: var(--bg-main); transition: width 0.2s ease; overflow-y: auto; overflow-x: hidden; }
        .wt-sidebar.open { width: 240px; }
        .wt-sidebar.closed { width: 0px; }
        .sidebar-content { padding: 12px; width: 216px; }
        
        .nav-item { display: flex; align-items: center; width: 100%; padding: 10px 12px; background: none; border: none; color: var(--text-primary); text-align: left; border-radius: 10px; cursor: pointer; font-size: 14px; margin-bottom: 4px; }
        .nav-item:hover, .nav-item.active { background: var(--bg-surface); font-weight: bold; }
        .divider { border: 0; border-top: 1px solid var(--border); margin: 12px 0; }
        .sidebar-title { font-size: 14px; font-weight: 600; padding: 8px 12px; color: var(--text-secondary); }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .add-pl-btn { background: none; border: none; color: #3ea6ff; font-size: 18px; cursor: pointer; }

        /* CONTENT AREA */
        .wt-content { flex: 1; background: var(--bg-main); overflow-y: auto; padding: 24px; }
        .empty { color: var(--text-secondary); text-align: center; margin-top: 50px; }
        
        .progress-banner { background: var(--bg-surface); padding: 16px; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 24px; }
        .progress-bar { width: 100%; height: 4px; background: var(--border); margin-top: 8px; border-radius: 2px; overflow: hidden; }
        .fill { height: 100%; background: #3ea6ff; transition: width 0.3s; }

        /* GRID (HOME) */
        .grid-feed { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px 16px; }
        .video-card { display: flex; flex-direction: column; gap: 12px; cursor: pointer; }
        .thumbnail-box { position: relative; width: 100%; aspect-ratio: 16/9; border-radius: 12px; overflow: hidden; background: #000; border: 1px solid var(--border); }
        .thumbnail-box img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s; }
        .video-card:hover .thumbnail-box img { transform: scale(1.05); }
        .badge-time { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.8); color: #fff; padding: 3px 4px; border-radius: 4px; font-size: 12px; font-weight: 500; }
        
        .video-meta-grid { display: flex; gap: 12px; align-items: flex-start; }
        .author-avatar { width: 36px; height: 36px; background: #555; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; flex-shrink: 0; }
        .text-info { flex: 1; }
        .text-info h4 { margin: 0 0 4px 0; font-size: 16px; font-weight: 600; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .text-info p { margin: 0; font-size: 14px; color: var(--text-secondary); }
        .menu-dots { background: none; border: none; color: var(--text-primary); font-size: 18px; cursor: pointer; padding: 0 8px; }
        .offline-txt { color: #00ff66 !important; font-weight: bold; }

        /* SHORTS */
        .shorts-container { display: flex; gap: 20px; overflow-x: auto; padding-bottom: 20px; }
        .short-player-card { width: 240px; height: 426px; border-radius: 16px; position: relative; overflow: hidden; flex-shrink: 0; border: 1px solid var(--border); }
        .short-player-card img { width: 100%; height: 100%; object-fit: cover; }
        .short-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 20px; background: linear-gradient(transparent, rgba(0,0,0,0.9)); }
        .short-overlay h4 { margin: 0 0 10px 0; font-size: 16px; text-shadow: 0 1px 2px #000; }
        .play-short-btn { width: 100%; background: #fff; color: #000; border: none; padding: 10px; border-radius: 20px; font-weight: bold; cursor: pointer; }

        /* PLAYER LAYOUT */
        .player-grid-layout { display: flex; gap: 24px; flex-wrap: wrap; }
        .player-column { flex: 1; min-width: 60%; }
        .recommendations-column { width: 400px; display: flex; flex-direction: column; gap: 12px; }
        
        .video-wrapper { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; overflow: hidden; }
        .main-video { width: 100%; height: 100%; outline: none; }
        
        .video-details-section h1 { font-size: 20px; font-weight: bold; margin: 15px 0; }
        .offline-alert { background: #332200; color: #ffaa00; padding: 12px; border-radius: 8px; font-size: 14px; font-weight: bold; }
        
        .player-action-row { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
        .author-block { display: flex; align-items: center; gap: 12px; }
        .author-avatar.large { width: 40px; height: 40px; }
        .author-texts strong { font-size: 16px; display: block; }
        .author-texts span { font-size: 12px; color: var(--text-secondary); }
        .sub-btn { background: var(--text-primary); color: var(--bg-main); border: none; padding: 8px 16px; border-radius: 20px; font-weight: bold; cursor: pointer; margin-left: 12px; }
        .sub-btn.active { background: var(--bg-surface); color: var(--text-primary); }
        
        .interaction-block { display: flex; gap: 8px; }
        .pill-btn { background: var(--bg-surface); color: var(--text-primary); border: none; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .pill-btn:hover { background: var(--border); }
        
        .desc-box { background: var(--bg-surface); padding: 12px; border-radius: 12px; margin-top: 16px; font-size: 14px; line-height: 1.5; }
        
        .comments-block { margin-top: 24px; }
        .comment-form { display: flex; gap: 12px; margin-bottom: 24px; }
        .comment-form input { flex: 1; background: transparent; border: none; border-bottom: 1px solid var(--text-secondary); color: var(--text-primary); outline: none; padding: 4px 0; }
        .comment-form button { background: #3ea6ff; color: #000; border: none; padding: 8px 16px; border-radius: 18px; font-weight: bold; cursor: pointer; }
        .comment-item { display: flex; gap: 12px; margin-bottom: 16px; font-size: 14px; }
        .author-avatar.small { width: 24px; height: 24px; font-size: 10px; }
        
        /* SIDE RECS */
        .rec-mini-card { display: flex; gap: 10px; cursor: pointer; }
        .rec-mini-card img { width: 160px; height: 90px; border-radius: 8px; object-fit: cover; }
        .rec-texts h4 { margin: 0 0 4px 0; font-size: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .rec-texts p { margin: 0; font-size: 12px; color: var(--text-secondary); }
        .ad-banner { background: var(--bg-surface); border: 1px solid var(--border); padding: 16px; border-radius: 8px; position: relative; }
        .ad-badge { position: absolute; top: 8px; right: 8px; background: #f2c811; color: #000; font-size: 10px; padding: 2px 4px; border-radius: 4px; font-weight: bold; }
        
        /* СТУДИЯ */
        .studio-container { max-width: 800px; margin: 0 auto; background: var(--bg-surface); padding: 32px; border-radius: 16px; border: 1px solid var(--border); }
        .studio-hint { color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; }
        .upload-form { display: flex; flex-direction: column; gap: 16px; }
        .upload-form input[type="text"], .upload-form textarea, .upload-form select { background: var(--bg-main); border: 1px solid var(--border); color: var(--text-primary); padding: 12px; border-radius: 8px; font-family: inherit; }
        .file-inputs { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .file-inputs label { font-size: 14px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 8px; }
        .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: center; }
        .checkbox-lbl { font-size: 14px; display: flex; align-items: center; gap: 8px; }
        .upload-btn { background: #3ea6ff; color: #000; font-weight: bold; padding: 14px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; margin-top: 16px; }
        .upload-btn:disabled { background: var(--border); color: var(--text-secondary); cursor: not-allowed; }

        /* МОДАЛКА */
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .modal-box { background: var(--bg-surface); padding: 24px; border-radius: 12px; width: 300px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border); }
        .modal-pl-btn { background: var(--bg-main); border: 1px solid var(--border); color: var(--text-primary); padding: 10px; border-radius: 6px; cursor: pointer; text-align: left; }
        .modal-pl-btn:hover { background: var(--border); }
        .modal-close-btn { background: #ff4e4e; color: #fff; border: none; padding: 10px; border-radius: 6px; cursor: pointer; margin-top: 10px; font-weight: bold; }

        @media (max-width: 900px) {
          .wt-sidebar.open { position: fixed; top: 56px; bottom: 0; z-index: 99; }
          .player-grid-layout { flex-direction: column; }
          .recommendations-column { width: 100%; }
          .search-bar { width: 50%; }
        }
      `}</style>
    </div>
  );
}