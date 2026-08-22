'use client';
import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
// ПРОВЕРЬТЕ путь импорта — предполагается, что actions.js лежит в корне проекта.
import { getNewsPost, likeNewsPost, unlikeNewsPost, deleteNewsPost, addNewsComment, getNewsComments, deleteNewsComment } from '../../actions';

function buildDoc(html) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000;color:#eee;font-family:system-ui,-apple-system,sans-serif;padding:20px;box-sizing:border-box">${html}</body></html>`;
}

export default function NewsPostPage() {
  const router = useRouter();
  const { id } = useParams();
  const [username, setUsername] = useState(null);
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSending, setCommentSending] = useState(false);

  useEffect(() => { setUsername(localStorage.getItem('p_user')); }, []);

  const reloadComments = async () => {
    setComments(await getNewsComments(id));
  };

  const reload = async () => {
    setLoading(true);
    const p = await getNewsPost(id, username);
    setPost(p);
    setLoading(false);
  };

  useEffect(() => { if (id) { reload(); reloadComments(); } /* eslint-disable-next-line */ }, [id, username]);

  const handleAddComment = async () => {
    const text = commentDraft.trim();
    if (!text) return;
    if (!username) return alert('Войдите в аккаунт, чтобы комментировать');
    setCommentSending(true);
    try {
      const res = await addNewsComment(username, id, text);
      if (res?.success === false) { alert('Не получилось отправить: ' + (res.error || 'неизвестная ошибка')); return; }
      setCommentDraft('');
      await reloadComments();
    } finally {
      setCommentSending(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!confirm('Удалить комментарий?')) return;
    const res = await deleteNewsComment(username, commentId);
    if (res?.success === false) { alert('Не получилось удалить: ' + (res.error || 'нет доступа')); return; }
    await reloadComments();
  };

  if (loading) return <div className="state-msg">Загрузка...</div>;
  if (!post || post.error) return <div className="state-msg">{post?.error || 'Новость не найдена'}</div>;

  const handleLike = async () => {
    if (!username) return alert('Войдите в аккаунт, чтобы ставить лайки');
    if (post.likedByViewer) await unlikeNewsPost(username, id);
    else await likeNewsPost(username, id);
    reload();
  };

  const canManage = username && (username === post.author_username || username === post.album.ownerUsername);

  return (
    <div className="post-page">
    <div className="post-page-inner">
      <button className="back-btn" onClick={() => router.push(`/album/${post.album.id}`)}>← {post.album.title}</button>

      <h1>{post.title}</h1>
      <p className="meta">{post.author_username} · 👁 {post.views} просмотров</p>

      {/* Изолированный рендер: sandbox без allow-scripts — HTML/CSS новости
          не могут выполнить JS или достучаться до остального сайта. */}
      <iframe
        title={post.title}
        sandbox="allow-same-origin"
        srcDoc={buildDoc(post.content)}
        className="content-frame"
        onLoad={e => {
          try {
            const h = e.target.contentWindow.document.body.scrollHeight;
            if (h) e.target.style.height = h + 40 + 'px';
          } catch {}
        }}
      />

      <div className="actions-row">
        <button className="like-btn" onClick={handleLike}>{post.likedByViewer ? '❤️' : '🤍'} {post.likes}</button>
        {canManage && (
          <button className="del-btn" onClick={async () => {
            if (confirm('Удалить новость?')) { await deleteNewsPost(id, username); router.push(`/album/${post.album.id}`); }
          }}>Удалить</button>
        )}
      </div>

      <div className="comments-section">
        <h3>Комментарии ({comments.length})</h3>

        {username ? (
          <div className="comment-input">
            <textarea
              placeholder="Написать комментарий..."
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
            />
            <button onClick={handleAddComment} disabled={commentSending || !commentDraft.trim()}>
              {commentSending ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        ) : (
          <p className="login-prompt">Войдите в аккаунт, чтобы оставить комментарий</p>
        )}

        <div className="comments-list">
          {comments.map(c => (
            <div key={c.id} className="comment">
              <div className="comment-head">
                <strong>{c.username}</strong>
                <span>{new Date(Number(c.created_at)).toLocaleString('ru')}</span>
              </div>
              <div className="comment-text">{c.text}</div>
              {username && (username === c.username || canManage) && (
                <button className="comment-del" onClick={() => handleDeleteComment(c.id)}>Удалить</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>

      <style jsx>{`
        .post-page { min-height: 100vh; background: #000; box-sizing: border-box; max-width: 100%; margin: 0; padding: 90px 20px 30px; color: #fff; }
        .post-page-inner { max-width: 800px; margin: 0 auto; }
        .state-msg { padding: 30px; color: #fff; opacity: 0.6; }
        .back-btn { background: #111; border: 1px solid #222; color: #ccc; padding: 8px 16px; border-radius: 10px; cursor: pointer; font-size: 13px; margin-bottom: 16px; }
        .back-btn:hover { background: #161616; }
        h1 { margin-bottom: 6px; }
        .meta { opacity: 0.5; font-size: 13px; margin-bottom: 16px; }
        .content-frame { width: 100%; min-height: 400px; border: 1px solid #222; border-radius: 16px; background: #000; }
        .actions-row { display: flex; gap: 10px; margin-top: 20px; }
        .like-btn { background: #111; border: 1px solid #222; color: #fff; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 14px; }
        .like-btn:hover { background: #161616; }
        .del-btn { background: #111; border: 1px solid #ff4d4d; color: #ff4d4d; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 14px; }

        .comments-section { margin-top: 40px; padding-top: 24px; border-top: 1px solid #222; }
        .comments-section h3 { font-size: 16px; margin-bottom: 16px; }
        .comment-input { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }
        .comment-input textarea { width: 100%; min-height: 70px; background: #111; border: 1px solid #222; color: #fff; padding: 12px; border-radius: 10px; resize: vertical; outline: none; font-family: inherit; box-sizing: border-box; }
        .comment-input button { align-self: flex-end; background: #fff; color: #000; border: none; padding: 8px 18px; border-radius: 20px; font-weight: 600; cursor: pointer; }
        .comment-input button:disabled { opacity: 0.5; cursor: not-allowed; }
        .login-prompt { background: #111; padding: 14px; border-radius: 10px; color: #888; font-size: 13px; text-align: center; margin-bottom: 20px; }
        .comments-list { display: flex; flex-direction: column; gap: 12px; }
        .comment { background: #111; border: 1px solid #222; padding: 12px 14px; border-radius: 10px; position: relative; }
        .comment-head { display: flex; justify-content: space-between; font-size: 12px; color: #888; margin-bottom: 6px; }
        .comment-text { font-size: 14px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
        .comment-del { position: absolute; top: 10px; right: 12px; background: none; border: none; color: #ff4d4d; font-size: 11px; cursor: pointer; opacity: 0; transition: 0.2s; }
        .comment:hover .comment-del { opacity: 1; }
        @media (max-width: 768px) {
          .post-page { padding: 80px 16px 16px; }
        }
      `}</style>
    </div>
  );
}
