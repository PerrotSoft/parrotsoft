'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getMails,
  sendMail,
  markAsRead,
  toggleStar,
  deleteMail,
  getUnreadCount,
} from '../actions';

// ── Иконки (inline SVG, без зависимостей) ─────────────────────────────────
const Icon = {
  Inbox: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
    </svg>
  ),
  Send: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
  Star: ({ filled }) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? '#f5c518' : 'none'} stroke={filled ? '#f5c518' : 'currentColor'} strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  Trash: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4h6v2"/>
    </svg>
  ),
  Compose: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  Back: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  Close: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  Menu: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  Parrot: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8">
      <path d="M12 2C8 2 5 5 5 9c0 2.5 1 4.5 2.5 6L6 20h12l-1.5-5C18 13.5 19 11.5 19 9c0-4-3-7-7-7z"/>
      <circle cx="9" cy="9" r="1" fill="#4ade80"/>
      <circle cx="15" cy="9" r="1" fill="#4ade80"/>
      <path d="M10 13s1 1.5 2 1.5 2-1.5 2-1.5"/>
    </svg>
  ),
};

// ── Форматирование даты ────────────────────────────────────────────────────
function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const isThisYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', ...(!isThisYear && { year: 'numeric' }) });
}

// ── Компонент: Compose Modal ───────────────────────────────────────────────
function ComposeModal({ currentUser, onClose, onSent }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    if (!to.trim() || !body.trim()) { setError('Заполни поле «Кому» и текст письма'); return; }
    setSending(true);
    setError('');
    try {
      const res = await sendMail(currentUser, to.trim(), subject, body);
      if (res?.error === 'user_not_found') { setError(`Пользователь «${to}» не найден`); }
      else if (res?.error === 'self_send')  { setError('Нельзя отправить письмо самому себе'); }
      else if (res?.error)                  { setError('Ошибка отправки. Попробуй снова.'); }
      else { onSent?.(); onClose(); }
    } catch { setError('Что-то пошло не так.'); }
    setSending(false);
  };

  return (
    <div style={styles.modalOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={styles.composeBox}>
        <div style={styles.composeHeader}>
          <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 14 }}>✉ Новое письмо</span>
          <button onClick={onClose} style={styles.iconBtn}><Icon.Close /></button>
        </div>

        <div style={styles.composeField}>
          <label style={styles.label}>Кому</label>
          <input
            style={styles.input}
            placeholder="username (без @)"
            value={to}
            onChange={e => setTo(e.target.value.toLowerCase())}
            autoFocus
          />
        </div>
        <div style={styles.composeField}>
          <label style={styles.label}>Тема</label>
          <input
            style={styles.input}
            placeholder="Тема письма"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
        <textarea
          style={styles.textarea}
          placeholder="Текст письма..."
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
        />
        {error && <div style={styles.errorMsg}>{error}</div>}
        <div style={styles.composeFooter}>
          <button style={styles.btnPrimary} onClick={handleSend} disabled={sending}>
            {sending ? 'Отправка...' : '➤ Отправить'}
          </button>
          <button style={styles.btnGhost} onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ── Компонент: Просмотр письма ─────────────────────────────────────────────
function MailView({ mail, currentUser, onBack, onDelete, onToggleStar }) {
  const isInbox = mail.folder === 'inbox' || mail.to_user === currentUser;

  return (
    <div style={styles.mailView}>
      <div style={styles.mailViewHeader}>
        <button style={styles.iconBtn} onClick={onBack}><Icon.Back /> <span style={{ marginLeft: 4, fontSize: 13 }}>Назад</span></button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={styles.iconBtn} onClick={() => onToggleStar(mail.id)} title="Звёздочка">
            <Icon.Star filled={mail.is_starred === 1} />
          </button>
          <button style={{ ...styles.iconBtn, color: '#f87171' }} onClick={() => onDelete(mail.id)} title="Удалить">
            <Icon.Trash />
          </button>
        </div>
      </div>

      <h2 style={styles.mailSubject}>{mail.subject || '(Без темы)'}</h2>

      <div style={styles.mailMeta}>
        <span style={{ color: '#4ade80', fontWeight: 600 }}>
          {isInbox ? `От: ${mail.from_user}` : `Кому: ${mail.to_user}`}
        </span>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{formatDate(mail.timestamp)}</span>
      </div>

      <div style={styles.mailBody}>{mail.body}</div>
    </div>
  );
}

