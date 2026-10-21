import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { metricValues } from '../server/analytics.mjs';
import { dateKey } from '../server/domain.mjs';
import { randomBytes } from 'node:crypto';

async function fixture(t, options = {}) {
  const db = createDatabase(':memory:', { seedDemo: false });
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('work', 'Teste', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('other', 'Outra', 0);
  const app = createApp(db, { password: '', secretKey: randomBytes(32), ...options });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, body, method = body ? 'POST' : 'GET', headers = {}) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      redirect: 'manual',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, headers: r.headers, data: r.status === 302 ? null : await r.json() };
  };
  const pixel = (
    await request('/pixels', {
      project_id: 'work',
      name: 'Pixel teste',
      domain: 'https://site.test',
    })
  ).data;
  const token = (
    await request('/tokens', {
      project_id: 'work',
      name: 'CRM teste',
      platform: 'API personalizada',
    })
  ).data;
  return { db, app, request, pixel, token, base };
}

test('report formulas distinguish unknown metrics, use approved orders and consolidate cumulative engagement', () => {
  const events = [
    {
      event_name: 'PageView',
      visitor_id: 'v1',
      session_id: 's1',
      page_view_id: 'pv1',
      duration_ms: 0,
    },
    {
      event_name: 'PageEngagement',
      visitor_id: 'v1',
      page_view_id: 'pv1',
      duration_ms: 15000,
      active_ms: 12000,
      scroll_depth: 25,
    },
    {
      event_name: 'PageEngagement',
      visitor_id: 'v1',
      page_view_id: 'pv1',
      duration_ms: 30000,
      active_ms: 20000,
      scroll_depth: 75,
    },
    { event_name: 'Lead', visitor_id: 'v1' },
    { event_name: 'Lead', visitor_id: 'v1' },
    { event_name: 'InitiateCheckout', visitor_id: 'v1' },
  ];
  const m = metricValues(
    [
      { status: 'approved', amount: 200, payment_method: 'pix' },
      { status: 'pending', amount: 100 },
      { status: 'refunded', amount: 50 },
    ],
    50,
    1000,
    100,
    events,
    [{ link_clicks: 80, landing_views: 40, checkouts: 10 }],
  );
  assert.equal(m.revenue, 200);
  assert.equal(m.profit, 150);
  assert.equal(m.roas, 4);
  assert.equal(m.ctr, 10);
  assert.equal(m.cpm, 50);
  assert.equal(m.cpc, 0.5);
  assert.equal(m.link_cpc, 0.625);
  assert.equal(m.landing_rate, 50);
  assert.equal(m.leads, 1);
  assert.equal(m.cpl, 50);
  assert.equal(m.avg_duration, 30);
  assert.equal(m.avg_active, 20);
  assert.equal(m.avg_scroll, 75);
  assert.equal(m.refunded_amount, 50);
  assert.ok(Math.abs(m.approval_rate - 100 / 3) < 1e-10);
  assert.equal(m.orders, 3);
  const empty = metricValues([], 0, 0, 0);
  assert.equal(empty.roas, null);
  assert.equal(empty.link_clicks, null);
  assert.equal(empty.link_ctr, null);
  assert.equal(empty.avg_active, null);
});

test('columns persist per operation and reject empty, duplicate or oversized preferences', async (t) => {
  const f = await fixture(t);
  const saved = {
    selected: ['spend', 'revenue', 'ctr'],
    presets: [{ name: 'Minha visão', columns: ['revenue', 'sales'] }],
  };
  assert.equal((await f.request('/report-columns?project=work', saved, 'PUT')).status, 200);
  assert.deepEqual((await f.request('/report-columns?project=work')).data, saved);
  assert.equal((await f.request('/report-columns?project=other')).data, null);
  assert.equal(
    (await f.request('/report-columns?project=work', { ...saved, selected: [] }, 'PUT')).status,
    400,
  );
  assert.equal(
    (await f.request('/report-columns?project=work', { ...saved, selected: ['ctr', 'ctr'] }, 'PUT'))
      .status,
    400,
  );
  assert.equal((await f.request('/report-columns?project=missing')).status, 404);
});

