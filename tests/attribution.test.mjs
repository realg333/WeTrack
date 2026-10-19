import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey, webhookSchema } from '../server/domain.mjs';
import { recordSale } from '../server/sales.mjs';

async function fixture(t, password = '') {
  const db = createDatabase(':memory:', { seedDemo: false });
  for (const project of ['workspace', 'other'])
    db.prepare('INSERT INTO projects VALUES(?,?,0)').run(project, project);
  for (const [id, project] of [
    ['a', 'workspace'],
    ['b', 'workspace'],
    ['hidden', 'workspace'],
    ['foreign', 'other'],
  ]) {
    db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,0,0,?)').run(
      id,
      project,
      'Campanha ' + id,
      'Meta Ads',
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO ad_sets VALUES(?,?,?,?,0,0)').run(
      'set-' + id,
      id,
      'ext-set-' + id,
      'Conjunto ' + id,
    );
    db.prepare('INSERT INTO ads VALUES(?,?,?,?,0)').run(
      'ad-' + id,
      'set-' + id,
      'ext-ad-' + id,
      'Anúncio ' + id,
    );
  }
  db.prepare('INSERT INTO meta_campaigns VALUES(?,?,?)').run('hidden', 'ext-hidden', 'act_hidden');
  const app = createApp(db, { password });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const report = async () =>
    (await request(`/dashboard?project=workspace&start=${dateKey()}&end=${dateKey()}`, null, 'GET'))
      .data;
  const token = password
    ? null
    : (
        await request('/tokens', {
          project_id: 'workspace',
          name: 'Vendas teste',
          platform: 'API personalizada',
        })
      ).data;
  return { db, request, report, token };
}
const order = {
  order_id: 'MANUAL-1',
  product: 'Produto atribuição',
  customer_name: 'Cliente teste',
  amount: 97,
  status: 'approved',
  utm_source: 'facebook',
  utm_medium: 'paid',
  utm_campaign: 'campanha-desconhecida',
  utm_term: 'conjunto-original',
  utm_content: 'anuncio-original',
  visitor_id: 'visitor-original',
};

test('visitor recovery keeps all five UTMs for both custom and native sales', async (t) => {
  const { db, request, report, token } = await fixture(t);
  const pixel = (
    await request('/pixels', {
      name: 'Pixel atribuição',
      project_id: 'workspace',
      domain: 'https://loja.example.com',
    })
  ).data;
  db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    'paid-visit',
    pixel.id,
    'workspace',
    'paid-visitor',
    'PageView',
    'https://loja.example.com/',
    'facebook',
    'a',
    new Date().toISOString(),
    dateKey(),
  );
  db.prepare(
    'INSERT INTO event_details(event_id,utm_medium,utm_content,utm_term) VALUES(?,?,?,?)',
  ).run('paid-visit', 'paid', 'ext-ad-a', 'ext-set-a');
  const input = webhookSchema.parse({
    order_id: 'RECOVERED',
    status: 'pending',
    product: 'Produto',
    amount: 97,
    visitor_id: 'paid-visitor',
    utm_source: 'direct',
  });
  assert.equal((await request(`/webhooks/${token.token}`, input)).status, 200);
  const integration = db.prepare('SELECT * FROM integrations WHERE id=?').get(token.id);
  recordSale(
    db,
    { enqueue: () => false },
    integration,
    { ...input, order_id: 'RECOVERED-NATIVE' },
    { provider: 'hotmart' },
  );
  const sales = (await report()).sales;
  assert.equal(sales.length, 2);
  for (const sale of sales) {
    assert.equal(sale.utm_source, 'facebook');
    assert.equal(sale.utm_medium, 'paid');
    assert.equal(sale.utm_campaign, 'a');
    assert.equal(sale.utm_term, 'ext-set-a');
    assert.equal(sale.utm_content, 'ext-ad-a');
    assert.equal(sale.campaign_id, 'a');
    assert.equal(sale.adset_id, 'set-a');
    assert.equal(sale.ad_id, 'ad-a');
  }
});

