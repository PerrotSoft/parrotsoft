'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
// ПРОВЕРЬТЕ путь импорта — предполагается, что actions.js лежит в корне проекта.
import {
  getNewsFeed, getMyAlbums, getPublicAlbums,
  createNewsAlbum, createNewsPost,
} from '../actions';
import NewsEditor from '../components/NewsEditor';
import { compressImageToJPEG } from '../lib/imageUpload';

export default function NewsPage() {
  const router = useRouter();
  const [username, setUsername] = useState(null);
  const [tab, setTab] = useState('feed');
  const [sort, setSort] = useState('recent');
  const [posts, setPosts] = useState([]);
  const [myAlbums, setMyAlbums] = useState([]);
  const [publicAlbums, setPublicAlbums] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createChoice, setCreateChoice] = useState(null);
  const [albumForm, setAlbumForm] = useState({ title: '', description: '', visibility: 'public', cover: '' });
  const [coverUploading, setCoverUploading] = useState(false);
  const [postAlbumId, setPostAlbumId] = useState('');

  useEffect(() => { setUsername(localStorage.getItem('p_user')); }, []);

  const reload = async () => {
    setLoading(true);
    const [feed, mine, pub] = await Promise.all([
      getNewsFeed(username, { sort }),
      username ? getMyAlbums(username) : Promise.resolve([]),
      getPublicAlbums({}),
    ]);
    setPosts(feed);
    setMyAlbums(mine);
    setPublicAlbums(pub);
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [username, sort]);

  const closeCreate = () => { setCreateOpen(false); setCreateChoice(null); setPostAlbumId(''); };

  const handleAlbumCoverFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const { dataUrl } = await compressImageToJPEG(file);
      setAlbumForm(f => ({ ...f, cover: dataUrl }));
    } catch (err) {
      alert('Не удалось обработать картинку: ' + err.message);
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateAlbum = async () => {
    if (!username) return alert('Войдите в аккаунт');
    if (!albumForm.title.trim()) return alert('Укажите название альбома');
    const res = await createNewsAlbum(username, albumForm);
    if (res.success) { closeCreate(); router.push(`/album/${res.albumId}`); }
    else alert(res.error || 'Ошибка создания альбома');
  };

  const handleSavePost = async (data) => {
    if (!username) return alert('Войдите в аккаунт');
    if (!postAlbumId) return alert('Выберите альбом');
    const res = await createNewsPost(username, postAlbumId, data);
    if (res.success) { closeCreate(); router.push(`/news/${res.postId}`); }
    else alert(res.error || 'Ошибка публикации новости');
  };

  const postableAlbums = myAlbums.filter(a => a.isOwner || a.canPost);

  return (
    <div className="news-page">
    <div className="news-page-inner">
      <div className="page-header">
        <h1>Новости</h1>
        <button className="create-btn" onClick={() => setCreateOpen(true)}>＋</button>
      </div>

      <div className="tab-row">
        <button className={tab === 'feed' ? 'tab active' : 'tab'} onClick={() => setTab('feed')}>Новости</button>
        <button className={tab === 'albums' ? 'tab active' : 'tab'} onClick={() => setTab('albums')}>Альбомы</button>
      </div>

      {tab === 'feed' && (
        <>
          <div className="sort-row">
            <button className={sort === 'recent' ? 'sort-chip active' : 'sort-chip'} onClick={() => setSort('recent')}>Свежее</button>
            <button className={sort === 'recommended' ? 'sort-chip active' : 'sort-chip'} onClick={() => setSort('recommended')}>Рекомендации</button>
          </div>

          {loading && <p className="muted">Загрузка...</p>}
          {!loading && posts.length === 0 && <p className="muted">Пока нет новостей. Создайте первую!</p>}

          <div className="post-list">
            {posts.map(p => (
              <div key={p.id} className="post-card" onClick={() => router.push(`/news/${p.id}`)}>
                {p.cover && <img src={p.cover} className="post-cover" alt="" />}
                <div>
                  <h3>{p.title}</h3>
                  <p className="meta">{p.author_username} · 👁 {p.views} · ❤️ {p.likes}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'albums' && (
        <>
          <span className="section-title">Мои альбомы</span>
          <div className="album-grid">
            {myAlbums.length === 0 && <p className="muted">У вас пока нет альбомов.</p>}
            {myAlbums.map(a => (
              <div key={a.id} className="album-card" onClick={() => router.push(`/album/${a.id}`)}>
                {a.cover && <img src={a.cover} className="album-cover" alt="" />}
                <div className="album-card-body">
                  <div className="album-card-title"><b>{a.title}</b>{a.starred && <span title="Избранное">⭐</span>}</div>
                  <p className="meta">{a.visibility === 'private' ? '🔒 Приватный' : '🌐 Публичный'}</p>
                </div>
              </div>
            ))}
          </div>

          <span className="section-title">Публичные альбомы</span>
          <div className="album-grid">
            {publicAlbums.map(a => (
              <div key={a.id} className="album-card" onClick={() => router.push(`/album/${a.id}`)}>
                {a.cover && <img src={a.cover} className="album-cover" alt="" />}
                <div className="album-card-body">
                  <b>{a.title}</b>
                  <p className="meta">{a.description || 'Без описания'}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>

      {createOpen && (
        <div className="modal-overlay">
          {!createChoice && (
            <div className="modal-content">
              <h2>Что создаём?</h2>
              <button className="wide-btn primary" onClick={() => setCreateChoice('album')}>📁 Новостной альбом</button>
              <button className="wide-btn primary" onClick={() => setCreateChoice('post')} disabled={!postableAlbums.length}>📰 Новость</button>
              {!postableAlbums.length && <p className="hint">Чтобы создать новость, сначала создайте альбом</p>}
              <button className="wide-btn" onClick={closeCreate}>Отмена</button>
            </div>
          )}

          {createChoice === 'album' && (
            <div className="modal-content">
              <h2>Новый альбом</h2>
              <input className="modal-input" placeholder="Название альбома" value={albumForm.title}
                onChange={e => setAlbumForm({ ...albumForm, title: e.target.value })} />
              <textarea className="modal-input textarea" placeholder="Описание (необязательно)" value={albumForm.description}
                onChange={e => setAlbumForm({ ...albumForm, description: e.target.value })} />
              <div className="cover-row">
                <input className="modal-input" placeholder="Обложка — URL или загрузите файл" value={albumForm.cover}
                  onChange={e => setAlbumForm({ ...albumForm, cover: e.target.value })} />
                <label className="upload-btn">
                  {coverUploading ? '...' : '🖼️'}
                  <input type="file" accept="image/*" hidden onChange={handleAlbumCoverFile} />
                </label>
              </div>
              {albumForm.cover && <img src={albumForm.cover} className="cover-preview" alt="" />}
              <div className="two-col">
                <button className={albumForm.visibility === 'public' ? 'wide-btn primary' : 'wide-btn'} onClick={() => setAlbumForm({ ...albumForm, visibility: 'public' })}>🌐 Публичный</button>
                <button className={albumForm.visibility === 'private' ? 'wide-btn primary' : 'wide-btn'} onClick={() => setAlbumForm({ ...albumForm, visibility: 'private' })}>🔒 Приватный</button>
              </div>
              <div className="two-col">
                <button className="wide-btn primary" onClick={handleCreateAlbum}>Создать</button>
                <button className="wide-btn" onClick={closeCreate}>Отмена</button>
              </div>
            </div>
          )}

          {createChoice === 'post' && !postAlbumId && (
            <div className="modal-content">
              <h2>В какой альбом?</h2>
              <div className="album-pick-list">
                {postableAlbums.map(a => (
                  <button key={a.id} className="wide-btn" onClick={() => setPostAlbumId(a.id)}>{a.title}</button>
                ))}
              </div>
              <button className="wide-btn" onClick={closeCreate}>Отмена</button>
            </div>
          )}

          {createChoice === 'post' && postAlbumId && (
            <NewsEditor onSave={handleSavePost} onCancel={closeCreate} />
          )}
        </div>
      )}

      <style jsx>{`
        .news-page { min-height: 100vh; background: #000; box-sizing: border-box; max-width: 100%; margin: 0; padding: 90px 20px 30px; color: #fff; }
        .news-page-inner { max-width: 900px; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
        .page-header h1 { margin: 0; }
        .create-btn { background: #0078d4; border: none; color: #fff; width: 40px; height: 40px; border-radius: 12px; cursor: pointer; font-size: 20px; }
        .tab-row { display: flex; gap: 8px; margin-bottom: 14px; }
        .tab { background: #111; border: 1px solid #222; color: #999; padding: 8px 18px; border-radius: 20px; cursor: pointer; font-size: 13px; }
        .tab.active { background: #0078d4; border-color: #0078d4; color: #fff; }
        .sort-row { display: flex; gap: 8px; margin-bottom: 16px; }
        .sort-chip { background: transparent; border: 1px solid #222; color: #999; padding: 6px 14px; border-radius: 16px; cursor: pointer; font-size: 12px; }
        .sort-chip.active { border-color: #0078d4; color: #0078d4; }
        .muted { opacity: 0.5; }
        .post-list { display: flex; flex-direction: column; gap: 10px; }
        .post-card { background: #111; border: 1px solid #222; border-radius: 14px; padding: 14px; cursor: pointer; display: flex; gap: 14px; transition: background 0.15s; }
        .post-card:hover { background: #161616; }
        .post-card h3 { margin: 0 0 6px; }
        .post-cover { width: 100px; height: 70px; object-fit: cover; border-radius: 10px; flex-shrink: 0; }
        .meta { margin: 0; opacity: 0.5; font-size: 12px; }
        .section-title { display: block; padding: 10px 0; opacity: 0.5; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
        .album-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
        .album-card { background: #111; border: 1px solid #222; border-radius: 14px; width: 210px; cursor: pointer; overflow: hidden; transition: background 0.15s; }
        .album-card:hover { background: #161616; }
        .album-cover { width: 100%; height: 100px; object-fit: cover; display: block; }
        .album-card-body { padding: 12px; }
        .album-card-title { display: flex; justify-content: space-between; align-items: center; }
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 3000; padding: 20px; }
        .modal-content { background: #0a0a0a; border: 1px solid #222; padding: 24px; border-radius: 18px; width: 100%; max-width: 420px; }
        .modal-content h2 { margin-top: 0; }
        .modal-input { width: 100%; background: #111; border: 1px solid #222; color: #fff; padding: 10px 14px; border-radius: 10px; outline: none; font-size: 14px; margin-bottom: 10px; box-sizing: border-box; }
        .modal-input:focus { border-color: #0078d4; }
        .modal-input.textarea { min-height: 70px; font-family: inherit; }
        .cover-row { display: flex; gap: 8px; align-items: center; }
        .cover-row .modal-input { margin-bottom: 0; flex: 1; }
        .cover-preview { max-width: 140px; max-height: 90px; border-radius: 10px; margin: 10px 0; object-fit: cover; }
        .upload-btn { background: #111; border: 1px solid #222; color: #0078d4; padding: 10px 12px; border-radius: 10px; cursor: pointer; font-size: 13px; }
        .two-col { display: flex; gap: 10px; margin-top: 10px; }
        .wide-btn { width: 100%; background: #111; border: 1px solid #222; color: #ccc; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 14px; margin-bottom: 10px; }
        .wide-btn.primary { background: #0078d4; border-color: #0078d4; color: #fff; }
        .wide-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .hint { font-size: 11px; opacity: 0.5; text-align: center; margin: -4px 0 10px; }
        .album-pick-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
        @media (max-width: 768px) {
          .news-page { padding: 80px 16px 16px; }
          .album-card { width: 100%; }
        }
      `}</style>
    </div>
  );
}
