'use client';
import { useState, useEffect } from 'react';
import AdsAdvertiserPanel from './AdvertiserPanel';
import AdsDeveloperPanel from './DeveloperPanel';

// ─── КОНФИГ (замени здесь) ───────────────────────────────────────────────────
const DEV_ACCOUNT_COST = 10; // Стоимость аккаунта разработчика в Pey Coins
// ─────────────────────────────────────────────────────────────────────────────

export default function AdsPage() {
  const [mode, setMode] = useState(null); // null = экран выбора, 'advertiser' | 'developer'
  const [username, setUsername] = useState('');
  const [balance, setBalance] = useState(0);
  const [isDevAccount, setIsDevAccount] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const u = localStorage.getItem('p_user') || '';
    setUsername(u);
    if (u) {
      fetch(`/api/ads?action=getStatus&user=${u}`)
        .then(r => r.json())
        .then(d => {
          setBalance(d.balance_pc || 0);
          setIsDevAccount(d.isDevAccount || true);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const refreshStatus = () => {
    if (!username) return;
    fetch(`/api/ads?action=getStatus&user=${username}`)
      .then(r => r.json())
      .then(d => {
        setBalance(d.balance || 0);
        setIsDevAccount(d.isDevAccount || false);
      });
  };

  if (loading) return (
    <div style={styles.loadingWrap}>
      <div style={styles.spinner} />
      <p style={{ color: 'rgba(255,255,255,0.5)', marginTop: 16, fontSize: 14 }}>Loading FireSoft.Ads...</p>
    </div>
  );

  // ── Экран выбора режима ────────────────────────────────────────────────────
  if (mode === null) return (
    <div style={styles.root}>
      <div style={styles.bgGlow} />
      <div style={styles.selectWrap}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>📡</span>
          <span style={styles.logoText}>FireSoft<b>.Ads</b></span>
        </div>
        <p style={styles.logoSub}>Рекламная платформа нового поколения</p>
        <div style={styles.modeGrid}>
          <button style={styles.modeCard} onClick={() => setMode('advertiser')}>
            <span style={{ fontSize: 42 }}>📣</span>
            <h3 style={styles.modeTitle}>Рекламодатель</h3>
            <p style={styles.modeDesc}>Создавай кампании, управляй бюджетом и продвигай свой продукт по всей сети ParrotSoft</p>
            <div style={styles.modeBtn}>Войти →</div>
          </button>
          <button style={styles.modeCard} onClick={() => setMode('developer')}>
            <span style={{ fontSize: 42 }}>💻</span>
            <h3 style={styles.modeTitle}>Разработчик</h3>
            <p style={styles.modeDesc}>Размещай рекламу на своём сайте, зарабатывай Pey Coins и выводи средства</p>
            <div style={styles.modeBtn}>Войти →</div>
          </button>
        </div>
        <p style={styles.balanceHint}>Баланс: <b>{balance} pc</b> · @{username || 'гость'}</p>
      </div>
    </div>
  );

  return (
    <div style={styles.root}>
      <div style={styles.bgGlow} />
      {/* ── Топ-бар ── */}
      <div style={styles.topBar}>
        <button style={styles.backBtn} onClick={() => setMode(null)}>← Назад</button>
        <div style={styles.logo}>
          <span style={{ fontSize: 18 }}>📡</span>
          <span style={styles.logoTextSm}>FireSoft<b>.Ads</b></span>
        </div>
        <div style={styles.modeTabs}>
          <button
            style={{ ...styles.modeTab, ...(mode === 'advertiser' ? styles.modeTabActive : {}) }}
            onClick={() => setMode('advertiser')}
          >📣 Рекламодатель</button>
          <button
            style={{ ...styles.modeTab, ...(mode === 'developer' ? styles.modeTabActive : {}) }}
            onClick={() => setMode('developer')}
          >💻 Разработчик</button>
        </div>
        <div style={styles.balancePill}>
          <span style={{ opacity: 0.6, fontSize: 12 }}>Balance</span>
          <span style={{ fontWeight: 700, color: '#7dd3fc' }}>{balance} pc</span>
        </div>
      </div>

      {/* ── Панели ── */}
      <div style={styles.panelWrap}>
        {mode === 'advertiser' && (
          <AdsAdvertiserPanel
            username={username}
            balance={balance}
            onRefresh={refreshStatus}
          />
        )}
        {mode === 'developer' && (
          <AdsDeveloperPanel
            username={username}
            balance={balance}
            isDevAccount={isDevAccount}
            devAccountCost={DEV_ACCOUNT_COST}
            onRefresh={refreshStatus}
          />
        )}
      </div>
    </div>
  );
}

// ─── Стили ────────────────────────────────────────────────────────────────────
const styles = {
  root: {
    minHeight: '100vh',
    background: '#080c14',
    color: '#fff',
    fontFamily: "'Inter', sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  bgGlow: {
    position: 'fixed',
    top: -200,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 800,
    height: 600,
    background: 'radial-gradient(ellipse, rgba(99,102,241,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
    zIndex: 0,
  },
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#080c14',
  },
  spinner: {
    width: 36,
    height: 36,
    border: '3px solid rgba(255,255,255,0.1)',
    borderTop: '3px solid #6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  selectWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '40px 20px',
    position: 'relative',
    zIndex: 1,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  logoIcon: { fontSize: 36 },
  logoText: { fontSize: 32, fontWeight: 300, letterSpacing: '-1px' },
  logoTextSm: { fontSize: 18, fontWeight: 300 },
  logoSub: { color: 'rgba(255,255,255,0.4)', marginBottom: 48, fontSize: 15 },
  modeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 20,
    maxWidth: 600,
    width: '100%',
    marginBottom: 32,
  },
  modeCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 24,
    padding: '36px 28px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
    cursor: 'pointer',
    transition: 'all 0.2s',
    color: '#fff',
    textAlign: 'center',
  },
  modeTitle: { fontSize: 20, fontWeight: 600, margin: 0 },
  modeDesc: { fontSize: 13, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6, margin: 0 },
  modeBtn: {
    marginTop: 8,
    padding: '8px 20px',
    background: 'rgba(99,102,241,0.2)',
    border: '1px solid rgba(99,102,241,0.4)',
    borderRadius: 100,
    fontSize: 13,
    color: '#a5b4fc',
  },
  balanceHint: { color: 'rgba(255,255,255,0.3)', fontSize: 13 },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 24px',
    background: 'rgba(8,12,20,0.85)',
    backdropFilter: 'blur(20px)',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontSize: 14,
    padding: '6px 10px',
    borderRadius: 8,
  },
  modeTabs: {
    display: 'flex',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  modeTab: {
    padding: '7px 18px',
    borderRadius: 100,
    border: 'none',
    background: 'rgba(255,255,255,0.05)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontSize: 13,
    transition: 'all 0.2s',
  },
  modeTabActive: {
    background: 'rgba(99,102,241,0.25)',
    color: '#a5b4fc',
    border: '1px solid rgba(99,102,241,0.35)',
  },
  balancePill: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  panelWrap: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '32px 20px 60px',
    position: 'relative',
    zIndex: 1,
  },
};
