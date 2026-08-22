'use client';
import { useState, useEffect, useRef } from 'react';
import { uploadTrack, getMusicFeed, getTrackAudio, registerPlay, toggleTrackLike, getMyTrackLikes, deleteTrack } from '../actions';
import { compressImageToJPEG } from '../lib/imageUpload';

const fmtDuration = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
};

export default function WavyMusic() {
    const [username, setUsername] = useState(null);
    const [tracks, setTracks] = useState(null);
    const [likedIds, setLikedIds] = useState(new Set());
    const [uploadOpen, setUploadOpen] = useState(false);

    const [activeTrack, setActiveTrack] = useState(null); // {id, title, artist, cover, duration}
    const [activeIndex, setActiveIndex] = useState(-1);
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0); // 0..1
    const [currentTime, setCurrentTime] = useState(0);
    const [audioLoading, setAudioLoading] = useState(false);

    const audioRef = useRef(null);
    const playedRegisteredRef = useRef(false);

    useEffect(() => { setUsername(localStorage.getItem('p_user')); }, []);

    const load = async () => {
        const list = await getMusicFeed();
        setTracks(list);
    };
    useEffect(() => { load(); }, []);

    useEffect(() => {
        if (!username) return;
        getMyTrackLikes(username).then(ids => setLikedIds(new Set(ids)));
    }, [username]);

    // ── Воспроизведение ──────────────────────────────────────────────────
    const playTrackAt = async (index) => {
        if (!tracks || !tracks[index]) return;
        const t = tracks[index];
        setActiveIndex(index);
        setActiveTrack(t);
        setAudioLoading(true);
        playedRegisteredRef.current = false;
        const audioData = await getTrackAudio(t.id);
        setAudioLoading(false);
        if (!audioData || !audioRef.current) return;
        audioRef.current.src = audioData;
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
    };

    const togglePlayPause = () => {
        if (!audioRef.current || !activeTrack) return;
        if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
        else { audioRef.current.play().catch(() => {}); setIsPlaying(true); }
    };

    const playNext = () => {
        if (!tracks || activeIndex < 0) return;
        const next = (activeIndex + 1) % tracks.length;
        playTrackAt(next);
    };
    const playPrev = () => {
        if (!tracks || activeIndex < 0) return;
        const prev = (activeIndex - 1 + tracks.length) % tracks.length;
        playTrackAt(prev);
    };

    // ── Media Session API — управление с наушников / блокировки экрана ────
    useEffect(() => {
        if (!('mediaSession' in navigator) || !activeTrack) return;
        navigator.mediaSession.metadata = new window.MediaMetadata({
            title: activeTrack.title,
            artist: activeTrack.artist || activeTrack.username,
            artwork: activeTrack.cover ? [{ src: activeTrack.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
        });
        navigator.mediaSession.setActionHandler('play', () => { audioRef.current?.play(); setIsPlaying(true); });
        navigator.mediaSession.setActionHandler('pause', () => { audioRef.current?.pause(); setIsPlaying(false); });
        navigator.mediaSession.setActionHandler('previoustrack', playPrev);
        navigator.mediaSession.setActionHandler('nexttrack', playNext);
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (audioRef.current && details.seekTime != null) audioRef.current.currentTime = details.seekTime;
        });
        return () => {
            ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'].forEach(a => {
                try { navigator.mediaSession.setActionHandler(a, null); } catch (e) {}
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTrack, activeIndex, tracks]);

    useEffect(() => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }, [isPlaying]);

    const handleTimeUpdate = () => {
        const a = audioRef.current;
        if (!a || !a.duration) return;
        setCurrentTime(a.currentTime);
        setProgress(a.currentTime / a.duration);
        // Засчитываем прослушивание один раз, после 30% трека или 20 сек — что раньше.
        if (!playedRegisteredRef.current && (a.currentTime > 20 || a.currentTime / a.duration > 0.3)) {
            playedRegisteredRef.current = true;
            registerPlay(activeTrack.id);
        }
    };

    const handleSeek = (e) => {
        const a = audioRef.current;
        if (!a || !a.duration) return;
        const ratio = Number(e.target.value);
        a.currentTime = ratio * a.duration;
        setProgress(ratio);
    };

    const handleLike = async (trackId) => {
        if (!username) return alert('Войдите в аккаунт, чтобы лайкать треки');
        const res = await toggleTrackLike(username, trackId);
        if (res?.success === false) return;
        setLikedIds(prev => {
            const next = new Set(prev);
            if (res.liked) next.add(trackId); else next.delete(trackId);
            return next;
        });
        setTracks(prev => prev.map(t => t.id === trackId ? { ...t, likes: t.likes + (res.liked ? 1 : -1) } : t));
    };

    const handleDelete = async (trackId) => {
        if (!confirm('Удалить трек?')) return;
        const res = await deleteTrack(username, trackId);
        if (res?.success === false) return alert('Не удалось удалить: ' + (res.error || 'нет доступа'));
        if (activeTrack?.id === trackId) { audioRef.current?.pause(); setActiveTrack(null); setIsPlaying(false); }
        load();
    };

    return (
        <div className="wm-root">
            <header className="wm-header">
                <h1>🎵 WavyMusic</h1>
                {username && <button className="wm-upload-btn" onClick={() => setUploadOpen(true)}>+ Загрузить</button>}
            </header>

            <div className="wm-list">
                {tracks === null && <p className="wm-empty">Загрузка…</p>}
                {tracks?.length === 0 && <p className="wm-empty">Пока нет треков — загрузи первый!</p>}
                {tracks?.map((t, i) => (
                    <div key={t.id} className={`wm-track-row ${activeTrack?.id === t.id ? 'active' : ''}`}>
                        <button className="wm-track-cover" onClick={() => playTrackAt(i)}>
                            {t.cover ? <img src={t.cover} alt="" /> : <span>🎵</span>}
                            <span className="wm-play-overlay">{activeTrack?.id === t.id && isPlaying ? '⏸' : '▶'}</span>
                        </button>
                        <div className="wm-track-info" onClick={() => playTrackAt(i)}>
                            <div className="wm-track-title">{t.title}</div>
                            <div className="wm-track-artist">{t.artist || t.username}</div>
                        </div>
                        <div className="wm-track-meta">
                            <span>{fmtDuration(t.duration)}</span>
                            <button className={`wm-like-btn ${likedIds.has(t.id) ? 'liked' : ''}`} onClick={() => handleLike(t.id)}>
                                {likedIds.has(t.id) ? '❤️' : '🤍'} {t.likes}
                            </button>
                            {username === t.username && (
                                <button className="wm-del-btn" onClick={() => handleDelete(t.id)}>🗑️</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Нижний плеер — прилипает к низу, приоритет на удобство на телефоне (крупные зоны нажатия) */}
            {activeTrack && (
                <div className="wm-player-bar">
                    <div className="wm-player-progress">
                        <input type="range" min={0} max={1} step={0.001} value={progress || 0} onChange={handleSeek} />
                    </div>
                    <div className="wm-player-row">
                        <div className="wm-player-cover">
                            {activeTrack.cover ? <img src={activeTrack.cover} alt="" /> : <span>🎵</span>}
                        </div>
                        <div className="wm-player-info">
                            <div className="wm-player-title">{activeTrack.title}</div>
                            <div className="wm-player-artist">{activeTrack.artist || activeTrack.username}</div>
                        </div>
                        <div className="wm-player-time">{fmtDuration(currentTime)}</div>
                        <div className="wm-player-controls">
                            <button onClick={playPrev}>⏮</button>
                            <button className="wm-player-playbtn" onClick={togglePlayPause} disabled={audioLoading}>
                                {audioLoading ? '…' : (isPlaying ? '⏸' : '▶')}
                            </button>
                            <button onClick={playNext}>⏭</button>
                        </div>
                    </div>
                </div>
            )}

            <audio
                ref={audioRef}
                onTimeUpdate={handleTimeUpdate}
                onEnded={playNext}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />

            {uploadOpen && (
                <UploadModal
                    username={username}
                    onClose={() => setUploadOpen(false)}
                    onUploaded={() => { setUploadOpen(false); load(); }}
                />
            )}

            <style jsx global>{`
                .wm-root {
                    min-height: 100vh; background: #0a0a0d; color: #f0f0f2;
                    font-family: -apple-system, 'Segoe UI', sans-serif;
                    padding: 16px 16px 110px; /* место снизу под плеер */
                    box-sizing: border-box;
                }
                .wm-header { display: flex; justify-content: space-between; align-items: center; padding: 70px 0 16px; }
                .wm-header h1 { margin: 0; font-size: 22px; }
                .wm-upload-btn { background: #a239ff; color: #fff; border: none; border-radius: 20px; padding: 10px 18px; font-weight: 600; cursor: pointer; font-size: 13px; }

                .wm-list { display: flex; flex-direction: column; gap: 8px; max-width: 700px; margin: 0 auto; }
                .wm-empty { text-align: center; opacity: 0.5; padding: 40px 0; }

                .wm-track-row {
                    display: flex; align-items: center; gap: 12px;
                    background: #131318; border-radius: 12px; padding: 8px; cursor: pointer;
                }
                .wm-track-row.active { background: rgba(162,57,255,0.15); }
                .wm-track-cover {
                    position: relative; width: 52px; height: 52px; flex-shrink: 0; border-radius: 8px; overflow: hidden;
                    background: #222; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 22px;
                }
                .wm-track-cover img { width: 100%; height: 100%; object-fit: cover; }
                .wm-play-overlay {
                    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                    background: rgba(0,0,0,0.35); color: #fff; font-size: 18px; opacity: 0;
                }
                .wm-track-cover:hover .wm-play-overlay, .wm-track-row.active .wm-play-overlay { opacity: 1; }

                .wm-track-info { flex: 1; min-width: 0; }
                .wm-track-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .wm-track-artist { font-size: 12px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

                .wm-track-meta { display: flex; align-items: center; gap: 10px; font-size: 12px; opacity: 0.8; flex-shrink: 0; }
                .wm-like-btn, .wm-del-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 13px; padding: 6px; }
                .wm-like-btn.liked { color: #ff4d6d; }

                /* ── Нижний плеер: mobile-first — большие зоны нажатия, компактно ── */
                .wm-player-bar {
                    position: fixed; left: 0; right: 0; bottom: 0; z-index: 500;
                    background: rgba(15,15,20,0.97); backdrop-filter: blur(12px);
                    border-top: 1px solid rgba(255,255,255,0.08);
                    padding-bottom: env(safe-area-inset-bottom, 0px);
                }
                .wm-player-progress input[type="range"] { width: 100%; margin: 0; display: block; accent-color: #a239ff; }
                .wm-player-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
                .wm-player-cover { width: 40px; height: 40px; border-radius: 8px; overflow: hidden; background: #222; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
                .wm-player-cover img { width: 100%; height: 100%; object-fit: cover; }
                .wm-player-info { flex: 1; min-width: 0; }
                .wm-player-title { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .wm-player-artist { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .wm-player-time { font-size: 11px; opacity: 0.6; flex-shrink: 0; display: none; }
                .wm-player-controls { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
                .wm-player-controls button {
                    background: none; border: none; color: #fff; cursor: pointer;
                    width: 40px; height: 40px; font-size: 18px; display: flex; align-items: center; justify-content: center;
                }
                .wm-player-playbtn {
                    background: #a239ff !important; border-radius: 50%; width: 44px !important; height: 44px !important; font-size: 17px !important;
                }

                @media (min-width: 700px) {
                    .wm-player-time { display: block; }
                    .wm-player-row { padding: 10px 20px; }
                }
            `}</style>
        </div>
    );
}

function UploadModal({ username, onClose, onUploaded }) {
    const [title, setTitle] = useState('');
    const [artist, setArtist] = useState('');
    const [audioFile, setAudioFile] = useState(null);
    const [audioDataUrl, setAudioDataUrl] = useState(null);
    const [duration, setDuration] = useState(0);
    const [cover, setCover] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState(null);

    const handleAudioPick = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setAudioFile(file);
        const reader = new FileReader();
        reader.onload = () => {
            setAudioDataUrl(reader.result);
            const tempAudio = new Audio();
            tempAudio.src = reader.result;
            tempAudio.addEventListener('loadedmetadata', () => setDuration(tempAudio.duration || 0));
        };
        reader.readAsDataURL(file);
    };

    const handleCoverPick = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const { dataUrl } = await compressImageToJPEG(file);
            setCover(dataUrl);
        } catch (err) {
            setError('Не удалось обработать обложку: ' + err.message);
        }
    };

    const submit = async () => {
        if (!title.trim()) return setError('Укажи название трека');
        if (!audioDataUrl) return setError('Выбери аудиофайл');
        setUploading(true);
        setError(null);
        try {
            const res = await uploadTrack(username, { title: title.trim(), artist: artist.trim(), cover, audioData: audioDataUrl, duration });
            if (res?.success === false) { setError(res.error || 'Не удалось загрузить'); return; }
            onUploaded();
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="wm-modal-overlay" onClick={onClose}>
            <div className="wm-modal" onClick={e => e.stopPropagation()}>
                <div className="wm-modal-head">
                    <b>Загрузить трек</b>
                    <button onClick={onClose}>✕</button>
                </div>
                <div className="wm-modal-body">
                    <label className="wm-field-label">Название</label>
                    <input className="wm-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Название трека" />

                    <label className="wm-field-label">Исполнитель</label>
                    <input className="wm-input" value={artist} onChange={e => setArtist(e.target.value)} placeholder={username || 'исполнитель'} />

                    <label className="wm-field-label">Аудиофайл</label>
                    <input className="wm-input" type="file" accept="audio/*" onChange={handleAudioPick} />
                    {audioFile && <div className="wm-file-hint">{audioFile.name} · {duration ? `${Math.round(duration)} сек` : '…'}</div>}

                    <label className="wm-field-label">Обложка (необязательно)</label>
                    <input className="wm-input" type="file" accept="image/*" onChange={handleCoverPick} />
                    {cover && <img src={cover} alt="" className="wm-cover-preview" />}

                    {error && <div className="wm-error">{error}</div>}
                </div>
                <div className="wm-modal-foot">
                    <button className="wm-btn-cancel" onClick={onClose}>Отмена</button>
                    <button className="wm-btn-submit" onClick={submit} disabled={uploading}>{uploading ? 'Загружаю…' : 'Опубликовать'}</button>
                </div>
            </div>

            <style jsx global>{`
                .wm-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
                .wm-modal { background: #131318; border-radius: 16px; width: 100%; max-width: 420px; max-height: 90vh; overflow-y: auto; color: #fff; }
                .wm-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,0.08); }
                .wm-modal-head button { background: none; border: none; color: #fff; font-size: 16px; cursor: pointer; }
                .wm-modal-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; }
                .wm-field-label { font-size: 11px; opacity: 0.6; margin: 10px 0 4px; }
                .wm-input { background: #1c1c22; border: 1px solid #2a2a33; color: #fff; padding: 10px 12px; border-radius: 8px; font-size: 14px; outline: none; }
                .wm-file-hint { font-size: 11px; opacity: 0.5; margin-top: 4px; }
                .wm-cover-preview { width: 60px; height: 60px; object-fit: cover; border-radius: 8px; margin-top: 8px; }
                .wm-error { background: rgba(239,83,80,0.12); color: #ff8a85; padding: 10px; border-radius: 8px; font-size: 12px; margin-top: 10px; }
                .wm-modal-foot { display: flex; gap: 10px; padding: 14px 18px; border-top: 1px solid rgba(255,255,255,0.08); }
                .wm-btn-cancel, .wm-btn-submit { flex: 1; border: none; border-radius: 10px; padding: 10px 0; cursor: pointer; font-weight: 600; font-size: 13px; }
                .wm-btn-cancel { background: #1c1c22; color: #fff; }
                .wm-btn-submit { background: #a239ff; color: #fff; }
                .wm-btn-submit:disabled { opacity: 0.5; }
            `}</style>
        </div>
    );
}
