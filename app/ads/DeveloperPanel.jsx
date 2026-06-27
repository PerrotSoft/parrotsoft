'use client';
import { useState, useEffect } from 'react';

export default function AdsDeveloperPanel({ username, balance, isDevAccount, devAccountCost, onRefresh }) {
  const [tab, setTab]               = useState('sites');
  const [sites, setSites]           = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [wcBalance, setWcBalance]   = useState(0);
  const [loading, setLoading]       = useState(true);
  const [activating, setActivating] = useState(false);

  // Форма добавления сайта
  const [siteForm, setSiteForm] = useState({ name: '', url: '', description: '' });
  const [addingSite, setAddingSite] = useState(false);
  const [showSiteForm, setShowSiteForm] = useState(false);

  // Форма вывода
  const [withForm, setWithForm] = useState({ amount: '', method: 'card', details: '' });
  const [withdrawing, setWithdrawing] = useState(false);

  const WITHDRAWAL_FEE = 0.50; // 50% комиссия при выводе

  useEffect(() => {
    if (username) loadData();
  }, [username]);

  const loadData = async () => {
    setLoading(true);
    const [sRes, wRes, stsRes] = await Promise.all([
      fetch(`/api/ads?action=getMySites&user=${username}`).then(r => r.json()),
      fetch(`/api/ads?action=getWithdrawals&user=${username}`).then(r => r.json()),
      fetch(`/api/ads?action=getStatus&user=${username}`).then(r => r.json()),
    ]);
    setSites(sRes.sites || []);
    setWithdrawals(wRes.withdrawals || []);
    setWcBalance(stsRes.balance_wc || 0);
    setLoading(false);
  };

  // Активация Dev-аккаунта
  const handleActivate = async () => {
    if (!confirm(`Активировать Dev-аккаунт за ${devAccountCost} PC?`)) return;
    setActivating(true);
    const r = await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activateDevAccount', username }),
    });
    const d = await r.json();
    setActivating(false);
    if (d.success) { onRefresh(); alert('✅ Dev-аккаунт активирован!'); }
    else alert('Ошибка: ' + (d.error || 'Неизвестная'));
  };

  // Добавление сайта
  const handleAddSite = async () => {
    if (!siteForm.name || !siteForm.url) return alert('Заполни название и URL!');
    setAddingSite(true);
    const r = await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'registerSite', username, ...siteForm }),
    });
    const d = await r.json();
    setAddingSite(false);
    if (d.success) {
      setSiteForm({ name: '', url: '', description: '' });
      setShowSiteForm(false);
      loadData();
    } else alert('Ошибка: ' + (d.error || 'Неизвестная'));
  };

  // Удаление сайта
  const handleDeleteSite = async (siteId) => {
    if (!confirm('Удалить площадку?')) return;
    await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteSite', siteId, username }),
    });
    loadData();
  };

  // Запрос вывода
  const handleWithdraw = async () => {
    const amt = Number(withForm.amount);
    if (!amt || amt <= 0)      return alert('Введи сумму!');
    if (amt > wcBalance)       return alert('Недостаточно WC!');
    if (!withForm.details)     return alert('Укажи реквизиты!');

    const payout = (amt * (1 - WITHDRAWAL_FEE)).toFixed(4);
    if (!confirm(`Запросить вывод ${amt} WC?\nКомиссия 50% → получишь: ${payout} WC ($${payout})`)) return;

    setWithdrawing(true);
    const r = await fetch('/api/ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'requestWithdrawal', devId: username, ...withForm, amount: amt }),
    });
    const d = await r.json();
    setWithdrawing(false);
    if (d.success) {
      alert(`✅ Заявка создана!\nЗапрошено: ${d.requested_wc} WC\nКомиссия: ${d.fee_wc} WC\nК выплате: ${d.payout_wc} WC ($${d.payout_wc})`);
      setWithForm({ amount: '', method: 'card', details: '' });
      loadData();
      onRefresh();
    } else alert('Ошибка: ' + (d.error || 'Неизвестная'));
  };

  const statusColor = { pending: '#fbbf24', approved: '#4ade80', rejected: '#f87171' };
  const statusLabel = { pending: '⏳ Ожидание', approved: '✅ Выплачено', rejected: '❌ Отклонено' };

  // ── Экран активации ──────────────────────────────────────────────────────────
  if (!isDevAccount) return (
    <div style={s.root}>
      <div style={s.activateCard}>
        <span style={{ fontSize: 52 }}>💻</span>
        <h2 style={s.h2}>Аккаунт разработчика</h2>
        <p style={s.desc}>
          Размещай рекламные блоки на своих сайтах и зарабатывай Wavy Coins.
          Активация разовая и стоит <b style={{ color: '#7dd3fc' }}>{devAccountCost} PC</b>.
        </p>

        {/* Схема монетизации */}
        <div style={s.schemeBox}>
          <div style={s.schemeTitle}>💰 Схема заработка</div>
          <div style={s.schemeRow}>
            <span>Рекламодатель платит CPV и CPC</span>
            <span style={{ color: '#fff' }}>за показы и клики</span>
          </div>
          <div style={s.schemeRow}>
            <span>Вам отчисляется</span>
            <span style={{ color: '#4ade80' }}>доля 1/1000 в WC</span>
          </div>
          <div style={s.schemeDivider} />
          <div style={s.schemeRow}>
            <span>При выводе комиссия</span>
            <span style={{ color: '#f87171' }}>50% платформе</span>
          </div>
        </div>

        <div style={s.balanceHint}>Твой баланс: <b>{balance} PC</b></div>

        <button style={s.btnActivate} onClick={handleActivate} disabled={activating || balance < devAccountCost}>
          {activating ? '⏳ Активируем...' : balance < devAccountCost
            ? `Нужно ${devAccountCost} PC (не хватает ${devAccountCost - balance} PC)`
            : `🚀 Активировать за ${devAccountCost} PC`}
        </button>
      </div>
    </div>
  );

  // ── Основной кабинет ──────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* Шапка */}
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>💻 Разработчик</h2>
          <p style={s.sub}>Монетизируй свои сайты и выводи заработок</p>
        </div>
        <div style={s.tabs}>
          {['sites', 'withdraw', 'history'].map(t => (
            <button key={t}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
              onClick={() => setTab(t)}>
              {t === 'sites' ? '🌐 Площадки' : t === 'withdraw' ? '💸 Вывод' : '📜 История'}
            </button>
          ))}
        </div>
      </div>

      {/* Статы */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <span style={s.statLabel}>Баланс WC</span>
          <span style={s.statVal}>{wcBalance.toFixed(4)} <span style={{ fontSize: 13, color: '#a5b4fc' }}>wc</span></span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>≈ в долларах</span>
          <span style={s.statVal}>${wcBalance.toFixed(4)}</span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>Площадок</span>
          <span style={s.statVal}>{sites.length} / 10</span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>Показов всего</span>
          <span style={s.statVal}>{sites.reduce((a, s) => a + (s.total_views || 0), 0).toLocaleString()}</span>
        </div>
      </div>

      {loading ? (
        <div style={s.centered}><div style={s.spinner} /></div>
      ) : (
        <>
          {/* ── Площадки ── */}
          {tab === 'sites' && (
            <div>
              <div style={s.sectionHeader}>
                <h3 style={s.sectionTitle}>Мои площадки</h3>
                <button style={s.btnPrimary} onClick={() => setShowSiteForm(v => !v)}>
                  {showSiteForm ? '✕ Отмена' : '+ Добавить сайт'}
                </button>
              </div>

              {/* Форма добавления */}
              {showSiteForm && (
                <div style={s.card}>
                  <h3 style={s.cardTitle}>Новая площадка</h3>

                  <label style={s.label}>Название</label>
                  <input style={s.input} placeholder="Мой крутой сайт"
                    value={siteForm.name}
                    onChange={e => setSiteForm({ ...siteForm, name: e.target.value })} />

                  <label style={s.label}>URL сайта (https://...)</label>
                  <input style={s.input} placeholder="parrotsoft.vercel.app"
                    value={siteForm.url}
                    onChange={e => setSiteForm({ ...siteForm, url: e.target.value })} />

                  <label style={s.label}>Описание (необязательно)</label>
                  <input style={s.input} placeholder="Игровой портал, 10к посетителей в день"
                    value={siteForm.description}
                    onChange={e => setSiteForm({ ...siteForm, description: e.target.value })} />

                  <button style={s.btnPrimary} onClick={handleAddSite} disabled={addingSite}>
                    {addingSite ? '⏳ Добавляем...' : '✅ Добавить площадку'}
                  </button>

                  {/* Инструкция интеграции */}
                  <div style={s.integrationBox}>
                    <div style={s.integrationTitle}>📋 Код для вставки на сайт</div>
                    <pre style={s.codeBlock}>{`<!-- 1. Подключи SDK в <head> -->
<script
  src="https://your-domain.com/firesoft-ads-sdk.js"
  data-dev="${username}"
  data-site="ТВОЙ_SITE_ID"
  async
></script>

<!-- 2. Вставь рекламные блоки -->
<!-- Баннер -->
<div class="fs-ad" data-type="banner"></div>

<!-- Видео -->
<div class="fs-ad" data-type="video"></div>

<!-- Межстраничная (показывается 1 раз за сессию) -->
<div class="fs-ad" data-type="interstitial"></div>`}</pre>
                  </div>
                </div>
              )}

              {/* Список сайтов */}
              {sites.length === 0 ? (
                <div style={s.emptyState}>
                  <span style={{ fontSize: 44 }}>🌐</span>
                  <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>Нет площадок. Добавь первый сайт!</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {sites.map(site => (
                    <div key={site.id} style={s.siteCard}>
                      <div style={s.siteLeft}>
                        <span style={{ fontSize: 28 }}>🌐</span>
                        <div>
                          <div style={s.siteTitle}>{site.name}</div>
                          <a href={site.url} target="_blank" rel="noopener noreferrer" style={s.siteUrl}>{site.url}</a>
                          <div style={s.siteId}>ID: <code style={s.code}>{site.id}</code></div>
                        </div>
                      </div>
                      <div style={s.siteRight}>
                        <div style={s.siteStat}>
                          <span style={s.statMini}>Показов</span>
                          <span>{(site.total_views || 0).toLocaleString()}</span>
                        </div>
                        <div style={s.siteStat}>
                          <span style={s.statMini}>Заработано</span>
                          <span style={{ color: '#4ade80' }}>{Number(site.total_earned || 0).toFixed(6)} WC</span>
                        </div>
                        <button style={s.btnDanger} onClick={() => handleDeleteSite(site.id)}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Вывод ── */}
          {tab === 'withdraw' && (
            <div style={s.card}>
              <h3 style={s.cardTitle}>💸 Вывод средств</h3>

              {/* Калькулятор комиссии */}
              <div style={s.feeCalc}>
                <div style={s.feeTitle}>Калькулятор вывода</div>
                <div style={s.feeRow}>
                  <span>Доступно</span>
                  <span style={{ color: '#7dd3fc', fontWeight: 700 }}>{wcBalance.toFixed(6)} WC</span>
                </div>
                {withForm.amount && (
                  <>
                    <div style={s.feeRow}>
                      <span>Запрашиваешь</span>
                      <span>{Number(withForm.amount).toFixed(4)} WC</span>
                    </div>
                    <div style={s.feeRow}>
                      <span>Комиссия платформы (50%)</span>
                      <span style={{ color: '#f87171' }}>−{(Number(withForm.amount) * WITHDRAWAL_FEE).toFixed(4)} WC</span>
                    </div>
                    <div style={s.feeDivider} />
                    <div style={s.feeRow}>
                      <span style={{ fontWeight: 700 }}>Получишь на руки</span>
                      <span style={{ color: '#4ade80', fontWeight: 700 }}>
                        {(Number(withForm.amount) * (1 - WITHDRAWAL_FEE)).toFixed(4)} WC
                        &nbsp;≈ ${(Number(withForm.amount) * (1 - WITHDRAWAL_FEE)).toFixed(4)}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <label style={s.label}>Сумма вывода (WC)</label>
              <input style={s.input} type="number" min="1" step="0.01"
                placeholder={`Минимум 1 WC, доступно ${wcBalance.toFixed(4)} WC`}
                value={withForm.amount}
                onChange={e => setWithForm({ ...withForm, amount: e.target.value })} />

              <label style={s.label}>Способ вывода</label>
              <div style={s.methodGrid}>
                {[
                  { value: 'card',   label: '💳 Карта' },
                  { value: 'crypto', label: '🪙 Крипто' },
                  { value: 'paypal', label: '🅿️ PayPal' },
                  { value: 'other',  label: '📋 Другое' },
                ].map(m => (
                  <button key={m.value}
                    style={{ ...s.methodBtn, ...(withForm.method === m.value ? s.methodBtnActive : {}) }}
                    onClick={() => setWithForm({ ...withForm, method: m.value })}>
                    {m.label}
                  </button>
                ))}
              </div>

              <label style={s.label}>
                {withForm.method === 'card'   ? 'Номер карты или IBAN' :
                 withForm.method === 'crypto' ? 'Адрес кошелька + сеть (напр: TRC20)' :
                 withForm.method === 'paypal' ? 'Email PayPal' : 'Реквизиты'}
              </label>
              <input style={s.input}
                placeholder={withForm.method === 'card' ? '4111 1111 1111 1111' :
                             withForm.method === 'crypto' ? 'TXyz... (TRC20 USDT)' :
                             withForm.method === 'paypal' ? 'you@email.com' : 'Опиши способ...'}
                value={withForm.details}
                onChange={e => setWithForm({ ...withForm, details: e.target.value })} />

              <button style={{ ...s.btnPrimary, marginTop: 20, width: '100%' }}
                onClick={handleWithdraw} disabled={withdrawing || !wcBalance}>
                {withdrawing ? '⏳ Обрабатываем...' : '💸 Запросить вывод'}
              </button>

              <p style={s.hint}>
                ⚠️ Заявки обрабатываются вручную в течение 1–3 рабочих дней.
                Комиссия 50% вычитается из суммы вывода.
                Минимальная сумма вывода: 1 WC ($1).
              </p>
            </div>
          )}

          {/* ── История выводов ── */}
          {tab === 'history' && (
            <div>
              <h3 style={{ ...s.sectionTitle, marginBottom: 16 }}>История выводов</h3>
              {withdrawals.length === 0 ? (
                <div style={s.emptyState}>
                  <span style={{ fontSize: 44 }}>📭</span>
                  <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>Заявок на вывод ещё нет</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {withdrawals.map(w => (
                    <div key={w.id} style={s.wCard}>
                      <div>
                        <div style={s.wMethod}>
                          {w.method === 'card' ? '💳' : w.method === 'crypto' ? '🪙' : w.method === 'paypal' ? '🅿️' : '📋'}
                          &nbsp;{w.method}
                        </div>
                        <div style={s.wDate}>{new Date(w.timestamp).toLocaleString('ru')}</div>
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
                          ID: {w.id}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#f87171', fontSize: 13 }}>
                          Запрошено: {Number(w.amount_requested || w.amount || 0).toFixed(4)} WC
                        </div>
                        <div style={{ color: '#4ade80', fontWeight: 700, fontSize: 16 }}>
                          К выплате: {Number(w.amount_payout || 0).toFixed(4)} WC
                        </div>
                        <div style={{ ...s.wStatus, color: statusColor[w.status] || '#94a3b8' }}>
                          {statusLabel[w.status] || w.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const s = {
  root:          { padding: 0 },
  header:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 },
  h2:            { fontSize: 26, fontWeight: 700, margin: 0 },
  sub:           { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '4px 0 0' },
  tabs:          { display: 'flex', gap: 6, flexWrap: 'wrap' },
  tab:           { padding: '8px 18px', borderRadius: 100, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 },
  tabActive:     { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc' },
  statsRow:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 },
  statCard:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4 },
  statLabel:     { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  statVal:       { fontSize: 22, fontWeight: 700 },
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: 28, marginBottom: 20 },
  cardTitle:     { fontSize: 18, fontWeight: 600, margin: '0 0 20px' },
  label:         { display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6, marginTop: 14 },
  input:         { width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle:  { fontSize: 18, fontWeight: 600, margin: 0 },
  emptyState:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: 8 },
  centered:      { display: 'flex', justifyContent: 'center', padding: 60 },
  spinner:       { width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  btnPrimary:    { padding: '12px 22px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnDanger:     { padding: '8px 14px', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#f87171', cursor: 'pointer', fontSize: 16 },
  hint:          { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 14, lineHeight: 1.6 },
  siteCard:      { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  siteLeft:      { display: 'flex', alignItems: 'center', gap: 14 },
  siteRight:     { display: 'flex', alignItems: 'center', gap: 16 },
  siteTitle:     { fontSize: 16, fontWeight: 600, marginBottom: 2 },
  siteUrl:       { fontSize: 12, color: '#7dd3fc', textDecoration: 'none' },
  siteId:        { fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 },
  siteStat:      { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  statMini:      { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  code:          { fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 4, fontSize: 11, userSelect: 'all' },
  integrationBox:{ marginTop: 20, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: 16 },
  integrationTitle:{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#a5b4fc' },
  codeBlock:     { fontSize: 12, color: '#86efac', lineHeight: 1.7, margin: 0, overflowX: 'auto', whiteSpace: 'pre', fontFamily: 'monospace' },
  feeCalc:       { background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 14, padding: '16px 20px', marginBottom: 8 },
  feeTitle:      { fontSize: 13, fontWeight: 600, color: '#a5b4fc', marginBottom: 12 },
  feeRow:        { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: 'rgba(255,255,255,0.7)' },
  feeDivider:    { borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0' },
  methodGrid:    { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 },
  methodBtn:     { padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 },
  methodBtnActive:{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' },
  wCard:         { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  wMethod:       { fontSize: 15, fontWeight: 600, marginBottom: 4 },
  wDate:         { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  wStatus:       { fontSize: 13, fontWeight: 600, marginTop: 4 },
  activateCard:  { maxWidth: 560, margin: '0 auto', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 24, padding: '48px 36px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' },
  desc:          { color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, maxWidth: 400, margin: 0 },
  schemeBox:     { width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '16px 20px', marginTop: 4 },
  schemeTitle:   { fontSize: 13, fontWeight: 600, color: '#a5b4fc', marginBottom: 12 },
  schemeRow:     { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '5px 0', color: 'rgba(255,255,255,0.6)' },
  schemeDivider: { borderTop: '1px solid rgba(255,255,255,0.08)', margin: '8px 0' },
  balanceHint:   { color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  btnActivate:   { padding: '14px 32px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 14, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 16, marginTop: 8, opacity: 1 },
};