test('manual attribution updates every reporting level, preserves UTMs and survives custom webhook retries', async (t) => {
  const { db, request, report, token } = await fixture(t);
  const sale = await request(`/webhooks/${token.token}`, order);
  assert.equal(sale.status, 200);
  const before = await report();
  assert.equal(before.sales[0].attribution_method, 'unattributed');
  assert.equal(before.sales[0].utm_term, order.utm_term);
  const saved = await request(
    `/sales/${sale.data.id}/attribution`,
    {
      project_id: 'workspace',
      campaign_id: 'a',
      adset_id: 'set-a',
      ad_id: 'ad-a',
    },
    'PATCH',
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.data.attribution_method, 'manual');
  assert.equal(saved.data.campaign_name, 'Campanha a');
  assert.equal(saved.data.adset_name, 'Conjunto a');
  assert.equal(saved.data.ad_name, 'Anúncio a');
  assert.equal(saved.data.visitor_id, order.visitor_id);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'])
    assert.equal(saved.data[key], order[key]);
  const after = await report();
  assert.equal(after.metrics.revenue, before.metrics.revenue);
  assert.equal(after.campaigns.find((c) => c.id === 'a').revenue, 97);
  for (const level of ['adsets', 'ads']) {
    const hierarchy = await request(
      `/ad-hierarchy?project=workspace&level=${level}&start=${dateKey()}&end=${dateKey()}`,
      null,
      'GET',
    );
    assert.equal(
      hierarchy.data.rows.find((r) => r.id === (level === 'ads' ? 'ad-a' : 'set-a')).revenue,
      97,
    );
  }
  await request(`/webhooks/${token.token}`, { ...order, ad_id: 'ext-ad-b', adset_id: 'ext-set-b' });
  assert.equal((await report()).sales[0].ad_id, 'ad-a');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM capi_queue').get().n, 0);
  // Reducing the selected level clears all child IDs instead of keeping stale attribution.
  await request(
    `/sales/${sale.data.id}/attribution`,
    { project_id: 'workspace', campaign_id: 'b', adset_id: 'set-b' },
    'PATCH',
  );
  assert.equal((await report()).sales[0].ad_id, null);
  await request(
    `/sales/${sale.data.id}/attribution`,
    { project_id: 'workspace', campaign_id: 'b' },
    'PATCH',
  );
  await request(`/webhooks/${token.token}`, { ...order, status: 'refunded', ad_id: 'ext-ad-a' });
  const refunded = await report();
  assert.equal(refunded.metrics.revenue, 0);
  assert.equal(refunded.sales[0].campaign_id, 'b');
  assert.equal(refunded.sales[0].adset_id, null);
  assert.equal(refunded.sales[0].ad_id, null);
  assert.equal(refunded.sales[0].utm_term, order.utm_term);
});

test('attribution validates operation, account selection and the complete parent hierarchy before writing', async (t) => {
  const { db, request, token } = await fixture(t);
  const sale = (await request(`/webhooks/${token.token}`, order)).data;
  const options = await request('/sale-attribution-options?project=workspace', null, 'GET');
  assert.deepEqual(
    options.data.campaigns.map((c) => c.id),
    ['a', 'b'],
  ); // Paused items remain selectable.
  assert.deepEqual(
    options.data.ads.map((ad) => ad.id),
    ['ad-a', 'ad-b'],
  );
  const path = `/sales/${sale.id}/attribution`;
  for (const selection of [
    { campaign_id: 'foreign' },
    { campaign_id: 'hidden' },
    { campaign_id: 'a', adset_id: 'set-b' },
    { campaign_id: 'a', adset_id: 'set-a', ad_id: 'ad-b' },
    { campaign_id: 'a', ad_id: 'ad-a' },
    { campaign_id: 'a', adset_id: 'ext-set-a' },
    { campaign_id: '' },
  ]) {
    assert.equal(
      (await request(path, { project_id: 'workspace', ...selection }, 'PATCH')).status,
      400,
    );
    assert.equal(
      db.prepare('SELECT campaign_id FROM sales WHERE id=?').get(sale.id).campaign_id,
      null,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM manual_sale_attribution').get().n, 0);
  }
  assert.equal(
    (await request(path, { project_id: 'other', campaign_id: 'foreign' }, 'PATCH')).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/sales/missing/attribution',
        { project_id: 'workspace', campaign_id: 'a' },
        'PATCH',
      )
    ).status,
    404,
  );
});

test('attribution endpoints require the administrator session', async (t) => {
  const { request } = await fixture(t, 'test-password');
  assert.equal(
    (await request('/sale-attribution-options?project=workspace', null, 'GET')).status,
    401,
  );
  assert.equal(
    (
      await request(
        '/sales/any/attribution',
        { project_id: 'workspace', campaign_id: 'a' },
        'PATCH',
      )
    ).status,
    401,
  );
});

test('native sale status changes preserve manual choices and received tracking references', async (t) => {
  const { db, request, token, report } = await fixture(t);
  const integration = db.prepare('SELECT * FROM integrations WHERE id=?').get(token.id);
  const meta = { enqueue: () => false };
  const data = webhookSchema.parse({ ...order, adset_id: 'ext-set-b', ad_id: 'ext-ad-b' });
  const sale = recordSale(db, meta, integration, data, { provider: 'cakto' });
  assert.equal((await report()).sales[0].attribution_method, 'automatic');
  const updated = await request(
    `/sales/${sale.id}/attribution`,
    { project_id: 'workspace', campaign_id: 'a', adset_id: 'set-a', ad_id: 'ad-a' },
    'PATCH',
  );
  assert.equal(updated.status, 200);
  recordSale(db, meta, integration, { ...data, status: 'refunded' }, { provider: 'cakto' });
  const result = (await report()).sales[0];
  assert.equal(result.status, 'refunded');
  assert.equal(result.campaign_id, 'a');
  assert.equal(result.adset_id, 'set-a');
  assert.equal(result.ad_id, 'ad-a');
  assert.equal(result.ad_reference, 'ext-ad-b');
  assert.equal(result.utm_term, order.utm_term);
  assert.equal(result.utm_content, order.utm_content);
});
