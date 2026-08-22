'use client';

import { useState, useEffect } from 'react';
import * as actions from '../../actions';

export default function OAuthAuthorizePage() {
  const [params, setParams] = useState(null);
  const [appInfo, setAppInfo] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [useOtherAccount, setUseOtherAccount] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const clientId = sp.get('client_id');
    const redirectUri = sp.get('redirect_uri');
    const state = sp.get('state') || '';

    if (!clientId || !redirectUri) {
      setError('Не хватает client_id или redirect_uri в ссылке.');
      return;
    }

    setParams({ clientId, redirectUri, state });
    setCurrentUser(localStorage.getItem('p_user'));

    actions.getOAuthClientPublic(clientId, redirectUri).then(res => {
      if (!res.valid) setError(res.error);
      else setAppInfo(res);
    });
  }, []);

  const handleContinueAsCurrent = async () => {
    setLoading(true);
    setError('');
    const res = await actions.authorizeOAuthLoginTrusted(params.clientId, params.redirectUri, params.state, currentUser);
    setLoading(false);
    if (res.success) window.location.href = res.redirectTo;
    else setError(res.error);
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await actions.authorizeOAuthLogin(params.clientId, params.redirectUri, params.state, username, password);
    setLoading(false);
    if (res.success) window.location.href = res.redirectTo;
    else setError(res.error);
  };

  if (error && !appInfo) {
    return (
      <div style={styles.wrap}>
        <div style={styles.card}>
          <p style={{ color: '#ff5555' }}>⚠️ {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logo}>Parrot<span style={{ color: '#00ff41' }}>Soft</span></div>

        {appInfo && (
          <p style={styles.text}>
            <b>{appInfo.name}</b> хочет войти с помощью вашего аккаунта ParrotSoft.
          </p>
        )}

        {currentUser && !useOtherAccount ? (
          <>
            <p style={styles.text}>Продолжить как <b>{currentUser}</b>?</p>
            <button style={styles.btnPrimary} onClick={handleContinueAsCurrent} disabled={loading}>
              {loading ? '...' : `Продолжить как ${currentUser}`}
            </button>
            <button style={styles.btnLink} onClick={() => setUseOtherAccount(true)}>Войти в другой аккаунт</button>
          </>
        ) : (
          <form onSubmit={handleLoginSubmit}>
            <input style={styles.input} placeholder="Имя пользователя" value={username} onChange={e => setUsername(e.target.value)} />
            <input style={styles.input} type="password" placeholder="Пароль" value={password} onChange={e => setPassword(e.target.value)} />
            <button style={styles.btnPrimary} type="submit" disabled={loading}>
              {loading ? '...' : 'Войти и разрешить'}
            </button>
            {currentUser && (
              <button type="button" style={styles.btnLink} onClick={() => setUseOtherAccount(false)}>Назад к {currentUser}</button>
            )}
          </form>
        )}

        {error && <p style={{ color: '#ff5555', marginTop: '10px' }}>{error}</p>}
      </div>
    </div>
  );
}

const styles = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', fontFamily: 'sans-serif' },
  card: { width: '360px', background: '#0a0a0a', border: '1px solid #222', borderRadius: '12px', padding: '28px' },
  logo: { fontSize: '20px', fontWeight: 'bold', color: '#fff', marginBottom: '18px' },
  text: { color: '#ccc', fontSize: '14px', marginBottom: '16px', lineHeight: 1.5 },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginBottom: '10px', background: '#111', border: '1px solid #333', borderRadius: '6px', color: '#fff', fontSize: '14px' },
  btnPrimary: { width: '100%', padding: '11px', background: '#00ff41', color: '#000', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' },
  btnLink: { width: '100%', marginTop: '10px', padding: '8px', background: 'transparent', color: '#888', border: 'none', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' },
};
