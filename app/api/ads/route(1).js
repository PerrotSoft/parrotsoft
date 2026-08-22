import { NextResponse } from 'next/server';
import * as actions from '@/app/actions';

// ── GET МЕТОДЫ (Рендеринг и получение данных) ────────────────────────────────
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const user = searchParams.get('user');

    // 1. ОТРИСОВКА РЕКЛАМЫ В IFRAME
    if (action === 'renderAd') {
      const type = searchParams.get('type') || 'banner';
      const devId = searchParams.get('devId') || '';
      const siteId = searchParams.get('siteId') || '';

      const finalHtml = await actions.renderAdHtml({ type, devId, siteId });
      return new Response(finalHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache' } });
    }

    // 1b. ПОЛУЧЕНИЕ РЕКЛАМЫ ДЛЯ ВСТРОЕННОГО МИДРОЛЛА (используется WavyPlayer, без iframe)
    if (action === 'getAd') {
      const type = searchParams.get('type') || 'banner';
      const devId = searchParams.get('devId') || '';
      const siteId = searchParams.get('siteId') || '';
      const result = await actions.getAdForPlayer(type, devId, siteId);
      return NextResponse.json(result);
    }

    // 2. ОБРАБОТКА КЛИКА (И БИЛЛИНГ ПЕРЕХОДА)
    if (action === 'click') {
      const adId = searchParams.get('adId');
      const devId = searchParams.get('devId');
      const siteId = searchParams.get('siteId');
      const target = searchParams.get('target');
      const finalTarget = await actions.handleAdClick(adId, devId, siteId, target);
      return NextResponse.redirect(finalTarget);
    }

    // 3. Кабинеты
    if (action === 'getStatus') {
      return NextResponse.json(await actions.getAdStatus(user));
    }
    if (action === 'getMyCampaigns') {
      return NextResponse.json({ campaigns: await actions.getMyAdCampaigns(user) });
    }
    if (action === 'getMySites') {
      return NextResponse.json({ sites: await actions.getMyAdSites(user) });
    }
    if (action === 'getWithdrawals') {
      return NextResponse.json({ withdrawals: await actions.getAdWithdrawals(user) });
    }

    return NextResponse.json({ error: 'unknown_get_action' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

// ── POST МЕТОДЫ (Создание кампаний и обработка токенов) ──────────────────────
export async function POST(req) {
  try {
    const body = await req.json();
    const { action } = body;

    // 1. БИЛЛИНГ ПОКАЗА (Отрабатывает только после подтверждения Anti-Fraud скриптом)
    if (action === 'verifyImpression') {
      const { payload, signature } = body;
      const result = await actions.verifyAdImpression(payload, signature);
      if (result.error) return NextResponse.json({ error: result.error }, { status: result.status || 200 });
      return NextResponse.json(result);
    }

    // 2. Создание кампании
    if (action === 'createCampaign') {
      const { ownerId, title, type, contentUrl, targetUrl, budget, cpv, cpc } = body;
      const result = await actions.createAdCampaign(ownerId, title, type, contentUrl, targetUrl, budget, cpv, cpc);
      return NextResponse.json(result);
    }

    if (action === 'activateDevAccount') {
      const { username } = body;
      const result = await actions.adServe_activateDevAccount(username);
      return NextResponse.json(result);
    }

    if (action === 'stopCampaign') {
      const { adId, ownerId } = body;
      return NextResponse.json(await actions.stopAdCampaign(adId, ownerId));
    }

    if (action === 'deleteCampaign') {
      const { adId, ownerId } = body;
      return NextResponse.json(await actions.deleteAdCampaign(adId, ownerId));
    }

    if (action === 'registerSite') {
      const { username, name, url, description } = body;
      return NextResponse.json(await actions.registerAdSite(username, name, url, description));
    }

    if (action === 'deleteSite') {
      const { siteId, username } = body;
      return NextResponse.json(await actions.deleteAdSite(siteId, username));
    }

    if (action === 'requestWithdrawal') {
      const { devId, amount, method, details } = body;
      return NextResponse.json(await actions.requestAdWithdrawal(devId, amount, method, details));
    }

    return NextResponse.json({ error: 'unknown_post_action' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
