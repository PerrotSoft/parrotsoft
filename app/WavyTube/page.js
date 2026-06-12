'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import * as actions from '../actions';

// ─── IndexedDB ────────────────────────────────────────────────────────────────
const initOfflineDB = () => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') return resolve(null);
  const req = indexedDB.open('WavyTubeOffline', 1);
  req.onupgradeneeded = (e) => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror  = () => reject(req.error);
});
const saveVideoOffline = async (meta, blob) => {
  const db = await initOfflineDB();
  if (!db) return;
  return new Promise(res => {
    const tx = db.transaction('videos', 'readwrite');
    tx.objectStore('videos').put({ ...meta, blobData: blob, downloadedAt: Date.now() });
    tx.oncomplete = res;
  });
};
const getOfflineVideos = async () => {
  const db = await initOfflineDB();
  if (!db) return [];
  return new Promise(res => {
    const tx = db.transaction('videos', 'readonly');
    const req = tx.objectStore('videos').getAll();
    req.onsuccess = () => res(req.result);
  });
};

// ─── Defensive plain-object strip (client-side safety net) ───────────────────
// actions.js already strips on the server; this guards against any edge case
const plain  = (rows) => (rows || []).map(r => { const o={}; for(const k of Object.keys(r)) o[k]=r[k]??null; return o; });
const plain1 = (r)    => { if(!r) return null; const o={}; for(const k of Object.keys(r)) o[k]=r[k]??null; return o; };

// ─── Global log ring-buffer (survives re-renders) ────────────────────────────
let _logBuf = [];
const pushLog = (msg, type='info') => {
  _logBuf = [{ id: Date.now()+Math.random(), ts: new Date().toLocaleTimeString('ru-RU'), msg, type }, ..._logBuf.slice(0,199)];
  return [..._logBuf];
};

// ─── fmtSecs ─────────────────────────────────────────────────────────────────
const fmtSecs = (s) => { if(!s||isNaN(s)) return ''; const m=Math.floor(s/60),ss=Math.floor(s%60); return `${m}:${ss<10?'0':''}${ss}`; };