// ── Главный компонент ─────────────────────────────────────────────────────
export default function MailPage() {
  const [user, setUser]           = useState(null);
  const [folder, setFolder]       = useState('inbox');
  const [mails, setMails]         = useState([]);
  const [selectedMail, setSelectedMail] = useState(null);
  const [unread, setUnread]       = useState(0);
  const [loading, setLoading]     = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pollRef = useRef(null);

  // Читаем юзера из localStorage
  useEffect(() => {
    const u = (localStorage.getItem('p_user') || '').toLowerCase().trim();
    if (u) setUser(u);
  }, []);

  const loadMails = useCallback(async (f = folder) => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getMails(user, f);
      setMails(data);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [user, folder]);

  const refreshUnread = useCallback(async () => {
    if (!user) return;
    try { setUnread(await getUnreadCount(user)); } catch {}
  }, [user]);

  // Загрузка при смене папки / юзера
  useEffect(() => {
    if (!user) return;
    setSelectedMail(null);
    loadMails(folder);
    refreshUnread();
  }, [user, folder]);

  // Polling каждые 15 сек
  useEffect(() => {
    if (!user) return;
    pollRef.current = setInterval(() => { refreshUnread(); if (folder === 'inbox') loadMails('inbox'); }, 15000);
    return () => clearInterval(pollRef.current);
  }, [user, folder]);

  const handleSelectMail = async (mail) => {
    setSelectedMail(mail);
    if (mail.is_read === 0 && mail.to_user === user) {
      await markAsRead(mail.id, user);
      setMails(prev => prev.map(m => m.id === mail.id ? { ...m, is_read: 1 } : m));
      setUnread(prev => Math.max(0, prev - 1));
    }
  };

  const handleDelete = async (id) => {
    await deleteMail(id, user);
    setSelectedMail(null);
    loadMails(folder);
  };

  const handleToggleStar = async (id) => {
    const res = await toggleStar(id, user);
    if (res?.success) {
      setMails(prev => prev.map(m => m.id === id ? { ...m, is_starred: res.is_starred } : m));
      if (selectedMail?.id === id) setSelectedMail(prev => ({ ...prev, is_starred: res.is_starred }));
    }
  };

  const folders = [
    { key: 'inbox',   label: 'Входящие',   Icon: Icon.Inbox, badge: unread },
    { key: 'sent',    label: 'Отправленные', Icon: Icon.Send },
    { key: 'starred', label: 'Избранное',   Icon: Icon.Star },
    { key: 'trash',   label: 'Корзина',     Icon: Icon.Trash },
  ];

  if (!user) return (
    <div style={styles.noUser}>
      <Icon.Parrot />
      <p style={{ color: '#9ca3af', marginTop: 12 }}>Войди в аккаунт, чтобы открыть почту</p>
    </div>
  );

  return (
    <div style={styles.root}>
      {/* Мобильный оверлей сайдбара */}
      {sidebarOpen && (
        <div style={styles.sidebarOverlay} onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── SIDEBAR ── */}
      <aside style={{ ...styles.sidebar, ...(sidebarOpen ? styles.sidebarOpen : {}) }}>
        <div style={styles.sidebarLogo}>
          <Icon.Parrot />
          <span style={styles.logoText}>PMail</span>
        </div>

        <button style={styles.composeBtn} onClick={() => { setShowCompose(true); setSidebarOpen(false); }}>
          <Icon.Compose /> <span>Написать</span>
        </button>

        <nav style={{ marginTop: 8 }}>
          {folders.map(({ key, label, Icon: FolderIcon, badge }) => (
            <button
              key={key}
              style={{ ...styles.folderBtn, ...(folder === key ? styles.folderBtnActive : {}) }}
              onClick={() => { setFolder(key); setSidebarOpen(false); }}
            >
              <FolderIcon filled={false} />
              <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
              {badge > 0 && <span style={styles.badge}>{badge}</span>}
            </button>
          ))}
        </nav>

        <div style={styles.sidebarFooter}>
          <span style={{ color: '#4ade80', fontSize: 12, opacity: 0.7 }}>@{user}</span>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={styles.main}>
        {/* Хедер */}
        <div style={styles.topbar}>
          <button style={{ ...styles.iconBtn, display: 'flex' }} onClick={() => setSidebarOpen(v => !v)}>
            <Icon.Menu />
          </button>
          <span style={styles.topbarTitle}>
            {folders.find(f => f.key === folder)?.label}
          </span>
          {unread > 0 && folder === 'inbox' && (
            <span style={styles.badge}>{unread} новых</span>
          )}
        </div>

        {/* Контент: список или просмотр */}
        {selectedMail ? (
          <MailView
            mail={selectedMail}
            currentUser={user}
            onBack={() => setSelectedMail(null)}
            onDelete={handleDelete}
            onToggleStar={handleToggleStar}
          />
        ) : (
          <div style={styles.mailList}>
            {loading && (
              <div style={styles.emptyState}>
                <div style={styles.spinner} />
              </div>
            )}
            {!loading && mails.length === 0 && (
              <div style={styles.emptyState}>
                <div style={{ fontSize: 40, opacity: 0.2 }}>✉</div>
                <p style={{ color: '#6b7280', marginTop: 12, fontSize: 14 }}>Писем нет</p>
              </div>
            )}
            {!loading && mails.map(mail => (
              <div
                key={mail.id}
                style={{
                  ...styles.mailRow,
                  ...(mail.is_read === 0 ? styles.mailRowUnread : {}),
                }}
                onClick={() => handleSelectMail(mail)}
              >
                <div style={styles.mailRowLeft}>
                  {mail.is_read === 0 && <span style={styles.unreadDot} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={styles.mailRowFrom}>
                      {folder === 'sent' ? `→ ${mail.to_user}` : mail.from_user}
                    </div>
                    <div style={styles.mailRowSubject}>{mail.subject || '(Без темы)'}</div>
                    <div style={styles.mailRowPreview}>
                      {mail.body.slice(0, 80)}{mail.body.length > 80 ? '…' : ''}
                    </div>
                  </div>
                </div>
                <div style={styles.mailRowRight}>
                  <span style={{ fontSize: 11, color: '#6b7280' }}>{formatDate(mail.timestamp)}</span>
                  {mail.is_starred === 1 && <Icon.Star filled />}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Compose Modal */}
      {showCompose && (
        <ComposeModal
          currentUser={user}
          onClose={() => setShowCompose(false)}
          onSent={() => { refreshUnread(); if (folder === 'sent') loadMails('sent'); }}
        />
      )}
    </div>
  );
}

// ── Стили ─────────────────────────────────────────────────────────────────
const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    background: '#0a0a0a',
    color: '#e5e7eb',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    overflow: 'hidden',
    position: 'relative',
  },
  sidebar: {
    width: 220,
    minWidth: 220,
    background: '#111111',
    borderRight: '1px solid #1f1f1f',
    display: 'flex',
    flexDirection: 'column',
    padding: '16px 12px',
    gap: 4,
    zIndex: 100,
    transition: 'transform 0.2s ease',
    '@media (max-width: 640px)': { position: 'fixed', top: 0, left: 0, height: '100%', transform: 'translateX(-100%)' },
  },
  sidebarOpen: {
    position: 'fixed',
    top: 0,
    left: 0,
    height: '100%',
    transform: 'translateX(0)',
  },
  sidebarOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99,
  },
  sidebarLogo: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px 16px',
    borderBottom: '1px solid #1f2937', marginBottom: 8,
  },
  logoText: { fontWeight: 700, fontSize: 16, color: '#f9fafb', letterSpacing: '-0.3px' },
  composeBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#4ade80', color: '#000', border: 'none',
    borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
    fontWeight: 700, fontSize: 13, width: '100%', marginBottom: 4,
    transition: 'background 0.15s',
  },
  folderBtn: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: 'none', border: 'none', color: '#9ca3af',
    padding: '9px 10px', borderRadius: 8, cursor: 'pointer',
    fontSize: 13, width: '100%', transition: 'all 0.15s',
  },
  folderBtnActive: {
    background: '#1a2e1a', color: '#4ade80',
  },
  badge: {
    background: '#4ade80', color: '#000',
    fontSize: 10, fontWeight: 700,
    borderRadius: 99, padding: '2px 6px', minWidth: 18, textAlign: 'center',
  },
  sidebarFooter: {
    marginTop: 'auto', padding: '12px 4px 0', borderTop: '1px solid #1f2937',
  },
  main: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  topbar: {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '12px 16px', borderBottom: '1px solid #1f1f1f',
    background: '#0d0d0d',
  },
  topbarTitle: { fontWeight: 600, fontSize: 15, color: '#f9fafb', flex: 1 },
  mailList: { flex: 1, overflowY: 'auto' },
  mailRow: {
    display: 'flex', alignItems: 'flex-start', gap: 12,
    padding: '14px 16px', borderBottom: '1px solid #111',
    cursor: 'pointer', transition: 'background 0.1s',
    justifyContent: 'space-between',
  },
  mailRowUnread: { background: '#0f1a0f' },
  mailRowLeft: { display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 },
  unreadDot: {
    width: 7, height: 7, borderRadius: '50%', background: '#4ade80',
    flexShrink: 0, marginTop: 5,
  },
  mailRowFrom: { fontSize: 13, fontWeight: 600, color: '#f9fafb', marginBottom: 2 },
  mailRowSubject: { fontSize: 13, color: '#d1d5db', marginBottom: 2 },
  mailRowPreview: { fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400 },
  mailRowRight: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  mailView: { flex: 1, padding: '24px', overflowY: 'auto', maxWidth: 720 },
  mailViewHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  mailSubject: { fontSize: 20, fontWeight: 700, color: '#f9fafb', marginBottom: 12, lineHeight: 1.3 },
  mailMeta: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #1f2937' },
  mailBody: { fontSize: 14, color: '#d1d5db', lineHeight: 1.7, whiteSpace: 'pre-wrap' },
  emptyState: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: 60 },
  iconBtn: {
    background: 'none', border: 'none', color: '#9ca3af',
    cursor: 'pointer', padding: '6px', borderRadius: 6,
    display: 'inline-flex', alignItems: 'center', gap: 4,
    transition: 'color 0.15s',
  },
  // Compose
  modalOverlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    padding: 20, zIndex: 200,
  },
  composeBox: {
    background: '#111', border: '1px solid #1f2937', borderRadius: 12,
    width: '100%', maxWidth: 480,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
  },
  composeHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#0d0d0d',
  },
  composeField: {
    display: 'flex', alignItems: 'center', borderBottom: '1px solid #111',
  },
  label: { fontSize: 12, color: '#6b7280', padding: '0 16px', width: 50, flexShrink: 0 },
  input: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    color: '#f9fafb', fontSize: 13, padding: '12px 12px 12px 0',
  },
  textarea: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    color: '#d1d5db', fontSize: 13, padding: '14px 16px',
    resize: 'none', fontFamily: 'inherit', lineHeight: 1.6,
    minHeight: 180,
  },
  errorMsg: { color: '#f87171', fontSize: 12, padding: '8px 16px', background: '#1a0f0f' },
  composeFooter: {
    display: 'flex', gap: 8, padding: '12px 16px',
    borderTop: '1px solid #1f2937', background: '#0d0d0d',
  },
  btnPrimary: {
    background: '#4ade80', color: '#000', border: 'none',
    padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
    fontWeight: 700, fontSize: 13,
  },
  btnGhost: {
    background: 'none', color: '#9ca3af', border: '1px solid #374151',
    padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
  },
  noUser: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    background: '#0a0a0a',
  },
  spinner: {
    width: 28, height: 28, border: '3px solid #1f2937',
    borderTop: '3px solid #4ade80', borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};
