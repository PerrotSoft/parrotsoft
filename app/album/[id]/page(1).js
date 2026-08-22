'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
// ПРОВЕРЬТЕ путь импорта — предполагается, что actions.js лежит в корне проекта.
import {
  getAlbumForViewer, getAlbumPosts, followAlbum, unfollowAlbum, toggleAlbumStar,
  addAlbumEditor, removeAlbumEditor, createNewsPost, updateNewsAlbum, deleteNewsAlbum,
} from '../../actions';
import NewsEditor from '../../components/NewsEditor';
import { compressImageToJPEG } from '../../lib/imageUpload';

export default function AlbumPage() {
  const router = useRouter();
  const { id } = useParams();
  const [username, setUsername] = useState(null);
  const [album, setAlbum] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [newEditorName, setNewEditorName] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  useEffect(() => { setUsername(localStorage.getItem('p_user')); }, []);

  const reload = async () => {
    setLoading(true);
    const [a, p] = await Promise.all([getAlbumForViewer(id, username), getAlbumPosts(id, {})]);
    setAlbum(a);
    setPosts(p);
    setLoading(false);
  };

  useEffect(() => { if (id) reload(); /* eslint-disable-next-line */ }, [id, username]);

  if (loading) return <div className="state-msg">Загрузка...</div>;
  if (!album || album.error) return <div className="state-msg">{album?.error || 'Альбом не найден'}</div>;

  const handleSavePost = async (data) => {
    const res = await createNewsPost(username, id, data);
    if (res.success) { setEditorOpen(false); router.push(`/news/${res.postId}`); }
    else alert(res.error || 'Ошибка публикации');
  };

  const handleToggleFollow = async () => {
    if (!username) return alert('Войдите в аккаунт');
    if (album.isFollowing) await unfollowAlbum(username, id);
    else await followAlbum(username, id);
    reload();
  };

  const handleToggleStar = async () => {
    if (!username) return alert('Войдите в аккаунт');
    await toggleAlbumStar(username, id);
    reload();
  };

  const handleAddEditor = async () => {
    if (!newEditorName.trim()) return;
    const res = await addAlbumEditor(id, username, newEditorName.trim());
    if (res.success) { setNewEditorName(''); reload(); }
    else alert(res.error);
  };

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const { dataUrl } = await compressImageToJPEG(file);
      await updateNewsAlbum(id, username, { cover: dataUrl });
      reload();
    } catch (err) {
      alert('Не удалось обработать картинку: ' + err.message);
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/album/${id}` : `/album/${id}`;

  return (
    <div className="album-page">
    <div className="album-page-inner">
      <div className="album-header">
        {album.cover && <img src={album.cover} className="album-header-cover" alt="" />}
        <div className="album-header-top">
          <div>
            <h1>{album.title} {album.visibility === 'private' ? '🔒' : '🌐'}</h1>
            <p className="muted">{album.description || 'Без описания'}</p>
            <p className="muted small">Автор: {album.owner_username}</p>
          </div>
          <div className="header-actions">
            {!album.isOwner && (
              <button className="pill-btn" onClick={handleToggleFollow}>{album.isFollowing ? 'Отписаться' : 'Подписаться'}</button>
            )}
            <button className="pill-btn" onClick={handleToggleStar}>{album.isStarred ? '⭐ В избранном' : '☆ В избранное'}</button>
            {album.canPost && <button className="pill-btn primary" onClick={() => setEditorOpen(true)}>＋ Новость</button>}
            {album.isOwner && (
              <label className="pill-btn">
                {coverUploading ? '...' : '🖼️ Обложка'}
                <input type="file" accept="image/*" hidden onChange={handleCoverFile} />
              </label>
            )}
            {album.isOwner && <button className="pill-btn" onClick={() => setSettingsOpen(true)}>⚙️</button>}
          </div>
        </div>
        {album.visibility === 'private' && (
          <p className="private-note">Приватный альбом — доступен только по ссылке: <code>{shareUrl}</code></p>
        )}
      </div>

      <div className="post-list">
        {posts.length === 0 && <p className="muted">В альбоме пока нет новостей.</p>}
        {posts.map(p => (
          <div key={p.id} className="post-card" onClick={() => router.push(`/news/${p.id}`)}>
            {p.cover && <img src={p.cover} className="post-cover" alt="" />}
            <div>
              <h3>{p.title}</h3>
              <p className="muted small">{p.author_username} · 👁 {p.views} · ❤️ {p.likes}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

      {editorOpen && (
        <div className="modal-overlay">
          <NewsEditor onSave={handleSavePost} onCancel={() => setEditorOpen(false)} />
        </div>
      )}

      {settingsOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2>Настройки альбома</h2>

            <span className="field-label">Добавить соавтора (по имени пользователя)</span>
            <div className="cover-row">
              <input className="modal-input" placeholder="username" value={newEditorName} onChange={e => setNewEditorName(e.target.value)} />
              <button className="pill-btn primary" onClick={handleAddEditor}>Добавить</button>
            </div>
            {album.editors.length > 0 && (
              <div className="editor-list">
                {album.editors.map(e => (
                  <div key={e} className="editor-row">
                    <span>{e}</span>
                    <button className="x-btn" onClick={async () => { await removeAlbumEditor(id, username, e); reload(); }}>✕</button>
                  </div>
                ))}
              </div>
            )}

            <div className="two-col">
              <button className={album.visibility === 'public' ? 'wide-btn primary' : 'wide-btn'} onClick={async () => { await updateNewsAlbum(id, username, { visibility: 'public' }); reload(); }}>🌐 Публичный</button>
              <button className={album.visibility === 'private' ? 'wide-btn primary' : 'wide-btn'} onClick={async () => { await updateNewsAlbum(id, username, { visibility: 'private' }); reload(); }}>🔒 Приватный</button>
            </div>

            <button className="wide-btn danger" onClick={async () => { if (confirm('Удалить альбом со всеми новостями?')) { await deleteNewsAlbum(id, username); router.push('/news'); } }}>
              Удалить альбом
            </button>
            <button className="wide-btn" onClick={() => setSettingsOpen(false)}>Закрыть</button>
          </div>
        </div>
      )}

      <style jsx>{`
        .album-page { min-height: 100vh; background: #000; box-sizing: border-box; max-width: 100%; margin: 0; padding: 90px 20px 30px; color: #fff; }
        .album-page-inner { max-width: 900px; margin: 0 auto; }
        .state-msg { padding: 30px; color: #fff; opacity: 0.6; }
        .album-header { background: #111; border: 1px solid #222; border-radius: 18px; margin-bottom: 20px; overflow: hidden; }
        .album-header-cover { width: 100%; height: 180px; object-fit: cover; display: block; }
        .album-header-top { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 20px; }
        .album-header-top h1 { margin: 0 0 6px; }
        .muted { opacity: 0.6; margin: 0; }
        .muted.small { opacity: 0.4; font-size: 12px; margin-top: 6px; }
        .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .pill-btn { background: #0a0a0a; border: 1px solid #222; color: #ccc; padding: 8px 14px; border-radius: 20px; cursor: pointer; font-size: 13px; }
        .pill-btn.primary { background: #0078d4; border-color: #0078d4; color: #fff; }
        .private-note { font-size: 12px; opacity: 0.5; padding: 0 20px 16px; }
        .private-note code { background: #0a0a0a; padding: 2px 6px; border-radius: 4px; }
        .post-list { display: flex; flex-direction: column; gap: 10px; }
        .post-card { background: #111; border: 1px solid #222; border-radius: 14px; padding: 14px; cursor: pointer; display: flex; gap: 14px; transition: background 0.15s; }
        .post-card:hover { background: #161616; }
        .post-card h3 { margin: 0 0 6px; }
        .post-cover { width: 100px; height: 70px; object-fit: cover; border-radius: 10px; flex-shrink: 0; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; }
        .modal-content { background: #0a0a0a; border: 1px solid #222; padding: 24px; border-radius: 18px; width: 100%; max-width: 420px; }
        .modal-content h2 { margin-top: 0; }
        .field-label { display: block; font-size: 11px; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
        .modal-input { width: 100%; background: #111; border: 1px solid #222; color: #fff; padding: 10px 14px; border-radius: 10px; outline: none; font-size: 14px; box-sizing: border-box; }
        .modal-input:focus { border-color: #0078d4; }
        .cover-row { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; }
        .cover-row .modal-input { flex: 1; }
        .editor-list { margin-bottom: 14px; }
        .editor-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #1a1a1a; }
        .x-btn { background: #111; border: 1px solid #222; color: #ff4d4d; padding: 3px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; }
        .two-col { display: flex; gap: 10px; margin-bottom: 10px; }
        .wide-btn { width: 100%; background: #111; border: 1px solid #222; color: #ccc; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 14px; margin-bottom: 10px; }
        .wide-btn.primary { background: #0078d4; border-color: #0078d4; color: #fff; }
        .wide-btn.danger { color: #ff4d4d; border-color: #ff4d4d; }
        @media (max-width: 768px) {
          .album-page { padding: 80px 16px 16px; }
          .album-header-top { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
