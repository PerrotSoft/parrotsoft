'use client';
import { useState, useEffect, useRef } from 'react';
import * as actions from '../actions';
import CallWindow from './CallWindow';
// npm install marked   (используется для форматированных MD-сообщений)
import { marked } from 'marked';
import { compressImageToJPEG } from '../lib/imageUpload';
import { sha256OfDataUrl, makeImageThumb, makeVideoThumb, reduceColorDepth, compressVideoFile } from '../lib/fileStore';
import { LANGS, t } from '../lib/i18n';
import { POSTS_ENABLED, MAX_POST_TEXT_LENGTH, MAX_COMMENT_LENGTH, FEED_AD_EVERY_N } from '../lib/siteConfig';
import AdSlot from '../components/AdSlot';
marked.setOptions({ gfm: true, breaks: true });

// ── Пароли запароленных чатов — кэш в localStorage ──────────────────────
// Сообщения в чатах с паролем шифруются ключом, выведенным из САМОГО пароля
// (см. app/lib/msgCrypto.js) — сервер его не хранит. Поэтому клиенту нужно
// держать пароль под рукой (в открытом виде, не хэш — хэш для расшифровки
// бесполезен) и подставлять его во все запросы к этому чату, иначе сервер
// не сможет ни зашифровать новое сообщение, ни расшифровать старые.
const getChatPw = (chatId) => {
  if (typeof window === 'undefined' || !chatId) return null;
  try { return localStorage.getItem(`wc_chatpw_${chatId}`); } catch { return null; }
};
const setChatPw = (chatId, password) => {
  if (typeof window === 'undefined' || !chatId || !password) return;
  try { localStorage.setItem(`wc_chatpw_${chatId}`, password); } catch {}
};

const formatFileSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const CHAT_ICON_EMOJIS = ["💬","👥","📢","🎮","🎨","🎓","💻","🚀","🎵","⚽","🍕","🌍","🔥","⭐","💡","🛠️"];

// Настоящей загрузки фото профиля в проекте пока нет — используем тот же
// генератор аватарок, что и в остальном проекте (см. getChannelProfile в
// actions.js), детерминированный по имени пользователя.
// Генерируем аватар-заглушку прямо здесь — первая буква имени на цветном круге.
// Цвет выбирается детерминированно по имени (одинаковый для одного юзера везде).
// Это SVG в data: URI — не требует сети, мгновенно, никаких роботов-рандомайзеров.
const AVATAR_COLORS = ['#4c6ef5','#7950f2','#1c7ed6','#0ca678','#f76707','#e64980','#2f9e44','#c2255c','#5c7cfa','#845ef7'];
function usernameColor(username) {
  let h = 0;
  for (let i = 0; i < (username || '').length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function makeInitialAvatar(username) {
  const letter = (username || '?')[0].toUpperCase();
  const bg = usernameColor(username);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="' + bg + '"/><text x="20" y="27" text-anchor="middle" font-size="20" font-family="sans-serif" fill="#fff" font-weight="600">' + letter + '</text></svg>';
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
const userAvatarUrl = (username) => makeInitialAvatar(username);

// Простой синтетический рингтон (два тона, повтор) через Web Audio — без внешнего mp3.
function playRingtone() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return { stop() {} };
    const ctx = new AudioCtx();
    let stopped = false;
    const beep = (t0) => {
        if (stopped) return;
        [880, 660].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = freq;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.0001, t0 + i * 0.28);
            gain.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.28 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.28 + 0.26);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0 + i * 0.28);
            osc.stop(t0 + i * 0.28 + 0.28);
        });
    };
    beep(ctx.currentTime + 0.05);
    const interval = setInterval(() => { if (!stopped) beep(ctx.currentTime + 0.05); }, 1800);
    return {
        stop() {
            stopped = true;
            clearInterval(interval);
            ctx.close().catch(() => {});
        },
    };
}

// Личный чат хранится как group-запись с type='dm' и техническим названием
// "user1__dm__user2" (см. startDirectChat в actions.js) — для показа достаём
// из этого названия имя собеседника, чтобы не палить служебный формат в UI.
const dmPeer = (chat, currentUser) => {
    if (chat?.type !== 'dm' || !chat.title?.includes('__dm__')) return null;
    const [a, b] = chat.title.split('__dm__');
    return a === currentUser ? b : a;
};

// Голосовое сообщение в стиле Telegram: кнопка play/pause + "волна" из полосок,
// прогресс закрашивает волну слева направо по мере воспроизведения.
function VoiceBubble({ file, getFullFile, duration, mine }) {
    const audioRef = useRef(null);
    const [src, setSrc] = useState(file.data || null);
    const [playing, setPlaying] = useState(false);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(0); // 0..1
    const [broken, setBroken] = useState(false);
    const bars = useRef(Array.from({ length: 28 }, (_, i) => 6 + Math.round(18 * Math.abs(Math.sin(i * 12.9898 + (file.hash?.length || 0)) % 1))));

    const toggle = async (e) => {
        e.stopPropagation();
        if (broken) return;
        if (!src) {
            setLoading(true);
            const data = await getFullFile(file);
            setLoading(false);
            if (!data) { setBroken(true); return; }
            setSrc(data);
            return; // <audio> ещё не смонтирован с этим src — play нажмут ещё раз, либо автоплей ниже
        }
        const audio = audioRef.current;
        if (!audio) return;
        if (playing) {
            audio.pause();
        } else {
            // audio.play() возвращает промис, который может зареджектиться (например,
            // если формат не поддерживается) — без catch это было бы необработанное
            // отклонение промиса и "NotSupportedError" в консоли.
            audio.play().catch(() => setBroken(true));
        }
    };

    // Как только src появился после лениво загруженных байт — сразу начинаем играть.
    useEffect(() => {
        if (src && audioRef.current) audioRef.current.play().catch(() => setBroken(true));
        // eslint-disable-next-line
    }, [src]);

    return (
        <div className={`voice-bubble ${mine ? 'mine' : ''}`} onClick={e => e.stopPropagation()}>
            <button className="voice-play" onClick={toggle} disabled={broken}>{broken ? '⚠️' : loading ? '…' : playing ? '⏸' : '▶'}</button>
            <div className="voice-wave">
                {bars.current.map((h, i) => (
                    <span key={i} className={i / bars.current.length <= progress ? 'bar filled' : 'bar'} style={{ height: h }} />
                ))}
            </div>
            <span className="voice-duration">{broken ? 'ошибка' : duration ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : ''}</span>
            {src && (
                <audio ref={audioRef} src={src} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                    onEnded={() => { setPlaying(false); setProgress(0); }}
                    onError={() => setBroken(true)}
                    onTimeUpdate={e => setProgress(e.target.duration ? e.target.currentTime / e.target.duration : 0)} />
            )}
        </div>
    );
}

// Рендер одного вложения. Картинка/видео показывают маленький thumb сразу и
// подгружают полные байты по клику ("открыть" / "смотреть видео") — они не
// передаются на клиент, пока реально не понадобились.
function AttachmentItem({ file, mine, getFullFile, single }) {
    const [fullData, setFullData] = useState(file.data || null);
    const [loading, setLoading] = useState(false);

    const load = async (e) => {
        e?.stopPropagation();
        if (fullData || loading) return fullData;
        setLoading(true);
        const data = await getFullFile(file);
        setLoading(false);
        setFullData(data);
        return data;
    };

    // Реальные пропорции файла (сохраняются при сжатии, см. lib/fileStore.js
    // makeImageThumb/makeVideoThumb). Только для одиночного вложения — когда
    // их несколько, показываем единообразную сетку-альбом (см. CSS), там
    // динамический размер только всё усложнил бы вид.
    const ratioStyle = single && file.w && file.h ? { aspectRatio: `${file.w} / ${file.h}` } : undefined;

    if (file.type?.startsWith('image/')) {
        return (
            <img src={file.thumb || fullData} alt="" className={`lazy-thumb ${single ? 'dynamic-size' : ''}`} style={ratioStyle}
                onClick={async (e) => { const d = await load(e); if (d) window.open(d); }} />
        );
    }

    if (file.type?.startsWith('video/')) {
        if (!fullData) {
            return (
                <div className={`video-poster ${single ? 'dynamic-size' : ''}`} style={ratioStyle} onClick={load}>
                    {file.thumb && <img src={file.thumb} alt="" />}
                    <span className="play-overlay">{loading ? '…' : '▶'}</span>
                    {file.duration != null && (
                        <span className="video-duration-badge">
                            {Math.floor(file.duration / 60)}:{String(Math.floor(file.duration % 60)).padStart(2, '0')}
                        </span>
                    )}
                </div>
            );
        }
        return <video src={fullData} controls autoPlay className={single ? 'dynamic-size' : ''} style={ratioStyle} onClick={e => e.stopPropagation()} />;
    }

    if (file.type === 'audio/voice+webm') {
        return <VoiceBubble file={file} getFullFile={getFullFile} duration={file.duration} mine={mine} />;
    }

    if (file.type?.startsWith('audio/')) {
        if (!fullData) {
            return (
                <button className="doc-file" onClick={load}>
                    <span className="doc-file-icon">{loading ? '…' : '▶'}</span>
                    <span className="doc-file-info">
                        <span className="doc-file-name">{file.name || 'Аудио'}</span>
                        <small className="doc-file-meta">{loading ? 'Загрузка…' : formatFileSize(file.size) || 'Аудиофайл'}</small>
                    </span>
                </button>
            );
        }
        return <audio src={fullData} controls onClick={e => e.stopPropagation()} />;
    }

    // Обычный файл — качаем по клику. Разметка как в референсе (Telegram):
    // круглая иконка слева + название сверху + размер снизу, а не голый
    // 📦-эмодзи текстом в столбик.
    const ext = (file.name || '').split('.').pop()?.toLowerCase();
    const docIcon = ['zip','rar','7z','tar','gz'].includes(ext) ? '🗜️'
        : ['mp3','wav','ogg','flac'].includes(ext) ? '🎵'
        : ['png','jpg','jpeg','gif','webp','svg'].includes(ext) ? '🖼️'
        : ['js','ts','py','cpp','c','java','go','rs','html','css','json'].includes(ext) ? '📄'
        : ['pdf'].includes(ext) ? '📕'
        : '📦';
    return (
        <button className="doc-file" onClick={async (e) => {
            const d = await load(e);
            if (d) {
                const a = document.createElement('a');
                a.href = d; a.download = file.name; a.click();
            }
        }}>
            <span className="doc-file-icon">{docIcon}</span>
            <span className="doc-file-info">
                <span className="doc-file-name">{file.name}</span>
                <small className="doc-file-meta">{loading ? 'Загрузка…' : formatFileSize(file.size) || 'Скачать'}</small>
            </span>
        </button>
    );
}

