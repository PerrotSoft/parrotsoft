import { NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import crypto from 'crypto';

const DB_URL             = process.env.TURSO_DATABASE_URL  || "libsql://parrotsoft-vercel-icfg-i713yoki8d1eytlkyrwlsfzr.aws-us-east-1.turso.io";
const DB_TOKEN           = process.env.TURSO_AUTH_TOKEN    || "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NzEzNjM2NjIsImlkIjoiN2YyYTY2MDgtYWZjOC00MTQ1LWFlNmYtZDljMDhkZGRhZWE3IiwicmlkIjoiZDU5ZjM3ZTYtZGE5YS00YTA2LTk4OWYtMTBhYTRjNWFmOTViIn0.V6NDZo1wMJNNs5ipc40YkuTCXqG4DwijLBkqtDbr-6_uJa1xCJvHPOvE3jeK2UOfTBtc-cD8SZ0s3tqALRuABA";
const ANTI_FRAUD_SECRET  = process.env.API_SECRET || "firesoft_super_secret_key_2026";
const PLATFORM_ACCOUNT   = 'Icfg';  

// Математика монетизации
const DEV_REWARD_MULTIPLIER = 0.001; // Разработчик получает 1/1000 от стоимости (PC -> WC)
const WITHDRAWAL_FEE_PCT    = 0.50;  // Комиссия при выводе средств (50%)
const MIN_WITHDRAWAL_WC     = 1;     // Минималка на вывод
const DEV_ACCOUNT_COST      = 10;    // Цена активации аккаунта разработчика (PC)
const MAX_SITES             = 10;    

const ALLOWED_TYPES      = ['banner', 'video', 'interstitial'];

// Настройки заглушек Adsterra
const ADSTERRA_CONFIGS = {
  banner:       { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60  },
  video:        { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60  },
  interstitial: { key: '461fc1b30ddf891492b673d9f9ce6b0b', width: 468, height: 60  },
};
const ADSTERRA_SCRIPT_HOST = 'www.profitabledisplaynetwork.com';

const client  = createClient({ url: DB_URL, authToken: DB_TOKEN });
const toPlain = (rows) => rows.map(r => ({ ...r }));

// ── ИНИЦИАЛИЗАЦИЯ БД ──────────────────────────────────────────────────────────
async function ensureAdsTables() {
  await client.execute(`CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, data TEXT)`);
  
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_ads (
      id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, type TEXT, content_url TEXT, target_url TEXT,
      budget TEXT DEFAULT '0', initial_budget TEXT DEFAULT '0', 
      cpv TEXT DEFAULT '0.1', cpc TEXT DEFAULT '0.5', 
      views INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, status TEXT DEFAULT 'active', timestamp INTEGER
    )`);
    
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_withdrawals (
      id TEXT PRIMARY KEY, dev_id TEXT, amount_requested REAL DEFAULT 0, amount_payout REAL DEFAULT 0, 
      fee REAL DEFAULT 0, method TEXT, details TEXT, status TEXT DEFAULT 'pending', timestamp INTEGER
    )`);
    
  await client.execute(`
    CREATE TABLE IF NOT EXISTS fa_sites (
      id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, url TEXT, description TEXT, status TEXT DEFAULT 'active',
      total_views INTEGER DEFAULT 0, total_earned REAL DEFAULT 0, timestamp INTEGER
    )`);
    
  await client.execute(`CREATE TABLE IF NOT EXISTS fa_views_log (token TEXT PRIMARY KEY, timestamp INTEGER)`);
  
  // Миграции для старых таблиц (если они уже были созданы)
  for (const sql of [
    `ALTER TABLE users ADD COLUMN is_dev INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN initial_budget TEXT DEFAULT '0'`,
    `ALTER TABLE fa_ads ADD COLUMN views INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN clicks INTEGER DEFAULT 0`,
    `ALTER TABLE fa_ads ADD COLUMN cpc TEXT DEFAULT '0.5'`,
    `ALTER TABLE fa_withdrawals ADD COLUMN amount_payout REAL DEFAULT 0`,
    `ALTER TABLE fa_withdrawals ADD COLUMN fee REAL DEFAULT 0`,
  ]) { try { await client.execute(sql); } catch (_) {} }
}