// =============================================================================
export default function WavyTubePage() {

  // ── user ──────────────────────────────────────────────────────────────────
  const [currentUsername, setCurrentUsername] = useState('Guest');
  const [userAvatar,      setUserAvatar]      = useState(null);

  // ── ui ────────────────────────────────────────────────────────────────────
  const [activeTab,   setActiveTab]   = useState('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isOnline,    setIsOnline]    = useState(true);
  const [isLoading,   setIsLoading]   = useState(true);

  // ── settings ──────────────────────────────────────────────────────────────
  const [theme,               setTheme]               = useState('dark');
  const [hwProfile,           setHwProfile]           = useState('normal');
  const [adultContentAllowed, setAdultContentAllowed] = useState(true);

  // ── data ──────────────────────────────────────────────────────────────────
  const [allVideos,       setAllVideos]       = useState([]);
  const [videos,          setVideos]          = useState([]);   // filtered view
  const [recommended,     setRecommended]     = useState([]);
  const [playlists,       setPlaylists]       = useState([]);
  const [likedIds,        setLikedIds]        = useState(new Set());
  const [downloadedVideos,setDownloadedVideos]= useState([]);
  const [channelStats,    setChannelStats]    = useState({ subscribers: 0, handle: '' });

  // ── player ────────────────────────────────────────────────────────────────
  const [activeVideo,       setActiveVideo]       = useState(null);
  const [isOfflinePlayback, setIsOfflinePlayback] = useState(false);
  const [comments,          setComments]          = useState([]);
  const [newCommentText,    setNewCommentText]    = useState('');
  const [isSubscribed,      setIsSubscribed]      = useState(false);
  const [videoDuration,     setVideoDuration]     = useState(0);

  const videoRef        = useRef(null);
  const ffmpegRef       = useRef(new FFmpeg());
  const watchTimerRef   = useRef(null);
  const watchSecsRef    = useRef(0);

  // ── studio ────────────────────────────────────────────────────────────────
  const [title,         setTitle]         = useState('');
  const [description,   setDescription]   = useState('');
  const [selectedFile,  setSelectedFile]  = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [isShort,       setIsShort]       = useState(false);
  const [videoSettings, setVideoSettings] = useState({ likes:true, dislikes:true, recs:true, isAdult:false });

  const [isProcessing,   setIsProcessing]   = useState(false);
  const [processStatus,  setProcessStatus]  = useState('');
  const [processPercent, setProcessPercent] = useState(0);
  const [spamTimer,      setSpamTimer]      = useState(0);

  // ── playlist modals ───────────────────────────────────────────────────────
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlName,       setNewPlName]       = useState('');
  const [addToPlVid,      setAddToPlVid]      = useState(null); // video pending add-to-playlist

  // ── мойка log ────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState([]);

  // ── drag logo ─────────────────────────────────────────────────────────────
  const [logoPos,        setLogoPos]        = useState({ x:20, y:20 });
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const dragOffset       = useRef({ x:0, y:0 });
  const playerContainerRef = useRef(null);

  // ─── log helper ───────────────────────────────────────────────────────────
  const log = useCallback((msg, type='info') => {
    const next = pushLog(msg, type);
    setLogs(next);
  }, []);

  // ─── dedup playlists by name ──────────────────────────────────────────────
  const dedupPl = (arr) => {
    const seen = new Set();
    return arr.filter(p => { if(seen.has(p.name)) return false; seen.add(p.name); return true; });
  };

  // ─── refresh playlists ────────────────────────────────────────────────────
  const refreshPlaylists = async (username) => {
    let pl = await actions.getUserPlaylists(username);
    pl = plain(pl).map(p => ({ ...p, videos: Array.isArray(p.videos) ? p.videos : [] }));
    setPlaylists(dedupPl(pl));
    return dedupPl(pl);
  };

  // ─── INIT APP ─────────────────────────────────────────────────────────────
  async function initApp(username) {
    if (!navigator.onLine) { setIsLoading(false); return; }
    setIsLoading(true);
    log('Инициализация таблиц БД...');
    try {
      await actions.ensureVideoTables();
      log('Таблицы готовы', 'ok');

      log('Загрузка видео...');
      const vids = await actions.getAllVideos();
      if (vids.success) {
        const data = plain(vids.data);
        setAllVideos(data);
        setVideos(data);
        log(`Загружено ${data.length} видео`, 'ok');
      } else { log('Ошибка видео: ' + vids.error, 'error'); }

      const recs = await actions.getRecommendedVideos();
      if (recs.success) setRecommended(plain(recs.data));

      // ensure system playlists exist (no duplicates)
      let pl = await actions.getUserPlaylists(username);
      pl = plain(pl).map(p=>({...p, videos: Array.isArray(p.videos)?p.videos:[]}));
      pl = dedupPl(pl);

      for (const name of ['Смотреть позже', 'Мне нравится']) {
        if (!pl.some(p => p.name === name)) {
          log(`Создание плейлиста "${name}"...`);
          await actions.createPlaylist(username, name, 1);
        }
      }
      pl = await actions.getUserPlaylists(username);
      pl = plain(pl).map(p=>({...p, videos: Array.isArray(p.videos)?p.videos:[]}));
      setPlaylists(dedupPl(pl));
      log(`Плейлистов: ${dedupPl(pl).length}`, 'ok');

      const stats = await actions.getChannelStats(username);
      if (stats) setChannelStats(plain1(stats) || { subscribers:0, handle:'@'+username });

    } catch(err) {
      log('Критическая ошибка: ' + err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  }

  // ─── MOUNT ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const savedUser = localStorage.getItem('p_user') || 'Yevheniy_Fedorenko';
    setCurrentUsername(savedUser);
    actions.getRawUserData(savedUser).then(d => { if(d?.avatar) setUserAvatar(d.avatar); });

    setIsOnline(navigator.onLine);
    window.addEventListener('online',  () => setIsOnline(true));
    window.addEventListener('offline', () => { setIsOnline(false); setActiveTab('downloads'); });

    setTheme(localStorage.getItem('wt_theme') || 'dark');
    setHwProfile(localStorage.getItem('wt_hwProfile') || 'normal');
    setAdultContentAllowed(localStorage.getItem('wt_adult') !== 'false');

    getOfflineVideos().then(setDownloadedVideos);
    initApp(savedUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── DRAG LOGO ────────────────────────────────────────────────────────────
  useEffect(() => {
    const move = (e) => {
      if (!isDraggingLogo || !playerContainerRef.current) return;
      const r = playerContainerRef.current.getBoundingClientRect();
      setLogoPos({ x: Math.max(10,Math.min(e.clientX-dragOffset.current.x, r.width-100)), y: Math.max(10,Math.min(e.clientY-dragOffset.current.y, r.height-40)) });
    };
    const up = () => setIsDraggingLogo(false);
    if (isDraggingLogo) { window.addEventListener('mousemove',move); window.addEventListener('mouseup',up); }
    return () => { window.removeEventListener('mousemove',move); window.removeEventListener('mouseup',up); };
  }, [isDraggingLogo]);

  // ─── SEARCH ───────────────────────────────────────────────────────────────
  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) { setVideos(allVideos); return; }
    if (q.startsWith('channel:') || q.startsWith('@')) {
      const h = q.replace('channel:','').replace('@','').trim();
      setVideos(allVideos.filter(v => v.username === h)); setActiveTab('home'); return;
    }
    if (q.startsWith('video:')) {
      const id = q.match(/video:([^\s]+)/)?.[1];
      const t = allVideos.find(v => v.id === id);
      if (t) playVideo(t); return;
    }
    if (q.startsWith('playlist:')) {
      const nm = q.replace('playlist:','').trim();
      const pl = playlists.find(p => p.name.toLowerCase()===nm.toLowerCase());
      if (pl) { setVideos(allVideos.filter(v => pl.videos.includes(v.id))); setActiveTab('home'); } return;
    }
    setVideos(allVideos.filter(v => v.title?.toLowerCase().includes(q.toLowerCase())));
    setActiveTab('home');
  };
  const clearSearch = () => { setSearchQuery(''); setVideos(allVideos); };

  // ─── PLAYER ───────────────────────────────────────────────────────────────
  const playVideo = (video, startTime=0) => {
    if (video.settings) {
      try { const s = typeof video.settings==='string' ? JSON.parse(video.settings) : video.settings; if(s.isAdult && !adultContentAllowed) { alert('Контент 18+ скрыт.'); return; } } catch(_){}
    }
    setActiveVideo(video); setActiveTab('player'); setIsSubscribed(false);
    setTimeout(() => {
      if (!videoRef.current) return;
      if (video.blobData) { setIsOfflinePlayback(true); videoRef.current.src = URL.createObjectURL(video.blobData); }
      else { setIsOfflinePlayback(false); videoRef.current.src = `/api/video/${video.id}`; }
      videoRef.current.currentTime = startTime;
      videoRef.current.play().catch(()=>{});
      loadComments(video.id);
      actions.getChannelStats(video.username).then(s => { if(s) setChannelStats(plain1(s)||{}); });
      log(`▶ ${video.title}`);
    }, 100);
  };

  const loadComments = async (vidId) => {
    const res = await actions.getComments(vidId);
    if (res.success) setComments(plain(res.data));
  };

  // ─── WATCH TIMER ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeVideo && !isOfflinePlayback) {
      watchSecsRef.current = 0;
      watchTimerRef.current = setInterval(() => {
        watchSecsRef.current++;
        if (watchSecsRef.current % 30 === 0) actions.incrementViews(activeVideo.id);
      }, 1000);
    }
    return () => clearInterval(watchTimerRef.current);
  }, [activeVideo, isOfflinePlayback]);

  // ─── LIKE ─────────────────────────────────────────────────────────────────
  const handleLike = async (type) => {
    if (!isOnline || !activeVideo) return;
    const res = await actions.toggleLike(activeVideo.id, currentUsername, type);
    if (!res.success) return;
    setActiveVideo(prev => ({
      ...prev,
      likes:    type==='like'    ? ((prev.likes??0)    + (res.removed?-1:1)) : (prev.likes??0),
      dislikes: type==='dislike' ? ((prev.dislikes??0) + (res.removed?-1:1)) : (prev.dislikes??0),
    }));
    if (type==='like') {
      if (!res.removed) {
        setLikedIds(prev => new Set([...prev, activeVideo.id]));
        const pl = playlists.find(p => p.name==='Мне нравится');
        if (pl) await actions.addVideoToPlaylist(pl.id, activeVideo.id);
      } else {
        setLikedIds(prev => { const n=new Set(prev); n.delete(activeVideo.id); return n; });
      }
    }
  };

  const handleSubscribe = async () => {
    if (!activeVideo) return;
    const res = await actions.toggleSubscription(activeVideo.username, currentUsername);
    if (res.success) {
      setIsSubscribed(res.isSubscribed);
      setChannelStats(prev => ({ ...prev, subscribers: (prev.subscribers??0) + (res.isSubscribed?1:-1) }));
    }
  };

  // ─── COMMENT ──────────────────────────────────────────────────────────────
  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newCommentText.trim() || !isOnline || !activeVideo) return;
    const res = await actions.addComment(activeVideo.id, currentUsername, newCommentText);
    if (res.success) { setComments([plain1(res.data),...comments]); setNewCommentText(''); }
  };

  // ─── WATCH LATER ──────────────────────────────────────────────────────────
  const addToWatchLater = async (vidId) => {
    const pl = playlists.find(p => p.name==='Смотреть позже');
    if (!pl) return;
    await actions.addVideoToPlaylist(pl.id, vidId);
    await refreshPlaylists(currentUsername);
    log(`Добавлено в "Смотреть позже"`, 'ok');
    alert('✓ Добавлено в «Смотреть позже»');
  };

  // ─── PLAYLIST CREATE ──────────────────────────────────────────────────────
  const handleCreatePlaylist = async () => {
    const name = newPlName.trim();
    if (!name) return;
    if (playlists.some(p => p.name===name)) { alert('Такой плейлист уже есть!'); return; }
    log(`Создание "${name}"...`);
    await actions.createPlaylist(currentUsername, name, 0);
    await refreshPlaylists(currentUsername);
    log(`Плейлист "${name}" создан`, 'ok');
    setNewPlName(''); setShowCreateModal(false);
  };

  const handleAddVideoToPlaylist = async (plId) => {
    if (!addToPlVid) return;
    await actions.addVideoToPlaylist(plId, addToPlVid.id);
    await refreshPlaylists(currentUsername);
    log(`Видео добавлено в плейлист`, 'ok');
    setAddToPlVid(null);
    alert('✓ Добавлено');
  };

  // ─── UPLOAD / CONVERSION ──────────────────────────────────────────────────
  const handleSuperUpload = async (e) => {
    e.preventDefault();
    if (!selectedFile || !thumbnailFile || !title.trim()) { alert('Заполните все поля!'); return; }
    if (selectedFile.size > 100*1024*1024) {
      log(`Файл ${(selectedFile.size/1024/1024).toFixed(1)} МБ — режим очереди`, 'warn');
      setProcessStatus('Файл > 100МБ. Ожидание очереди...');
      setSpamTimer(180);
      const iv = setInterval(() => setSpamTimer(prev => { if(prev<=1){clearInterval(iv);executeConversion();return 0;} return prev-1; }), 1000);
      return;
    }
    executeConversion();
  };

  const executeConversion = async () => {
    setIsProcessing(true); setProcessPercent(0);
    try {
      if (!ffmpegRef.current.loaded) {
        setProcessStatus('Загрузка FFmpeg WASM...'); setProcessPercent(5);
        log('Загрузка FFmpeg WASM...');
        await ffmpegRef.current.load({
          coreURL: await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js','text/javascript'),
          wasmURL:  await toBlobURL('https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm','application/wasm'),
        });
        log('FFmpeg готов', 'ok');
      }
      const ff = ffmpegRef.current;

      setProcessStatus('Конвертация обложки → WebP...'); setProcessPercent(10);
      await ff.writeFile('thumb_in', await fetchFile(thumbnailFile));
      await ff.exec(['-i','thumb_in','-vf','scale=854:480','-c:v','libwebp','-quality','50','thumb_out.webp']);
      const thumbData = await ff.readFile('thumb_out.webp');
      const base64Thumb = await new Promise(res => { const r=new FileReader(); r.onloadend=()=>res(r.result); r.readAsDataURL(new Blob([thumbData],{type:'image/webp'})); });

      setProcessStatus('Анализ видео...'); setProcessPercent(15);
      await ff.writeFile('vid_in', await fetchFile(selectedFile));

      const presets = [
        ['-preset','ultrafast','-crf','35','-b:v','400k'],
        ['-preset','superfast','-crf','30','-b:v','600k'],
        ['-preset','veryfast', '-crf','28','-b:v','800k'],
      ];
      let bestSize=Infinity, bestIdx=0;
      for (let i=0; i<presets.length; i++) {
        setProcessStatus(`Тест пресета ${i+1}/3...`); setProcessPercent(20+i*15);
        log(`Тест пресета ${i+1}...`);
        await ff.exec(['-i','vid_in','-t','5','-c:v','libx264',...presets[i],`test_${i}.mp4`]);
        const td = await ff.readFile(`test_${i}.mp4`);
        if (td.byteLength < bestSize) { bestSize=td.byteLength; bestIdx=i; }
      }
      log(`Лучший пресет: ${bestIdx+1} (${(bestSize/1024).toFixed(0)} KB / 5s)`, 'ok');

      setProcessStatus(`Рендер (пресет ${bestIdx+1})...`); setProcessPercent(65);
      const vf = isShort ? 'scale=-2:854' : 'scale=854:480:force_original_aspect_ratio=decrease,pad=854:480:(ow-iw)/2:(oh-ih)/2';
      await ff.exec(['-i','vid_in','-vf',vf,'-c:v','libx264',...presets[bestIdx],'-c:a','aac','-b:a','64k','final.mp4']);
      setProcessPercent(85);

      const finalData = await ff.readFile('final.mp4');
      const videoBlob = new Blob([finalData],{type:'video/mp4'});
      log(`Рендер готов: ${(videoBlob.size/1024/1024).toFixed(2)} МБ`, 'ok');

      setProcessStatus('Запись в БД...'); setProcessPercent(88);
      const videoId = 'vid_'+Math.random().toString(36).substring(2,12);
      await actions.createVideoRecordEx(currentUsername, videoId, title, description, JSON.stringify(videoSettings), isShort?1:0);

      setProcessStatus('Выгрузка на сервер...'); setProcessPercent(93);
      const fd = new FormData();
      fd.append('file', videoBlob, `${videoId}.mp4`);
      const upRes = await fetch('/api/upload-native-video', { method:'POST', body:fd });
      if (!upRes.ok) throw new Error(`Upload HTTP ${upRes.status}`);

      setProcessPercent(100);
      log('Видео опубликовано!', 'ok');
      alert('✓ Видео успешно опубликовано!');
      setTitle(''); setDescription(''); setSelectedFile(null); setThumbnailFile(null);
      initApp(currentUsername); setActiveTab('home');

    } catch(err) {
      log('Ошибка конвертации: '+err.message, 'error');
      alert('Ошибка: '+err.message);
    } finally {
      setIsProcessing(false); setProcessPercent(0);
    }
  };

  const downloadForOffline = async (video) => {
    setIsProcessing(true); setProcessStatus(`Скачивание: ${video.title}...`);
    log(`Скачивание оффлайн: "${video.title}"...`);
    try {
      const res = await fetch(`/api/video/${video.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await saveVideoOffline({...video, isOfflineCopy:true, format:'mp4'}, blob);
      setDownloadedVideos(await getOfflineVideos());
      log(`"${video.title}" сохранено`, 'ok');
      alert('✓ Сохранено оффлайн!');
    } catch(err) { log('Ошибка скачивания: '+err.message,'error'); }
    finally { setIsProcessing(false); setProcessStatus(''); }
  };

  // ─── HW class ─────────────────────────────────────────────────────────────
  const hwClass = hwProfile==='very_weak'?'hw-lowest':hwProfile==='weak'?'hw-low':'';

  // ─── VideoCard component ──────────────────────────────────────────────────
  const VideoCard = ({ vid, onClick }) => (
    <div className="video-card" onClick={onClick}>
      <div className="thumbnail-box">
        <img src={vid.thumbnail||'/no-thumb.png'} alt={vid.title||'видео'} loading="lazy" />
        <span className="badge-time">{Number(vid.isShort)===1?'Short':'HD'}</span>
      </div>
      <div className="video-meta-grid">
        <div className="author-av-sm2">
          {vid.avatar ? <img src={vid.avatar} alt="av"/> : (vid.username||'?')[0].toUpperCase()}
        </div>
        <div className="text-info">
          <h4>{vid.title||'Без названия'}</h4>
          <p>{vid.username||'—'}</p>
          <p>{vid.views??0} просм.</p>
        </div>
        <button className="card-menu" onClick={e=>{e.stopPropagation();setAddToPlVid(vid);}} title="В плейлист">⋮</button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={`wt-app theme-${theme} ${hwClass}`}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="wt-header">
        <div className="hdr-left">
          <button className="burger-btn" onClick={()=>setSidebarOpen(v=>!v)}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="currentColor"><rect y="0" width="18" height="2" rx="1"/><rect y="6" width="18" height="2" rx="1"/><rect y="12" width="18" height="2" rx="1"/></svg>
          </button>
          <div className="logo-box" onClick={()=>{setActiveTab('home');setVideos(allVideos);setSearchQuery('');}}>
            <span>🌊</span><span className="logo-text">WavyTube</span>
          </div>
          {!isOnline && <span className="offline-pill">● ОФФЛАЙН</span>}
        </div>

        <form className="search-wrap" onSubmit={handleSearch}>
          <div className="search-field">
            <span className="search-ico">🔍</span>
            <input type="text" placeholder="Поиск видео, каналов…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} />
            {searchQuery && <button type="button" className="search-clear" onClick={clearSearch}>✕</button>}
          </div>
          <button type="submit" className="search-submit">Найти</button>
        </form>

        <div className="hdr-right">
          {isLoading && <span className="hdr-spinner"/>}
          <div className="user-chip" onClick={()=>setActiveTab('upload')} title={currentUsername}>
            {userAvatar ? <img src={userAvatar} alt="av"/> : currentUsername[0]?.toUpperCase()}
          </div>
        </div>
      </header>

      <div className="wt-body">

        {/* ── SIDEBAR ───────────────────────────────────────────────────────── */}
        <aside className={`wt-sidebar ${sidebarOpen?'open':'closed'}`}>
          <nav className="sb-inner">
            {isOnline && (
              <div className="sb-section">
                {[
                  ['home',      '🏠', 'Главная'],
                  ['shorts',    '⚡', 'Shorts'],
                  ['liked',     '👍', 'Понравилось'],
                  ['upload',    '📤', 'Студия'],
                  ['moika',     '🧹', 'Мойка'],
                ].map(([tab,ic,label]) => (
                  <button key={tab} className={`nav-item${activeTab===tab?' active':''}`}
                    onClick={()=>{setActiveTab(tab);if(tab==='home')setVideos(allVideos);}}>
                    <span className="ni-ic">{ic}</span>{label}
                  </button>
                ))}
              </div>
            )}

            <div className="sb-section">
              <div className="sb-label">МОЁ</div>
              <button className={`nav-item${activeTab==='downloads'?' active':''}`} onClick={()=>setActiveTab('downloads')}>
                <span className="ni-ic">💾</span>Скачанные
                {downloadedVideos.length>0 && <span className="nav-badge">{downloadedVideos.length}</span>}
              </button>
            </div>

            {isOnline && (
              <div className="sb-section">
                <div className="sb-label" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  ПЛЕЙЛИСТЫ
                  <button className="sb-plus" onClick={()=>setShowCreateModal(true)} title="Новый плейлист">＋</button>
                </div>
                {playlists.map(pl => (
                  <button key={pl.id} className="nav-item" style={{gap:8}} onClick={()=>{
                    setVideos(allVideos.filter(v=>pl.videos.includes(v.id)));
                    setActiveTab('home'); setSearchQuery(`playlist:${pl.name}`);
                  }}>
                    <span className="ni-ic">{Number(pl.is_system)===1?'🕒':'📁'}</span>
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{pl.name}</span>
                    {pl.videos.length>0 && <span className="nav-badge">{pl.videos.length}</span>}
                  </button>
                ))}
              </div>
            )}

            {isOnline && (
              <div className="sb-section">
                <div className="sb-label">ЖЕЛЕЗО</div>
                <select className="hw-select" value={hwProfile} onChange={e=>{setHwProfile(e.target.value);localStorage.setItem('wt_hwProfile',e.target.value);}}>
                  <option value="normal">🚀 Мощное</option>
                  <option value="weak">🐢 Слабое</option>
                  <option value="very_weak">🧮 Калькулятор</option>
                </select>
                <button className="nav-item" onClick={()=>{const v=!adultContentAllowed;setAdultContentAllowed(v);localStorage.setItem('wt_adult',String(v));}}>
                  <span className="ni-ic">🔞</span>18+: {adultContentAllowed?'ВКЛ':'ВЫКЛ'}
                </button>
                <button className="nav-item" onClick={()=>{const t=theme==='dark'?'light':'dark';setTheme(t);localStorage.setItem('wt_theme',t);}}>
                  <span className="ni-ic">{theme==='dark'?'🌙':'☀️'}</span>{theme==='dark'?'Тёмная':'Светлая'}
                </button>
              </div>
            )}
          </nav>
        </aside>

        {/* ── CONTENT ───────────────────────────────────────────────────────── */}
        <main className="wt-content" ref={playerContainerRef}>

          {/* Progress banner */}
          {(isProcessing||processStatus) && (
            <div className="progress-banner">
              <div className="pb-row"><span className="pb-spin"/><strong>{processStatus||'Обработка…'}</strong></div>
              {processPercent>0 && <div className="pb-track"><div className="pb-fill" style={{width:`${processPercent}%`}}/></div>}
            </div>
          )}

          {/* SKELETON */}
          {isLoading && activeTab==='home' && (
            <div className="grid-feed">
              {[...Array(6)].map((_,i) => (
                <div key={i} className="skel-card">
                  <div className="skel thumb"/>
                  <div className="skel line s"/>
                  <div className="skel line"/>
                </div>
              ))}
            </div>
          )}

          {/* HOME */}
          {activeTab==='home' && !isLoading && (
            videos.length===0
              ? <div className="empty"><div className="empty-ic">📭</div><p>Видео не найдено</p>{searchQuery&&<button className="pill-btn" onClick={clearSearch}>Очистить поиск</button>}</div>
              : <div className="grid-feed">{videos.map(v=><VideoCard key={v.id} vid={v} onClick={()=>playVideo(v)}/>)}</div>
          )}

          {/* SHORTS */}
          {activeTab==='shorts' && (
            <div>
              <h2 className="sec-title">⚡ Shorts</h2>
              {(() => { const s=allVideos.filter(v=>Number(v.isShort)===1); return s.length===0
                ? <div className="empty"><div className="empty-ic">⚡</div><p>Shorts пока нет</p></div>
                : <div className="shorts-row">{s.map(v=>(
                    <div key={v.id} className="short-card">
                      <img src={v.thumbnail||'/no-thumb.png'} alt="s" onClick={()=>playVideo(v)}/>
                      <div className="short-ov"><h4>{v.title}</h4><button className="play-short-btn" onClick={()=>playVideo(v)}>▶ Смотреть</button></div>
                    </div>))}</div>; })()}
            </div>
          )}

          {/* LIKED */}
          {activeTab==='liked' && (
            <div>
              <h2 className="sec-title">👍 Понравилось</h2>
              {(() => { const pl=playlists.find(p=>p.name==='Мне нравится'); const lv=pl?allVideos.filter(v=>pl.videos.includes(v.id)):[];
                return lv.length===0
                  ? <div className="empty"><div className="empty-ic">💔</div><p>Нет понравившихся</p></div>
                  : <div className="grid-feed">{lv.map(v=><VideoCard key={v.id} vid={v} onClick={()=>playVideo(v)}/>)}</div>;
              })()}
            </div>
          )}

          {/* DOWNLOADS */}
          {activeTab==='downloads' && (
            <div>
              <h2 className="sec-title">💾 Скачанные</h2>
              {downloadedVideos.length===0
                ? <div className="empty"><div className="empty-ic">📂</div><p>Нет оффлайн-видео</p></div>
                : <div className="grid-feed">{downloadedVideos.map(v=>(
                    <div key={v.id} className="video-card" onClick={()=>playVideo(v)}>
                      <div className="thumbnail-box"><img src={v.thumbnail||'/no-thumb.png'} alt="t"/><span className="badge-time badge-offline">ОФФЛАЙН</span></div>
                      <div className="text-info" style={{padding:'8px 4px'}}><h4>{v.title}</h4><p style={{color:'var(--green)'}}>Локально</p></div>
                    </div>))}</div>}
            </div>
          )}

          {/* PLAYER */}
          {activeTab==='player' && activeVideo && (
            <div className="player-layout">
              <div className="player-col">
                <div className="video-wrapper">
                  <video ref={videoRef} controls autoPlay className="main-video"
                    onLoadedMetadata={e=>setVideoDuration(e.target.duration)}/>
                  <div className="drag-logo"
                    style={{left:logoPos.x,top:logoPos.y,cursor:isDraggingLogo?'grabbing':'grab'}}
                    onMouseDown={e=>{setIsDraggingLogo(true);dragOffset.current={x:e.clientX-logoPos.x,y:e.clientY-logoPos.y};}}>
                    🌊 WavyTube
                  </div>
                </div>

                <div className="vid-details">
                  <h1>{activeVideo.title}</h1>

                  {isOfflinePlayback
                    ? <div className="offline-alert">🔒 Локальная копия</div>
                    : (
                      <div className="action-row">
                        <div className="author-block">
                          <div className="av-lg">{activeVideo.avatar?<img src={activeVideo.avatar} alt="av"/>:(activeVideo.username||'?')[0].toUpperCase()}</div>
                          <div>
                            <strong>{activeVideo.username}</strong>
                            <span className="subs-count">{channelStats.subscribers??0} подп.</span>
                          </div>
                          <button className={`sub-btn${isSubscribed?' subbed':''}`} onClick={handleSubscribe}>{isSubscribed?'✓ Подписан':'Подписаться'}</button>
                        </div>
                        <div className="pills-row">
                          <button className={`pill-btn${likedIds.has(activeVideo.id)?' pill-active':''}`} onClick={()=>handleLike('like')}>👍 {activeVideo.likes??0}</button>
                          <button className="pill-btn" onClick={()=>handleLike('dislike')}>👎 {activeVideo.dislikes??0}</button>
                          <button className="pill-btn" onClick={()=>addToWatchLater(activeVideo.id)}>⏱ Позже</button>
                          <button className="pill-btn" onClick={()=>setAddToPlVid(activeVideo)}>📁 Плейлист</button>
                          <button className="pill-btn" onClick={()=>downloadForOffline(activeVideo)}>📥 Скачать</button>
                        </div>
                      </div>
                    )}

                  <div className="desc-box">
                    <div className="desc-meta">
                      <span>{activeVideo.views??0} просмотров</span>
                      {videoDuration>0&&<span>{fmtSecs(videoDuration)}</span>}
                    </div>
                    <p>{activeVideo.description||'Описание отсутствует'}</p>
                  </div>

                  {!isOfflinePlayback && (
                    <div className="comments-block">
                      <h3>Комментарии ({comments.length})</h3>
                      <form onSubmit={handleAddComment} className="comment-form">
                        <div className="av-sm">{currentUsername[0]?.toUpperCase()}</div>
                        <input type="text" value={newCommentText} onChange={e=>setNewCommentText(e.target.value)} placeholder="Напишите комментарий…"/>
                        <button type="submit" disabled={!newCommentText.trim()}>Отправить</button>
                      </form>
                      {comments.map(c=>(
                        <div key={c.id} className="comment-item">
                          <div className="av-sm">{(c.username||'?')[0].toUpperCase()}</div>
                          <div><strong>{c.username}</strong><p>{c.text}</p></div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!isOfflinePlayback && (
                <aside className="recs-col">
                  <h3 className="recs-hdr">Далее</h3>
                  {recommended.filter(r=>r.id!==activeVideo.id).slice(0,15).map(v=>(
                    <div key={v.id} className="rec-card" onClick={()=>playVideo(v)}>
                      <img src={v.thumbnail||'/no-thumb.png'} alt="t" loading="lazy"/>
                      <div className="rec-texts"><h4>{v.title}</h4><p>{v.username}</p><p>{v.views??0} просм.</p></div>
                    </div>
                  ))}
                </aside>
              )}
            </div>
          )}

          {/* STUDIO */}
          {activeTab==='upload' && (
            <div className="studio-wrap">
              <div className="studio-card">
                <h2>🎬 Творческая студия</h2>
                <p className="studio-hint">FFmpeg WASM тестирует 3 пресета сжатия на первых 5 секундах и выбирает наименьший. Рендер происходит в браузере.</p>

                {spamTimer>0 && (
                  <div className="spam-box">⏳ Файл &gt;100МБ — очередь: {Math.floor(spamTimer/60)}:{String(spamTimer%60).padStart(2,'0')}</div>
                )}

                {isProcessing && (
                  <div className="process-card">
                    <div className="pb-row"><span className="pb-spin"/><strong>{processStatus}</strong></div>
                    <div className="pb-track" style={{marginTop:8}}><div className="pb-fill" style={{width:`${processPercent}%`}}/></div>
                    <p style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{processPercent}%</p>
                  </div>
                )}

                <form onSubmit={handleSuperUpload} className="upload-form">
                  <input className="wt-inp" type="text" placeholder="Название *" value={title} onChange={e=>setTitle(e.target.value)} required/>
                  <textarea className="wt-inp" placeholder="Описание" value={description} onChange={e=>setDescription(e.target.value)} rows={3}/>
                  <div className="file-grid">
                    <label className="file-label">
                      <span>🎥 Видео (MP4/MKV)</span>
                      <input type="file" accept="video/*" onChange={e=>setSelectedFile(e.target.files[0])} required/>
                      {selectedFile && <span className="file-name">{selectedFile.name} ({(selectedFile.size/1024/1024).toFixed(1)} МБ)</span>}
                    </label>
                    <label className="file-label">
                      <span>🖼 Обложка</span>
                      <input type="file" accept="image/*" onChange={e=>setThumbnailFile(e.target.files[0])} required/>
                      {thumbnailFile && <span className="file-name">{thumbnailFile.name}</span>}
                    </label>
                  </div>
                  <div className="toggle-row">
                    <label className="tog-lbl">
                      <input type="checkbox" checked={isShort} onChange={e=>setIsShort(e.target.checked)}/>
                      <span className="tog-track"/><span>Shorts</span>
                    </label>
                    <label className="tog-lbl">
                      <input type="checkbox" checked={videoSettings.isAdult} onChange={e=>setVideoSettings({...videoSettings,isAdult:e.target.checked})}/>
                      <span className="tog-track"/><span>Контент 18+</span>
                    </label>
                  </div>
                  <button type="submit" className="upload-btn" disabled={isProcessing||spamTimer>0}>
                    {isProcessing?'⏳ Рендер…':'🚀 Опубликовать'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* МОЙКА */}
          {activeTab==='moika' && (
            <div className="moika-wrap">
              <div className="moika-hdr">
                <h2>🧹 Мойка — Системный журнал</h2>
                <button className="pill-btn" onClick={()=>{_logBuf=[];setLogs([]);}}>Очистить</button>
              </div>

              <div className="stat-cards">
                {[
                  ['🎬', allVideos.length, 'Видео'],
                  ['📁', playlists.length, 'Плейлистов'],
                  ['💾', downloadedVideos.length, 'Оффлайн'],
                  [isOnline?'🟢':'🔴', isOnline?'Онлайн':'Офф.', 'Сеть'],
                  ['⚙️', hwProfile, 'Профиль'],
                ].map(([ic,val,lbl],i) => (
                  <div key={i} className="stat-card">
                    <div className="stat-ic">{ic}</div>
                    <div><strong>{val}</strong><span>{lbl}</span></div>
                  </div>
                ))}
              </div>

              {isProcessing && (
                <div className="moika-proc-box">
                  <div className="pb-row"><span className="pb-spin"/><strong>Обработка: {processStatus}</strong></div>
                  <div className="pb-track" style={{marginTop:6}}><div className="pb-fill" style={{width:`${processPercent}%`}}/></div>
                  <span style={{fontSize:12,color:'var(--text2)'}}>{processPercent}%</span>
                </div>
              )}

              <div className="log-box">
                <div className="log-hdr"><span>ЖУРНАЛ СОБЫТИЙ</span><span style={{fontSize:12,color:'var(--text2)'}}>{logs.length} записей</span></div>
                {logs.length===0 && <div className="log-empty">Пусто — выполните любое действие</div>}
                {logs.map(e=>(
                  <div key={e.id} className={`log-row log-${e.type}`}>
                    <span className="log-ts">{e.ts}</span>
                    <span className={`log-badge badge-${e.type}`}>{e.type.toUpperCase()}</span>
                    <span className="log-msg">{e.msg}</span>
                  </div>
                ))}
              </div>

              <div className="moika-actions">
                <button className="pill-btn" onClick={()=>initApp(currentUsername)}>🔄 Перезагрузить</button>
                <button className="pill-btn" onClick={()=>{log('Проверка таблиц…');actions.ensureVideoTables().then(()=>log('Таблицы ОК','ok'));}}>🔧 Проверить БД</button>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ── MODALS ──────────────────────────────────────────────────────────── */}
      {(showCreateModal || addToPlVid) && (
        <div className="modal-ov" onClick={e=>{if(e.target===e.currentTarget){setShowCreateModal(false);setAddToPlVid(null);}}}>
          <div className="modal-box">
            {showCreateModal && !addToPlVid ? (
              <>
                <h3>➕ Новый плейлист</h3>
                <input className="wt-inp" type="text" placeholder="Название" value={newPlName} onChange={e=>setNewPlName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleCreatePlaylist()} autoFocus/>
                <button className="upload-btn" style={{marginTop:0}} onClick={handleCreatePlaylist}>Создать</button>
                <button className="modal-close-btn" onClick={()=>{setShowCreateModal(false);setNewPlName('');}}>Отмена</button>
              </>
            ) : addToPlVid ? (
              <>
                <h3>📁 Добавить в плейлист</h3>
                <p style={{fontSize:13,color:'var(--text2)',margin:'4px 0 10px'}}>{addToPlVid.title}</p>
                {playlists.map(pl=>(
                  <button key={pl.id} className="modal-pl-btn" onClick={()=>handleAddVideoToPlaylist(pl.id)}>
                    {Number(pl.is_system)===1?'🕒':'📁'} {pl.name}
                    <span style={{float:'right',fontSize:11,color:'var(--text2)'}}>{pl.videos.length}</span>
                  </button>
                ))}
                <button className="modal-pl-btn" style={{color:'var(--accent)'}} onClick={()=>{setAddToPlVid(null);setShowCreateModal(true);}}>➕ Создать плейлист</button>
                <button className="modal-close-btn" onClick={()=>setAddToPlVid(null)}>Закрыть</button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* ── STYLES ──────────────────────────────────────────────────────────── */}
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

        /* ── Design tokens: Windows 11 25H2 + iOS 26 ── */
        :root {
          --bg:        #0a0a0f;
          --bg2:       #141418;
          --bg3:       #1c1c22;
          --glass:     rgba(20,20,26,0.75);
          --text1:     #f2f2f7;
          --text2:     #8e8e99;
          --accent:    #0a84ff;
          --accent2:   #0070e0;
          --green:     #32d74b;
          --red:       #ff453a;
          --border:    rgba(255,255,255,0.08);
          --border2:   rgba(255,255,255,0.14);
          --shadow:    0 8px 32px rgba(0,0,0,0.55);
          --shadow-sm: 0 2px 8px rgba(0,0,0,0.35);
          --blur:      blur(20px);
          --r-sm: 8px; --r-md: 14px; --r-lg: 20px; --r-xl: 28px;
          --h-hdr: 56px;
          --font: 'Inter', -apple-system, 'Segoe UI', Arial, sans-serif;
        }
        .theme-light {
          --bg: #f0f0f5; --bg2: #ffffff; --bg3: #e8e8ef;
          --glass: rgba(255,255,255,0.80);
          --text1: #1c1c1e; --text2: #636366;
          --border: rgba(0,0,0,0.07); --border2: rgba(0,0,0,0.13);
          --shadow: 0 8px 32px rgba(0,0,0,0.10);
        }

        /* HW degradation */
        .hw-lowest * { border-radius:0!important; box-shadow:none!important; animation:none!important; transition:none!important; backdrop-filter:none!important; }
        .hw-low * { box-shadow:none!important; animation:none!important; }

        /* Base */
        *,*::before,*::after { box-sizing:border-box; margin:0; padding:0; }
        body { background:var(--bg); color:var(--text1); font-family:var(--font); }
        img { display:block; max-width:100%; }
        button { font-family:var(--font); cursor:pointer; }

        /* App shell */
        .wt-app { display:flex; flex-direction:column; height:100vh; background:var(--bg); color:var(--text1); overflow:hidden; }

        /* ── Header (Win11 Mica effect) ── */
        .wt-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:0 16px; height:var(--h-hdr);
          background:var(--glass); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur);
          border-bottom:1px solid var(--border); position:sticky; top:0; z-index:200;
        }
        .hdr-left { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .burger-btn { background:none; border:none; color:var(--text1); width:36px; height:36px; border-radius:50%; display:flex; align-items:center; justify-content:center; transition:background 0.15s; }
        .burger-btn:hover { background:var(--bg3); }
        .logo-box { display:flex; align-items:center; gap:6px; cursor:pointer; user-select:none; font-size:18px; font-weight:700; letter-spacing:-0.3px; }
        .logo-text { font-size:18px; font-weight:700; }
        .offline-pill { background:var(--red); color:#fff; font-size:11px; font-weight:600; padding:3px 10px; border-radius:20px; }

        /* Search (iOS 26 pill) */
        .search-wrap { display:flex; gap:8px; width:42%; max-width:580px; }
        .search-field { flex:1; display:flex; align-items:center; gap:8px; background:var(--bg3); border:1px solid var(--border); border-radius:var(--r-xl); padding:0 14px; height:38px; transition:border-color 0.15s; }
        .search-field:focus-within { border-color:var(--accent); }
        .search-ico { font-size:14px; color:var(--text2); flex-shrink:0; }
        .search-field input { flex:1; background:none; border:none; color:var(--text1); font-size:14px; outline:none; font-family:var(--font); }
        .search-field input::placeholder { color:var(--text2); }
        .search-clear { background:none; border:none; color:var(--text2); font-size:13px; padding:0 2px; }
        .search-submit { background:var(--accent); color:#fff; border:none; padding:0 16px; height:38px; border-radius:var(--r-xl); font-size:13px; font-weight:600; transition:background 0.15s; white-space:nowrap; }
        .search-submit:hover { background:var(--accent2); }

        .hdr-right { display:flex; align-items:center; gap:10px; flex-shrink:0; }
        .hdr-spinner { width:18px; height:18px; border:2px solid var(--border2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; }
        @keyframes spin { to { transform:rotate(360deg); } }
        .user-chip { width:32px; height:32px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; overflow:hidden; cursor:pointer; border:2px solid var(--border2); transition:transform 0.15s; font-size:13px; }
        .user-chip:hover { transform:scale(1.08); }
        .user-chip img { width:100%; height:100%; object-fit:cover; }

        /* ── Body / sidebar ── */
        .wt-body { display:flex; flex:1; overflow:hidden; }
        .wt-sidebar { background:var(--glass); backdrop-filter:var(--blur); -webkit-backdrop-filter:var(--blur); border-right:1px solid var(--border); transition:width 0.22s cubic-bezier(.4,0,.2,1); overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; }
        .wt-sidebar.open  { width:248px; }
        .wt-sidebar.closed { width:0; }
        .sb-inner { width:248px; padding:10px 8px; }
        .sb-section { margin-bottom:6px; }
        .sb-label { font-size:11px; font-weight:600; color:var(--text2); padding:8px 12px 4px; letter-spacing:.6px; text-transform:uppercase; display:flex; justify-content:space-between; align-items:center; }
        .sb-plus { background:none; border:none; color:var(--accent); font-size:18px; cursor:pointer; border-radius:6px; padding:0 4px; transition:background 0.15s; }
        .sb-plus:hover { background:rgba(10,132,255,.12); }
        .nav-item { display:flex; align-items:center; width:100%; padding:9px 12px; background:none; border:none; color:var(--text1); text-align:left; border-radius:var(--r-md); cursor:pointer; font-size:14px; font-weight:500; gap:10px; transition:background 0.13s; }
        .nav-item:hover { background:var(--bg3); }
        .nav-item.active { background:rgba(10,132,255,.14); color:var(--accent); font-weight:600; }
        .ni-ic { font-size:16px; flex-shrink:0; }
        .nav-badge { margin-left:auto; background:var(--accent); color:#fff; font-size:11px; font-weight:700; padding:1px 7px; border-radius:20px; min-width:20px; text-align:center; }
        .hw-select { width:100%; background:var(--bg3); color:var(--text1); border:1px solid var(--border); padding:9px 10px; border-radius:var(--r-md); margin:4px 0; font-family:var(--font); font-size:13px; appearance:none; cursor:pointer; }

        /* ── Content area ── */
        .wt-content { flex:1; overflow-y:auto; padding:24px; background:var(--bg); scrollbar-width:thin; }

        /* ── Progress banner ── */
        .progress-banner { background:var(--bg3); border:1px solid var(--accent); border-radius:var(--r-md); padding:14px 16px; margin-bottom:20px; }
        .pb-row { display:flex; align-items:center; gap:10px; }
        .pb-spin { width:16px; height:16px; border:2px solid var(--border2); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; flex-shrink:0; }
        .pb-track { height:4px; background:var(--border); border-radius:4px; margin-top:10px; overflow:hidden; }
        .pb-fill  { height:100%; background:linear-gradient(90deg,var(--accent),var(--green)); border-radius:4px; transition:width 0.35s ease; }

        /* ── Skeleton ── */
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .skel-card { display:flex; flex-direction:column; gap:10px; }
        .skel { background:linear-gradient(90deg,var(--bg3) 25%,var(--bg2) 50%,var(--bg3) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; border-radius:var(--r-md); }
        .skel.thumb { aspect-ratio:16/9; width:100%; }
        .skel.line  { height:13px; width:100%; border-radius:4px; }
        .skel.line.s { width:60%; }

        /* ── Video grid ── */
        .grid-feed { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:24px 16px; }
        .video-card { display:flex; flex-direction:column; gap:10px; cursor:pointer; border-radius:var(--r-lg); overflow:hidden; transition:transform 0.15s; }
        .video-card:hover { transform:translateY(-3px); }
        .thumbnail-box { position:relative; width:100%; aspect-ratio:16/9; border-radius:var(--r-md); overflow:hidden; background:var(--bg3); }
        .thumbnail-box img { width:100%; height:100%; object-fit:cover; transition:transform 0.22s; }
        .video-card:hover .thumbnail-box img { transform:scale(1.04); }
        .badge-time { position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.75); color:#fff; padding:2px 6px; border-radius:6px; font-size:11px; font-weight:600; backdrop-filter:blur(4px); }
        .badge-offline { background:rgba(50,215,75,.85); color:#000; }
        .video-meta-grid { display:flex; gap:10px; align-items:flex-start; padding:0 4px 4px; }
        .author-av-sm2 { width:34px; height:34px; background:var(--bg3); border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; flex-shrink:0; overflow:hidden; font-size:13px; }
        .author-av-sm2 img { width:100%; height:100%; object-fit:cover; }
        .text-info { flex:1; min-width:0; }
        .text-info h4 { margin:0 0 3px; font-size:14px; font-weight:600; line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        .text-info p  { margin:0; font-size:12px; color:var(--text2); }
        .card-menu { background:none; border:none; color:var(--text2); font-size:20px; padding:2px 4px; border-radius:6px; opacity:0; transition:opacity 0.15s; flex-shrink:0; align-self:center; }
        .video-card:hover .card-menu { opacity:1; }

        /* ── Shorts ── */
        .sec-title { font-size:20px; font-weight:700; margin-bottom:20px; }
        .shorts-row { display:flex; gap:16px; overflow-x:auto; padding-bottom:16px; scrollbar-width:thin; }
        .short-card { width:220px; height:390px; border-radius:var(--r-xl); position:relative; overflow:hidden; flex-shrink:0; border:1px solid var(--border); cursor:pointer; }
        .short-card img { width:100%; height:100%; object-fit:cover; }
        .short-ov { position:absolute; bottom:0; left:0; right:0; padding:16px; background:linear-gradient(transparent,rgba(0,0,0,.88)); }
        .short-ov h4 { margin:0 0 8px; font-size:14px; font-weight:600; }
        .play-short-btn { width:100%; background:rgba(255,255,255,.95); color:#000; border:none; padding:9px; border-radius:20px; font-weight:700; font-size:13px; }

        /* ── Player ── */
        .player-layout { display:flex; gap:24px; }
        .player-col  { flex:1; min-width:0; }
        .recs-col    { width:370px; flex-shrink:0; }
        .recs-hdr    { font-size:16px; font-weight:600; margin-bottom:14px; }
        .video-wrapper { position:relative; width:100%; aspect-ratio:16/9; background:#000; border-radius:var(--r-lg); overflow:hidden; box-shadow:var(--shadow); }
        .main-video  { width:100%; height:100%; outline:none; }
        .drag-logo   { position:absolute; background:rgba(0,0,0,.55); backdrop-filter:blur(6px); padding:4px 10px; border-radius:var(--r-sm); font-size:12px; font-weight:700; z-index:10; user-select:none; color:#fff; }
        .vid-details { margin-top:16px; }
        .vid-details h1 { font-size:20px; font-weight:700; margin-bottom:14px; line-height:1.3; }
        .offline-alert { background:rgba(255,170,0,.10); border:1px solid rgba(255,170,0,.3); color:#ffaa00; padding:12px 16px; border-radius:var(--r-md); font-size:14px; font-weight:600; }
        .action-row { display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; padding-bottom:14px; border-bottom:1px solid var(--border); }
        .author-block { display:flex; align-items:center; gap:12px; }
        .av-lg { width:44px; height:44px; background:var(--bg3); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:700; color:#fff; overflow:hidden; flex-shrink:0; }
        .av-lg img { width:100%; height:100%; object-fit:cover; }
        .author-block strong { display:block; font-size:15px; font-weight:600; }
        .subs-count { display:block; font-size:12px; color:var(--text2); margin-top:2px; }
        .sub-btn { background:var(--text1); color:var(--bg); border:none; padding:8px 18px; border-radius:20px; font-weight:700; font-size:13px; transition:0.15s; }
        .sub-btn.subbed { background:var(--bg3); color:var(--text1); border:1px solid var(--border2); }
        .pills-row { display:flex; flex-wrap:wrap; gap:8px; }
        .pill-btn { background:var(--bg3); color:var(--text1); border:1px solid var(--border); padding:8px 16px; border-radius:20px; font-size:13px; font-weight:500; transition:0.13s; }
        .pill-btn:hover { background:var(--glass); border-color:var(--border2); }
        .pill-active { background:rgba(10,132,255,.14)!important; border-color:var(--accent)!important; color:var(--accent)!important; }
        .desc-box { background:var(--bg2); border:1px solid var(--border); padding:14px 16px; border-radius:var(--r-md); margin-top:14px; font-size:14px; line-height:1.6; }
        .desc-meta { display:flex; gap:14px; color:var(--text2); font-size:13px; font-weight:500; }
        .desc-box p { margin-top:8px; }
        .comments-block { margin-top:24px; }
        .comments-block h3 { font-size:16px; font-weight:600; margin-bottom:14px; }
        .comment-form { display:flex; gap:10px; margin-bottom:20px; align-items:center; }
        .av-sm { width:30px; height:30px; background:var(--accent); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:#fff; flex-shrink:0; }
        .comment-form input { flex:1; background:transparent; border:none; border-bottom:1px solid var(--border2); color:var(--text1); outline:none; padding:6px 0; font-family:var(--font); font-size:14px; }
        .comment-form button { background:var(--accent); color:#fff; border:none; padding:8px 16px; border-radius:16px; font-weight:600; font-size:13px; transition:0.13s; }
        .comment-form button:disabled { opacity:.4; cursor:not-allowed; }
        .comment-item { display:flex; gap:10px; margin-bottom:14px; font-size:14px; }
        .comment-item strong { font-size:13px; font-weight:600; display:block; margin-bottom:2px; }
        .comment-item p { color:var(--text2); margin:0; line-height:1.5; }
        .rec-card { display:flex; gap:10px; cursor:pointer; margin-bottom:12px; border-radius:var(--r-md); padding:6px; transition:background 0.13s; }
        .rec-card:hover { background:var(--bg3); }
        .rec-card img { width:148px; height:83px; border-radius:var(--r-sm); object-fit:cover; flex-shrink:0; }
        .rec-texts h4 { margin:0 0 4px; font-size:13px; font-weight:600; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4; }
        .rec-texts p  { margin:0; font-size:12px; color:var(--text2); }

        /* ── Studio ── */
        .studio-wrap { max-width:700px; margin:0 auto; }
        .studio-card { background:var(--bg2); border:1px solid var(--border); border-radius:var(--r-xl); padding:32px; }
        .studio-card h2 { font-size:22px; font-weight:700; margin-bottom:6px; }
        .studio-hint { color:var(--text2); font-size:13px; margin-bottom:24px; line-height:1.5; }
        .spam-box { background:rgba(255,69,58,.10); border:1px solid rgba(255,69,58,.3); color:var(--red); padding:12px 16px; border-radius:var(--r-md); margin-bottom:16px; font-weight:600; font-size:14px; }
        .process-card { background:var(--bg3); border:1px solid var(--border); border-radius:var(--r-md); padding:14px 16px; margin-bottom:20px; }
        .upload-form { display:flex; flex-direction:column; gap:14px; margin-top:20px; }
        .wt-inp { background:var(--bg); border:1px solid var(--border); color:var(--text1); padding:12px 14px; border-radius:var(--r-md); font-family:var(--font); font-size:14px; width:100%; transition:border-color 0.15s; outline:none; resize:vertical; }
        .wt-inp:focus { border-color:var(--accent); }
        .file-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
        .file-label { display:flex; flex-direction:column; gap:6px; background:var(--bg); border:1.5px dashed var(--border2); border-radius:var(--r-md); padding:14px; font-size:13px; color:var(--text2); cursor:pointer; transition:border-color 0.15s; }
        .file-label:hover { border-color:var(--accent); }
        .file-label input[type="file"] { display:none; }
        .file-name { font-size:11px; color:var(--accent); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .toggle-row { display:flex; gap:24px; flex-wrap:wrap; }
        .tog-lbl { display:flex; align-items:center; gap:10px; cursor:pointer; font-size:14px; user-select:none; }
        .tog-lbl input[type="checkbox"] { display:none; }
        .tog-track { width:40px; height:24px; background:var(--bg3); border-radius:12px; position:relative; transition:background .2s; border:1px solid var(--border); flex-shrink:0; }
        .tog-track::after { content:''; position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:50%; background:var(--text2); transition:left .2s, background .2s; }
        .tog-lbl input:checked + .tog-track { background:var(--accent); border-color:var(--accent); }
        .tog-lbl input:checked + .tog-track::after { left:19px; background:#fff; }
        .upload-btn { background:var(--accent); color:#fff; font-weight:700; padding:14px; border:none; border-radius:var(--r-md); font-size:15px; transition:0.15s; margin-top:4px; }
        .upload-btn:hover:not(:disabled) { background:var(--accent2); }
        .upload-btn:disabled { opacity:.45; cursor:not-allowed; }

        /* ── Мойка ── */
        .moika-wrap { max-width:900px; }
        .moika-hdr { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
        .moika-hdr h2 { font-size:22px; font-weight:700; }
        .stat-cards { display:flex; flex-wrap:wrap; gap:12px; margin-bottom:24px; }
        .stat-card { display:flex; align-items:center; gap:12px; background:var(--bg2); border:1px solid var(--border); border-radius:var(--r-lg); padding:14px 18px; flex:1; min-width:120px; }
        .stat-ic { font-size:24px; }
        .stat-card strong { display:block; font-size:18px; font-weight:700; }
        .stat-card span { font-size:12px; color:var(--text2); }
        .moika-proc-box { background:var(--bg3); border:1px solid var(--accent); border-radius:var(--r-md); padding:14px; margin-bottom:20px; }
        .log-box { background:var(--bg2); border:1px solid var(--border); border-radius:var(--r-md); overflow:hidden; margin-bottom:16px; max-height:400px; overflow-y:auto; scrollbar-width:thin; }
        .log-hdr { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--border); font-size:11px; font-weight:600; color:var(--text2); letter-spacing:.5px; position:sticky; top:0; background:var(--bg2); }
        .log-empty { padding:24px; text-align:center; color:var(--text2); font-size:14px; }
        .log-row { display:flex; align-items:baseline; gap:8px; padding:7px 14px; border-bottom:1px solid rgba(255,255,255,.03); font-size:12px; font-family:'SF Mono','Fira Code',monospace; }
        .log-row:last-child { border-bottom:none; }
        .log-info  { color:var(--text1); }
        .log-ok    { color:var(--green); }
        .log-error { color:var(--red); }
        .log-warn  { color:#ff9f0a; }
        .log-ts    { color:var(--text2); font-size:10px; flex-shrink:0; }
        .log-badge { font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; flex-shrink:0; background:var(--bg3); }
        .log-msg   { flex:1; word-break:break-word; }
        .moika-actions { display:flex; flex-wrap:wrap; gap:10px; }

        /* ── Empty state ── */
        .empty { text-align:center; padding:60px 20px; color:var(--text2); }
        .empty-ic { font-size:48px; margin-bottom:12px; }
        .empty p  { font-size:16px; margin-bottom:16px; }

        /* ── Modal ── */
        .modal-ov { position:fixed; inset:0; background:rgba(0,0,0,.6); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); display:flex; align-items:center; justify-content:center; z-index:2000; }
        .modal-box { background:var(--bg3); border:1px solid var(--border2); border-radius:var(--r-xl); padding:24px; width:340px; max-width:92vw; display:flex; flex-direction:column; gap:10px; box-shadow:var(--shadow); }
        .modal-box h3 { font-size:17px; font-weight:700; }
        .modal-pl-btn { background:var(--bg); border:1px solid var(--border); color:var(--text1); padding:11px 14px; border-radius:var(--r-md); cursor:pointer; text-align:left; font-size:14px; font-weight:500; transition:background 0.13s; }
        .modal-pl-btn:hover { background:var(--glass); }
        .modal-close-btn { background:rgba(255,69,58,.12); color:var(--red); border:1px solid rgba(255,69,58,.2); padding:11px; border-radius:var(--r-md); cursor:pointer; font-weight:600; transition:0.13s; }
        .modal-close-btn:hover { background:rgba(255,69,58,.22); }

        /* ── Scrollbar ── */
        ::-webkit-scrollbar { width:5px; height:5px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:var(--border2); border-radius:4px; }

        /* ── Responsive ── */
        @media(max-width:960px) {
          .wt-sidebar.open { position:fixed; top:var(--h-hdr); bottom:0; z-index:150; }
          .player-layout { flex-direction:column; }
          .recs-col { width:100%; }
          .search-wrap { width:55%; }
          .file-grid { grid-template-columns:1fr; }
        }
        @media(max-width:600px) {
          .wt-content { padding:14px; }
          .grid-feed { grid-template-columns:1fr; }
          .search-wrap { width:100%; }
          .logo-text { display:none; }
          .stat-card { min-width:calc(50% - 6px); flex:none; }
        }
      `}</style>
    </div>
  );
}