// Опрос: клик по варианту голосует/снимает голос, проценты — сразу под каждым вариантом.
function PollCard({ msgId, data, votes, currentUser, onVote }) {
    const total = votes.length;
    const myVote = votes.find(v => v.username === currentUser)?.optionIdx;
    return (
        <div className="poll-card">
            <div className="poll-q">📊 {data.q}</div>
            <div className="poll-options">
                {data.options.map((opt, idx) => {
                    const count = votes.filter(v => v.optionIdx === idx).length;
                    const pct = total ? Math.round((count / total) * 100) : 0;
                    const mine = myVote === idx;
                    return (
                        <button key={idx} type="button" className={`poll-btn ${mine ? 'mine' : ''}`} onClick={() => onVote(msgId, idx)}>
                            <span className="poll-btn-fill" style={{ width: `${pct}%` }} />
                            <span className="poll-btn-row">
                                <span className="poll-btn-label">{mine && '✓ '}{opt}</span>
                                {total > 0 && <span className="poll-btn-pct">{pct}%</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="poll-total">{total} голос{total === 1 ? '' : total >= 2 && total <= 4 ? 'а' : 'ов'}</div>
        </div>
    );
}

// «Архитектура» / форматированное сообщение: свёрнутая карточка-документ,
// разворачивается в полноценный рендер Markdown (таблицы, картинки, код и т.д.).
function RichCard({ data, expanded, onToggle }) {
    const html = marked.parse(data.md || '');
    return (
        <div className="rich-card">
            <div className="rich-card-head" onClick={onToggle}>
                <span className="rich-icon">📝</span>
                <b>{data.title || 'Документ'}</b>
                <span className="rich-toggle">{expanded ? '▲' : '▼'}</span>
            </div>
            {expanded && (
                <div className="rich-card-body">
                    {data.image && <img src={data.image} alt="" className="rich-card-image" />}
                    <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
                </div>
            )}
        </div>
    );
}

const ALL_EMOJIS = [
  "💻", "🖥️", "⌨️", "🖱️", "💾", "💿", "📀", "📡", "🔋", "🔌", "⚙️", "🔧", "🔨", "🔩", "🏗️", "🧱",
  "📦", "📂", "📁", "📄", "📃", "📑", "📊", "📈", "📉", "🔍", "🔎", "🔐", "🔓", "🔑", "🛡️", "🧬",
  "🤖", "👾", "👽", "🚀", "🛸", "🛰️", "🚠", "🚥", "🚦", "⚠️", "🚫", "✅", "❌", "💯", "🆙", "🆕",
  "💬", "💭", "🗯️", "🗨️", "🗨️", "👋", "🤝", "👑", "👤", "👥", "🗣️", "📢", "📣", "🔔", "🔕",
  "⭐", "🌟", "✨", "🔥", "☄️", "💥", "⚡", "🌈", "☀️", "🌙", "❄️", "💧", "🌊", "🍃", "🌵",
  "🎉", "🎊", "🎈", "🎂", "🎁", "🏅", "🏆", "🎮", "🕹️", "🎰", "🎲", "🎯", "🎨", "🎭", "🎼",
  "🦜", "🐦", "🕊️", "🦅", "🦉", "🦆", "🦢", "🦋", "🐛", "🐝", "🐞", "🐾", "🐕", "🐈", "🐠",
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍",
  "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
  "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢",
  "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤔"
];

// ── Лента "Посты" — второй режим WavyChat (переключатель сверху), в духе
// старого Facebook: карточки текст+картинка, лайк, комментарии. Рендерится
// как полноэкранный оверлей поверх обычного чата (см. .wc-posts-overlay
// ниже) — так не пришлось трогать разметку самого чата.
function PostsFeed({ username, actions, sortMode, setSortMode, sidebarWidth = 0, activePaablik = 'general', canWrite = true }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draftText, setDraftText] = useState('');
  const [draftImage, setDraftImage] = useState(null);
  const [draftVisibility, setDraftVisibility] = useState('public'); // 'public' | 'followers'
  const [posting, setPosting] = useState(false);
  const [openComments, setOpenComments] = useState(null); // postId | null
  const [comments, setComments] = useState({}); // { postId: [...] }
  const [commentDraft, setCommentDraft] = useState('');
  const fileRef = useRef(null);

  const loadFeed = async () => {
    setLoading(true);
    const feed = await actions.getPostsFeed(username, 50, activePaablik);
    setPosts(feed);
    setLoading(false);
  };

  useEffect(() => { loadFeed(); }, [activePaablik]); // eslint-disable-line

  const handleImagePick = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { dataUrl } = await compressImageToJPEG(file);
      setDraftImage(dataUrl);
    } catch (err) {
      alert('Не удалось обработать картинку: ' + err.message);
    }
  };

  const submitPost = async () => {
    if (!draftText.trim() && !draftImage) return;
    if (localStorage.getItem('p_is_guest') === '1') { alert('В гостевом режиме нельзя публиковать посты — войдите в аккаунт'); return; }
    setPosting(true);
    const res = await actions.createPost(username, draftText, draftImage, draftVisibility, activePaablik);
    setPosting(false);
    if (!res.success) { alert(res.error); return; }
    setDraftText('');
    setDraftImage(null);
    setDraftVisibility('public');
    loadFeed();
  };

  const toggleLike = async (postId) => {
    // Оптимистичное обновление — не ждём ответ сервера, чтобы сердечко отзывалось мгновенно
    setPosts(prev => prev.map(p => p.id === postId
      ? { ...p, likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1) }
      : p));
    await actions.togglePostLike(postId, username);
  };

  const openPostComments = async (postId) => {
    if (openComments === postId) { setOpenComments(null); return; }
    setOpenComments(postId);
    if (!comments[postId]) {
      const list = await actions.getPostComments(postId);
      setComments(prev => ({ ...prev, [postId]: list }));
    }
  };

  const submitComment = async (postId) => {
    if (!commentDraft.trim()) return;
    const res = await actions.addPostComment(postId, username, commentDraft);
    if (res.success) {
      setCommentDraft('');
      const list = await actions.getPostComments(postId);
      setComments(prev => ({ ...prev, [postId]: list }));
    }
  };

  const removePost = async (postId) => {
    if (!confirm('Удалить пост?')) return;
    await actions.deletePost(postId, username);
    loadFeed();
  };

  const toggleFollow = async (authorUsername, currentlyFollowed) => {
    // Оптимистично обновляем всех авторов сразу (у одного автора может быть несколько постов в ленте)
    setPosts(prev => prev.map(p => p.username === authorUsername ? { ...p, followedByMe: !currentlyFollowed } : p));
    if (currentlyFollowed) await actions.unfollowUser(username, authorUsername);
    else await actions.followUser(username, authorUsername);
  };

  return (
    <div className="wc-posts-overlay" style={{ left: sidebarWidth }}>
      <div className="wc-posts-inner">
        {loading && <p style={{ textAlign: 'center', color: 'var(--wc-muted)' }}>Загрузка...</p>}
        {!loading && !posts.length && <p style={{ textAlign: 'center', color: 'var(--wc-muted)' }}>Пока нет постов — будь первым!</p>}
        {!loading && posts.length > 0 && sortMode === 'following' && !posts.some(p => p.followedByMe) && (
          <p style={{ textAlign: 'center', color: 'var(--wc-muted)' }}>Ты пока ни на кого не подписан(а) — нажми «Подписаться» под постом автора.</p>
        )}

        {[...posts]
          .filter(p => sortMode !== 'following' || p.followedByMe)
          .sort((a, b) => sortMode === 'top' ? (b.likes - a.likes) || (b.timestamp - a.timestamp) : b.timestamp - a.timestamp)
          .map((p, idx) => (
          <div key={`ad-wrap-${p.id}`}>
          <div className="wc-post-card">
            <div className="wc-post-header">
              <img className="wc-post-avatar" src={p.avatar || `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#4c8dff"/><text x="20" y="27" text-anchor="middle" font-size="20" font-family="sans-serif" fill="#fff">${(p.username||'?')[0].toUpperCase()}</text></svg>`)}`} alt="" />
              <div>
                <div className="wc-post-author">{p.username}</div>
                <div className="wc-post-time">{new Date(p.timestamp).toLocaleString('ru')} {p.visibility === 'followers' && '🔒'}</div>
              </div>
              {p.username !== username && (
                <button className={`wc-post-follow ${p.followedByMe ? 'following' : ''}`} onClick={() => toggleFollow(p.username, p.followedByMe)}>
                    {p.followedByMe ? 'Отписаться' : 'Подписаться'}
                </button>
              )}
              {p.username === username && (
                <button className="wc-post-delete" onClick={() => removePost(p.id)}>🗑️</button>
              )}
            </div>
            {p.text && <p className="wc-post-text">{p.text}</p>}
            {p.image && <img className="wc-post-image" src={p.image} alt="" />}
            <div className="wc-post-actions">
              <button className={p.likedByMe ? 'liked' : ''} onClick={() => toggleLike(p.id)}>
                {p.likedByMe ? '❤️' : '🤍'} {p.likes || 0}
              </button>
              <button onClick={() => openPostComments(p.id)}>💬 Комментарии</button>
            </div>
            {openComments === p.id && (
              <div className="wc-post-comments">
                {(comments[p.id] || []).map(c => (
                  <div key={c.id} className="wc-post-comment">
                    <b>{c.username}:</b> {c.text}
                  </div>
                ))}
                <div className="wc-post-comment-input">
                  <input
                    placeholder="Написать комментарий..."
                    value={commentDraft}
                    onChange={e => setCommentDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitComment(p.id); }}
                  />
                  <button onClick={() => submitComment(p.id)}>➤</button>
                </div>
              </div>
            )}
          </div>
          {(idx + 1) % FEED_AD_EVERY_N === 0 && (
            <div style={{ margin: '16px 0', display: 'flex', justifyContent: 'center' }}>
              <AdSlot weight="light" type="300x250" />
            </div>
          )}
          </div>
        ))}
      </div>

      {canWrite ? (
      <div className="wc-posts-composer">
        <textarea
          placeholder="Что нового?"
          value={draftText}
          onChange={e => setDraftText(e.target.value)}
          maxLength={MAX_POST_TEXT_LENGTH}
          rows={2}
        />
        {draftImage && (
          <div className="wc-posts-draft-img">
            <img src={draftImage} alt="" />
            <button onClick={() => setDraftImage(null)}>✕</button>
          </div>
        )}
        <div className="wc-posts-composer-row">
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImagePick} />
          <button className="wc-posts-img-btn" onClick={() => fileRef.current?.click()}>🖼️ Фото</button>
          <select className="wc-posts-visibility" value={draftVisibility} onChange={e => setDraftVisibility(e.target.value)}>
              <option value="public">🌐 Все</option>
              <option value="followers">👥 Только подписчики</option>
          </select>
          <button className="wc-posts-submit-btn" disabled={posting || (!draftText.trim() && !draftImage)} onClick={submitPost}>
            {posting ? 'Публикуем...' : 'Опубликовать'}
          </button>
        </div>
      </div>
      ) : (
        <div className="wc-posts-composer wc-posts-join-hint">
          Чтобы писать сюда, сначала вступи в этот паблик — кнопка в сайдбаре.
        </div>
      )}
      <style jsx>{`
        .wc-posts-overlay {
          position: fixed; top: 0; right: 0; bottom: 0; z-index: 900;
          background: var(--wc-bg);
          display: flex; flex-direction: column;
        }
        .wc-posts-inner { max-width: 560px; width: 100%; margin: 0 auto; flex: 1; overflow-y: auto; padding: 16px 16px 0; box-sizing: border-box; }
        .wc-posts-join-hint { text-align: center; font-size: 12px; color: var(--wc-muted); padding: 16px; }
        .wc-posts-sort {
          display: flex; gap: 8px; margin-bottom: 14px;
        }
        .wc-posts-sort button {
          background: var(--wc-chip-bg); color: var(--wc-chip-text); border: none;
          border-radius: 14px; padding: 6px 14px; cursor: pointer; font-size: 12px;
        }
        .wc-posts-sort button.active {
          background: var(--wc-accent); color: #fff;
        }
        .wc-posts-composer {
          background: var(--wc-surface); border: 1px solid var(--wc-border);
          border-radius: 14px; padding: 14px; margin-bottom: 20px;
        }
        .wc-posts-composer textarea {
          width: 100%; background: var(--wc-input-bg,transparent); border: 1px solid var(--wc-input-border,var(--wc-border));
          border-radius: 10px; padding: 10px 12px; color: var(--wc-text); font-size: 14px;
          font-family: inherit; resize: vertical; outline: none; box-sizing: border-box;
        }
        .wc-posts-draft-img { position: relative; margin-top: 10px; }
        .wc-posts-draft-img img { width: 100%; max-height: 240px; object-fit: cover; border-radius: 10px; }
        .wc-posts-draft-img button {
          position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #fff;
          border: none; border-radius: 50%; width: 26px; height: 26px; cursor: pointer;
        }
        .wc-posts-composer-row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 8px; }
        .wc-posts-visibility {
          background: var(--wc-input-bg,transparent); border: 1px solid var(--wc-input-border,var(--wc-border));
          border-radius: 10px; padding: 7px 8px; color: var(--wc-text); font-size: 12px; outline: none;
        }
        .wc-posts-img-btn { background: var(--wc-chip-bg); color: var(--wc-chip-text); border: none; border-radius: 10px; padding: 8px 14px; cursor: pointer; font-size: 13px; }
        .wc-posts-submit-btn { background: var(--wc-accent); color: #fff; border: none; border-radius: 10px; padding: 8px 18px; cursor: pointer; font-size: 13px; font-weight: 600; }
        .wc-posts-submit-btn:disabled { opacity: 0.5; cursor: default; }
        .wc-post-card {
          background: var(--wc-surface); border: 1px solid var(--wc-border);
          border-radius: 14px; padding: 14px; margin-bottom: 16px;
        }
        .wc-post-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
        .wc-post-avatar { width: 38px; height: 38px; border-radius: 50%; object-fit: cover; }
        .wc-post-author { font-weight: 600; font-size: 14px; color: var(--wc-text); }
        .wc-post-time { font-size: 11px; color: var(--wc-muted); }
        .wc-post-delete { margin-left: auto; background: none; border: none; cursor: pointer; opacity: 0.6; font-size: 13px; }
        .wc-post-follow {
          margin-left: auto; background: var(--wc-accent); color: #fff; border: none;
          border-radius: 14px; padding: 6px 12px; cursor: pointer; font-size: 11px; font-weight: 600;
        }
        .wc-post-follow.following { background: var(--wc-chip-bg); color: var(--wc-chip-text); }
        .wc-post-text { font-size: 14px; color: var(--wc-text); line-height: 1.5; margin: 0 0 10px; white-space: pre-wrap; }
        .wc-post-image { width: 100%; max-height: 420px; object-fit: cover; border-radius: 10px; margin-bottom: 10px; }
        .wc-post-actions { display: flex; gap: 16px; border-top: 1px solid var(--wc-border); padding-top: 10px; }
        .wc-post-actions button { background: none; border: none; color: var(--wc-muted); cursor: pointer; font-size: 13px; }
        .wc-post-actions button.liked { color: #ff4d6d; }
        .wc-post-comments { margin-top: 10px; border-top: 1px solid var(--wc-border); padding-top: 10px; }
        .wc-post-comment { font-size: 13px; color: var(--wc-text); margin-bottom: 6px; }
        .wc-post-comment-input { display: flex; gap: 8px; margin-top: 8px; }
        .wc-post-comment-input input {
          flex: 1; background: var(--wc-input-bg,transparent); border: 1px solid var(--wc-input-border,var(--wc-border));
          border-radius: 20px; padding: 8px 14px; color: var(--wc-text); font-size: 13px; outline: none;
        }
        .wc-post-comment-input button { background: var(--wc-accent); color: #fff; border: none; border-radius: 50%; width: 32px; height: 32px; cursor: pointer; }
      `}</style>
    </div>
  );
}

function CreatePaablikModal({ onClose, onCreate }) {
    const [title, setTitle] = useState('');
    const [privacy, setPrivacy] = useState('public');
    const [password, setPassword] = useState('');
    const [icon, setIcon] = useState('📰');

    const submit = () => {
        if (!title.trim()) return alert('Укажи название паблика');
        if (privacy === 'private' && !password.trim()) return alert('Для приватного паблика нужен пароль');
        onCreate({ title: title.trim(), privacy, password: password.trim(), icon });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3>➕ Создать паблик</h3>
                <input className="modal-input" placeholder="Иконка (эмодзи)" value={icon} onChange={e => setIcon(e.target.value)} style={{ maxWidth: 60, textAlign: 'center' }} />
                <input className="modal-input" placeholder="Название паблика" value={title} onChange={e => setTitle(e.target.value)} />
                <div style={{ display: 'flex', gap: 10, margin: '10px 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input type="radio" checked={privacy === 'public'} onChange={() => setPrivacy('public')} /> Публичный
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <input type="radio" checked={privacy === 'private'} onChange={() => setPrivacy('private')} /> Приватный (по паролю)
                    </label>
                </div>
                {privacy === 'private' && (
                    <input className="modal-input" type="password" placeholder="Пароль для вступления" value={password} onChange={e => setPassword(e.target.value)} />
                )}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button className="cancel-btn" onClick={onClose}>Отмена</button>
                    <button className="confirm-btn" onClick={submit}>Создать</button>
                </div>
            </div>
        </div>
    );
}

function JoinPaablikModal({ paablik, onClose, onJoin }) {
    const [password, setPassword] = useState('');
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <h3>🔒 Вступить в «{paablik.title}»</h3>
                <p style={{ fontSize: 13, opacity: 0.7 }}>Этот паблик приватный — нужен пароль.</p>
                <input
                    className="modal-input"
                    type="password"
                    placeholder="Пароль"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onJoin(password)}
                    autoFocus
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                    <button className="cancel-btn" onClick={onClose}>Отмена</button>
                    <button className="confirm-btn" onClick={() => onJoin(password)}>Вступить</button>
                </div>
            </div>
        </div>
    );
}

export default function WevyChat() {
    const [active, setActive] = useState(null);
    const [msgs, setMsgs] = useState([]);
    const [text, setText] = useState("");
    const [pendingFiles, setPendingFiles] = useState([]); 
    const [selected, setSelected] = useState([]); 
    const [showEmoji, setShowEmoji] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [myChats, setMyChats] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [recorder, setRecorder] = useState(null);
    const fileRef = useRef(null);
    const scrollRef = useRef(null);
    const [targetChatId, setTargetChatId] = useState(null);
    const groupIconRef = useRef(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [inCall, setInCall] = useState(false);
    const [activeCallInfo, setActiveCallInfo] = useState(null);
    const [isCalling, setIsCalling] = useState(false); // Для исходящего вызова
    const [navOffset, setNavOffset] = useState(0); // ширина плавающей аватарки ParrotOS сверху справа
    const [notifPermission, setNotifPermission] = useState('default');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [theme, setTheme] = useState('gemini'); // 'gemini' | 'midnight' | 'light'
    const [accent, setAccent] = useState('#4c8dff'); // акцентный цвет — свой, как в WavyTube (см. настройки)
    const [viewMode, setViewMode] = useState('chats'); // 'chats' | 'posts' — переключатель сверху
    const [postsSortMode, setPostsSortMode] = useState('new'); // 'new' | 'top' | 'following' — вынесено сюда, чтобы фильтры жили в сайдбаре, а не внутри PostsFeed
    const [pabliks, setPabliks] = useState([]);
    const [activePaablik, setActivePaablik] = useState('general');
    const [createPaablikOpen, setCreatePaablikOpen] = useState(false);
    const [joinPaablikPrompt, setJoinPaablikPrompt] = useState(null); // {id, title} | null — запрос пароля для приватного паблика

    const loadPabliks = async () => {
        const list = await actions.getMyPabliks(currentUser);
        setPabliks(list);
    };
    useEffect(() => { if (viewMode === 'posts') loadPabliks(); }, [viewMode, currentUser]); // eslint-disable-line

    const handleJoinPaablik = async (p, password = '') => {
        const res = await actions.joinPaablik(currentUser, p.id, password);
        if (res?.success === false) { alert(res.error || 'Не удалось вступить'); return; }
        setJoinPaablikPrompt(null);
        setActivePaablik(p.id);
        loadPabliks();
    };

    const handleCreatePaablik = async ({ title, privacy, password, icon }) => {
        const res = await actions.createPaablik(currentUser, title, privacy, password, icon);
        if (res?.success === false) { alert(res.error || 'Не удалось создать'); return; }
        setCreatePaablikOpen(false);
        setActivePaablik(res.id);
        loadPabliks();
    };
    const [sidebarWidth, setSidebarWidth] = useState(320);
    const [msgNotifEnabled, setMsgNotifEnabled] = useState(true);
    const [lang, setLang] = useState('en');
    const [fastMode, setFastMode] = useState(false); // общий флаг p_fast — тот же, что и в ClientInterface
    const [pendingInvite, setPendingInvite] = useState(null); // { chatId, pw? } — распознано из ссылки-приглашения
    const [inviteError, setInviteError] = useState('');
    const [inviteModalOpen, setInviteModalOpen] = useState(false); // ссылка-приглашение для активного чата (генерация)
    const [inviteIncludePw, setInviteIncludePw] = useState(false);
    const [incomingCall, setIncomingCall] = useState(null); // { chat, callerName } — баннер входящего звонка
    const lastSeenRef = useRef({}); // { chatId: lastMsgId } — чтобы не слать уведомление повторно
    const notifiedCallsRef = useRef({}); // { chatId: timestamp } — чтобы не спамить баннером на один и тот же звонок
    const ringtoneRef = useRef(null); // { stop() } — активный рингтон
    const [groupInfoOpen, setGroupInfoOpen] = useState(false);
    const [chatMembers, setChatMembers] = useState([]);
    const [chatAdmins, setChatAdmins] = useState([]);
    const [privacyDraft, setPrivacyDraft] = useState({ privacy: 'public', password: '' });
    const [newMemberName, setNewMemberName] = useState('');
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [reactions, setReactions] = useState({}); // { msgId: [{username, emoji}] }
    const [readState, setReadState] = useState({}); // { username: lastReadAt }
    const [reactionPickerFor, setReactionPickerFor] = useState(null);
    const [replyTo, setReplyTo] = useState(null); // { id, sender, text }
    const REACTION_EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢'];

    const [attachMenuOpen, setAttachMenuOpen] = useState(false);
    const [recordingSeconds, setRecordingSeconds] = useState(0);
    const [pollModalOpen, setPollModalOpen] = useState(false);
    const [pollDraft, setPollDraft] = useState({ q: '', options: ['', ''] });
    const [richModalOpen, setRichModalOpen] = useState(false);
    const [richDraft, setRichDraft] = useState({ title: '', md: '', image: '' });
    const [pollVotesByMsg, setPollVotesByMsg] = useState({});
    const [linkPreviews, setLinkPreviews] = useState({}); // { url: {title, favicon} }
    const [expandedRichMsgs, setExpandedRichMsgs] = useState({});
    const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);
    const [searchFilters, setSearchFilters] = useState({ type: 'all', privacy: 'all' });
    const [userSearchResults, setUserSearchResults] = useState([]);
    const imgFileRef = useRef(null);
    const videoFileRef = useRef(null);
    const [newChatData, setNewChatData] = useState({
        title: "",
        type: "group",
        privacy: "public",
        password: "",
        icon: null
    });
    const updateAccent = (c) => { setAccent(c); try { localStorage.setItem('p_wc_accent', c); } catch (e) {} };
    const updateTheme = (t) => {
        setTheme(t);
        try {
            if (t === 'auto') localStorage.removeItem('p_wc_theme_override');
            else localStorage.setItem('p_wc_theme_override', t);
        } catch (e) {}
    };
    const handleIconUpload = async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const { dataUrl } = await compressImageToJPEG(file);
                setNewChatData({...newChatData, icon: dataUrl});
            } catch (err) {
                alert('Не удалось обработать картинку: ' + err.message);
            }
        }
    };
    useEffect(() => {
        let saved = localStorage.getItem('p_user');;
        setCurrentUser(saved);
        loadMyChats(saved);

        // Тема и язык больше не настраиваются отдельно в WavyChat — всегда следуют
        // общим настройкам сайта (см. ClientInterface: p_theme_mode / p_lang).
        const themeOverride = localStorage.getItem('p_wc_theme_override'); // 'midnight' | 'light' | null (null = следуем общей теме)
        const globalDark = localStorage.getItem('p_theme_mode');
        setTheme(themeOverride || (globalDark === 'dark' ? 'midnight' : 'light'));
        const savedAccent = localStorage.getItem('p_wc_accent');
        if (savedAccent) setAccent(savedAccent);
        const globalLang = localStorage.getItem('p_lang');
        if (globalLang) setLang(globalLang);

        const savedWidth = localStorage.getItem('wc_sidebar_width');
        if (savedWidth) setSidebarWidth(Number(savedWidth));
        const savedNotifPref = localStorage.getItem('wc_msg_notif');
        if (savedNotifPref !== null) setMsgNotifEnabled(savedNotifPref === '1');
        const savedFast = localStorage.getItem('p_fast'); // общий флаг с ClientInterface — не свой, отдельный
        if (savedFast !== null) setFastMode(savedFast === '1');

        // Ссылка-приглашение: /WavyChat?join=<chatId>&pw=<пароль, необязательно>
        try {
            const params = new URLSearchParams(window.location.search);
            const joinId = params.get('join');
            if (joinId) setPendingInvite({ chatId: joinId, pw: params.get('pw') || '' });
        } catch (e) {}

        // По умолчанию спрашиваем разрешение на уведомления один раз при входе.
        // Повторно запросить можно из настроек (⚙️ в сайдбаре) — requestNotifPermission().
        if (typeof Notification !== 'undefined') {
            setNotifPermission(Notification.permission);
            if (Notification.permission === 'default') {
                Notification.requestPermission().then(setNotifPermission);
            }
        }
    }, []);

    // Присоединение по ссылке-приглашению — как только известен текущий пользователь.
    useEffect(() => {
        if (!pendingInvite || !currentUser) return;
        const tryJoin = async () => {
            try {
                await actions.checkChatAccess(pendingInvite.chatId, pendingInvite.pw || '');
                if (pendingInvite.pw) setChatPw(pendingInvite.chatId, pendingInvite.pw);
                await actions.joinChat(pendingInvite.chatId, currentUser);
                await loadMyChats(currentUser);
                setActive({ id: pendingInvite.chatId }); // временный минимальный объект — реальные поля подтянутся из myChats
                await loadChatMessages(pendingInvite.chatId);
                setPendingInvite(null);
                setInviteError('');
                window.history.replaceState({}, '', window.location.pathname);
            } catch (e) {
                setInviteError(e.message || 'Не удалось присоединиться по ссылке');
            }
        };
        tryJoin();
        // eslint-disable-next-line
    }, [pendingInvite, currentUser]);

    const changeFastMode = (on) => {
        setFastMode(on);
        localStorage.setItem('p_fast', on ? '1' : '0'); // общий флаг — тот же читает ClientInterface
    };
    const tr = (key) => t(lang, key);

    const changeSidebarWidth = (w) => {
        setSidebarWidth(w);
        localStorage.setItem('wc_sidebar_width', String(w));
    };

    const toggleMsgNotif = () => {
        setMsgNotifEnabled(v => {
            localStorage.setItem('wc_msg_notif', v ? '0' : '1');
            return !v;
        });
    };

    const requestNotifPermission = () => {
        if (typeof Notification === 'undefined') return alert('Уведомления не поддерживаются этим браузером');
        Notification.requestPermission().then(perm => {
            setNotifPermission(perm);
            if (perm === 'denied') alert('Уведомления заблокированы — разрешите их в настройках сайта в браузере (иконка замка рядом с адресом).');
        });
    };

    // ЕДИНЫЙ лёгкий поллинг вместо пяти отдельных (список чатов + фоновые
    // сообщения + фоновые звонки + звонок в активном чате + сообщения в
    // активном чате). Раз в 3 секунды спрашиваем getUpdatesSignal — это
    // маленький запрос (без текста сообщений и без файлов), который просто
    // говорит "вот столько-то чатов, вот такой id последнего сообщения в
    // каждом, вот такой звонок, если есть". Тяжёлые данные (getMsgs с
    // картинками/видео и т.д.) подгружаются ТОЛЬКО когда сигнал показал, что
    // что-то реально изменилось — а не на каждый тик, как было раньше.
    const chatsSignatureRef = useRef(null);
    const activeMsgIdRef = useRef(null);

    useEffect(() => {
        if (!currentUser) return;

        const poll = async () => {
            let signal;
            try {
                signal = await actions.getUpdatesSignal(currentUser, active?.id);
            } catch (e) {
                console.error('getUpdatesSignal error:', e);
                return;
            }

            // 1. Список чатов изменился (новый чат/удалили/вышли) — перегружаем список.
            if (chatsSignatureRef.current !== null && chatsSignatureRef.current !== signal.chatsSignature) {
                loadMyChats(currentUser);
            }
            chatsSignatureRef.current = signal.chatsSignature;

            for (const [chatId, info] of Object.entries(signal.perChat || {})) {
                const isActiveChat = active?.id === chatId;

                // 2. Новое сообщение в АКТИВНОМ чате — подтягиваем ТОЛЬКО новые
                //    сообщения (не всю историю заново — именно это раньше было
                //    причиной прогрессирующего замедления в течение сессии).
                if (isActiveChat) {
                    if (activeMsgIdRef.current !== null && info.lastMsgId !== activeMsgIdRef.current) {
                        actions.getMsgsSince(chatId, activeMsgIdRef.current, getChatPw(chatId)).then(newOnes => {
                            if (!newOnes.length) return;
                            setMsgs(prev => {
                                // Защита от дублей: если это сообщение уже есть в списке (например,
                                // из-за гонки — старый в-полёте запрос дошёл уже после того, как чат
                                // перезагрузили через loadChatMessages), не добавляем его второй раз —
                                // иначе React ругается на два элемента с одинаковым key={m.id}.
                                const existingIds = new Set(prev.map(m => m.id));
                                const fresh = newOnes.filter(m => !existingIds.has(m.id));
                                return fresh.length ? [...prev, ...fresh] : prev;
                            });
                        });
                    }
                    activeMsgIdRef.current = info.lastMsgId;

                    if (info.call) {
                        const started = new Date(info.call.timestamp).getTime();
                        if (started && Date.now() - started > 6 * 3600 * 1000) {
                            // Подстраховка: "зависший" звонок (например, браузер хоста упал
                            // без штатного выхода) старше 6 часов — считаем мёртвым.
                            actions.endCallNotification(chatId);
                            setActiveCallInfo(null);
                        } else {
                            setActiveCallInfo(info.call);
                        }
                    } else {
                        setActiveCallInfo(null);
                    }
                    continue;
                }

                // 3. Новое сообщение в ЧУЖОМ (не открытом) чате — уведомление.
                const seen = lastSeenRef.current[chatId];
                if (info.lastMsgId !== null) {
                    if (seen === undefined) {
                        lastSeenRef.current[chatId] = info.lastMsgId;
                    } else if (info.lastMsgId !== seen && info.lastSender !== currentUser) {
                        lastSeenRef.current[chatId] = info.lastMsgId;
                        if (notifPermission === 'granted' && msgNotifEnabled) {
                            const chat = myChats.find(c => c.id === chatId);
                            const disp = chat ? chatDisplay(chat) : { title: chatId };
                            const n = new Notification(`${disp.title}`, {
                                body: info.lastPreview?.startsWith('📊POLL:') ? '📊 Опрос' : info.lastPreview?.startsWith('📝MD:') ? '📝 Документ' : info.lastPreview?.startsWith('📍LOC:') ? '📍 Геопозиция' : (info.lastPreview || '📎 Вложение'),
                                tag: `msg-${chatId}`,
                            });
                            n.onclick = () => {
                                window.focus();
                                if (chat) { openChat(chat); }
                                n.close();
                            };
                        }
                    } else {
                        lastSeenRef.current[chatId] = info.lastMsgId;
                    }
                }

                // 4. Входящий звонок в чужом чате — баннер + рингтон.
                if (info.call && info.call.caller !== currentUser && !incomingCall) {
                    const already = notifiedCallsRef.current[chatId];
                    if (already !== info.call.timestamp) {
                        notifiedCallsRef.current[chatId] = info.call.timestamp;
                        const chat = myChats.find(c => c.id === chatId);
                        if (chat) {
                            setIncomingCall({ chat, callerName: info.call.caller });
                            if (!ringtoneRef.current) ringtoneRef.current = playRingtone();
                            if (notifPermission === 'granted') {
                                const disp = chatDisplay(chat);
                                const n = new Notification(`📞 Звонок: ${disp.title}`, { body: `${info.call.caller} звонит...`, tag: `call-${chatId}` });
                                n.onclick = () => { window.focus(); n.close(); };
                            }
                        }
                    }
                }
            }
        };

        poll();
        const interval = setInterval(poll, 3000); // сам сигнал лёгкий — можно часто, тяжёлые данные тянутся только по изменению
        return () => clearInterval(interval);
        // eslint-disable-next-line
    }, [currentUser, active, myChats, notifPermission, incomingCall, msgNotifEnabled]);

    const dismissIncomingCall = () => {
        ringtoneRef.current?.stop();
        ringtoneRef.current = null;
        setIncomingCall(null);
    };

    const acceptIncomingCall = () => {
        if (!incomingCall) return;
        const chat = incomingCall.chat;
        dismissIncomingCall();
        openChat(chat);
        actions.checkActiveCall(chat.id).then(call => { setActiveCallInfo(call); setInCall(true); });
    };

    const declineIncomingCall = async () => {
        if (!incomingCall) return;
        const chat = incomingCall.chat;
        dismissIncomingCall();
        if (chat.type === 'dm') {
            // Отклонить личный звонок — завершаем его целиком (как сброс трубки).
            await actions.endCallNotification(chat.id);
        }
        // Для группы/канала "Скрыть" просто прячет баннер — звонок продолжается для остальных.
    };

    useEffect(() => {
        activeMsgIdRef.current = null;
    }, [active?.id]);

    const skipAutoScrollRef = useRef(false);

    useEffect(() => {
        if (skipAutoScrollRef.current) { skipAutoScrollRef.current = false; return; }
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [msgs]);

    useEffect(() => {
        // Плавающая аватарка/баланс ParrotOS (.island-nav из ClientInterface) рендерится
        // поверх всего (position: fixed, top-right) и может перекрывать кнопки в шапке
        // чата. Вместо жёсткого отступа — измеряем её реальную ширину и подстраиваемся,
        // она меняется в зависимости от длины имени/баланса.
        const measure = () => {
            const el = document.querySelector('.island-nav');
            if (el) {
                const rect = el.getBoundingClientRect();
                setNavOffset(Math.round(window.innerWidth - rect.left) + 15);
            } else {
                setNavOffset(0);
            }
        };
        measure();
        const el = document.querySelector('.island-nav');
        let ro;
        if (el && typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(measure);
            ro.observe(el);
        }
        window.addEventListener('resize', measure);
        const retry = setTimeout(measure, 500); // island-nav может смонтироваться чуть позже
        return () => {
            window.removeEventListener('resize', measure);
            if (ro) ro.disconnect();
            clearTimeout(retry);
        };
    }, []);

    const handleCreateChat = async () => {
        if (!newChatData.title.trim()) return alert("Enter chat name");
        if (newChatData.privacy === 'private' && !newChatData.password.trim()) {
            return alert("Password is required for private chat!");
        }

        setLoading(true);
        try {
            // Не даём создать группу/канал с уже занятым названием.
            const existing = await actions.searchGlobal(newChatData.title.trim());
            const taken = existing.some(c => c.title?.toLowerCase() === newChatData.title.trim().toLowerCase());
            if (taken) {
                setLoading(false);
                return alert('Название уже занято — выберите другое');
            }

            const newChatId = await actions.createChat(
                newChatData.title, 
                currentUser, 
                newChatData.type, 
                newChatData.privacy,
                newChatData.icon,    
                newChatData.password 
            );
            if (newChatData.privacy === 'private' && newChatData.password) setChatPw(newChatId, newChatData.password);
            
            setShowCreateModal(false);
            setNewChatData({ title: "", type: "group", privacy: "public", password: "", icon: null });
            await loadMyChats(currentUser);
        } catch (e) {
            alert("Error during creation: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const recordTimerRef = useRef(null);
    const recordStartRef = useRef(0);

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // ВАЖНО: браузер сам решает, в каком реальном контейнере писать звук
            // (Chrome — audio/webm;codecs=opus, Safari — audio/mp4 и т.д.). Если
            // жёстко прописать 'audio/webm' в Blob, а по факту записалось что-то
            // другое, <audio> не сможет проиграть файл — именно это и вызывало
            // "NotSupportedError: no supported sources".
            const preferredMime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
                .find(m => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(m));
            const recOpts = { audioBitsPerSecond: 32000 }; // голосовые — речь, 32kbps более чем достаточно
            const mediaRecorder = preferredMime ? new MediaRecorder(stream, { mimeType: preferredMime, ...recOpts }) : new MediaRecorder(stream, recOpts);
            const chunks = [];

            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            mediaRecorder.onstop = async () => {
                const actualMime = mediaRecorder.mimeType || 'audio/webm';
                const blob = new Blob(chunks, { type: actualMime });
                if (blob.size === 0) {
                    alert('Запись не удалась (пустой звук) — проверьте доступ к микрофону и попробуйте ещё раз.');
                    stream.getTracks().forEach(track => track.stop());
                    return;
                }
                const durationSec = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    await storeFileAndAttach(
                        base64Audio,
                        'audio/voice+webm', // наш служебный маркер "это голосовое" — реальный MIME уже зашит в data-URL выше
                        `Voice_${new Date().toLocaleTimeString()}.${actualMime.includes('mp4') ? 'm4a' : actualMime.includes('ogg') ? 'ogg' : 'webm'}`,
                        { duration: durationSec }
                    );
                };
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            recordStartRef.current = Date.now();
            setRecordingSeconds(0);
            recordTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
            setRecorder(mediaRecorder);
            setIsRecording(true);
        } catch (err) {
            alert("Microphone not available: " + err);
        }
    };

    const stopRecording = () => {
        if (recorder) {
            recorder.stop();
            setIsRecording(false);
            clearInterval(recordTimerRef.current);
        }
    };
    const loadMyChats = async (username) => {
        if (!username) return;
        const res = await actions.getMyChats(username);
        setMyChats(res);
    };

    // ── Пагинация сообщений ─────────────────────────────────────────────────
    // РЕАЛЬНАЯ причина того, что запросы к /WavyChat становились медленнее и
    // медленнее в течение сессии: getMsgs(chatId) тянул ВСЮ историю чата целиком
    // на каждое обновление — включая base64 превьюшки всех картинок/видео. Чем
    // дольше сессия и чем больше сообщений отправлено, тем БОЛЬШЕ становился
    // каждый следующий ответ, и это накапливалось прогрессивно. Заменяем на
    // пагинацию: изначально только последние 100, довесок — по кнопке/скроллу
    // вверх, а обновление "пришло новое сообщение" — только само новое сообщение,
    // а не вся история заново.
    const [hasMoreOlder, setHasMoreOlder] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);

    const loadChatMessages = async (chatId) => {
        const { messages, hasMore } = await actions.getMsgsPage(chatId, {}, getChatPw(chatId));
        setMsgs(messages);
        setHasMoreOlder(hasMore);
        if (messages.length) activeMsgIdRef.current = messages[messages.length - 1].id;
        return messages;
    };

    // Открыть уже-свой чат (не первое вступление, а просто клик по чату в
    // списке/уведомлении/возврат в звонок). Для запароленных чатов, в которые
    // вступили ДО того, как пароль стал нужен на каждый запрос (см.
    // handleJoinChat), пароль в localStorage может отсутствовать — тогда
    // спрашиваем его один раз здесь и кэшируем, иначе отправка/чтение
    // сообщений будет падать с "Неверный пароль чата".
    const openChat = async (c) => {
        if (c.privacy === 'private' && !getChatPw(c.id)) {
            const pw = prompt('Введите пароль чата:');
            if (!pw) return;
            try {
                await actions.checkChatAccess(c.id, pw);
                setChatPw(c.id, pw);
            } catch (e) {
                alert(e.message || 'Неверный пароль');
                return;
            }
        }
        setActive(c);
        loadChatMessages(c.id);
    };

    const loadOlderMessages = async () => {
        if (!active || !msgs.length || loadingOlder || !hasMoreOlder) return;
        setLoadingOlder(true);
        try {
            const oldestId = msgs[0].id;
            const el = scrollRef.current;
            const prevScrollHeight = el?.scrollHeight || 0;
            const { messages, hasMore } = await actions.getMsgsPage(active.id, { beforeId: oldestId }, getChatPw(active.id));
            skipAutoScrollRef.current = true;
            setMsgs(prev => [...messages, ...prev]);
            setHasMoreOlder(hasMore);
            // Восстанавливаем видимую позицию, чтобы подгрузка не дёргала экран вниз.
            requestAnimationFrame(() => {
                if (el) el.scrollTop = el.scrollHeight - prevScrollHeight;
            });
        } finally {
            setLoadingOlder(false);
        }
    };

    const onFileChange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            setPendingFiles(prev => [...prev, { localId, name: file.name, type: file.type, status: 'processing' }]);
            const reader = new FileReader();
            reader.onloadend = () => {
                setPendingFiles(prev => prev.map(f => f.localId === localId ? { ...f, status: 'uploading' } : f));
                storeFileAndAttach(reader.result, file.type, file.name, {}, localId);
            };
            reader.onerror = () => setPendingFiles(prev => prev.filter(f => f.localId !== localId));
            reader.readAsDataURL(file);
        });
        e.target.value = "";
    };

    const onImageFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        setAttachMenuOpen(false);
        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // Сразу, ДО какой-либо конвертации — превью прямо из выбранного файла
        // (просто ссылка на него в памяти, ничего не копируется и не грузится) —
        // и статус "обрабатывается", чтобы в композере сразу было видно, что
        // файл принят, а не тишина на несколько секунд, пока идёт сжатие.
        const localPreview = URL.createObjectURL(file);
        setPendingFiles(prev => [...prev, { localId, name: file.name, type: 'image/jpeg', status: 'processing', localPreview }]);
        try {
            const { dataUrl } = await compressImageToJPEG(file);
            const thumbRes = await makeImageThumb(dataUrl, 220).catch(() => null);
            // Разрешение сохраняем, но урезаем глубину цвета (с шумом-маскировкой) —
            // ощутимая экономия размера почти без видимой потери качества.
            const finalUrl = await reduceColorDepth(dataUrl, 6).catch(() => dataUrl);
            setPendingFiles(prev => prev.map(f => f.localId === localId
                ? { ...f, status: 'uploading', thumb: thumbRes?.dataUrl || null, w: thumbRes?.w, h: thumbRes?.h }
                : f));
            await storeFileAndAttach(finalUrl, 'image/jpeg', file.name, { thumb: thumbRes?.dataUrl || null, w: thumbRes?.w, h: thumbRes?.h }, localId);
        } catch (err) {
            alert('Не удалось обработать изображение: ' + err.message);
            setPendingFiles(prev => prev.filter(f => f.localId !== localId));
        } finally {
            URL.revokeObjectURL(localPreview);
        }
    };

    const onVideoFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 100 * 1024 * 1024) {
            alert('Видео слишком большое (>100MB).');
            e.target.value = "";
            return;
        }
        e.target.value = "";
        setAttachMenuOpen(false);
        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const localPreview = URL.createObjectURL(file);
        setPendingFiles(prev => [...prev, { localId, name: file.name, type: file.type, status: 'processing', localPreview }]);
        try {
            // Разрешение остаётся тем же, но битрейт уменьшается (пересжатие через
            // canvas — см. lib/fileStore.js). Если по какой-то причине не получится —
            // тихо откатываемся на оригинальный файл, отправка не должна из-за этого падать.
            const compressed = await compressVideoFile(file, { targetBitrate: 1200000 }).catch(() => file);
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(compressed);
            });
            // Превью — только первый кадр (маленький JPEG). Сам видеофайл целиком
            // грузится позже, по клику на превью (см. рендер сообщений).
            const thumbRes = await makeVideoThumb(dataUrl, 220).catch(() => null);
            setPendingFiles(prev => prev.map(f => f.localId === localId
                ? { ...f, status: 'uploading', thumb: thumbRes?.dataUrl || null, w: thumbRes?.w, h: thumbRes?.h, duration: thumbRes?.duration }
                : f));
            await storeFileAndAttach(dataUrl, compressed.type || file.type, file.name, { thumb: thumbRes?.dataUrl || null, w: thumbRes?.w, h: thumbRes?.h, duration: thumbRes?.duration }, localId);
        } catch (err) {
            alert('Не удалось обработать видео: ' + (err.message || err));
            setPendingFiles(prev => prev.filter(f => f.localId !== localId));
        } finally {
            URL.revokeObjectURL(localPreview);
        }
    };

    const sendGeolocation = () => {
        setAttachMenuOpen(false);
        if (!navigator.geolocation) return alert('Геолокация не поддерживается браузером');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            const { latitude, longitude } = pos.coords;
            await actions.sendMsg(active.id, currentUser, `📍LOC:${latitude},${longitude}`, [], getChatPw(active.id));
            await loadChatMessages(active.id);
        }, (err) => alert('Не удалось получить геопозицию: ' + err.message));
    };

    const openPollModal = () => { setAttachMenuOpen(false); setPollDraft({ q: '', options: ['', ''] }); setPollModalOpen(true); };
    const submitPoll = async () => {
        const opts = pollDraft.options.map(o => o.trim()).filter(Boolean);
        if (!pollDraft.q.trim() || opts.length < 2) return alert('Укажите вопрос и минимум 2 варианта');
        const payload = JSON.stringify({ q: pollDraft.q.trim(), options: opts });
        await actions.sendMsg(active.id, currentUser, `📊POLL:${payload}`, [], getChatPw(active.id));
        setPollModalOpen(false);
        await loadChatMessages(active.id);
    };

    const openRichModal = () => { setAttachMenuOpen(false); setRichDraft({ title: '', md: '', image: '' }); setRichModalOpen(true); };
    const submitRich = async () => {
        if (!richDraft.title.trim() || !richDraft.md.trim()) return alert('Укажите заголовок и текст');
        const payload = JSON.stringify(richDraft);
        await actions.sendMsg(active.id, currentUser, `📝MD:${payload}`, [], getChatPw(active.id));
        setRichModalOpen(false);
        await loadChatMessages(active.id);
    };

    const handleVotePoll = async (msgId, idx) => {
        await actions.votePoll(msgId, currentUser, idx);
        const votes = await actions.getPollVotes(msgId);
        setPollVotesByMsg(prev => ({ ...prev, [msgId]: votes }));
    };

    // Опросы: подтягиваем голоса для видимых сообщений-опросов.
    useEffect(() => {
        const pollMsgs = msgs.filter(m => m.text?.startsWith('📊POLL:'));
        pollMsgs.forEach(m => {
            actions.getPollVotes(m.id).then(votes => setPollVotesByMsg(prev => ({ ...prev, [m.id]: votes })));
        });
    }, [msgs]);

    // Превью ссылок: находим URL в обычных текстовых сообщениях и подгружаем title/favicon.
    useEffect(() => {
        const urlRe = /https?:\/\/[^\s]+/g;
        const urls = new Set();
        msgs.forEach(m => {
            if (!m.text || m.text.startsWith('📊POLL:') || m.text.startsWith('📝MD:') || m.text.startsWith('📍LOC:')) return;
            const found = m.text.match(urlRe);
            if (found) found.forEach(u => urls.add(u));
        });
        urls.forEach(u => {
            if (linkPreviews[u]) return;
            actions.getLinkPreview(u).then(p => setLinkPreviews(prev => ({ ...prev, [u]: p })));
        });
        // eslint-disable-next-line
    }, [msgs]);


    const onSend = async () => {
        if ((!text.trim() && pendingFiles.length === 0) || !active || !currentUser) return;
        if (pendingFiles.some(f => f.status && f.status !== 'ready')) {
            alert('Подождите, файлы ещё загружаются…');
            return;
        }
        
        setLoading(true);
        try {
            const outgoing = replyTo
                ? `↩ ${replyTo.sender}: ${replyTo.text.slice(0, 80)}\n${text}`
                : text;
            // status/localId/localPreview — служебные поля только для композера,
            // в само сообщение (и тем более в БД) улетать не должны.
            const outgoingFiles = pendingFiles.map(({ status, localId, localPreview, ...f }) => f);
            await actions.sendMsg(active.id, currentUser, outgoing, outgoingFiles, getChatPw(active.id));
            
            setText(""); 
            setPendingFiles([]); 
            setReplyTo(null);

            await loadChatMessages(active.id);
        } catch (e) {
            alert("Sending error: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const handleJoinChat = async (chat) => {
        try {
            let password = null;
            if (chat.privacy === 'private') {
                password = prompt("Enter password:");
                if (!password) return;
                await actions.checkChatAccess(chat.id, password);
                setChatPw(chat.id, password);
            }

            setLoading(true);
            await actions.joinChat(chat.id, currentUser);
            setMyChats(prev => {
                if (prev.find(c => c.id === chat.id)) return prev;
                return [...prev, chat];
            });
            setActive(chat);
            setSearchQuery("");
            setSearchResults([]);
            
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const toggleSelect = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };
    const addEmoji = (emoji) => {
        setText(prev => prev + emoji);
    };
    const deleteSelected = async () => {
        if (!confirm(`Delete ${selected.length} messages?`)) return;
        await actions.deleteMsgs(selected);
        setSelected([]);
        await loadChatMessages(active.id);
    };
    const handleStartCall = async () => {
        if (!active || !currentUser) return;
        await actions.startCallNotification(active.id, currentUser);
        setInCall(true);
    };

    const handleJoinCall = () => {
        setInCall(true);
    };
    
    // clearServerCall=true — звонок завершается для всех (обычно хост нажал "Завершить"
    // или получен сигнал DIE от хоста); false — я просто вышел, для остальных звонок продолжается.
    const handleEndCall = async (clearServerCall = true) => {
        if (active && clearServerCall) {
            await actions.endCallNotification(active.id);
        }
        setInCall(false);
    };
    const onIconChange = async (e, chatId) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onloadend = async () => {
            await actions.updateChatIcon(chatId, reader.result); 
            loadMyChats(currentUser);
            if (active?.id === chatId) setActive(prev => ({ ...prev, icon: reader.result }));
        };
        reader.readAsDataURL(file);
    };

    const isActiveAdmin = active && (active.admin === currentUser || chatAdmins.includes(currentUser));

    const openGroupInfo = async () => {
        if (!active) return;
        if (active.type === 'dm') return; // у личного чата нет группового профиля/админки
        setGroupInfoOpen(true);
        const [members, admins] = await Promise.all([
            actions.getChatMembers(active.id),
            actions.getChatAdmins(active.id, active.admin),
        ]);
        setChatMembers(members);
        setChatAdmins(admins);
        setTitleDraft(active.title);
        setPrivacyDraft({ privacy: active.privacy || 'public', password: '' });
    };

    const saveGroupPrivacy = async (privacy) => {
        const password = privacy === 'private' ? (privacyDraft.password || prompt('Пароль для приватного чата:') || '') : '';
        if (privacy === 'private' && !password) return alert('Нужен пароль');
        const res = await actions.updateChatPrivacy(active.id, currentUser, privacy, password);
        if (res.success) {
            if (privacy === 'private' && password) setChatPw(active.id, password);
            setPrivacyDraft({ privacy, password: '' });
            setActive(prev => ({ ...prev, privacy }));
            loadMyChats(currentUser);
        } else {
            alert(res.error || 'Не удалось изменить приватность');
        }
    };

    const saveGroupTitle = async () => {
        if (!titleDraft.trim() || titleDraft === active.title) { setEditingTitle(false); return; }
        await actions.renameChat(active.id, titleDraft.trim());
        setActive(prev => ({ ...prev, title: titleDraft.trim() }));
        loadMyChats(currentUser);
        setEditingTitle(false);
    };

    const handleAddMember = async () => {
        if (!newMemberName.trim()) return;
        try {
            await actions.joinChat(active.id, newMemberName.trim());
            setNewMemberName('');
            const members = await actions.getChatMembers(active.id);
            setChatMembers(members);
        } catch (e) {
            alert('Не удалось добавить: ' + e.message);
        }
    };

    const handleRemoveMember = async (username) => {
        if (!confirm(`Убрать ${username} из группы?`)) return;
        await actions.kickUser(active.id, username);
        const members = await actions.getChatMembers(active.id);
        setChatMembers(members);
    };

    const handleToggleAdmin = async (username) => {
        if (chatAdmins.includes(username) && username !== active.admin) {
            await actions.removeChatAdmin(active.id, currentUser, username, active.admin);
        } else if (!chatAdmins.includes(username)) {
            await actions.addChatAdmin(active.id, currentUser, username, active.admin);
        }
        const admins = await actions.getChatAdmins(active.id, active.admin);
        setChatAdmins(admins);
    };

    const handleToggleReaction = async (msgId, emoji) => {
        if (!currentUser) return;
        setReactionPickerFor(null);
        const res = await actions.toggleReaction(msgId, currentUser, emoji);
        const ids = msgs.map(m => m.id);
        const fresh = await actions.getReactionsForChat(ids);
        setReactions(fresh);
    };

    // «Прочитано»: отмечаем чат прочитанным раз при открытии/обновлении сообщений,
    // и подтягиваем состояние прочтения всех участников для галочек.
    useEffect(() => {
        if (!active || !currentUser) return;
        actions.markChatRead(active.id, currentUser);
        actions.getChatReadState(active.id).then(setReadState);
    }, [active, msgs.length, currentUser]);

    useEffect(() => {
        if (!msgs.length) { setReactions({}); return; }
        const ids = msgs.map(m => m.id);
        actions.getReactionsForChat(ids).then(setReactions);
    }, [msgs]);

    const readTicks = (msg) => {
        if (msg.sender !== currentUser) return null;
        const readers = Object.entries(readState).filter(([u, t]) => u !== currentUser && t >= msg.time);
        if (readers.length === 0) return <span className="tick" title="Отправлено">✓</span>;
        return <span className="tick read" title={`Прочитано: ${readers.map(r => r[0]).join(', ')}`}>✓✓</span>;
    };

    const startReply = (msg) => setReplyTo({ id: msg.id, sender: msg.sender, text: msg.text || '📎 Вложение' });

    // ── Дедупликация файлов внутри чата ────────────────────────────────────
    // ── Файлы по хэшу содержимого (глобальная дедупликация + ленивая подгрузка) ──
    // Сообщение хранит только {name, type, hash, thumb?, duration?} — маленький
    // thumb (128px картинка / первый кадр видео) показывается сразу, а полные
    // байты подтягиваются через getFileBlob только по клику ("открыть"/"смотреть
    // видео"), и кэшируются на клиенте на сессию, чтобы не тянуть повторно.
    const blobCacheRef = useRef({}); // { hash: dataUrl }
    const [blobCacheTick, setBlobCacheTick] = useState(0); // чтобы триггерить перерендер после фетча

    const getFullFile = async (fileEntry) => {
        if (fileEntry.data) return fileEntry.data; // старые сообщения (до этой схемы) — данные уже внутри
        if (!fileEntry.hash) return null;
        if (blobCacheRef.current[fileEntry.hash]) return blobCacheRef.current[fileEntry.hash];
        const blob = await actions.getFileBlob(fileEntry.hash);
        if (blob?.data) {
            blobCacheRef.current[fileEntry.hash] = blob.data;
            setBlobCacheTick(t => t + 1);
            return blob.data;
        }
        return null;
    };

    // Считает хэш содержимого, при необходимости кладёт байты в общее хранилище
    // (один раз на весь сервер — не важно, в каком чате уже отправляли такой файл)
    // и добавляет лёгкую запись в pendingFiles.
    // localId — если передан, ОБНОВЛЯЕТ уже существующую запись (созданную как
    // status:'processing' сразу при выборе файла — см. onImageFileChange и
    // т.д.), а не добавляет новую. Так чип в композере остаётся тем же самым
    // элементом на всём протяжении конвертации → загрузки → готовности.
    const storeFileAndAttach = async (dataUrl, type, name, extra = {}, localId = null) => {
        const hash = await sha256OfDataUrl(dataUrl);
        blobCacheRef.current[hash] = dataUrl; // сразу кэшируем локально — не ждём обратно с сервера
        // Примерный размер в байтах из длины base64 — для отображения "8.5 KB"
        // у карточки файла (см. AttachmentItem/doc-file), не для точных расчётов.
        const b64Idx = dataUrl.indexOf(',');
        const approxSize = b64Idx >= 0 ? Math.round((dataUrl.length - b64Idx - 1) * 3 / 4) : 0;
        try {
            const already = await actions.hasFileBlob(hash);
            if (!already) {
                // Загружаем через отдельный API route, а не через Server Action —
                // у Server Actions маленький лимит тела запроса по умолчанию (~1MB),
                // из-за чего видео и вообще что-то покрупнее не отправлялось.
                const blob = await (await fetch(dataUrl)).blob();
                const fd = new FormData();
                fd.append('file', blob, name || 'file');
                fd.append('hash', hash);
                fd.append('type', type);
                const res = await fetch('/api/wavychat-upload', { method: 'POST', body: fd });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }
            }
        } catch (err) {
            alert('Не удалось загрузить файл: ' + err.message);
            if (localId) setPendingFiles(prev => prev.filter(f => f.localId !== localId));
            return;
        }
        if (localId) {
            setPendingFiles(prev => prev.map(f => f.localId === localId ? { ...f, name, type, hash, size: approxSize, ...extra, status: 'ready' } : f));
        } else {
            setPendingFiles(prev => [...prev, { name, type, hash, size: approxSize, ...extra, status: 'ready' }]);
        }
    };

    // ── Пересылка сообщений ─────────────────────────────────────────────────
    // Файлы теперь ссылаются на общий file_store по hash — пересылка просто
    // копирует ссылку {name,type,hash,thumb}, без повторной загрузки байт.
    const [forwardMsg, setForwardMsg] = useState(null);
    const forwardToChat = async (targetChat) => {
        if (!forwardMsg) return;
        const isSpecial = forwardMsg.text?.startsWith('📊POLL:') || forwardMsg.text?.startsWith('📝MD:') || forwardMsg.text?.startsWith('📍LOC:');
        // Опрос/rich-карточку/геопозицию пересылаем как есть — в новом чате это
        // новый интерактивный объект (голоса считаются отдельно, как в Telegram).
        // Обычный текст — с припиской, откуда переслано.
        const bodyOnly = forwardMsg.text?.startsWith('↩ ') ? forwardMsg.text.split('\n').slice(1).join('\n') : forwardMsg.text;
        const outgoing = isSpecial ? forwardMsg.text : `↪ Переслано от ${forwardMsg.sender}:\n${bodyOnly || ''}`;
        const files = typeof forwardMsg.media === 'string' ? JSON.parse(forwardMsg.media) : [];
        await actions.sendMsg(targetChat.id, currentUser, outgoing, files, getChatPw(targetChat.id));
        setForwardMsg(null);
        if (active?.id === targetChat.id) await loadChatMessages(targetChat.id);
    };


    // Иконка чата может быть картинкой (data:...), эмодзи (короткая строка) или
    // отсутствовать вовсе — тогда просто первая буква названия.
    const [userIcons, setUserIcons] = useState({}); // { username: realIconUrlOrDataUrl }

    // Реальная иконка аккаунта, если она есть в профиле — иначе сгенерированная.
    const avatarSrc = (username) => userIcons[username] || userAvatarUrl(username);

    const renderChatIcon = (icon, title) => {
        if (icon && icon.startsWith('data:')) return <img src={icon} alt="" className="avatar-img" />;
        if (icon) return <span className="avatar-letter">{icon}</span>;
        return <span className="avatar-letter">{title?.[0]?.toUpperCase()}</span>;
    };

    // Личный чат показываем как "собеседник" с его аватаркой, а не техническим
    // названием чата — см. dmPeer() выше.
    const chatDisplay = (chat) => {
        const peer = dmPeer(chat, currentUser);
        if (peer) return { title: peer, icon: <img src={avatarSrc(peer)} alt="" className="avatar-img" /> };
        return { title: chat.title, icon: renderChatIcon(chat.icon, chat.title) };
    };

    // Подгружаем реальные иконки для всех, кто сейчас виден: отправители сообщений,
    // собеседники по DM в списке чатов, результаты поиска людей.
    useEffect(() => {
        const names = new Set();
        msgs.forEach(m => names.add(m.sender));
        myChats.forEach(c => { const p = dmPeer(c, currentUser); if (p) names.add(p); });
        userSearchResults.forEach(u => names.add(u));
        const missing = [...names].filter(n => n && !(n in userIcons));
        if (!missing.length) return;
        actions.getUserIcons(missing).then(map => {
            setUserIcons(prev => ({ ...prev, ...Object.fromEntries(missing.map(n => [n, map[n] || null])) }));
        });
        // eslint-disable-next-line
    }, [msgs, myChats, userSearchResults]);


    return (
        <div className={`app theme-${theme} ${fastMode ? 'perf-fast' : ''}`} style={{ '--wc-accent': accent, '--wc-msg-own-bg': `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
            {viewMode === 'posts' && (
                <PostsFeed
                    username={currentUser}
                    actions={actions}
                    sortMode={postsSortMode}
                    setSortMode={setPostsSortMode}
                    sidebarWidth={isSidebarVisible ? sidebarWidth : 0}
                    activePaablik={activePaablik}
                    canWrite={pabliks.find(p => p.id === activePaablik)?.isSubscribed ?? true}
                />
            )}

            <button className={`toggle-sidebar-btn ${isSidebarVisible ? "" : "collapsed"}`} onClick={() => setIsSidebarVisible(!isSidebarVisible)}>
                {isSidebarVisible ? "◀" : "▶"}
            </button>

            <aside className={`sidebar ${isSidebarVisible ? "" : "hidden"}`} style={{ width: sidebarWidth }}>
                <div className="user-card-row">
                    <div className="user-card">WavyChat</div>
                    {POSTS_ENABLED && (
                      <div className="wc-mode-switch">
                          <button className={viewMode === 'chats' ? 'active' : ''} onClick={() => setViewMode('chats')}>💬 Чаты</button>
                          <button className={viewMode === 'posts' ? 'active' : ''} onClick={() => setViewMode('posts')}>📰 Посты</button>
                      </div>
                    )}
                </div>
                
                {viewMode === 'chats' && (
                <>
                <div className="sidebar-tools">
                    <input 
                        className="search-input"
                        placeholder={tr('searchPlaceholder')} 
                        value={searchQuery}
                        onFocus={() => setSearchFiltersOpen(true)}
                        onBlur={() => setTimeout(() => { if (!searchQuery) setSearchFiltersOpen(false); }, 150)}
                        onChange={async (e) => {
                            const q = e.target.value;
                            setSearchQuery(q);
                            if (q.length > 0) {
                                const [res, users] = await Promise.all([
                                    actions.searchGlobal(q),
                                    actions.searchUsers(q),
                                ]);
                                setSearchResults(res);
                                setUserSearchResults(users.filter(u => u !== currentUser));
                            } else {
                                setSearchResults([]);
                                setUserSearchResults([]);
                            }
                        }}
                    />
                    <button className="create-btn" onClick={() => setShowCreateModal(true)}>+</button>
                </div>

                {searchFiltersOpen && (
                    <div className="search-filters">
                        <div className="filter-group">
                            {['all', 'group', 'channel'].map(t => (
                                <button key={t} className={searchFilters.type === t ? 'filter-chip active' : 'filter-chip'} onClick={() => setSearchFilters(f => ({ ...f, type: t }))}>
                                    {t === 'all' ? 'Все типы' : t === 'group' ? 'Группы' : 'Каналы'}
                                </button>
                            ))}
                        </div>
                        <div className="filter-group">
                            {['all', 'public', 'private'].map(p => (
                                <button key={p} className={searchFilters.privacy === p ? 'filter-chip active' : 'filter-chip'} onClick={() => setSearchFilters(f => ({ ...f, privacy: p }))}>
                                    {p === 'all' ? 'Любой доступ' : p === 'public' ? 'Публичные' : 'С паролем'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="chat-list">
                    {userSearchResults.length > 0 && (
                        <>
                            <small className="section-title">Люди</small>
                            {userSearchResults.map(u => (
                                <div key={u} className="search-item">
                                    <div className="avatar"><img src={avatarSrc(u)} alt="" className="avatar-img" /></div>
                                    <div className="info">
                                        <strong className="chat-title">{u}</strong>
                                        <button className="join-action" onClick={async () => {
                                            try {
                                                const res = await actions.startDirectChat(currentUser, u);
                                                if (res.success) {
                                                    await loadMyChats(currentUser);
                                                    setSearchQuery(''); setUserSearchResults([]); setSearchResults([]);
                                                    setActive({ id: res.chatId, title: [currentUser, u].sort().join('__dm__'), type: 'dm', admin: currentUser });
                                                    await loadChatMessages(res.chatId);
                                                } else {
                                                    alert(res.error || 'Не удалось начать чат');
                                                }
                                            } catch (err) {
                                                alert('Ошибка при создании чата: ' + err.message);
                                            }
                                        }}>{tr('write')}</button>
                                    </div>
                                </div>
                            ))}
                            <small className="section-title">Чаты</small>
                        </>
                    )}
                    {searchResults
                        .filter(c => c.type !== 'dm') // личные чаты не должны всплывать в общем поиске
                        .filter(c => searchFilters.type === 'all' || !c.type || c.type === searchFilters.type)
                        .filter(c => searchFilters.privacy === 'all' || !c.privacy || c.privacy === searchFilters.privacy)
                        .map(c => (
                        <div key={c.id} className="search-item">
                            <div className="avatar">
                                {renderChatIcon(c.icon, c.title)}
                            </div>
                            <div className="info">
                                <strong className="chat-title">{c.title}</strong>
                                <button className="join-action" onClick={() => handleJoinChat(c)}>{tr('join')}</button>
                            </div>
                        </div>
                    ))}


                    <small className="section-title">{tr('myChats')}</small>
                    {myChats.map(c => {
                        const disp = chatDisplay(c);
                        const isDm = c.type === 'dm';
                        return (
                        <div key={c.id} className={`chat-item ${active?.id === c.id ? 'active' : ''}`} 
                            onClick={() => { openChat(c); }}>
                            <div className="avatar">
                                {disp.icon}
                            </div>

                            <div className="info">
                                <strong>{disp.title}</strong>
                                <div className="admin-controls">
                                    {!isDm && c.admin === currentUser && (
                                        <>
                                            <button onClick={(e) => { 
                                                e.stopPropagation(); 
                                                const n = prompt("New name:", c.title);
                                                if(n) actions.renameChat(c.id, n).then(() => loadMyChats(currentUser));
                                            }}>✏️</button>
                                            
                                            <button onClick={(e) => {
                                                e.stopPropagation();
                                                if(confirm("Удалить группу целиком, вместе со всеми файлами (если они больше нигде не используются)?")) 
                                                    actions.deleteChatCompletely(c.id, getChatPw(c.id)).then(() => { if (active?.id === c.id) setActive(null); loadMyChats(currentUser); });
                                            }}>🗑️</button>

                                           <button onClick={(e) => {
                                                e.stopPropagation();
                                                setTargetChatId(c.id); 
                                                groupIconRef.current.click(); 
                                            }}>🖼️</button>
                                            
                                        </>
                                    )}
                                    <button onClick={async (e) => {
                                        e.stopPropagation();
                                        const confirmMsg = isDm
                                            ? `Удалить переписку с "${disp.title}"? Чат и файлы удалятся у обоих.`
                                            : (c.admin === currentUser ? `Выйти из "${c.title}"? Владение перейдёт другому участнику (или чат удалится, если он последний).` : `Leave group "${c.title}"?`);
                                        if (confirm(confirmMsg)) {
                                            await actions.leaveChatSmart(c.id, currentUser);
                                            if (active?.id === c.id) setActive(null);
                                            loadMyChats(currentUser);
                                        }
                                    }}>🚪 {isDm ? 'Удалить' : 'Leave'}</button>
                                    <button title="Пожаловаться на этот чат" onClick={async (e) => {
                                        e.stopPropagation();
                                        const reason = prompt('Опиши, что не так с этим чатом — жалоба попадёт в очередь модерации:');
                                        if (reason && reason.trim()) {
                                            const res = await actions.reportChat(currentUser, c.id, reason.trim());
                                            if (res?.success === false) alert('Не получилось отправить жалобу: ' + (res.error || 'неизвестная ошибка'));
                                            else alert('Жалоба отправлена.');
                                        }
                                    }}>🚩</button>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
                </>
                )}

                {viewMode === 'posts' && (
                    <div className="wc-posts-sidebar-filters">
                        <div className="wc-posts-sidebar-title">Паблики</div>
                        {pabliks.map(p => (
                            <div key={p.id} className="wc-paablik-row">
                                <button
                                    className={activePaablik === p.id ? 'wc-posts-sidebar-btn active' : 'wc-posts-sidebar-btn'}
                                    onClick={() => {
                                        if (!p.isSubscribed) {
                                            if (p.privacy === 'private') setJoinPaablikPrompt(p);
                                            else handleJoinPaablik(p);
                                            return;
                                        }
                                        setActivePaablik(p.id);
                                    }}
                                >
                                    {p.icon || '📰'} {p.title}
                                    {p.privacy === 'private' && !p.isSubscribed && ' 🔒'}
                                </button>
                                {!p.isSubscribed && <span className="wc-paablik-join-hint">вступить</span>}
                            </div>
                        ))}
                        <button className="wc-posts-sidebar-btn wc-paablik-create-btn" onClick={() => setCreatePaablikOpen(true)}>➕ Создать паблик</button>
                    </div>
                )}

                <button className="sidebar-settings-btn" onClick={() => setSettingsOpen(true)}>
                    ⚙️ Настройки
                </button>
            </aside>
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content create-chat-modal" onClick={e => e.stopPropagation()}>
                        <div className="create-modal-logo">
                            <div className="logo-badge">🦜</div>
                            <h3>Новый чат</h3>
                        </div>

                        <div className="create-icon-row">
                            <div className="create-icon-preview">
                                {newChatData.icon ? renderChatIcon(newChatData.icon, newChatData.title || '?') : <span className="avatar-letter">{newChatData.title?.[0]?.toUpperCase() || '?'}</span>}
                            </div>
                            <div className="form-item" style={{ flex: 1 }}>
                                <input 
                                    className="modal-input"
                                    placeholder="Название..." 
                                    value={newChatData.title}
                                    onChange={e => setNewChatData({...newChatData, title: e.target.value})}
                                />
                                <label className="file-label">
                                    {newChatData.icon?.startsWith('data:') ? "✅ Файл выбран" : "📁 Загрузить картинку"}
                                    <input type="file" accept="image/*" onChange={handleIconUpload} style={{display: 'none'}} />
                                </label>
                            </div>
                        </div>

                        <small className="section-title" style={{ padding: '4px 0' }}>Или выбрать эмодзи-иконку</small>
                        <div className="icon-emoji-grid">
                            {CHAT_ICON_EMOJIS.map(em => (
                                <span key={em} className={`icon-emoji-item ${newChatData.icon === em ? 'selected' : ''}`}
                                    onClick={() => setNewChatData(d => ({ ...d, icon: em }))}>{em}</span>
                            ))}
                        </div>

                        {newChatData.privacy === 'private' && (
                            <input 
                                className="modal-input"
                                type="password"
                                placeholder="Create a password for private chat..." 
                                value={newChatData.password}
                                onChange={e => setNewChatData({...newChatData, password: e.target.value})}
                            />
                        )}
                        <div style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
                            <select className="modal-select" value={newChatData.type} onChange={e => setNewChatData({...newChatData, type: e.target.value})}>
                                <option value="group">Group</option>
                                <option value="channel">Channel</option>
                            </select>
                            <select className="modal-select" value={newChatData.privacy} onChange={e => setNewChatData({...newChatData, privacy: e.target.value})}>
                                <option value="public">Public</option>
                                <option value="private">Private</option>
                            </select>
                        </div>

                        <div style={{display: 'flex', gap: '10px'}}>
                            <button className="cancel-btn" style={{flex: 1}} onClick={() => setShowCreateModal(false)}>{tr('cancel')}</button>
                            <button className="confirm-btn" style={{flex: 1, background: '#4c8dff', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer'}} onClick={handleCreateChat}>Create</button>
                        </div>
                    </div>
                </div>
            )}
            <main className="chat-area">
                {active ? (
                    <>
                        <header className="chat-header" style={{ paddingRight: navOffset || 25 }}>
                            <div className="header-info">
                                <div className="avatar header-avatar" onClick={openGroupInfo} title={active.type === 'dm' ? '' : 'Инфо о группе'}>
                                    {chatDisplay(active).icon}
                                </div>
                                <div className="header-titles" onClick={openGroupInfo}>
                                    <strong>{chatDisplay(active).title}</strong>
                                    <span className="sub">{active.type === 'dm' ? 'личный чат' : `${msgs.length} сообщений`}</span>
                                </div>
                                <div className="call-controls">
                                    {!inCall && !activeCallInfo && (
                                        <button onClick={handleStartCall} className="call-btn start">📞</button>
                                    )}

                                    {!inCall && activeCallInfo && (
                                        <button onClick={handleJoinCall} className="call-btn join">📞 Join</button>
                                    )}
                                </div>
                            </div>

                            {selected.length > 0 && (
                                <div className="batch-actions">
                                    <button onClick={deleteSelected} className="del-btn">{tr('delete')} ({selected.length})</button>
                                    <button onClick={() => setSelected([])} className="cancel-btn">{tr('cancel')}</button>
                                </div>
                            )}
                        </header>

                        <div className="messages" ref={scrollRef} onScroll={e => { if (e.target.scrollTop < 80) loadOlderMessages(); }}>
                            {loadingOlder && <div className="loading-older">Загрузка...</div>}
                            {msgs.map(m => {
                                const files = typeof m.media === 'string' ? JSON.parse(m.media) : [];
                                const isPoll = m.text?.startsWith('📊POLL:');
                                const isRich = m.text?.startsWith('📝MD:');
                                const isLoc = m.text?.startsWith('📍LOC:');
                                const quoteMatch = (!isPoll && !isRich && !isLoc && m.text?.startsWith('↩ ')) ? m.text.split('\n') : null;
                                const quoteLine = quoteMatch ? quoteMatch[0].slice(2) : null;
                                const bodyText = quoteMatch ? quoteMatch.slice(1).join('\n') : (!isPoll && !isRich && !isLoc ? m.text : null);
                                const msgReactions = reactions[m.id] || [];
                                const grouped = msgReactions.reduce((acc, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {});

                                let pollData = null, richData = null, locData = null;
                                if (isPoll) { try { pollData = JSON.parse(m.text.slice(7)); } catch {} }
                                if (isRich) { try { richData = JSON.parse(m.text.slice(5)); } catch {} }
                                if (isLoc) { const [lat, lng] = m.text.slice(6).split(','); locData = { lat, lng }; }

                                const urlRe = /https?:\/\/[^\s]+/g;
                                const foundUrl = bodyText ? bodyText.match(urlRe)?.[0] : null;
                                const preview = foundUrl ? linkPreviews[foundUrl] : null;

                                return (
                                    <div key={m.id} 
                                         className={`msg-wrapper ${m.sender === currentUser ? 'me' : ''} ${selected.includes(m.id) ? 'selected' : ''}`}
                                         onClick={() => toggleSelect(m.id)}>
                                        {m.sender !== currentUser && (
                                            <img src={avatarSrc(m.sender)} alt="" className="msg-avatar" />
                                        )}
                                        <div className="bubble">
                                            <div className="bubble-top">
                                                {active.type !== 'dm' && <div className="sender">{m.sender}</div>}
                                                <div className="msg-actions" onClick={e => e.stopPropagation()}>
                                                    <button className="mini-icon" onClick={() => startReply(m)} title={tr('reply')}>↩</button>
                                                    <button className="mini-icon" onClick={() => setForwardMsg(m)} title={tr('forward')}>➦</button>
                                                    <button className="mini-icon" onClick={() => setReactionPickerFor(reactionPickerFor === m.id ? null : m.id)} title={tr('react')}>🙂</button>
                                                </div>
                                            </div>

                                            {reactionPickerFor === m.id && (
                                                <div className="reaction-picker" onClick={e => e.stopPropagation()}>
                                                    {REACTION_EMOJIS.map(em => (
                                                        <span key={em} onClick={() => handleToggleReaction(m.id, em)}>{em}</span>
                                                    ))}
                                                </div>
                                            )}

                                            {quoteLine && <div className="quote-block">{quoteLine}</div>}

                                            {isLoc && locData && (
                                                <a className="loc-card" href={`https://www.openstreetmap.org/?mlat=${locData.lat}&mlon=${locData.lng}#map=15/${locData.lat}/${locData.lng}`}
                                                   target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>
                                                    📍 <div><b>Геопозиция</b><span>Открыть на карте</span></div>
                                                </a>
                                            )}

                                            {isPoll && pollData && (
                                                <PollCard msgId={m.id} data={pollData} votes={pollVotesByMsg[m.id] || []} currentUser={currentUser} onVote={handleVotePoll} />
                                            )}

                                            {isRich && richData && (
                                                <RichCard msgId={m.id} data={richData} expanded={!!expandedRichMsgs[m.id]}
                                                    onToggle={() => setExpandedRichMsgs(prev => ({ ...prev, [m.id]: !prev[m.id] }))} />
                                            )}

                                            {files.length > 0 && (
                                                <div className={`attachment-grid ${files.length === 1 && (files[0].type?.startsWith('image/') || files[0].type?.startsWith('video/')) ? 'single-media' : ''}`}>
                                                    {files.map((file, idx) => {
                                                        const isMedia = file.type?.startsWith('image/') || file.type?.startsWith('video/');
                                                        return (
                                                        <div key={idx} className={`file-item ${isMedia ? 'file-item-media' : 'file-item-full'}`}>
                                                            <AttachmentItem file={file} mine={m.sender === currentUser} getFullFile={getFullFile} single={files.length === 1} />
                                                        </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {bodyText && <div className="text">{bodyText}</div>}

                                            {preview && (
                                                <a className="link-preview-card" href={foundUrl} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}>
                                                    {preview.favicon && <img src={preview.favicon} alt="" onError={e => e.target.style.display = 'none'} />}
                                                    <div><b>{preview.title}</b><span>{new URL(foundUrl).hostname}</span></div>
                                                </a>
                                            )}

                                            {Object.keys(grouped).length > 0 && (
                                                <div className="reaction-row" onClick={e => e.stopPropagation()}>
                                                    {Object.entries(grouped).map(([em, count]) => (
                                                        <span key={em}
                                                            className={`reaction-chip ${msgReactions.some(r => r.username === currentUser && r.emoji === em) ? 'mine' : ''}`}
                                                            onClick={() => handleToggleReaction(m.id, em)}>
                                                            {em} {count}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="time">
                                                {new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                                                {readTicks(m)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="input-panel">
                            {replyTo && (
                                <div className="reply-preview">
                                    <div>
                                        <b>↩ {replyTo.sender}</b>
                                        <span>{replyTo.text.slice(0, 60)}</span>
                                    </div>
                                    <button onClick={() => setReplyTo(null)}>×</button>
                                </div>
                            )}
                            {pendingFiles.length > 0 && (
                                <div className="attachment-preview">
                                    {pendingFiles.map((f, i) => (
                                        <div key={f.localId || i} className={`chip ${f.status && f.status !== 'ready' ? 'chip-busy' : ''}`}>
                                            {f.type?.startsWith('image/') ? <img src={f.thumb || f.localPreview} className="chip-thumb" alt="" /> :
                                             f.type === 'audio/voice+webm' ? `🎤 ${f.duration || 0}с` :
                                             f.type?.startsWith('video/') ? (f.thumb || f.localPreview ? <img src={f.thumb || f.localPreview} className="chip-thumb" alt="" /> : '🎥 Видео') :
                                             f.type?.startsWith('audio/') ? '🎵 Аудио' :
                                             `${f.name.slice(0,14)}...`}
                                            {f.status && f.status !== 'ready' && (
                                                <span className="chip-status" title={f.status === 'processing' ? 'Обрабатывается…' : 'Загружается…'}>
                                                    <span className="chip-spinner" />
                                                </span>
                                            )}
                                            <button onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {isRecording && (
                                <div className="recording-indicator">
                                    🔴 Запись голосового... {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, '0')}
                                </div>
                            )}
                            
                            <div className="input-row">
                                <button className="tool-btn" onClick={() => setShowEmoji(!showEmoji)}>😊</button>

                                <div className="attach-wrapper">
                                    <button className="tool-btn" onClick={() => setAttachMenuOpen(v => !v)}>➕</button>
                                    {attachMenuOpen && (
                                        <div className="attach-menu">
                                            <button onClick={() => imgFileRef.current.click()}>🖼️ Изображение</button>
                                            <button onClick={() => videoFileRef.current.click()}>🎥 Видео</button>
                                            <button onClick={() => { fileRef.current.click(); setAttachMenuOpen(false); }}>📎 Файл</button>
                                            <button onClick={sendGeolocation}>📍 Геопозиция</button>
                                            <button onClick={openPollModal}>📊 Опрос</button>
                                            <button onClick={openRichModal}>📝 Форматированное сообщение</button>
                                        </div>
                                    )}
                                </div>

                                <button 
                                        className={`voice-btn ${isRecording ? 'recording' : ''}`}
                                        onMouseDown={startRecording}
                                        onMouseUp={stopRecording}
                                        onTouchStart={startRecording}
                                        onTouchEnd={stopRecording}
                                        title="Hold to record voice"
                                    >
                                        {isRecording ? '🛑' : '🎤'}
                                    </button>
                                <input 
                                    value={text} 
                                    onChange={e => setText(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && onSend()}
                                    placeholder={pendingFiles.some(f => f.type === 'audio/voice+webm') ? 'Подпись к голосовому...' : 'Message...'}
                                />
                                
                                <button className="send-btn" onClick={onSend} disabled={loading}>
                                    {loading ? '...' : '➤'}
                                </button>
                            </div>

                            {showEmoji && (
                                <div className="emoji-picker">
                                    <div className="emoji-grid">
                                        {ALL_EMOJIS.map((emoji, index) => (
                                        <span 
                                            key={index} 
                                            className="emoji-item" 
                                            onClick={() => addEmoji(emoji)}
                                        >
                                            {emoji}
                                        </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <input type="file" ref={fileRef} multiple hidden onChange={onFileChange} />
                            <input type="file" ref={imgFileRef} accept="image/*" hidden onChange={onImageFileChange} />
                            <input type="file" ref={videoFileRef} accept="video/*" hidden onChange={onVideoFileChange} />
                        </div>

                        {pollModalOpen && (
                            <div className="modal-overlay" onClick={() => setPollModalOpen(false)}>
                                <div className="modal-content" onClick={e => e.stopPropagation()}>
                                    <h3>📊 Новый опрос</h3>
                                    <input className="modal-input" placeholder="Вопрос" value={pollDraft.q} onChange={e => setPollDraft(d => ({ ...d, q: e.target.value }))} />
                                    {pollDraft.options.map((opt, i) => (
                                        <input key={i} className="modal-input" placeholder={`Вариант ${i + 1}`} value={opt}
                                            onChange={e => setPollDraft(d => ({ ...d, options: d.options.map((o, idx) => idx === i ? e.target.value : o) }))} />
                                    ))}
                                    {pollDraft.options.length < 6 && (
                                        <button className="cancel-btn" style={{ width: '100%', marginBottom: 10 }} onClick={() => setPollDraft(d => ({ ...d, options: [...d.options, ''] }))}>+ Вариант</button>
                                    )}
                                    <button className="confirm-btn" style={{ width: '100%', background: '#4c8dff', border: 'none', color: '#fff', borderRadius: '12px', padding: '10px', cursor: 'pointer' }} onClick={submitPoll}>Создать опрос</button>
                                </div>
                            </div>
                        )}

                        {richModalOpen && (
                            <div className="modal-overlay" onClick={() => setRichModalOpen(false)}>
                                <div className="modal-content rich-modal" onClick={e => e.stopPropagation()}>
                                    <h3>📝 Форматированное сообщение</h3>
                                    <input className="modal-input" placeholder="Заголовок (например: Архитектура Б)" value={richDraft.title} onChange={e => setRichDraft(d => ({ ...d, title: e.target.value }))} />
                                    <textarea className="modal-input rich-textarea" placeholder="Markdown: заголовки, **жирный**, таблицы, списки, `код`, ![картинка](url)..." value={richDraft.md} onChange={e => setRichDraft(d => ({ ...d, md: e.target.value }))} />
                                    <label className="upload-btn" style={{ display: 'block', textAlign: 'center', marginBottom: 10 }}>
                                        {richDraft.image ? '✓ Картинка добавлена' : '🖼️ Прикрепить картинку'}
                                        <input type="file" accept="image/*" hidden onChange={async e => {
                                            const f = e.target.files?.[0]; if (!f) return;
                                            const { dataUrl } = await compressImageToJPEG(f);
                                            setRichDraft(d => ({ ...d, image: dataUrl }));
                                        }} />
                                    </label>
                                    <button className="confirm-btn" style={{ width: '100%', background: '#4c8dff', border: 'none', color: '#fff', borderRadius: '12px', padding: '10px', cursor: 'pointer' }} onClick={submitRich}>Отправить</button>
                                </div>
                            </div>
                        )}
                    </>
                ) : <div className="empty">Select a chat to start communicating</div>}
            </main>
                <input 
                type="file" 
                ref={groupIconRef} 
                hidden 
                accept="image/*"
                onChange={(e) => {
                    if (targetChatId) {
                        onIconChange(e, targetChatId);
                        e.target.value = ""; 
                        setTargetChatId(null);
                    }
                }} 
            />
            {inCall && activeCallInfo && (
                <CallWindow 
                    currentUser={currentUser} 
                    activeCall={activeCallInfo} 
                    onEnd={handleEndCall} 
                />
            )}

            {createPaablikOpen && (
                <CreatePaablikModal onClose={() => setCreatePaablikOpen(false)} onCreate={handleCreatePaablik} />
            )}

            {joinPaablikPrompt && (
                <JoinPaablikModal
                    paablik={joinPaablikPrompt}
                    onClose={() => setJoinPaablikPrompt(null)}
                    onJoin={(password) => handleJoinPaablik(joinPaablikPrompt, password)}
                />
            )}

            {inviteModalOpen && active && (
                <div className="modal-overlay" onClick={() => setInviteModalOpen(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>🔗 Ссылка-приглашение</h3>
                        {active.privacy === 'private' && (
                            <div className="settings-row" style={{ marginBottom: 10 }}>
                                <span>Вшить пароль в ссылку</span>
                                <button className={`switch ${inviteIncludePw ? 'on' : ''}`} onClick={() => setInviteIncludePw(v => !v)}>
                                    <span className="switch-knob" />
                                </button>
                            </div>
                        )}
                        <p className="hint" style={{ marginBottom: 8 }}>
                            {active.privacy === 'private' && !inviteIncludePw
                                ? 'Без пароля в ссылке — тот, кто перейдёт, должен будет ввести его сам.'
                                : 'Переход по ссылке сразу добавляет человека в чат.'}
                        </p>
                        <input
                            className="modal-input"
                            readOnly
                            value={`${typeof window !== 'undefined' ? window.location.origin : ''}/WavyChat?join=${active.id}${active.privacy === 'private' && inviteIncludePw ? `&pw=${encodeURIComponent(active.password || '')}` : ''}`}
                            onClick={e => e.target.select()}
                        />
                        <button className="wide-btn primary" style={{ marginTop: 10 }} onClick={() => {
                            const url = `${window.location.origin}/WavyChat?join=${active.id}${active.privacy === 'private' && inviteIncludePw ? `&pw=${encodeURIComponent(active.password || '')}` : ''}`;
                            navigator.clipboard?.writeText(url);
                        }}>Скопировать</button>
                        <button className="cancel-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setInviteModalOpen(false)}>Закрыть</button>
                    </div>
                </div>
            )}

            {pendingInvite && inviteError && (
                <div className="modal-overlay" onClick={() => { setPendingInvite(null); setInviteError(''); }}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>🔒 Нужен пароль</h3>
                        <p className="hint" style={{ marginBottom: 10 }}>{inviteError}</p>
                        <input className="modal-input" type="password" placeholder="Пароль чата"
                            onKeyDown={e => { if (e.key === 'Enter') setPendingInvite(prev => ({ ...prev, pw: e.target.value })); }}
                            id="invite-pw-input" />
                        <button className="wide-btn primary" onClick={() => {
                            const val = document.getElementById('invite-pw-input')?.value || '';
                            setInviteError('');
                            setPendingInvite(prev => ({ ...prev, pw: val }));
                        }}>Войти</button>
                        <button className="cancel-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => { setPendingInvite(null); setInviteError(''); }}>Отмена</button>
                    </div>
                </div>
            )}

            {incomingCall && (
                <div className="incoming-call-banner">
                    <div className="avatar" style={{ width: 40, height: 40 }}>
                        {incomingCall.chat.type === 'dm'
                            ? <img src={avatarSrc(incomingCall.callerName)} alt="" className="avatar-img" />
                            : renderChatIcon(incomingCall.chat.icon, incomingCall.chat.title)}
                    </div>
                    <div className="incoming-call-info">
                        <b>{incomingCall.chat.type === 'dm' ? `Звонок от ${incomingCall.callerName}` : chatDisplay(incomingCall.chat).title}</b>
                        <span>{incomingCall.chat.type === 'dm' ? 'Входящий звонок' : `${incomingCall.callerName} начал звонок`}</span>
                    </div>
                    {incomingCall.chat.type === 'dm' ? (
                        <div className="incoming-call-actions">
                            <button className="call-accept" onClick={acceptIncomingCall}>✓ Принять</button>
                            <button className="call-decline" onClick={declineIncomingCall}>✕ Отклонить</button>
                        </div>
                    ) : (
                        <div className="incoming-call-actions">
                            <button className="call-accept" onClick={acceptIncomingCall}>📞 Подключиться</button>
                            <button className="call-decline" onClick={dismissIncomingCall}>Скрыть</button>
                        </div>
                    )}
                </div>
            )}

            {settingsOpen && (
                <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
                    <div className="modal-content settings-modal" onClick={e => e.stopPropagation()}>
                        <h3>⚙️ Настройки</h3>

                        <small className="section-title" style={{ padding: '0 0 8px' }}>Аватарка (360×360)</small>
                        <p className="hint" style={{ marginBottom: 14 }}>Настраивается в общих настройках сайта (⚙️ ParrotOS)</p>

                        <small className="section-title" style={{ padding: '4px 0 8px' }}>Тема</small>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            {[['auto', 'Как в системе'], ['light', 'Светлая'], ['midnight', 'Тёмная']].map(([val, label]) => (
                                <button key={val} className={`wide-btn ${theme === val || (val === 'auto' && !localStorage.getItem('p_wc_theme_override')) ? 'primary' : ''}`}
                                    style={{ flex: 1, fontSize: 12, padding: '8px 4px' }}
                                    onClick={() => updateTheme(val)}>{label}</button>
                            ))}
                        </div>

                        <small className="section-title" style={{ padding: '14px 0 8px' }}>Ширина списка чатов</small>
                        <div className="slider-row">
                            <input type="range" min="240" max="420" value={sidebarWidth} onChange={e => changeSidebarWidth(Number(e.target.value))} />
                            <span>{sidebarWidth}px</span>
                        </div>

                        <small className="section-title" style={{ padding: '14px 0 8px' }}>Уведомления</small>
                        <div className="settings-row">
                            <span>Сообщения из других чатов</span>
                            <button className={`switch ${msgNotifEnabled ? 'on' : ''}`} onClick={toggleMsgNotif}>
                                <span className="switch-knob" />
                            </button>
                        </div>
                        {notifPermission !== 'granted' && (
                            <button className="wide-btn primary" onClick={requestNotifPermission}>
                                {notifPermission === 'denied' ? 'Разрешить в настройках браузера' : 'Разрешить уведомления'}
                            </button>
                        )}
                        <small className="section-title" style={{ padding: '4px 0 8px' }}>🎨 Акцентный цвет</small>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                            {['#4c8dff', '#7c6ff0', '#ec4899', '#22c55e', '#f59e0b', '#ef4444'].map(c => (
                                <button key={c} onClick={() => updateAccent(c)} style={{
                                    width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer',
                                    border: accent === c ? '2px solid var(--wc-text)' : '2px solid transparent', padding: 0,
                                }} />
                            ))}
                        </div>

                        <p className="hint" style={{ marginBottom: 6 }}>2FA — теперь в общих настройках аккаунта (⚙️ ParrotOS)</p>

                        <button className="cancel-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => setSettingsOpen(false)}>Закрыть</button>
                    </div>
                </div>
            )}

            {forwardMsg && (
                <div className="modal-overlay" onClick={() => setForwardMsg(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3>➦ Переслать сообщение</h3>
                        <div className="album-pick-list">
                            {myChats.map(c => (
                                <button key={c.id} className="wide-btn" onClick={() => forwardToChat(c)}>
                                    {chatDisplay(c).title}
                                </button>
                            ))}
                            {myChats.length === 0 && <p className="hint">Нет доступных чатов</p>}
                        </div>
                        <button className="cancel-btn" style={{ width: '100%' }} onClick={() => setForwardMsg(null)}>Отмена</button>
                    </div>
                </div>
            )}

            {groupInfoOpen && active && (
                <div className="modal-overlay" onClick={() => setGroupInfoOpen(false)}>
                    <div className="modal-content group-info" onClick={e => e.stopPropagation()}>
                        <div className="gi-header">
                            <div className="avatar gi-avatar" onClick={() => { if (isActiveAdmin) { setTargetChatId(active.id); groupIconRef.current.click(); } }}>
                                {renderChatIcon(active.icon, active.title)}
                                {isActiveAdmin && <span className="gi-avatar-edit">✏️</span>}
                            </div>
                            {editingTitle ? (
                                <div className="gi-title-edit">
                                    <input className="modal-input" value={titleDraft} onChange={e => setTitleDraft(e.target.value)} autoFocus />
                                    <button className="mini-icon" onClick={saveGroupTitle}>✓</button>
                                </div>
                            ) : (
                                <h3 onClick={() => isActiveAdmin && setEditingTitle(true)}>
                                    {active.title} {isActiveAdmin && <span className="edit-hint">✏️</span>}
                                </h3>
                            )}
                        </div>

                        {isActiveAdmin && (
                            <div className="gi-add-member">
                                <input className="modal-input" placeholder="Имя пользователя..." value={newMemberName} onChange={e => setNewMemberName(e.target.value)} />
                                <button className="confirm-btn" onClick={handleAddMember}>Добавить</button>
                            </div>
                        )}

                        <button className="wide-btn" style={{ marginBottom: 14 }} onClick={() => setInviteModalOpen(true)}>🔗 Пригласить по ссылке</button>

                        <small className="section-title">Участники ({chatMembers.length})</small>
                        <div className="gi-member-list">
                            {chatMembers.map(u => (
                                <div key={u} className="gi-member-row">
                                    <div className="avatar mini-av"><span className="avatar-letter">{u[0]?.toUpperCase()}</span></div>
                                    <span className="gi-member-name">{u}{u === active.admin && ' 👑'}{chatAdmins.includes(u) && u !== active.admin && ' 🛡️'}</span>
                                    {isActiveAdmin && u !== active.admin && u !== currentUser && (
                                        <div className="gi-member-actions">
                                            <button className="mini-icon" onClick={() => handleToggleAdmin(u)} title={chatAdmins.includes(u) ? 'Снять админа' : 'Сделать админом'}>
                                                {chatAdmins.includes(u) ? '🛡️✕' : '🛡️+'}
                                            </button>
                                            <button className="mini-icon danger" onClick={() => handleRemoveMember(u)} title="Убрать из группы">✕</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {chatMembers.length === 0 && <p className="gi-empty">Список участников пуст или недоступен.</p>}
                        </div>

                        {isActiveAdmin && (
                            <div className="gi-privacy">
                                <small className="section-title" style={{ padding: '10px 0 6px' }}>Доступ к чату</small>
                                <div className="two-col">
                                    <button className={active.privacy !== 'private' ? 'wide-btn primary' : 'wide-btn'} onClick={() => saveGroupPrivacy('public')}>🌐 Публичный</button>
                                    <button className={active.privacy === 'private' ? 'wide-btn primary' : 'wide-btn'} onClick={() => setPrivacyDraft(d => ({ ...d, privacy: 'private' }))}>🔒 Приватный</button>
                                </div>
                                {(privacyDraft.privacy === 'private' || active.privacy === 'private') && (
                                    <div className="cover-row">
                                        <input className="modal-input" type="password" placeholder="Пароль"
                                            value={privacyDraft.password} onChange={e => setPrivacyDraft(d => ({ ...d, password: e.target.value }))} />
                                        <button className="pill-btn primary" onClick={() => saveGroupPrivacy('private')}>Сохранить</button>
                                    </div>
                                )}
                            </div>
                        )}

                        <button className="cancel-btn" style={{ width: '100%', marginTop: 15 }} onClick={() => setGroupInfoOpen(false)}>Закрыть</button>
                    </div>
                </div>
            )}
            <style jsx>{`
                .app { display: flex; height: 100vh; background: var(--wc-bg, #000); color: var(--wc-text, #f2f2f2); font-family: 'Google Sans', 'Segoe UI', -apple-system, sans-serif; overflow: hidden; }
                .app.theme-gemini { --wc-bg: #000; --wc-surface: #0a0a0a; --wc-surface2: #141414; --wc-bubble: #161616; --wc-border: #262626; --wc-text: #f2f2f2; --wc-accent: #4c8dff; --wc-chip-bg: rgba(255,255,255,0.08); --wc-chip-bg-hover: rgba(255,255,255,0.16); --wc-chip-text: #f2f2f2; --wc-muted: #9a9a9a; --wc-input-bg: #141414; --wc-input-border: #262626; --wc-search-bg: #141414; --wc-search-border: #262626; --wc-sidebar-btn-hover: #141414; --wc-sidebar-btn-color: #fff; --wc-msg-own-bg: linear-gradient(135deg,#4c8dff,#7a63d6); --wc-cancel-bg: #232323; --wc-cancel-color: #fff; }

                /* Быстрый режим (общий флаг p_fast с ClientInterface) — без блюра,
                   теней, анимаций. Тяжелее всего на слабых устройствах именно они. */
                .app.perf-fast * {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    box-shadow: none !important;
                    animation: none !important;
                    transition: none !important;
                }
                .app.theme-midnight { --wc-bg: #05070f; --wc-surface: #0b0e1a; --wc-surface2: #131728; --wc-bubble: #151a2e; --wc-border: #232a44; --wc-text: #e8ecff; --wc-accent: #7c6ff0; --wc-chip-bg: rgba(255,255,255,0.08); --wc-chip-bg-hover: rgba(255,255,255,0.16); --wc-chip-text: #e8ecff; --wc-muted: #9096b5; --wc-input-bg: #131728; --wc-input-border: #232a44; --wc-search-bg: #0b0e1a; --wc-search-border: #232a44; --wc-sidebar-btn-hover: #131728; --wc-sidebar-btn-color: #e8ecff; --wc-msg-own-bg: linear-gradient(135deg,#7c6ff0,#5c4fe0); --wc-cancel-bg: #1a1f35; --wc-cancel-color: #e8ecff; }
                .app.theme-light { --wc-bg: #f0f2f5; --wc-surface: #ffffff; --wc-surface2: #e8eaed; --wc-bubble: #ffffff; --wc-border: #d0d3da; --wc-text: #16181d; --wc-accent: #1565c0; --wc-chip-bg: rgba(0,0,0,0.07); --wc-chip-bg-hover: rgba(0,0,0,0.13); --wc-chip-text: #16181d; --wc-muted: #4b5563; --wc-input-bg: #ffffff; --wc-input-border: #c0c4cc; --wc-search-bg: #ffffff; --wc-search-border: #c0c4cc; --wc-sidebar-btn-hover: #e2e6ea; --wc-sidebar-btn-color: #16181d; --wc-msg-own-bg: linear-gradient(135deg,#1565c0,#1e88e5); --wc-cancel-bg: #e8eaed; --wc-cancel-color: #16181d; }

                .theme-swatches { display: flex; gap: 10px; margin-bottom: 6px; }
                .theme-swatch { background: none; border: 1px solid #262626; border-radius: 12px; padding: 8px; cursor: pointer; color: #ccc; font-size: 11px; display: flex; flex-direction: column; align-items: center; gap: 6px; flex: 1; }
                .theme-swatch.selected { border-color: #4c8dff; color: #fff; }
                .swatch-preview { width: 100%; height: 30px; border-radius: 8px; display: block; }
                .swatch-preview.gemini { background: linear-gradient(135deg, #000, #4c8dff); }
                .swatch-preview.midnight { background: linear-gradient(135deg, #05070f, #7c6ff0); }
                .swatch-preview.light { background: linear-gradient(135deg, #f5f6f8, #4c8dff); }
                .settings-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 13px; }
                .slider-row { display: flex; align-items: center; gap: 10px; padding: 4px 0 12px; }
                .slider-row input[type="range"] { flex: 1; }
                .slider-row span { font-size: 12px; opacity: 0.6; min-width: 44px; text-align: right; }
                .switch { width: 42px; height: 24px; border-radius: 12px; background: #262626; border: none; cursor: pointer; position: relative; padding: 0; }
                .switch.on { background: #4c8dff; }
                .switch-knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left 0.15s; }
                .switch.on .switch-knob { left: 21px; }
                .settings-modal { width: 340px; }
                .avatar-upload-row { display: flex; align-items: center; gap: 14px; margin-bottom: 4px; }
                .avatar-upload-preview { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: #1a1a1a; }
                .upload-btn { background: #161616; border: 1px solid #262626; color: #7fb0ff; padding: 8px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; }
                .upload-btn:hover { background: #1e1e1e; }
                .sidebar-settings-btn { margin: 8px 12px 12px; background: #0a0a0a; border: 1px solid #1c1c1c; color: #aaa; padding: 10px; border-radius: 12px; cursor: pointer; font-size: 13px; text-align: left; }
                .wc-posts-sidebar-filters { display: flex; flex-direction: column; gap: 6px; padding: 12px; flex: 1; }
                .wc-posts-sidebar-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--wc-muted, #888); margin-bottom: 6px; padding: 0 4px; }
                .wc-posts-sidebar-btn {
                    display: flex; align-items: center; gap: 8px; text-align: left;
                    background: transparent; border: none; color: var(--wc-text, #f2f2f2);
                    padding: 10px 12px; border-radius: 10px; cursor: pointer; font-size: 14px;
                }
                .wc-posts-sidebar-btn:hover { background: var(--wc-sidebar-btn-hover, #141414); }
                .wc-posts-sidebar-btn.active { background: var(--wc-accent); color: #fff; font-weight: 600; }
                .wc-paablik-row { display: flex; align-items: center; gap: 6px; }
                .wc-paablik-row .wc-posts-sidebar-btn { flex: 1; }
                .wc-paablik-join-hint { font-size: 10px; color: var(--wc-muted, #888); padding-right: 8px; }
                .wc-paablik-create-btn { margin-top: 8px; border: 1px dashed var(--wc-border); opacity: 0.8; }
                .sidebar-settings-btn:hover { background: var(--wc-sidebar-btn-hover,#141414); color: var(--wc-sidebar-btn-color,#fff); }
                /* Тонкий кастомный скроллбар вместо системного — во всех прокручиваемых зонах */
                .chat-list, .messages, .group-info, .gi-member-list, .emoji-grid, .icon-emoji-grid {
                    scrollbar-width: thin;
                    scrollbar-color: #333 transparent;
                }
                .chat-list::-webkit-scrollbar, .messages::-webkit-scrollbar, .group-info::-webkit-scrollbar,
                .gi-member-list::-webkit-scrollbar, .emoji-grid::-webkit-scrollbar, .icon-emoji-grid::-webkit-scrollbar { width: 6px; }
                .chat-list::-webkit-scrollbar-track, .messages::-webkit-scrollbar-track, .group-info::-webkit-scrollbar-track,
                .gi-member-list::-webkit-scrollbar-track, .emoji-grid::-webkit-scrollbar-track, .icon-emoji-grid::-webkit-scrollbar-track { background: transparent; }
                .chat-list::-webkit-scrollbar-thumb, .messages::-webkit-scrollbar-thumb, .group-info::-webkit-scrollbar-thumb,
                .gi-member-list::-webkit-scrollbar-thumb, .emoji-grid::-webkit-scrollbar-thumb, .icon-emoji-grid::-webkit-scrollbar-thumb {
                    background: #2a2a2a; border-radius: 10px;
                }
                .chat-list::-webkit-scrollbar-thumb:hover, .messages::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
                .sidebar { width: 320px; border-right: 1px solid var(--wc-border, #161616); background: var(--wc-surface, #0a0a0a); display: flex; flex-direction: column; }
                .user-card { padding: 20px; border-bottom: 1px solid #161616; font-weight: 700; font-size: 16px; background: linear-gradient(90deg, #4c8dff, #9b72cb, #d96570); -webkit-background-clip: text; background-clip: text; color: transparent; }
                .chat-list { flex: 1; overflow-y: auto; }
                .chat-item { display: flex; gap: 14px; padding: 13px 14px; cursor: pointer; transition: background 0.2s cubic-bezier(0.4,0,0.2,1), transform 0.1s; align-items: center; border-radius: 16px; margin: 4px 8px; }
                .chat-item:hover { background: #141414; }
                .chat-item.active { background: linear-gradient(90deg, rgba(76,141,255,0.16), rgba(155,114,203,0.12)); box-shadow: inset 0 0 0 1px rgba(76,141,255,0.35); border-left: none; }
                .avatar {
                    width: 46px;   
                    height: 46px;
                    background: linear-gradient(135deg, #2b2b2b, #1a1a1a);
                    border-radius: 50%;  
                    display: flex;
                    align-items: center; 
                    justify-content: center;
                    overflow: hidden;
                    position: relative;
                    flex-shrink: 0;
                }
                .call-btn {
                    border: none;
                    border-radius: 20px;
                    padding: 8px 16px;
                    cursor: pointer;
                    font-weight: 600;
                    transition: 0.25s cubic-bezier(0.4,0,0.2,1);
                }
                .call-btn.start { background: #1c1c1c; color: #7fb0ff; }
                .call-btn.start:hover { background: #232323; }
                .call-btn.join { 
                    background: linear-gradient(135deg, #4c8dff, #9b72cb);
                    color: white; 
                    animation: pulse-blue 2s infinite; 
                }

                @keyframes pulse-blue {
                    0% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(76, 141, 255, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(76, 141, 255, 0); }
                }
                .search-item {
                    display: flex;
                    align-items: center;
                    padding: 10px 14px;
                    gap: 12px;
                }
                .avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
                .chat-area { flex: 1; display: flex; flex-direction: column; background: var(--wc-bg, #000); position: relative; }
                .chat-header { padding: 16px 25px; border-bottom: 1px solid var(--wc-border, #161616); display: flex; justify-content: space-between; align-items: center; transition: padding-right 0.2s; }
                .header-info { display: flex; align-items: center; gap: 12px; }
                .header-avatar { cursor: pointer; transition: transform 0.15s; }
                .header-avatar:hover { transform: scale(1.05); }
                .header-titles { cursor: pointer; line-height: 1.3; }
                .header-titles .sub { display: block; font-size: 11px; opacity: 0.45; }
                .call-controls { display: flex; gap: 10px; margin-left: 14px; }
                .del-btn { background: #ff4d4d; border: none; color: white; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-weight: 600; margin-right: 10px; }
                .cancel-btn { background: var(--wc-cancel-bg,#232323); border: none; color: var(--wc-cancel-color,#fff); padding: 8px 16px; border-radius: 20px; cursor: pointer; }
                .sidebar-tools { padding: 12px; display: flex; gap: 8px; border-bottom: 1px solid #161616; }
                .search-input { flex: 1; background: var(--wc-search-bg,#141414); border: 1px solid var(--wc-search-border,#262626); border-radius: 20px; padding: 9px 16px; color: var(--wc-text,#fff); font-size: 13px; outline: none; }
                .create-btn { background: linear-gradient(135deg, #4c8dff, #9b72cb); border: none; color: white; width: 36px; height: 36px; border-radius: 12px; cursor: pointer; font-size: 20px; }
                .section-title { padding: 12px 18px 6px; display: block; opacity: 0.4; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
                .join-action { background: linear-gradient(135deg, #4c8dff, #9b72cb); border: none; color: white; padding: 4px 12px; border-radius: 12px; font-size: 11px; cursor: pointer; margin-top: 5px; }
                .messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
                .loading-older { text-align: center; font-size: 11px; opacity: 0.4; padding: 6px 0; }
                .msg-wrapper { max-width: 72%; align-self: flex-start; cursor: pointer; transition: 0.2s; display: flex; gap: 8px; align-items: flex-end; }
                .msg-avatar { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; background: #1a1a1a; }
                .msg-wrapper.me { align-self: flex-end; }
                .bubble { background: var(--wc-bubble, #161616); padding: 10px 16px; border-radius: 20px; position: relative; box-shadow: 0 2px 10px rgba(0,0,0,0.25); color: var(--wc-text, #f2f2f2); }
                .text { font-size: 14.5px; line-height: 1.48; white-space: pre-wrap; word-break: break-word; letter-spacing: 0.1px; }
                .sender { font-size: 11.5px; font-weight: 600; opacity: 0.65; margin-bottom: 3px; letter-spacing: 0.2px; }
                .me .bubble { background: var(--wc-msg-own-bg,linear-gradient(135deg,#4c8dff,#7a63d6)); color: #fff; }
                .bubble-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
                .time { font-size: 10px; opacity: 0.45; text-align: right; margin-top: 5px; display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
                .tick { font-size: 11px; opacity: 0.6; }
                .tick.read { color: #7fb0ff; opacity: 1; }
                .attachment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; margin-bottom: 5px; max-width: 320px; }
                .file-item-full { grid-column: 1 / -1; }
                .file-item-media img, .file-item-media video, .file-item-media .lazy-thumb, .file-item-media .video-poster { width: 100%; height: 100%; }
                .file-item img { max-width: 100%; border-radius: 14px; display: block; }
                .file-item video { max-width: 100%; border-radius: 14px; }
                .doc-file {
                    background: var(--wc-chip-bg); padding: 10px 14px; border-radius: 14px;
                    display: flex; align-items: center; gap: 10px; text-decoration: none;
                    color: var(--wc-chip-text); border: none; cursor: pointer; font-family: inherit;
                    width: 100%; box-sizing: border-box; text-align: left; transition: background 0.15s;
                }
                .doc-file:hover { background: var(--wc-chip-bg-hover); }
                .doc-file-icon {
                    flex-shrink: 0; width: 38px; height: 38px; border-radius: 50%;
                    background: var(--wc-accent); color: #fff; font-size: 16px;
                    display: flex; align-items: center; justify-content: center;
                }
                .doc-file-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                .doc-file-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                .doc-file-meta { font-size: 11px; color: var(--wc-muted); }
                .lazy-thumb { width: 100%; aspect-ratio: 1/1; object-fit: cover; border-radius: 14px; cursor: pointer; display: block; }
                .video-poster { position: relative; width: 100%; aspect-ratio: 1/1; border-radius: 14px; overflow: hidden; cursor: pointer; background: #0a0a0a; display: flex; align-items: center; justify-content: center; }
                .video-poster img { width: 100%; height: 100%; object-fit: cover; }
                .play-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 28px; background: rgba(0,0,0,0.35); color: #fff; }
                .video-duration-badge { position: absolute; left: 8px; bottom: 8px; background: rgba(0,0,0,0.55); color: #fff; font-size: 11px; padding: 2px 7px; border-radius: 8px; z-index: 1; }

                /* ── Динамический размер одиночной картинки/видео (как в Telegram) ──
                   .single-media снимает у .attachment-grid сетку/max-width — вместо
                   квадратной обрезки картинка/видео показывается в СВОИХ пропорциях
                   (aspect-ratio ставится инлайн через file.w/file.h в AttachmentItem),
                   но ограничена по максимальной ширине/высоте — три уровня:
                   ПК (по умолчанию) → планшет (≤768px) → телефон (≤380px), см. те же
                   брейкпоинты, что и в остальном composер/сетке ниже по файлу. */
                .attachment-grid.single-media { display: block; max-width: 380px; }
                .single-media .file-item-media { width: 100%; }
                .dynamic-size { width: auto; max-width: 100%; height: auto; max-height: 420px; object-fit: cover; border-radius: 14px; display: block; }
                .video-poster.dynamic-size { display: flex; } /* поверх object-fit:cover из .video-poster по умолчанию */

                /* ── Чипы вложений в композере: индикатор "обрабатывается/грузится" ── */
                .chip-busy { position: relative; opacity: 0.85; }
                .chip-status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); border-radius: inherit; }
                .chip-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.35); border-top-color: #fff; animation: chip-spin 0.7s linear infinite; }
                @keyframes chip-spin { to { transform: rotate(360deg); } }
                .input-panel { padding: 18px 22px; border-top: 1px solid var(--wc-border, #161616); }
                .input-row { display: flex; gap: 14px; align-items: center; }
                .input-row input { flex: 1; background: var(--wc-surface2, #141414); border: 1px solid var(--wc-border, #262626); padding: 12px 20px; border-radius: 25px; color: var(--wc-text, #f2f2f2); outline: none; transition: border-color 0.2s; }
                .input-row input:focus { border-color: #4c8dff; }
                .tool-btn { background: none; border: none; font-size: 20px; cursor: pointer; border-radius: 50%; width: 38px; height: 38px; flex-shrink: 0; transition: background 0.15s; }
                .tool-btn:hover { background: #1c1c1c; }
                .send-btn { background: none; border: none; color: #4c8dff; font-size: 24px; cursor: pointer; border-radius: 50%; width: 40px; height: 40px; transition: 0.15s; }
                .send-btn:hover { background: rgba(76,141,255,0.15); }
                .emoji-picker {
                    position: absolute;
                    bottom: 80px;
                    left: 20px;
                    width: 300px;         
                    height: 200px;        
                    background: #1e1e2e; 
                    border: 1px solid #333;
                    border-radius: 12px;
                    padding: 10px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.7);
                    display: flex;
                    z-index: 100;
                }
                .emoji-grid {
                    display: grid;
                    grid-template-columns: repeat(6, 1fr);
                    gap: 8px;
                    width: 100%;
                    overflow-y: auto;
                    padding-right: 5px;
                }
                .emoji-item {
                    font-size: 20px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 5px;
                    transition: transform 0.1s, background 0.2s;
                    border-radius: 5px;
                }
                .emoji-item:hover {
                    background: #313244;  
                    transform: scale(1.2); 
                }
                .emoji-grid::-webkit-scrollbar {
                    width: 6px;
                }
                .emoji-grid::-webkit-scrollbar-track {
                    background: #181825;
                    border-radius: 10px;
                }
                .emoji-grid::-webkit-scrollbar-thumb {
                    background: #45475a;
                    border-radius: 10px;
                }
                .emoji-grid::-webkit-scrollbar-thumb:hover {
                    background: #585b70;
                }
                .attachment-preview { display: flex; gap: 10px; margin-bottom: 10px; }
                .chip { background: var(--wc-surface2); color: var(--wc-text); border: 1px solid #4c8dff; padding: 5px 10px; border-radius: 15px; font-size: 11px; }
                .empty { margin: auto; opacity: 0.2; font-size: 20px; font-weight: bold; }
                .voice-btn {
                    background: transparent;
                    border: none;
                    font-size: 20px;
                    cursor: pointer;
                    flex-shrink: 0;
                    transition: transform 0.2s, color 0.2s;
                    user-select: none; 
                }

                .voice-btn.recording {
                    color: #ff4d4d;
                    transform: scale(1.3);
                    animation: pulse-red 1.5s infinite;
                }

                @keyframes pulse-red {
                    0% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.7)); }
                    50% { filter: drop-shadow(0 0 15px rgba(255, 77, 77, 0.9)); }
                    100% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.7)); }
                }
                    .admin-controls {
                    display: flex;
                    gap: 5px;
                    margin-top: 5px;
                    opacity: 0;
                    transition: 0.2s;
                }
                .chat-item:hover .admin-controls {
                    opacity: 1;
                }
                .admin-controls button {
                    background: #222;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                    padding: 2px 5px;
                }
                .admin-controls button:hover {
                    background: #333;
                }
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.75);
                    backdrop-filter: blur(6px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: var(--wc-surface, #121212);
                    color: var(--wc-text);
                    padding: 24px;
                    border-radius: 22px;
                    width: 320px;
                    border: 1px solid var(--wc-border, #262626);
                    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
                }
                .modal-input, .modal-select {
                    width: 100%;
                    background: var(--wc-surface2);
                    border: 1px solid var(--wc-border);
                    color: var(--wc-text);
                    padding: 10px 14px;
                    border-radius: 12px;
                    outline: none;
                    margin-bottom: 10px;
                    box-sizing: border-box;
                }
                .modal-input:focus, .modal-select:focus { border-color: #4c8dff; }

                /* Ответ на сообщение (превью над строкой ввода) */
                .reply-preview {
                    display: flex; justify-content: space-between; align-items: center;
                    background: var(--wc-chip-bg); border-left: 3px solid #4c8dff; border-radius: 10px;
                    padding: 8px 12px; margin-bottom: 10px; font-size: 12px;
                }
                .reply-preview b { color: #7fb0ff; margin-right: 8px; }
                .reply-preview span { opacity: 0.7; }
                .reply-preview button { background: none; border: none; color: #888; font-size: 16px; cursor: pointer; }

                /* Цитата внутри отправленного сообщения-ответа */
                .quote-block {
                    border-left: 3px solid var(--wc-accent);
                    padding: 4px 10px;
                    margin-bottom: 6px;
                    font-size: 11px;
                    opacity: 0.75;
                    border-radius: 6px;
                    background: var(--wc-chip-bg);
                }

                /* Реакции */
                .msg-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
                .bubble:hover .msg-actions { opacity: 1; }
                .mini-icon {
                    background: var(--wc-chip-bg); border: none; color: var(--wc-chip-text);
                    width: 22px; height: 22px; border-radius: 50%; font-size: 11px;
                    cursor: pointer; display: flex; align-items: center; justify-content: center;
                }
                .mini-icon:hover { background: var(--wc-chip-bg-hover); }
                .mini-icon.danger { color: #ff6b6b; }
                .reaction-picker {
                    position: absolute; top: -42px; right: 0;
                    background: #1c1c1c; border: 1px solid #333; border-radius: 20px;
                    padding: 6px 10px; display: flex; gap: 6px; z-index: 50;
                    box-shadow: 0 8px 20px rgba(0,0,0,0.5);
                }
                .reaction-picker span { cursor: pointer; font-size: 16px; transition: transform 0.1s; }
                .reaction-picker span:hover { transform: scale(1.3); }
                .reaction-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
                .reaction-chip {
                    background: var(--wc-chip-bg); color: var(--wc-chip-text); border-radius: 12px; padding: 2px 8px;
                    font-size: 11px; cursor: pointer; transition: 0.15s;
                }
                .reaction-chip:hover { background: var(--wc-chip-bg-hover); }
                .reaction-chip.mine { background: rgba(76,141,255,0.25); box-shadow: inset 0 0 0 1px #4c8dff; }

                /* Панель информации о группе */
                .group-info { width: 360px; max-height: 80vh; overflow-y: auto; }
                .gi-header { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; margin-bottom: 18px; }
                .gi-avatar { width: 84px; height: 84px; font-size: 30px; cursor: pointer; position: relative; }
                .gi-avatar-edit { position: absolute; bottom: 0; right: 0; background: #222; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 12px; }
                .gi-header h3 { margin: 0; cursor: pointer; }
                .edit-hint { font-size: 12px; opacity: 0.5; }
                .gi-title-edit { display: flex; gap: 8px; align-items: center; width: 100%; }
                .gi-title-edit .modal-input { margin-bottom: 0; }
                .gi-add-member { display: flex; gap: 8px; margin-bottom: 14px; }
                .gi-add-member .modal-input { margin-bottom: 0; }
                .gi-member-list { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; }
                .gi-member-row { display: flex; align-items: center; gap: 10px; padding: 6px 4px; border-radius: 10px; }
                .gi-member-row:hover { background: #181818; }
                .mini-av { width: 32px; height: 32px; font-size: 13px; }
                .gi-member-name { flex: 1; font-size: 13px; }
                .gi-member-actions { display: flex; gap: 6px; }
                .gi-empty { font-size: 12px; opacity: 0.5; padding: 10px 0; }
                .info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    overflow: hidden;
                }

                .chat-title {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis; 
                }

                .join-action {
                    width: fit-content;
                    padding: 4px 12px;
                    background: #4c8dff;
                    border: none;
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    font-size: 12px;
                }
                /* Внутри <style jsx> */
                .batch-actions {
                    display: flex; /* Делаем контейнер флексовым */
                    gap: 15px;      /* Увеличиваем расстояние между кнопками "Удалить" и "Отмена" */
                    right: 140px;   /* Увеличьте это значение (было 125px), чтобы сдвинуть весь блок влево */
                    position: relative; /* Убедитесь, что позиционирование работает корректно */
                }
                .modal-select { flex: 1; }
                .user-card-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    padding: 14px 16px;
                    border-bottom: 1px solid var(--wc-border, #161616);
                }
                .user-card-row .user-card { padding: 0; border-bottom: none; }
                .wc-mode-switch {
                    display: flex;
                    gap: 3px;
                    background: var(--wc-surface2, rgba(127,127,127,0.1));
                    border: 1px solid var(--wc-border);
                    border-radius: 16px;
                    padding: 3px;
                }
                .wc-mode-switch button {
                    background: transparent;
                    border: none;
                    color: var(--wc-muted);
                    padding: 5px 10px;
                    border-radius: 13px;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 600;
                    white-space: nowrap;
                    transition: 0.15s;
                }
                .wc-mode-switch button.active {
                    background: var(--wc-accent);
                    color: #fff;
                }
                .toggle-sidebar-btn {
                    position: fixed;
                    left: ${isSidebarVisible ? '320px' : '0px'};
                    top: 20px;
                    z-index: 1001;
                    background: #050505;
                    border: 1px solid #111;
                    border-left: none;
                    color: #4c8dff;
                    width: 30px;
                    height: 40px;
                    border-radius: 0 8px 8px 0;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 5px 0 15px rgba(0,0,0,0.5);
                }

                .toggle-sidebar-btn:hover {
                    color: #fff;
                    background: #4c8dff;
                }
                .sidebar {
                    width: 320px;
                    min-width: 320px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    overflow-x: hidden;
                    white-space: nowrap;
                }

                .sidebar.hidden {
                    width: 0;
                    min-width: 0;
                    border-right: none;
                    opacity: 0;
                }

                .chat-item {
                    margin: 5px 10px;
                    border-radius: 12px;
                    transition: background 0.2s, transform 0.1s;
                }

                .chat-item:active {
                    transform: scale(0.98);
                }

                .chat-item.active {
                    background: rgba(0, 112, 243, 0.15);
                    border-left: none; 
                    box-shadow: inset 0 0 0 1px #4c8dff;
                }
                .search-input {
                    border: 1px solid #222;
                    transition: all 0.2s;
                }

                .search-input:focus {
                    border-color: #4c8dff;
                    background: #111;
                }

                /* Меню "+" (вложения) */
                .attach-wrapper { position: relative; flex-shrink: 0; }
                .attach-menu {
                    position: absolute; bottom: 46px; left: 0;
                    background: #161616; border: 1px solid #262626; border-radius: 16px;
                    padding: 6px; display: flex; flex-direction: column; gap: 2px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.5); z-index: 60;
                    width: max-content; min-width: 200px; max-width: min(260px, 90vw);
                    max-height: 60vh; overflow-y: auto;
                }
                .attach-menu button {
                    background: none; border: none; color: #eee; text-align: left;
                    padding: 9px 12px; border-radius: 10px; cursor: pointer; font-size: 13px;
                }
                .attach-menu button:hover { background: #232323; }
                .recording-indicator { font-size: 12px; color: #ff6b6b; margin-bottom: 8px; }
                .chip-thumb { width: 20px; height: 20px; border-radius: 6px; object-fit: cover; vertical-align: middle; margin-right: 4px; }

                /* Голосовое сообщение */
                .voice-bubble { display: flex; align-items: center; gap: 8px; min-width: 200px; padding: 4px 0; }
                .voice-play {
                    background: var(--wc-chip-bg); border: none; color: var(--wc-chip-text);
                    width: 32px; height: 32px; border-radius: 50%; cursor: pointer; flex-shrink: 0; font-size: 12px;
                }
                .me .voice-play { background: rgba(255,255,255,0.25); }
                .voice-wave { display: flex; align-items: center; gap: 2px; flex: 1; height: 24px; }
                .voice-wave .bar { width: 2.5px; background: var(--wc-chip-bg-hover); border-radius: 2px; }
                .voice-wave .bar.filled { background: #7fb0ff; }
                .me .voice-wave .bar.filled { background: #fff; }
                .voice-duration { font-size: 11px; opacity: 0.6; flex-shrink: 0; }

                /* Геопозиция и превью ссылок */
                .loc-card, .link-preview-card {
                    display: flex; align-items: center; gap: 10px; background: var(--wc-chip-bg);
                    border-radius: 12px; padding: 8px 12px; margin-bottom: 6px; text-decoration: none; color: inherit;
                }
                .loc-card div, .link-preview-card div { display: flex; flex-direction: column; overflow: hidden; }
                .loc-card b, .link-preview-card b { font-size: 12px; }
                .loc-card span, .link-preview-card span { font-size: 11px; opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .link-preview-card img { width: 24px; height: 24px; border-radius: 6px; flex-shrink: 0; }

                /* Опрос — отдельные полноразмерные кнопки-варианты */
                .poll-card { min-width: 240px; max-width: 320px; background: var(--wc-chip-bg); border-radius: 16px; padding: 14px; }
                .poll-q { font-weight: 700; margin-bottom: 12px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
                .poll-options { display: flex; flex-direction: column; gap: 8px; }
                .poll-btn {
                    position: relative; display: block; width: 100%; box-sizing: border-box; text-align: left;
                    background: var(--wc-chip-bg); border: 1px solid var(--wc-border); color: var(--wc-text);
                    border-radius: 12px; padding: 12px 14px; cursor: pointer; overflow: hidden;
                    font-family: inherit; font-size: 13px; color: inherit;
                    transition: background 0.15s, transform 0.1s, border-color 0.15s;
                }
                .poll-btn:hover { background: var(--wc-chip-bg-hover); }
                .poll-btn:active { transform: scale(0.98); }
                .poll-btn.mine { border-color: #4c8dff; background: rgba(76,141,255,0.14); }
                .poll-btn-fill {
                    position: absolute; left: 0; top: 0; bottom: 0;
                    background: linear-gradient(90deg, rgba(76,141,255,0.25), rgba(155,114,203,0.18));
                    transition: width 0.4s cubic-bezier(0.4,0,0.2,1); z-index: 0;
                }
                .poll-btn-row { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; box-sizing: border-box; }
                .poll-btn-label { flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; margin-right: 8px; }
                .poll-btn-pct { font-weight: 700; opacity: 0.9; flex-shrink: 0; margin-left: auto; white-space: nowrap; }
                .poll-total { font-size: 11px; opacity: 0.5; margin-top: 10px; text-align: right; }

                /* «Архитектура» / rich-карточка */
                .rich-card { min-width: 240px; background: var(--wc-chip-bg); border-radius: 14px; overflow: hidden; }
                .rich-card-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; cursor: pointer; }
                .rich-card-head b { flex: 1; font-size: 13px; }
                .rich-toggle { font-size: 10px; opacity: 0.6; }
                .rich-card-body { padding: 0 14px 14px; }
                .rich-card-image { max-width: 100%; border-radius: 10px; margin-bottom: 8px; }
                .md-body { font-size: 13px; line-height: 1.55; }
                .md-body h1, .md-body h2, .md-body h3 { margin: 0.6em 0 0.3em; }
                .md-body a { color: #7fb0ff; }
                .md-body code { background: var(--wc-chip-bg); padding: 1px 5px; border-radius: 4px; }
                .md-body pre { background: var(--wc-chip-bg); padding: 10px; border-radius: 8px; overflow: auto; }
                .md-body table { border-collapse: collapse; width: 100%; margin: 8px 0; }
                .md-body th, .md-body td { border: 1px solid var(--wc-border); padding: 4px 8px; font-size: 12px; }
                .md-body img { max-width: 100%; border-radius: 8px; }

                /* Фильтры поиска */
                .search-filters { display: flex; flex-direction: column; gap: 6px; background: #101010; border-radius: 14px; margin: 0 12px 10px; padding: 10px 12px; border: 1px solid #1c1c1c; }
                .filter-group { display: flex; gap: 6px; flex-wrap: wrap; }
                .filter-chip { background: #141414; border: 1px solid #262626; color: #999; padding: 4px 10px; border-radius: 12px; font-size: 11px; cursor: pointer; }
                .filter-chip.active { background: rgba(76,141,255,0.2); border-color: #4c8dff; color: #7fb0ff; }
                .filter-btn { font-size: 15px; }

                /* Модалка создания чата */
                .create-modal-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
                .logo-badge { width: 40px; height: 40px; border-radius: 12px; background: linear-gradient(135deg, #4c8dff, #9b72cb); display: flex; align-items: center; justify-content: center; font-size: 20px; }
                .create-modal-logo h3 { margin: 0; }
                .create-icon-row { display: flex; gap: 12px; align-items: center; margin-bottom: 10px; }
                .create-icon-preview { width: 56px; height: 56px; border-radius: 50%; background: #1a1a1a; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; overflow: hidden; }
                .icon-emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; max-height: 90px; overflow-y: auto; margin-bottom: 12px; }
                .icon-emoji-item { text-align: center; padding: 6px 0; border-radius: 8px; cursor: pointer; font-size: 16px; }
                .icon-emoji-item:hover { background: #1c1c1c; }
                .icon-emoji-item.selected { background: rgba(76,141,255,0.25); box-shadow: inset 0 0 0 1px #4c8dff; }
                .file-label { font-size: 11px; opacity: 0.6; cursor: pointer; display: inline-block; margin-top: 4px; }
                .rich-textarea { min-height: 140px; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }

                /* Пересылка сообщений */
                .album-pick-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; max-height: 300px; overflow-y: auto; }
                .wide-btn { width: 100%; background: var(--wc-chip-bg); border: 1px solid var(--wc-border); color: var(--wc-text); padding: 11px; border-radius: 12px; cursor: pointer; font-size: 13px; text-align: left; transition: background 0.15s; }
                .wide-btn:hover { background: #1e1e1e; }
                .hint { font-size: 12px; opacity: 0.5; text-align: center; }
                .dedup-badge { font-size: 10px; opacity: 0.7; margin-left: 2px; }

                /* Приватность в панели группы */
                .wide-btn.primary { background: #4c8dff; border-color: #4c8dff; color: #fff; }
                .two-col { display: flex; gap: 10px; margin-bottom: 10px; }
                .cover-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
                .cover-row .modal-input { flex: 1; margin-bottom: 0; }
                .pill-btn { background: var(--wc-chip-bg); border: 1px solid var(--wc-border); color: var(--wc-text); padding: 8px 14px; border-radius: 16px; cursor: pointer; font-size: 12px; white-space: nowrap; }
                .pill-btn.primary { background: #4c8dff; border-color: #4c8dff; color: #fff; }
                .gi-privacy { border-top: 1px solid #222; margin-top: 12px; padding-top: 4px; }

                /* Баннер входящего звонка */
                .incoming-call-banner {
                    position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
                    background: #121212; border: 1px solid #262626; border-radius: 18px;
                    padding: 12px 16px; display: flex; align-items: center; gap: 12px;
                    box-shadow: 0 15px 40px rgba(0,0,0,0.6); z-index: 5000; min-width: 320px;
                    animation: call-pop 0.25s ease;
                }
                @keyframes call-pop { from { opacity: 0; transform: translateX(-50%) translateY(-15px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
                .incoming-call-info { display: flex; flex-direction: column; flex: 1; }
                .incoming-call-info span { font-size: 12px; opacity: 0.6; }
                .incoming-call-actions { display: flex; gap: 8px; }
                .call-accept { background: #34a853; border: none; color: #fff; padding: 8px 14px; border-radius: 14px; cursor: pointer; font-size: 13px; font-weight: 600; }
                .call-decline { background: #ea4335; border: none; color: #fff; padding: 8px 14px; border-radius: 14px; cursor: pointer; font-size: 13px; }

                /* Более аккуратные фильтры поиска (боковая панель "настроек" поиска) */
                .filter-group + .filter-group { margin-top: 6px; }
                    /* Мобильные стили */
                @media (max-width: 768px) {
                    .sidebar {
                        /* Делаем сайдбар перекрывающим контент, когда он открыт */
                        position: fixed;
                        z-index: 1000;
                        height: 100%;
                        width: 85%; /* Оставляем кусочек чата видимым сбоку */
                        min-width: 85%;
                    }

                    .sidebar.hidden {
                        width: 0;
                        min-width: 0;
                        transform: translateX(-100%); /* Прячем за экран */
                    }

                    .toggle-sidebar-btn {
                        /* Сдвигаем кнопку переключателя, чтобы она всегда была под рукой */
                        left: ${isSidebarVisible ? '85%' : '0px'};
                        width: 40px;
                        height: 50px;
                        top: 10px;
                    }

                    .chat-area {
                        width: 100%;
                    }

                    .chat-header {
                        padding: 10px 15px;
                        flex-direction: column; /* Заголовок и кнопки в две строки */
                        align-items: flex-start;
                        gap: 10px;
                    }

                    .batch-actions {
                        position: static; /* Возвращаем в общий поток */
                        width: 100%;
                        justify-content: flex-end;
                    }

                    .msg-wrapper {
                        max-width: 90%; /* Сообщения пошире на узком экране */
                    }

                    .input-panel {
                        padding: 10px;
                    }

                    .input-row {
                        gap: 8px;
                    }

                    .input-row input {
                        padding: 10px 15px;
                        font-size: 14px;
                    }

                    .tool-btn, .voice-btn, .send-btn {
                        font-size: 18px; /* Немного уменьшаем кнопки управления */
                    }

                    .emoji-picker {
                        width: 90%;
                        left: 5%;
                        right: 5%;
                        bottom: 70px;
                    }

                    .file-item img {
                        max-width: 100%; /* Картинки на всю ширину сообщения */
                    }

                    .modal-content, .settings-modal, .group-info, .rich-modal, .create-chat-modal, .news-editor {
                        width: 92vw !important;
                        max-width: 92vw !important;
                        max-height: 85vh;
                        overflow-y: auto;
                    }

                    .video-poster, .lazy-thumb, .file-item video {
                        max-width: 100%;
                    }

                    /* Планшетный уровень (см. .single-media / .dynamic-size выше) */
                    .attachment-grid.single-media { max-width: 300px; }
                    .dynamic-size { max-height: 360px; }

                    .icon-emoji-grid {
                        grid-template-columns: repeat(6, 1fr);
                    }

                    .incoming-call-banner {
                        min-width: unset;
                        width: 92vw;
                        left: 4vw;
                        transform: none;
                    }

                    .attach-menu {
                        max-width: 80vw;
                    }
                }

                /* Совсем маленькие экраны (бюджетные телефоны) — иконки-кнопки компактнее */
                @media (max-width: 380px) {
                    .tool-btn, .voice-btn { width: 32px; height: 32px; font-size: 17px; }
                    .create-btn { width: 32px; height: 32px; font-size: 17px; }
                    .send-btn { width: 34px; height: 34px; font-size: 20px; }
                    .avatar { width: 38px; height: 38px; }
                    .chat-header { padding: 12px 16px; }
                    .messages { padding: 14px; }
                    .input-panel { padding: 12px; }

                    /* Телефонный уровень (самый компактный из трёх) */
                    .attachment-grid.single-media { max-width: min(78vw, 260px); }
                    .dynamic-size { max-height: 320px; }
                }
            `}</style>
            
        </div>
    );
}