// ── УТИЛИТЫ КОШЕЛЬКА ─────────────────────────────────────────────────────────
async function getRawUser(username) {
  if (!username || username === 'null' || username === 'undefined') return { balance: 0, wavy_coins: 0, isDevAccount: false };
  const r = await client.execute({ sql: 'SELECT data FROM users WHERE username = ?', args: [String(username)] });
  if (!r.rows.length) return { balance: 0, wavy_coins: 0, isDevAccount: false };
  try {
    const d = JSON.parse(r.rows[0].data || '{}');
    return { ...d, balance: Number(d.balance || 0), wavy_coins: Number(d.wavy_coins || 0), isDevAccount: Boolean(d.isDevAccount) };
  } catch { return { balance: 0, wavy_coins: 0, isDevAccount: false }; }
}

async function saveUser(username, data) {
  if (!username || username === 'null') return;
  await client.execute({ sql: 'INSERT INTO users (username, data) VALUES (?,?) ON CONFLICT(username) DO UPDATE SET data=?', args: [String(username), JSON.stringify(data), JSON.stringify(data)] });
}

async function addPlatformFee(amountWC) {
  if (!amountWC || amountWC <= 0 || !PLATFORM_ACCOUNT) return;
  try {
    const pd = await getRawUser(PLATFORM_ACCOUNT);
    pd.wavy_coins = Number(((pd.wavy_coins || 0) + amountWC).toFixed(8));
    await saveUser(PLATFORM_ACCOUNT, pd);
  } catch (_) {}
}

