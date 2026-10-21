import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey } from '../server/domain.mjs';
import {
  normalizeCakto,
  normalizeHotmart,
  normalizeBlackcat,
} from '../server/platform-adapters.mjs';
import { recordSale } from '../server/sales.mjs';
import { ruleTargets } from '../server/rule-model.mjs';

test('BRL and USD accounts sync native amounts and keep dashboard, hierarchy, orders and rules isolated', async (t) => {
  const previous = process.env.META_GRAPH_VERSION;
  process.env.META_GRAPH_VERSION = 'v99.0';
  const db = createDatabase(':memory:');
  const day = dateKey();
  const transport = async (url) => {
    const path = new URL(url).pathname;
    const usd = path.includes('act_2');
    const campaign = usd ? '200' : '100';
    const set = usd ? '201' : '101';
    const ad = usd ? '202' : '102';
    let data;
    if (path.endsWith('/me/adaccounts'))
      data = [
        { id: 'act_1', name: 'Conta BRL', currency: 'BRL', account_status: 1 },
        { id: 'act_2', name: 'Conta USD', currency: 'USD', account_status: 1 },
      ];
    else if (path.endsWith('/campaigns'))
      data = [
        { id: campaign, name: `Campanha ${campaign}`, daily_budget: '1250', status: 'ACTIVE' },
      ];
    else if (path.endsWith('/adsets'))
      data = [{ id: set, campaign_id: campaign, daily_budget: '1250' }];
    else if (path.endsWith('/ads')) data = [{ id: ad, adset_id: set }];
    else if (path.endsWith('/insights'))
      data = [
        {
          campaign_id: campaign,
          adset_id: set,
          ad_id: ad,
          date_start: day,
          spend: usd ? '10.25' : '100.50',
          clicks: '10',
          impressions: '100',
          inline_link_clicks: '5',
        },
      ];
    else throw new Error(`Unexpected mock request: ${path}`);
    return { ok: true, json: async () => ({ data }) };
  };
  const app = createApp(db, { password: '', secretKey: randomBytes(32), transport });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    if (previous === undefined) delete process.env.META_GRAPH_VERSION;
    else process.env.META_GRAPH_VERSION = previous;
  });
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const meta = app.locals.meta;
  assert.equal((await meta.connect('workspace', 'mock-currency-token')).skipped, 0);
  assert.ok(meta.accountsFor('workspace').every((a) => a.supported && !a.enabled));
  for (const id of ['act_1', 'act_2']) meta.selectAccount('workspace', id, true);
  await meta.sync('workspace', day, day);
  await meta.sync('workspace', day, day);
  const token = (
    await request('/tokens', {
      project_id: 'workspace',
      name: 'Vendas por moeda',
      platform: 'API personalizada',
    })
  ).data.token;
  const pixel = (
    await request('/pixels', {
      project_id: 'workspace',
      name: 'Pixel moedas',
      domain: 'https://example.com',
    })
  ).data.id;
  meta.configurePixel(pixel, '123456789', 'mock-capi-token');
  const integration = db
    .prepare('SELECT id FROM integrations WHERE project_id=?')
    .get('workspace').id;
  db.prepare('INSERT INTO integration_pixels VALUES(?,?)').run(integration, pixel);
  for (const [currency, amount, campaign] of [
    ['BRL', 200, '100'],
    ['USD', 40, '200'],
  ]) {
    const result = await request(`/webhooks/${token}`, {
      order_id: currency,
      status: 'approved',
      product: 'Produto',
      amount,
      currency,
      customer_email: 'buyer@example.com',
      utm_campaign: campaign,
      ad_id: currency === 'USD' ? '202' : '102',
    });
    assert.equal(result.status, 200);
  }
  // A real-denominated sale attributed to a dollar account is never relabeled as USD.
  await request(`/webhooks/${token}`, {
    order_id: 'CROSS',
    status: 'approved',
    product: 'Produto',
    amount: 300,
    utm_campaign: '200',
    ad_id: '202',
  });
  const report = async (currency) =>
    (
      await request(
        `/dashboard?project=workspace&start=${day}&end=${day}${currency ? `&currency=${currency}` : ''}`,
        null,
        'GET',
      )
    ).data;
  const brl = await report();
  const usd = await report('USD');
  assert.equal(brl.currency, 'BRL');
  assert.equal(brl.metrics.spend, 100.5);
  assert.equal(brl.metrics.revenue, 500);
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.metrics.spend, 10.25);
  assert.equal(usd.metrics.revenue, 40);
  assert.equal(usd.metrics.profit, 29.75);
  assert.equal(usd.metrics.roas, 40 / 10.25);
  assert.equal(usd.daily[0].spend, 10.25);
  assert.equal(usd.daily[0].revenue, 40);
  assert.equal(usd.sales.length, 1);
  assert.equal(usd.sales[0].currency, 'USD');
  assert.equal(
    JSON.parse(db.prepare('SELECT payload FROM capi_queue WHERE id=?').get(usd.sales[0].id).payload)
      .custom_data.currency,
    'USD',
  );
  assert.equal(usd.campaigns.length, 1);
  assert.equal(usd.campaigns[0].budget, 12.5);
  for (const level of ['campaigns', 'adsets', 'ads']) {
    const rows = (
      await request(
        `/ad-hierarchy?project=workspace&start=${day}&end=${day}&level=${level}&currency=USD`,
        null,
        'GET',
      )
    ).data.rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].currency, 'USD');
    assert.equal(rows[0].spend, 10.25);
    assert.equal(rows[0].revenue, 40);
    assert.equal(rows[0].sales, 1);
  }
  assert.equal(
    (await request('/dashboard?project=workspace&currency=EUR', null, 'GET')).status,
    400,
  );
  const changed = await request(`/webhooks/${token}`, {
    order_id: 'USD',
    status: 'refunded',
    product: 'Produto',
    amount: 40,
    currency: 'BRL',
  });
  assert.equal(changed.status, 400);
  assert.equal((await report('USD')).metrics.revenue, 40);
  const refunded = await request(`/webhooks/${token}`, {
    order_id: 'USD',
    status: 'refunded',
    product: 'Produto',
    amount: 40,
    currency: 'USD',
  });
  assert.equal(refunded.status, 200);
  assert.equal((await report('USD')).metrics.revenue, 0);
  const rule = {
    project_id: 'workspace',
    name: 'Alerta USD',
    currency: 'USD',
    conditions: [{ metric: 'spend', operator: 'gt', threshold: 5 }],
    active: true,
  };
  assert.equal((await request('/rules', rule)).status, 201);
  assert.equal((await request('/rules?project=workspace', null, 'GET')).data.rules.length, 0);
  assert.equal(
    (await request('/rules?project=workspace&currency=USD', null, 'GET')).data.rules.length,
    1,
  );
  const legacy = { action: 'pause', campaign_ids: [] };
  assert.equal(ruleTargets(db, legacy, usd.campaigns[0]), false);
  assert.equal(ruleTargets(db, { ...legacy, currency: 'USD' }, usd.campaigns[0]), true);
  meta.selectAccount('workspace', 'act_2', false);
  assert.equal((await report('USD')).metrics.spend, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM campaign_currencies').get().n, 2);
});

