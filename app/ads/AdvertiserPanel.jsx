'use client';
import { useState, useEffect } from 'react';

const typeLabels  = { banner: '🖼 Баннер', video: '🎬 Видео', interstitial: '📺 Полный экран' };
const statusColor = { active: '#4ade80', paused: '#fbbf24', ended: '#94a3b8' };

export default function AdsAdvertiserPanel({ username, balance, onRefresh }) {
  const [tab, setTab]         = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [form, setForm] = useState({
    title: '', type: 'banner', contentUrl: '', targetUrl: '', budget: '', cpv: '0.1', cpc: '0.5',
  });

  useEffect(() => { loadCampaigns(); }, [username]);

  const loadCampaigns = async () => {
    if (!username) return;
    setLoading(true);
    const r = await fetch(`/api/ads?action=getMyCampaigns&user=${username}`);
    const d = await r.json();
    setCampaigns(d.campaigns || []);
    setLoading(false);
  };

  // ── Создать кампанию ────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.title || !form.contentUrl || !form.targetUrl || !form.budget)
      return alert('Заполни все поля!');
    if (Number(form.budget) > balance)
      return alert('Недостаточно Pey Coins на балансе!');

    setCreating(true);
    const r = await fetch('/api/ads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'createCampaign', ownerId: username, ...form,
        budget: Number(form.budget), cpv: Number(form.cpv), cpc: Number(form.cpc) }),
    });
    const d = await r.json();
    setCreating(false);
    if (d.success) {
      setTab('list');
      setForm({ title: '', type: 'banner', contentUrl: '', targetUrl: '', budget: '', cpv: '0.1', cpc: '0.5' });
      loadCampaigns(); onRefresh();
      alert('✅ Кампания создана! ID: ' + d.adId);
    } else alert('Ошибка: ' + (d.error || 'Неизвестная'));
  };

  // ── Остановить (пауза) ──────────────────────────────────────────────────────
  const handleStop = async (adId) => {
    if (!confirm('Остановить кампанию?')) return;
    await fetch('/api/ads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stopCampaign', adId, ownerId: username }),
    });
    loadCampaigns();
  };

  // ── Удалить кампанию + вернуть остаток бюджета ─────────────────────────────
  const handleDelete = async (c) => {
    const leftPC = Number(c.budget || 0).toFixed(2);
    if (!confirm(`Удалить кампанию «${c.title}»?\n\nОстаток бюджета ${leftPC} PC будет возвращён на баланс.`)) return;
    const r = await fetch('/api/ads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteCampaign', adId: c.id, ownerId: username }),
    });
    const d = await r.json();
    if (d.success) {
      loadCampaigns(); onRefresh();
      if (d.refunded_pc > 0) alert(`✅ Удалено. Возвращено ${d.refunded_pc.toFixed(2)} PC`);
    } else alert('Ошибка: ' + (d.error || 'Неизвестная'));
  };

  const spent = campaigns.reduce((a, c) => a + (Number(c.initial_budget || 0) - Number(c.budget || 0)), 0);

  return (
    <div>
      {/* Шапка */}
      <div style={s.header}>
        <div>
          <h2 style={s.h2}>📣 Рекламодатель</h2>
          <p style={s.sub}>Управляй своими рекламными кампаниями</p>
        </div>
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab === 'list' ? s.tabActive : {}) }} onClick={() => setTab('list')}>Мои кампании</button>
          <button style={{ ...s.tab, ...(tab === 'create' ? s.tabActive : {}) }} onClick={() => setTab('create')}>+ Создать</button>
        </div>
      </div>

      {/* Статы */}
      <div style={s.statsRow}>
        <div style={s.statCard}>
          <span style={s.statLabel}>Баланс</span>
          <span style={s.statVal}>{balance} <span style={{ fontSize: 13, color: '#7dd3fc' }}>pc</span></span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>Активных</span>
          <span style={s.statVal}>{campaigns.filter(c => c.status === 'active').length}</span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>Потрачено</span>
          <span style={s.statVal}>{spent.toFixed(1)} <span style={{ fontSize: 13, color: '#f87171' }}>pc</span></span>
        </div>
        <div style={s.statCard}>
          <span style={s.statLabel}>Показы / Клики</span>
          <span style={s.statVal}>
            {campaigns.reduce((a, c) => a + (Number(c.views) || 0), 0).toLocaleString()}
            <span style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', margin: '0 6px' }}>/</span>
            {campaigns.reduce((a, c) => a + (Number(c.clicks) || 0), 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Создать */}
      {tab === 'create' && (
        <div style={s.card}>
          <h3 style={s.cardTitle}>Новая кампания</h3>

          <label style={s.label}>Название</label>
          <input style={s.input} placeholder="Летняя акция 2026" value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })} />

          <label style={s.label}>Тип рекламы</label>
          <div style={s.typeGrid}>
            {Object.entries(typeLabels).map(([val, label]) => (
              <button key={val}
                style={{ ...s.typeBtn, ...(form.type === val ? s.typeBtnActive : {}) }}
                onClick={() => setForm({ ...form, type: val })}>{label}</button>
            ))}
          </div>

          <label style={s.label}>{form.type === 'video' ? 'URL видео (mp4)' : 'URL изображения'}</label>
          <input style={s.input}
            placeholder={form.type === 'video' ? 'https://cdn.example.com/ad.mp4' : 'https://cdn.example.com/banner.jpg'}
            value={form.contentUrl} onChange={e => setForm({ ...form, contentUrl: e.target.value })} />

          {form.contentUrl && (
            <div style={s.preview}>
              {form.type === 'video'
                ? <video src={form.contentUrl} style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 180 }} controls />
                : <img src={form.contentUrl} alt="preview" style={{ maxWidth: '100%', borderRadius: 8, maxHeight: 120 }} onError={e => e.target.style.display = 'none'} />}
            </div>
          )}

          <label style={s.label}>URL назначения</label>
          <input style={s.input} placeholder="https://yoursite.com/landing"
            value={form.targetUrl} onChange={e => setForm({ ...form, targetUrl: e.target.value })} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <div>
              <label style={s.label}>Бюджет (pc)</label>
              <input style={s.input} type="number" min="1" placeholder="100"
                value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>CPV (цена за показ)</label>
              <input style={s.input} type="number" min="0.001" step="0.001" placeholder="0.1"
                value={form.cpv} onChange={e => setForm({ ...form, cpv: e.target.value })} />
            </div>
            <div>
              <label style={s.label}>CPC (цена за клик)</label>
              <input style={s.input} type="number" min="0.01" step="0.01" placeholder="0.5"
                value={form.cpc} onChange={e => setForm({ ...form, cpc: e.target.value })} />
            </div>
          </div>

          {form.budget && form.cpv && form.cpc && (
            <div style={s.estimate}>
              <span>📊 Расчёт охвата:</span>
              <span style={{ color: '#a5b4fc' }}>
                ~{Math.floor(Number(form.budget) / Number(form.cpv)).toLocaleString()} показов
                <span style={{ color: 'rgba(255,255,255,0.3)', margin: '0 8px' }}>или</span> 
                ~{Math.floor(Number(form.budget) / Number(form.cpc)).toLocaleString()} кликов
              </span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button style={s.btnPrimary} onClick={handleCreate} disabled={creating}>
              {creating ? '⏳ Создаём...' : '🚀 Запустить кампанию'}
            </button>
            <button style={s.btnSecondary} onClick={() => setTab('list')}>Отмена</button>
          </div>

          <p style={s.hint}>⚠️ Средства списываются сразу. При удалении кампании остаток возвращается на баланс.</p>
        </div>
      )}

      {/* Список */}
      {tab === 'list' && (
        loading ? (
          <div style={s.emptyState}><div style={s.spinner} /></div>
        ) : campaigns.length === 0 ? (
          <div style={s.emptyState}>
            <span style={{ fontSize: 48 }}>📭</span>
            <p style={{ color: 'rgba(255,255,255,0.4)', marginTop: 12 }}>Нет кампаний. Создай первую!</p>
            <button style={s.btnPrimary} onClick={() => setTab('create')}>+ Создать кампанию</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {campaigns.map(c => (
              <div key={c.id} style={s.campaignCard}>
                <div style={s.campaignLeft}>
                  <span style={{ fontSize: 28 }}>
                    {c.type === 'video' ? '🎬' : c.type === 'interstitial' ? '📺' : '🖼'}
                  </span>
                  <div>
                    <div style={s.campaignTitle}>{c.title}</div>
                    <div style={s.campaignMeta}>
                      <span style={{ color: statusColor[c.status] || '#94a3b8' }}>● {c.status}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <span>{typeLabels[c.type] || c.type}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <span>{new Date(c.timestamp).toLocaleDateString('ru')}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <span>👁 {Number(c.views || 0).toLocaleString()}</span>
                      <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                      <span>👆 {Number(c.clicks || 0).toLocaleString()}</span>
                    </div>
                    {/* Прогресс-бар расхода бюджета */}
                    <div style={s.progressOuter}>
                      <div style={{
                        ...s.progressFill,
                        width: `${Math.min(100, ((Number(c.initial_budget) - Number(c.budget)) / Math.max(0.01, Number(c.initial_budget))) * 100)}%`
                      }} />
                    </div>
                  </div>
                </div>
                <div style={s.campaignRight}>
                  <div style={s.campaignStat}>
                    <span style={s.statMiniLabel}>Остаток</span>
                    <span style={{ color: '#7dd3fc', fontWeight: 600 }}>{Number(c.budget).toFixed(1)} pc</span>
                  </div>
                  <div style={s.campaignStat}>
                    <span style={s.statMiniLabel}>CPV / CPC</span>
                    <span>{Number(c.cpv || 0).toFixed(3)} / {Number(c.cpc || 0).toFixed(2)} pc</span>
                  </div>
                  {c.status === 'active' && (
                    <button style={s.btnWarn} onClick={() => handleStop(c.id)}>⏹ Стоп</button>
                  )}
                  {/* Кнопка УДАЛИТЬ (всегда видна) */}
                  <button style={s.btnDanger} onClick={() => handleDelete(c)} title="Удалить и вернуть остаток">
                    🗑 Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

const s = {
  header:        { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 24 },
  h2:            { fontSize: 26, fontWeight: 700, margin: 0 },
  sub:           { color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: '4px 0 0' },
  tabs:          { display: 'flex', gap: 6 },
  tab:           { padding: '8px 20px', borderRadius: 100, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 },
  tabActive:     { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', color: '#a5b4fc' },
  statsRow:      { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 },
  statCard:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 4 },
  statLabel:     { fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  statVal:       { fontSize: 22, fontWeight: 700 },
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 20, padding: 28 },
  cardTitle:     { fontSize: 18, fontWeight: 600, margin: '0 0 20px' },
  label:         { display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6, marginTop: 14 },
  input:         { width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  typeGrid:      { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 },
  typeBtn:       { padding: '10px 18px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 14 },
  typeBtnActive: { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.5)', color: '#a5b4fc' },
  preview:       { marginTop: 10, marginBottom: 4, padding: 12, background: 'rgba(0,0,0,0.3)', borderRadius: 12, textAlign: 'center' },
  estimate:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: '12px 16px', marginTop: 12, fontSize: 14 },
  btnPrimary:    { padding: '12px 24px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', border: 'none', borderRadius: 12, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnSecondary:  { padding: '12px 20px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14 },
  btnWarn:       { padding: '8px 14px', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 10, color: '#fbbf24', cursor: 'pointer', fontSize: 13 },
  btnDanger:     { padding: '8px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, color: '#f87171', cursor: 'pointer', fontSize: 13 },
  hint:          { fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 14, lineHeight: 1.6 },
  emptyState:    { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 260, gap: 12 },
  spinner:       { width: 32, height: 32, border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  campaignCard:  { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  campaignLeft:  { display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 220 },
  campaignTitle: { fontSize: 16, fontWeight: 600, marginBottom: 4 },
  campaignMeta:  { display: 'flex', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.5)', flexWrap: 'wrap' },
  campaignRight: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  campaignStat:  { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  statMiniLabel: { fontSize: 11, color: 'rgba(255,255,255,0.3)' },
  progressOuter: { width: '100%', maxWidth: 200, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  progressFill:  { height: '100%', background: 'linear-gradient(90deg,#6366f1,#8b5cf6)', borderRadius: 2, transition: 'width 0.4s' },
};