function sanitize(s, max = 300) { return typeof s === 'string' ? s.replace(/[<>"'`]/g, '').trim().slice(0, max) : ''; }

// ── GET МЕТОДЫ (Рендеринг и получение данных) ────────────────────────────────
export async function GET(req) {
  try {
    await ensureAdsTables();
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const user   = searchParams.get('user');

    // 1. ОТРИСОВКА РЕКЛАМЫ В IFRAME
    if (action === 'renderAd') {
      const type = searchParams.get('type') || 'banner';
      const devId = searchParams.get('devId') || '';
      const siteId = searchParams.get('siteId') || '';

      // Ищем кампанию, у которой бюджет больше стоимости показа (cpv)
      const rs = await client.execute({
        sql: `SELECT * FROM fa_ads WHERE type = ? AND status = 'active' AND CAST(budget AS REAL) >= CAST(cpv AS REAL) ORDER BY RANDOM() LIMIT 1`,
        args: [type]
      });

      let adId = 'adsterra';
      let mediaHtml = '';

      if (rs.rows.length > 0) {
        // Рендерим внутреннюю рекламу FireSoft
        const ad = rs.rows[0];
        adId = ad.id;
        
        // В URL клика зашиваем devId и siteId, чтобы оплатить переход разработчику
        const clickUrl = `/api/ads?action=click&adId=${ad.id}&devId=${encodeURIComponent(devId)}&siteId=${encodeURIComponent(siteId)}&target=${encodeURIComponent(ad.target_url)}`;
        
        const mediaTag = type === 'video' 
          ? `<video src="${ad.content_url}" autoplay loop muted playsinline></video>` 
          : `<img src="${ad.content_url}" alt="Ad" />`;

        mediaHtml = `
          ${mediaTag}
          <a href="${clickUrl}" target="_blank" class="link"></a>
          <div class="badge">FireSoft Ads</div>
        `;
      } else {
        // Если нашей рекламы нет, отдаем заглушку Adsterra
        const cfg = ADSTERRA_CONFIGS[type] || ADSTERRA_CONFIGS.banner;
        mediaHtml = `
          <script type="text/javascript">
            atOptions = { 'key': '${cfg.key}', 'format': 'iframe', 'height': ${cfg.height}, 'width': ${cfg.width}, 'params': {} };
          </script>
          <script type="text/javascript" src="https://${ADSTERRA_SCRIPT_HOST}/${cfg.key}/invoke.js"></script>
          <div class="badge" style="z-index:100;background:rgba(0,0,0,0.5);">Adsterra</div>
        `;
      }

      // Генерация крипто-токена для защиты от накрутки показов
      const payloadObj = { adId, devId, siteId, ts: Date.now() };
      const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
      const signature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payloadBase64).digest('hex');

      const finalHtml = `
        <!DOCTYPE html><html><head><style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: sans-serif; display: flex; justify-content: center; align-items: center; }
          .box { position: relative; width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; }
          video, img { width: 100%; height: 100%; object-fit: contain; display: block; }
          .link { position: absolute; inset: 0; z-index: 10; cursor: pointer; }
          .badge { position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.6); color: rgba(255,255,255,0.7); font-size: 10px; padding: 2px 6px; border-radius: 4px; z-index: 11; pointer-events: none; }
        </style></head><body>
          <div class="box" id="ad-container">
            ${mediaHtml}
          </div>
          <script>
            let impressionSent = false;
            // Проверка: видит ли пользователь рекламу на экране (минимум 50%)
            const observer = new IntersectionObserver((entries) => {
              if (entries[0].isIntersecting && !impressionSent) {
                impressionSent = true;
                fetch('/api/ads', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    action: 'verifyImpression', 
                    payload: '${payloadBase64}', 
                    signature: '${signature}' 
                  })
                }).catch(()=>{});
              }
            }, { threshold: 0.5 });
            observer.observe(document.getElementById('ad-container'));
          </script>
        </body></html>
      `;

      return new Response(finalHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache' } });
    }

    // 1b. ПОЛУЧЕНИЕ РЕКЛАМЫ ДЛЯ ВСТРОЕННОГО МИДРОЛЛА (используется WavyPlayer, без iframe)
    if (action === 'getAd') {
      const type = searchParams.get('type') || 'banner';
      const devId = searchParams.get('devId') || '';
      const siteId = searchParams.get('siteId') || '';

      const rs = await client.execute({
        sql: `SELECT * FROM fa_ads WHERE type = ? AND status = 'active' AND CAST(budget AS REAL) >= CAST(cpv AS REAL) ORDER BY RANDOM() LIMIT 1`,
        args: [type]
      });

      if (rs.rows.length === 0) {
        // Нет активных кампаний нужного типа — реклама отключена, без заглушек
        return NextResponse.json({ success: false });
      }

      const ad = rs.rows[0];

      // Токен для подтверждения показа (биллинг происходит отдельным POST после реального показа)
      const payloadObj = { adId: ad.id, devId, siteId, ts: Date.now() };
      const payloadBase64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
      const signature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payloadBase64).digest('hex');

      return NextResponse.json({
        success: true,
        ad: {
          id: ad.id,
          source: ad.type,
          content_url: ad.content_url,
          target_url: `/api/ads?action=click&adId=${ad.id}&devId=${encodeURIComponent(devId)}&siteId=${encodeURIComponent(siteId)}&target=${encodeURIComponent(ad.target_url)}`,
          payload: payloadBase64,
          signature
        }
      });
    }

    // 2. ОБРАБОТКА КЛИКА (И БИЛЛИНГ ПЕРЕХОДА)
    if (action === 'click') {
      const adId = searchParams.get('adId');
      const devId = searchParams.get('devId');
      const siteId = searchParams.get('siteId');
      const target = searchParams.get('target') || 'https://parrotsoft.ru';

      if (adId && adId !== 'adsterra') {
        const adRes = await client.execute({ sql: "SELECT cpc, budget FROM fa_ads WHERE id = ?", args: [adId] });
        
        if (adRes.rows.length > 0) {
          const ad = adRes.rows[0];
          const cpc = parseFloat(ad.cpc || '0.5'); // Стоимость клика (PC)
          const budget = parseFloat(ad.budget || '0');

          if (budget >= cpc) {
            // Списываем CPC с рекламодателя и фиксируем клик
            await client.execute({ 
              sql: "UPDATE fa_ads SET budget = CAST(CAST(budget AS REAL) - ? AS TEXT), clicks = clicks + 1 WHERE id = ?", 
              args: [cpc, adId] 
            });

            // Начисляем 1/1000 разработчику в Wavy Coins
            if (devId && devId !== 'null') {
              const costWC = cpc * DEV_REWARD_MULTIPLIER;
              const ud = await getRawUser(devId);
              ud.wavy_coins = Number((ud.wavy_coins + costWC).toFixed(8));
              await saveUser(devId, ud);
              
              if (siteId && siteId !== 'null') {
                await client.execute({ sql: "UPDATE fa_sites SET total_earned = total_earned + ? WHERE id = ?", args: [costWC, siteId] });
              }
            }
          }
        }
      }
      return NextResponse.redirect(target);
    }

    // 3. Кабинеты
    if (action === 'getStatus') {
      const ud = await getRawUser(user);
      console.log(ud.balance);
      return NextResponse.json({ balance_pc: ud.balance, balance_wc: ud.wavy_coins, isDevAccount: ud.isDevAccount, devAccountCost: DEV_ACCOUNT_COST, withdrawalFee: WITHDRAWAL_FEE_PCT });
    }
    if (action === 'getMyCampaigns') {
      const rs = await client.execute({ sql: 'SELECT * FROM fa_ads WHERE owner_id=? ORDER BY timestamp DESC', args: [String(user)] });
      return NextResponse.json({ campaigns: toPlain(rs.rows) });
    }
    if (action === 'getMySites') {
      const rs = await client.execute({ sql: 'SELECT * FROM fa_sites WHERE owner_id=? ORDER BY timestamp DESC', args: [String(user)] });
      return NextResponse.json({ sites: toPlain(rs.rows) });
    }
    if (action === 'getWithdrawals') {
      const rs = await client.execute({ sql: 'SELECT * FROM fa_withdrawals WHERE dev_id=? ORDER BY timestamp DESC', args: [String(user)] });
      return NextResponse.json({ withdrawals: toPlain(rs.rows) });
    }

    return NextResponse.json({ error: 'unknown_get_action' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

// ── POST МЕТОДЫ (Создание кампаний и обработка токенов) ──────────────────────
export async function POST(req) {
  try {
    await ensureAdsTables();
    const body = await req.json();
    const { action } = body;

    // 1. БИЛЛИНГ ПОКАЗА (Отрабатывает только после подтверждения Anti-Fraud скриптом)
    if (action === 'verifyImpression') {
      const { payload, signature } = body;
      if (!payload || !signature) return NextResponse.json({ error: 'Missing security data' });

      const expectedSignature = crypto.createHmac('sha256', ANTI_FRAUD_SECRET).update(payload).digest('hex');
      if (signature !== expectedSignature) return NextResponse.json({ error: 'Fraud detected' }, { status: 403 });

      const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      const { adId, devId, siteId, ts } = data;

      // Устаревший токен (>30 минут)
      if (Date.now() - ts > 30 * 60 * 1000) return NextResponse.json({ error: 'Token expired' }, { status: 403 });

      // Защита от повторного использования токена
      try {
        await client.execute({ sql: "INSERT INTO fa_views_log (token, timestamp) VALUES (?, ?)", args: [signature, Date.now()] });
      } catch (e) {
        return NextResponse.json({ error: 'Impression already counted' }, { status: 429 });
      }

      // Биллинг показа Adsterra (даем микро-копейку для стимула)
      if (adId === 'adsterra') {
        const microReward = 0.000001;
        if (devId && devId !== 'null') {
          const ud = await getRawUser(devId);
          ud.wavy_coins = Number((ud.wavy_coins + microReward).toFixed(8));
          await saveUser(devId, ud);
          if (siteId && siteId !== 'null') {
            await client.execute({ sql: "UPDATE fa_sites SET total_views = total_views + 1, total_earned = total_earned + ? WHERE id = ?", args: [microReward, siteId] });
          }
        }
        return NextResponse.json({ success: true, reward: microReward });
      }

      // Биллинг внутренней кампании FireSoft
      const adRes = await client.execute({ sql: "SELECT cpv, budget, status FROM fa_ads WHERE id = ?", args: [adId] });
      if (adRes.rows.length === 0 || adRes.rows[0].status !== 'active') return NextResponse.json({ error: 'Ad inactive' });
      
      const cpv = parseFloat(adRes.rows[0].cpv || '0.1'); // Стоимость показа в PC
      const costWC = cpv * DEV_REWARD_MULTIPLIER;         // 1/1000 в WC для разработчика

      // Списываем у рекламодателя и прибавляем просмотр
      await client.execute({ sql: "UPDATE fa_ads SET budget = CAST(CAST(budget AS REAL) - ? AS TEXT), views = views + 1 WHERE id = ?", args: [cpv, adId] });

      // Начисляем разработчику
      if (devId && devId !== 'null') {
        const ud = await getRawUser(devId);
        ud.wavy_coins = Number((ud.wavy_coins + costWC).toFixed(8));
        await saveUser(devId, ud);

        if (siteId && siteId !== 'null') {
          await client.execute({ sql: "UPDATE fa_sites SET total_views = total_views + 1, total_earned = total_earned + ? WHERE id = ?", args: [costWC, siteId] });
        }
      }
      return NextResponse.json({ success: true, reward: costWC });
    }

    // 2. Создание кампании (Добавлены CPV и CPC)
    if (action === 'createCampaign') {
      const { ownerId, title, type, contentUrl, targetUrl, budget, cpv, cpc } = body;
      const reqBudget = Number(budget); 
      const reqCpv = Number(cpv || 0.1);
      const reqCpc = Number(cpc || 0.5);

      const ud = await getRawUser(ownerId);
      if (ud.balance < reqBudget) return NextResponse.json({ success: false, error: 'Недостаточно PC' });
      
      ud.balance -= reqBudget; 
      await saveUser(ownerId, ud);
      
      const adId = 'ad_' + Math.random().toString(36).substring(2, 11);
      await client.execute({
        sql: `INSERT INTO fa_ads (id,owner_id,title,type,content_url,target_url,budget,initial_budget,cpv,cpc,views,clicks,status,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'active',?)`,
        args: [adId, String(ownerId), sanitize(title, 200), type, contentUrl, targetUrl, String(reqBudget), String(reqBudget), String(reqCpv), String(reqCpc), 0, 0, Date.now()]
      });
      return NextResponse.json({ success: true, adId, newBalance_pc: ud.balance });
    }

    // Остальные методы кабинетов...
    if (action === 'activateDevAccount') {
      const { username } = body;
      const ud = await getRawUser(username);
      if (ud.isDevAccount) return NextResponse.json({ success: false, error: 'Уже активирован' });
      if (ud.balance < DEV_ACCOUNT_COST) return NextResponse.json({ success: false, error: `Нужно ${DEV_ACCOUNT_COST} PC` });
      ud.balance -= DEV_ACCOUNT_COST; ud.isDevAccount = true;
      await saveUser(username, ud);
      await addPlatformFee(DEV_ACCOUNT_COST * DEV_REWARD_MULTIPLIER);
      return NextResponse.json({ success: true });
    }

    if (action === 'stopCampaign') {
      const { adId, ownerId } = body;
      await client.execute({ sql: "UPDATE fa_ads SET status='ended' WHERE id=? AND owner_id=?", args: [String(adId), String(ownerId)] });
      return NextResponse.json({ success: true });
    }

    if (action === 'deleteCampaign') {
      const { adId, ownerId } = body;
      const adRes = await client.execute({ sql: 'SELECT budget,owner_id FROM fa_ads WHERE id=?', args: [String(adId)] });
      if (!adRes.rows.length || String(adRes.rows[0].owner_id) !== String(ownerId)) return NextResponse.json({ success: false });
      const refundPC = parseFloat(adRes.rows[0].budget || '0');
      if (refundPC > 0) { const ud = await getRawUser(ownerId); ud.balance = Number((ud.balance + refundPC).toFixed(6)); await saveUser(ownerId, ud); }
      await client.execute({ sql: 'DELETE FROM fa_ads WHERE id=?', args: [String(adId)] });
      return NextResponse.json({ success: true, refunded_pc: refundPC });
    }

    if (action === 'registerSite') {
      const { username, name, url, description } = body;
      const siteId = 'site_' + Math.random().toString(36).substring(2, 11);
      await client.execute({ sql: `INSERT INTO fa_sites (id,owner_id,name,url,description,status,total_views,total_earned,timestamp) VALUES (?,?,?,?,?,'active',0,0,?)`, args: [siteId, String(username), sanitize(name, 100), url, sanitize(description), Date.now()] });
      return NextResponse.json({ success: true, siteId });
    }

    if (action === 'deleteSite') {
      const { siteId, username } = body;
      await client.execute({ sql: 'DELETE FROM fa_sites WHERE id=? AND owner_id=?', args: [String(siteId), String(username)] });
      return NextResponse.json({ success: true });
    }

    if (action === 'requestWithdrawal') {
      const { devId, amount, method, details } = body;
      const reqWC = Number(amount);
      const ud = await getRawUser(devId);
      if (ud.wavy_coins < reqWC) return NextResponse.json({ success: false, error: 'Недостаточно WC' });
      const feeWC = Number((reqWC * WITHDRAWAL_FEE_PCT).toFixed(8)); const payoutWC = Number((reqWC - feeWC).toFixed(8));
      ud.wavy_coins = Number((ud.wavy_coins - reqWC).toFixed(8)); await saveUser(devId, ud);
      await addPlatformFee(feeWC);
      const wid = 'with_' + Math.random().toString(36).substring(2, 11);
      await client.execute({ sql: `INSERT INTO fa_withdrawals (id,dev_id,amount_requested,amount_payout,fee,method,details,status,timestamp) VALUES (?,?,?,?,?,?,?,'pending',?)`, args: [wid, String(devId), reqWC, payoutWC, feeWC, sanitize(method, 50), sanitize(details), Date.now()] });
      return NextResponse.json({ success: true, withdrawalId: wid });
    }

    return NextResponse.json({ error: 'unknown_post_action' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}