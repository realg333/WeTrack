import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey, summarize } from '../server/domain.mjs';

let db, server, base;
before(async () => {
  db = createDatabase(':memory:');
  server = createApp(db, { password: '' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});
async function request(path, body, method = 'POST', headers = {}) {
  const r = await fetch(base + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const today = () => dateKey();
const dashboard = (project = 'workspace') =>
  request(`/dashboard?project=${project}&start=${today()}&end=${today()}`, null, 'GET');
const sample = {
  order_id: 'order-1',
  status: 'pending',
  amount: 97,
  product: 'Produto teste',
  customer_name: 'Cliente teste',
  utm_source: 'facebook',
  utm_campaign: '',
};

test('metrics count approved revenue only and keep negative profit', () => {
  const summary = summarize(
    [
      { status: 'approved', amount: 97 },
      { status: 'pending', amount: 150 },
      { status: 'refunded', amount: 97 },
    ],
    110,
    100,
  );
  assert.equal(summary.revenue, 97);
  assert.equal(summary.profit, -13);
  assert.equal(summary.sales, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.conversion, 1);
  assert.equal(summarize([], 0, 0).roas, 0);
});
test('demo records and real workspace stay separate', async () => {
  const demo = await dashboard('demo');
  const real = await dashboard();
  assert.equal(demo.status, 200);
  assert.ok(demo.data.metrics.revenue > 0);
  assert.equal(real.data.metrics.revenue, 0);
  assert.equal(real.data.sales.length, 0);
  assert.equal(demo.data.daily.length, 1);
  assert.equal(demo.data.metrics.revenue, demo.data.daily[0].revenue);
});
test('invalid reporting dates and nonexistent workspaces are rejected', async () => {
  assert.equal((await request('/dashboard?project=missing', null, 'GET')).status, 404);
  assert.equal(
    (await request('/dashboard?start=2026-12-01&end=2026-01-01', null, 'GET')).status,
    400,
  );
  assert.equal(
    (await request('/dashboard?start=2020-01-01&end=2026-01-01', null, 'GET')).status,
    400,
  );
});
test('webhook token, duplicate order, payment approval, refund and revocation', async () => {
  const token = await request('/tokens', {
    name: 'Teste pedidos',
    platform: 'API personalizada',
    project_id: 'workspace',
  });
  assert.equal(token.status, 201);
  assert.ok(token.data.token.startsWith('wt_'));
  const stored = db.prepare('SELECT token_hash FROM integrations WHERE id=?').get(token.data.id);
  assert.notEqual(stored.token_hash, token.data.token);
  const endpoint = `/webhooks/${token.data.token}`;
  assert.equal((await request('/webhooks/invalid', sample)).status, 401);
  assert.equal((await request(endpoint, { ...sample, amount: -1 })).status, 400);
  const first = await request(endpoint, sample);
  assert.equal(first.data.duplicate, false);
  assert.equal((await dashboard()).data.metrics.revenue, 0);
  const approved = await request(endpoint, { ...sample, status: 'approved' });
  assert.equal(approved.data.duplicate, true);
  assert.equal(approved.data.id, first.data.id);
  assert.equal((await dashboard()).data.metrics.revenue, 97);
  await request(endpoint, { ...sample, status: 'approved' });
  assert.equal((await dashboard()).data.sales.length, 1);
  await request(endpoint, { ...sample, status: 'refunded' });
  assert.equal((await dashboard()).data.metrics.revenue, 0);
  const list = await request('/integrations?project=workspace', null, 'GET');
  assert.ok(!JSON.stringify(list.data).includes(token.data.token));
  await request(`/tokens/${token.data.id}`, null, 'DELETE');
  assert.equal((await request(endpoint, sample)).status, 401);
  assert.equal((await dashboard()).data.sales.length, 1);
});
test('pixel respects origin, deduplicates events and browser Purchase cannot create revenue', async () => {
  const pixel = await request('/pixels', {
    name: 'Pixel testes',
    domain: 'https://loja.example.com',
    checkout_url: '',
    project_id: 'workspace',
  });
  assert.equal(pixel.status, 201);
  const event = {
    event_id: 'event-12345',
    visitor_id: 'visitor-12345',
    event_name: 'PageView',
    page_url: 'https://loja.example.com/produto',
    utm_source: 'facebook',
    utm_campaign: 'campaign',
  };
  const route = `/collect/${pixel.data.id}`;
  assert.equal(
    (await request(route, event, 'POST', { Origin: 'https://evil.example.com' })).status,
    403,
  );
  assert.equal(
    (await request(route, event, 'POST', { Origin: 'https://loja.example.com' })).status,
    200,
  );
  await request(route, event, 'POST', { Origin: 'https://loja.example.com' });
  assert.equal((await request(`/pixels/${pixel.data.id}/events`, null, 'GET')).data.length, 1);
  await request(route, { ...event, event_id: 'purchase-12345', event_name: 'Purchase' }, 'POST', {
    Origin: 'https://loja.example.com',
  });
  assert.equal((await dashboard()).data.metrics.revenue, 0);
  assert.equal((await dashboard()).data.metrics.visits, 1);
  await request(`/pixels/${pixel.data.id}`, { active: false }, 'PATCH');
  assert.equal(
    (
      await request(route, { ...event, event_id: 'new-event-12345' }, 'POST', {
        Origin: 'https://loja.example.com',
      })
    ).status,
    404,
  );
});
test('webhook can recover paid attribution by visitor and campaign', async () => {
  const c = await request('/campaigns', {
    name: 'Campanha de atribuição',
    source: 'Meta Ads',
    budget: 100,
    project_id: 'workspace',
  });
  const pixel = await request('/pixels', {
    name: 'Atribuição',
    domain: 'https://site.example.com',
    project_id: 'workspace',
  });
  await request(
    `/collect/${pixel.data.id}`,
    {
      event_id: 'attrib-event-1',
      visitor_id: 'attrib-visitor-1',
      event_name: 'PageView',
      page_url: 'https://site.example.com/',
      utm_source: 'facebook',
      utm_campaign: c.data.id,
    },
    'POST',
    { Origin: 'https://site.example.com' },
  );
  const token = await request('/tokens', {
    name: 'Atribuição',
    platform: 'API personalizada',
    project_id: 'workspace',
  });
  await request(`/webhooks/${token.data.token}`, {
    ...sample,
    order_id: 'attribution-order',
    status: 'approved',
    utm_source: 'direct',
    visitor_id: 'attrib-visitor-1',
  });
  const d = (await dashboard()).data;
  const sale = d.sales.find((s) => s.external_id === 'attribution-order');
  assert.equal(sale.utm_source, 'facebook');
  assert.equal(sale.campaign_id, c.data.id);
  assert.equal(d.campaigns.find((x) => x.id === c.data.id).revenue, 97);
});
test('admin writes reject unexpected browser origins', async () => {
  const result = await request(
    '/campaigns',
    { name: 'Não criar', source: 'Meta Ads', budget: 10, project_id: 'workspace' },
    'POST',
    { Origin: 'https://evil.example.com' },
  );
  assert.equal(result.status, 403);
});
test('manual daily cost is replaced rather than duplicated', async () => {
  const campaign = await request('/campaigns', {
    name: 'Investimento manual',
    source: 'Meta Ads',
    budget: 100,
    project_id: 'workspace',
  });
  const route = `/campaigns/${campaign.data.id}/spend`;
  assert.equal(
    (await request(route, { day: today(), amount: 50, clicks: 25, impressions: 500 }, 'PUT'))
      .status,
    200,
  );
  await request(route, { day: today(), amount: 75, clicks: 40, impressions: 800 }, 'PUT');
  const record = db.prepare('SELECT * FROM spend WHERE campaign_id=?').get(campaign.data.id);
  assert.equal(record.amount, 75);
  assert.equal(record.clicks, 40);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM spend WHERE campaign_id=?').get(campaign.data.id)
      .count,
    1,
  );
});
test('authenticated access, session cookie and logout', async () => {
  const secured = createApp(db, { password: 'test-password' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => secured.once('listening', resolve));
  const secureBase = `http://127.0.0.1:${secured.address().port}/api`;
  try {
    assert.equal((await fetch(secureBase + '/projects')).status, 401);
    assert.equal(
      (
        await fetch(secureBase + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: 'wrong' }),
        })
      ).status,
      401,
    );
    const login = await fetch(secureBase + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.equal(
      (await fetch(secureBase + '/projects', { headers: { Cookie: cookie } })).status,
      200,
    );
    await fetch(secureBase + '/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(
      (await fetch(secureBase + '/projects', { headers: { Cookie: cookie } })).status,
      401,
    );
  } finally {
    await new Promise((resolve) => secured.close(resolve));
  }
});