test('native provider adapters retain USD, and recordSale rejects changing an existing order currency', () => {
  const cakto = normalizeCakto({
    event: 'purchase_approved',
    data: { id: 'usd', currency: 'USD', amount: 42 },
  }).orders[0];
  const hotmart = normalizeHotmart({
    event: 'PURCHASE_APPROVED',
    version: '2.0.0',
    data: { purchase: { transaction: 'usd', price: { value: 42, currency_value: 'USD' } } },
  }).orders[0];
  const blackcat = normalizeBlackcat(
    { event: 'transaction.paid', transactionId: 'usd' },
    { transactionId: 'usd', currency: 'USD', amount: 4200, status: 'PAID' },
  ).orders[0];
  for (const order of [cakto, hotmart, blackcat]) {
    assert.equal(order.currency, 'USD');
    assert.equal(order.amount, 42);
  }
  const db = createDatabase(':memory:');
  try {
    const integration = { id: 'native', project_id: 'workspace' };
    const meta = { enqueue: () => false };
    const result = recordSale(db, meta, integration, cakto);
    assert.equal(
      db.prepare('SELECT currency FROM sale_currencies WHERE sale_id=?').get(result.id).currency,
      'USD',
    );
    assert.throws(
      () => recordSale(db, meta, integration, { ...cakto, currency: 'BRL', amount: 999 }),
      /moeda/,
    );
    assert.equal(db.prepare('SELECT amount FROM sales WHERE id=?').get(result.id).amount, 42);
  } finally {
    db.close();
  }
});