test('API and browser events are idempotent, preserve signals, cannot create revenue and respect project/token isolation', async (t) => {
  const f = await fixture(t);
  const event = {
    pixel_id: f.pixel.id,
    event_id: 'stable-crm-event',
    visitor_id: 'visitor-00001',
    event_name: 'Lead',
    value: 97,
    utm_source: 'facebook',
    utm_campaign: 'Campanha',
    content_id: 'curso-1',
    first_touch: { utm_source: 'google' },
    click_ids: { ttclid: 'tiktok-123' },
  };
  const auth = { Authorization: `Bearer ${f.token.token}` };
  await f.request('/campaigns', {
    project_id: 'work',
    name: 'Campanha',
    source: 'Meta Ads',
    budget: 0,
  });
  assert.equal((await f.request('/track-events', event)).status, 401);
  assert.equal((await f.request('/track-events', event, 'POST', auth)).data.duplicate, false);
  assert.equal((await f.request('/track-events', event, 'POST', auth)).data.duplicate, true);
  assert.equal(
    (
      await f.request(
        '/track-events',
        { ...event, event_id: 'another-purchase', event_name: 'Purchase' },
        'POST',
        auth,
      )
    ).status,
    400,
  );
  const foreign = (
    await f.request('/pixels', {
      project_id: 'other',
      name: 'Outro pixel',
      domain: 'https://site.test',
    })
  ).data;
  assert.equal(
    (await f.request('/track-events', { ...event, pixel_id: foreign.id }, 'POST', auth)).status,
    404,
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  const signals = f.db.prepare('SELECT * FROM event_signals').get();
  assert.equal(signals.channel, 'server');
  assert.equal(signals.value, 97);
  assert.equal(JSON.parse(signals.first_touch).utm_source, 'google');
  const browser = {
    ...event,
    event_id: 'browser-custom-01',
    event_name: 'MinhaConversao',
    page_url: 'https://site.test/oferta?secret=private',
  };
  assert.equal(
    (await f.request(`/collect/${f.pixel.id}`, browser, 'POST', { Origin: 'https://evil.test' }))
      .status,
    403,
  );
  assert.equal(
    (await f.request(`/collect/${f.pixel.id}`, browser, 'POST', { Origin: 'https://site.test' }))
      .status,
    200,
  );
  assert.equal(
    (await f.request(`/collect/${f.pixel.id}`, browser, 'POST', { Origin: 'https://site.test' }))
      .status,
    200,
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 2);
  const hierarchy = (
    await f.request(
      `/ad-hierarchy?project=work&level=campaigns&start=${dateKey()}&end=${dateKey()}`,
    )
  ).data;
  assert.equal(hierarchy.rows[0].leads, 1);
  assert.equal(hierarchy.rows[0].link_clicks, null);
  const journey = (
    await f.request(`/visitors/visitor-00001?project=work&start=${dateKey()}&end=${dateKey()}`)
  ).data;
  assert.equal(journey.events.length, 2);
  assert.equal(journey.events[0].first_source, 'google');
  assert.ok(!JSON.stringify(journey).includes('secret=private'));
  await f.request(`/tokens/${f.token.id}`, null, 'DELETE');
  assert.equal(
    (await f.request('/track-events', { ...event, event_id: 'revoked-token-01' }, 'POST', auth))
      .status,
    401,
  );
});

test('smart links keep fixed destinations, propagate attribution and recover WhatsApp origin for CRM and sales', async (t) => {
  const f = await fixture(t);
  const link = (
    await f.request('/smart-links', {
      project_id: 'work',
      pixel_id: f.pixel.id,
      name: 'WhatsApp consultoria',
      destination: 'https://wa.me/5511999999999?text=Olá',
      event_name: 'WhatsAppClick',
    })
  ).data;
  const redirected = await f.request(
    `/r/${link.id}?utm_source=facebook&utm_campaign=camp-123&destination=https://evil.test`,
  );
  assert.equal(redirected.status, 302);
  const target = new URL(redirected.headers.get('location'));
  assert.equal(target.hostname, 'wa.me');
  assert.equal(target.searchParams.get('utm_campaign'), 'camp-123');
  const code = target.searchParams.get('text').match(/\[(wt[a-z0-9]+)\]/)[1];
  const event = await f.request(
    '/track-events',
    {
      pixel_id: f.pixel.id,
      attribution_code: code,
      event_id: 'conversation-001',
      event_name: 'Contact',
    },
    'POST',
    { Authorization: `Bearer ${f.token.token}` },
  );
  assert.equal(event.status, 200);
  const contact = f.db.prepare("SELECT * FROM events WHERE event_name='Contact'").get();
  assert.equal(contact.utm_source, 'facebook');
  assert.equal(contact.utm_campaign, 'camp-123');
  assert.equal(
    (
      await f.request(`/webhooks/${f.token.token}`, {
        attribution_code: code,
        order_id: 'offline-001',
        product: 'Consultoria',
        amount: 200,
        status: 'approved',
      })
    ).status,
    200,
  );
  assert.equal(f.db.prepare('SELECT utm_source FROM sales').get().utm_source, 'facebook');
  assert.equal(
    f.db.prepare('SELECT visitor_id FROM sale_attribution').get().visitor_id,
    contact.visitor_id,
  );
  assert.equal(
    (
      await f.request('/smart-links', {
        project_id: 'work',
        pixel_id: f.pixel.id,
        name: 'Inválido',
        destination: 'javascript:alert(1)',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request('/tracking/events', {
        project_id: 'other',
        pixel_id: f.pixel.id,
        attribution_code: code,
        event_id: 'foreign-ref-001',
        event_name: 'Contact',
      })
    ).status,
    400,
  );
  await f.request(`/smart-links/${link.id}`, { project_id: 'work', active: false }, 'PATCH');
  assert.equal((await f.request(`/r/${link.id}`)).status, 404);
  assert.equal((await f.request(`/pixels/${f.pixel.id}`, null, 'DELETE')).status, 200);
});

test('funnel CAPI is opt-in, hashes customer identity and never queues browser Purchases or engagement', async (t) => {
  const prior = process.env.META_GRAPH_VERSION;
  process.env.META_GRAPH_VERSION = 'v23.0';
  t.after(() => {
    if (prior === undefined) delete process.env.META_GRAPH_VERSION;
    else process.env.META_GRAPH_VERSION = prior;
  });
  const f = await fixture(t, {
    transport: async () => ({ ok: true, json: async () => ({ events_received: 1 }) }),
  });
  f.app.locals.meta.configurePixel(f.pixel.id, '12345678', 'secret-token');
  const body = {
    event_id: 'capi-browser-0001',
    visitor_id: 'browser-visitor-01',
    event_name: 'Lead',
    page_url: 'https://site.test/',
  };
  const collect = (v) =>
    f.request(`/collect/${f.pixel.id}`, v, 'POST', { Origin: 'https://site.test' });
  await collect(body);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM capi_queue').get().n, 0);
  await f.request(
    `/pixels/${f.pixel.id}/tracking`,
    { project_id: 'work', capi_events: true },
    'PUT',
  );
  await collect({ ...body, event_id: 'capi-browser-0002' });
  await collect({ ...body, event_id: 'capi-browser-0002' });
  await collect({ ...body, event_id: 'capi-browser-purchase', event_name: 'Purchase' });
  await collect({ ...body, event_id: 'capi-browser-timing', event_name: 'PageEngagement' });
  const event = await f.request(
    '/track-events',
    {
      pixel_id: f.pixel.id,
      event_id: 'custom-server-id',
      visitor_id: 'browser-visitor-01',
      event_name: 'QualifiedLead',
      send_capi: true,
      customer_email: 'TEST@EXAMPLE.COM',
      value: 150,
    },
    'POST',
    { Authorization: `Bearer ${f.token.token}` },
  );
  assert.equal(event.data.capi, 'queued');
  const queued = f.db.prepare('SELECT * FROM capi_queue').all();
  assert.equal(queued.length, 2);
  const payload = JSON.parse(
    queued.find((q) => JSON.parse(q.payload).event_name === 'QualifiedLead').payload,
  );
  assert.match(payload.user_data.em[0], /^[a-f0-9]{64}$/);
  assert.equal(payload.event_id, 'custom-server-id');
  assert.ok(!JSON.stringify(queued).includes('TEST@EXAMPLE.COM'));
  await f.app.locals.meta.drain();
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM capi_queue WHERE status='sent'").get().n, 2);
});

test('compatible order format validates BRL cents, UTC, tests, pipe attribution, idempotent payment and refund', async (t) => {
  const f = await fixture(t);
  f.db
    .prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)')
    .run('c', 'work', 'Campanha real', 'Meta Ads', 0, 1, new Date().toISOString());
  f.db.prepare('INSERT INTO meta_campaigns VALUES(?,?,?)').run('c', '123', 'act_1');
  f.db.prepare('INSERT INTO meta_account_selection VALUES(?,?,?)').run('work', 'act_1', 1);
  f.db.prepare('INSERT INTO ad_sets VALUES(?,?,?,?,?,?)').run('set', 'c', '456', 'Conjunto', 1, 0);
  f.db.prepare('INSERT INTO ads VALUES(?,?,?,?,?)').run('ad', 'set', '789', 'Anúncio', 1);
  const body = {
    orderId: 'compatible-order-001',
    platform: 'Checkout externo',
    paymentMethod: 'pix',
    status: 'paid',
    createdAt: '2026-10-21 12:00:00',
    approvedDate: '2026-10-21 12:01:00',
    customer: {
      name: 'Teste',
      email: 'test@example.test',
      phone: '11999999999',
      document: 'not-stored',
    },
    products: [{ id: 'curso', name: 'Curso', quantity: 1, priceInCents: 9700 }],
    trackingParameters: {
      utm_source: 'FB',
      utm_campaign: 'Campanha|123',
      utm_medium: 'Conjunto|456',
      utm_content: 'Anuncio|789',
      utm_term: 'feed',
    },
    commission: {
      totalPriceInCents: 9700,
      gatewayFeeInCents: 500,
      userCommissionInCents: 9200,
      currency: 'BRL',
    },
    isTest: true,
  };
  const headers = { 'x-api-token': f.token.token };
  assert.equal((await f.request('/compat/utmify', body, 'POST', headers)).data.test, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  assert.equal(
    (await f.request('/compat/utmify', { ...body, isTest: false }, 'POST', headers)).status,
    200,
  );
  const sale = f.db.prepare('SELECT * FROM sales').get();
  assert.equal(sale.amount, 97);
  assert.equal(sale.created_at, '2026-10-21T12:00:00Z');
  assert.equal(sale.campaign_id, 'c');
  assert.equal(sale.utm_source, 'facebook');
  assert.equal(f.db.prepare('SELECT ad_id FROM sale_attribution').get().ad_id, 'ad');
  assert.equal(
    (await f.request('/compat/utmify', { ...body, isTest: false }, 'POST', headers)).data.duplicate,
    true,
  );
  await f.request(
    '/compat/utmify',
    { ...body, isTest: false, status: 'refunded' },
    'POST',
    headers,
  );
  assert.equal(f.db.prepare('SELECT status FROM sales').get().status, 'refunded');
  const stale = await f.request('/compat/utmify', { ...body, isTest: false }, 'POST', headers);
  assert.equal(stale.data.ignored, true);
  assert.equal(f.db.prepare('SELECT status FROM sales').get().status, 'refunded');
  assert.equal(
    (
      await f.request(
        '/compat/utmify',
        { ...body, commission: { ...body.commission, currency: 'USD' } },
        'POST',
        headers,
      )
    ).status,
    400,
  );
  assert.equal((await f.request('/compat/utmify', body)).status, 401);
});
