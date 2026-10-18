import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHmac } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { encrypt } from '../server/meta.mjs';
import { normalizeHotmart } from '../server/platform-adapters.mjs';

const secret = 'test-platform-secret-only';
const stamp = () => new Date().toISOString();
const cakto = (event = 'purchase_approved', overrides = {}) => ({
  secret,
  event,
  data: {
    id: 'cakto-order-main',
    status: 'paid',
    amount: 97.35,
    baseAmount: 100,
    currency: 'BRL',
    paymentMethod: 'pix',
    customer: { name: 'Comprador teste', email: 'test@example.com', phone: '5531999999999' },
    product: { name: 'Curso Cakto' },
    createdAt: stamp(),
    paidAt: stamp(),
    utm_source: 'facebook',
    utm_campaign: '123',
    ...overrides,
  },
});
const hotmart = (event = 'PURCHASE_APPROVED', overrides = {}) => ({
  id: 'event-' + randomBytes(8).toString('hex'),
  event,
  creation_date: Date.now(),
  version: '2.0.0',
  data: {
    buyer: {
      name: 'Comprador teste',
      email: 'test@example.com',
      checkout_phone: '999999999',
      checkout_phone_code: '31',
    },
    product: { name: 'Curso Hotmart' },
    purchase: {
      transaction: 'HP-TEST-001',
      status: 'APPROVED',
      price: { value: 97.35, currency_value: 'BRL' },
      full_price: { value: 110, currency_value: 'BRL' },
      approved_date: Date.now(),
      order_date: Date.now(),
      checkout_country: { iso: 'BR' },
      payment: { type: 'PIX' },
      origin: {},
      ...overrides,
    },
  },
});

async function fixture(t) {
  const db = createDatabase(':memory:'),
    key = randomBytes(32),
    calls = [],
    objects = new Map(),
    flags = {};
  const transport = async (url, init) => {
    url = new URL(url);
    if (url.hostname === 'api.blackcatoficial.com') {
      calls.push({ path: url.pathname, method: init.method });
      assert.equal(init.method, 'GET');
      assert.equal(init.headers['X-API-Key'], secret);
      if (flags.down) throw new Error('private transport information');
      const data = url.pathname.endsWith('/seller')
        ? { name: 'Vendedor de teste' }
        : objects.get(decodeURIComponent(url.pathname.split('/').at(-2)));
      return Response.json(data ? { success: true, data } : { success: false }, {
        status: data ? 200 : 404,
      });
    }
    assert.equal(url.hostname, 'graph.facebook.com');
    calls.push({ path: url.pathname, method: init.method });
    return Response.json({ events_received: 1 });
  };
  const app = createApp(db, { secretKey: key, transport, serverless: true }),
    server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body, method = body ? 'POST' : 'GET', headers = {}) => {
    const r = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  const create = async (provider) => {
    const r = await call('/platform-connections', {
      project_id: 'workspace',
      provider,
      name: provider + ' teste',
    });
    assert.equal(r.status, 201);
    return r.data;
  };
  const configure = async (c, changes = {}) =>
    call(
      '/platform-connections/' + c.id,
      {
        project_id: 'workspace',
        name: c.name,
        secret,
        test_mode: true,
        purchase_owner: 'checkout',
        ...changes,
      },
      'PATCH',
    );
  const send = async (c, payload, headers) =>
    call(
      new URL(c.url).pathname.replace('/api', ''),
      payload,
      'POST',
      headers || (c.provider === 'hotmart' ? { 'X-HOTMART-HOTTOK': secret } : {}),
    );
  const prime = async (c, payload) => {
    assert.equal((await configure(c)).status, 200);
    assert.equal((await send(c, payload)).status, 200);
    await app.locals.platforms.drain();
    assert.equal((await configure(c, { test_mode: false, confirm_live: true })).status, 200);
  };
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    db,
    key,
    app,
    transport,
    calls,
    objects,
    flags,
    call,
    create,
    configure,
    send,
    prime,
    count,
  };
}

test('native connectors require credentials, validate exact Cakto bytes and Hotmart Hottok, and isolate tests from sales', async (t) => {
  const f = await fixture(t),
    c = await f.create('cakto'),
    h = await f.create('hotmart');
  assert.equal((await f.send(c, cakto())).status, 401);
  assert.equal((await f.configure(c, { test_mode: false, confirm_live: true })).status, 400);
  assert.equal((await f.configure(c)).status, 200);
  const body = JSON.stringify(cakto(), null, 2),
    ts = String(Math.floor(Date.now() / 1000));
  const signature =
    'v1=' +
    createHmac('sha256', secret)
      .update(ts + '.')
      .update(body)
      .digest('hex');
  assert.equal(
    (await f.send(c, body, { 'X-Cakto-Timestamp': ts, 'X-Cakto-Signature': signature })).status,
    200,
  );
  assert.equal(
    (await f.send(c, body + ' ', { 'X-Cakto-Timestamp': ts, 'X-Cakto-Signature': signature }))
      .status,
    401,
  );
  assert.equal(
    (await f.send(c, body, { 'X-Cakto-Timestamp': '1', 'X-Cakto-Signature': signature })).status,
    401,
  );
  await f.configure(h);
  assert.equal((await f.send(h, hotmart(), { 'X-HOTMART-HOTTOK': 'wrong' })).status, 401);
  assert.equal((await f.send(h, hotmart())).status, 200);
  await f.app.locals.platforms.drain();
  assert.equal(
    f.count('sales'),
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='demo'").get().n,
  );
  assert.equal(
    f.db
      .prepare(
        "SELECT COUNT(*) AS n FROM webhook_receipts WHERE status='test' AND payload_cipher IS NULL",
      )
      .get().n,
    2,
  );
  assert.equal(f.count('capi_queue'), 0);
  const listed = (await f.call('/integrations?project=workspace')).data;
  assert(!JSON.stringify(listed).includes(secret));
  assert.equal(listed.providers.length, 2);
  assert(
    !f.db
      .prepare('SELECT secret_cipher FROM provider_connections LIMIT 1')
      .get()
      .secret_cipher.includes(secret),
  );
});

test('Cakto V2 preserves distinct bump transactions, deduplicates connections, and ignores late pending events after refunds', async (t) => {
  const f = await fixture(t),
    c = await f.create('cakto');
  await f.prime(c, cakto());
  const d = cakto().data,
    paid = {
      secret,
      event: 'purchase_approved',
      data: [
        { ...d, id: 'main' },
        { ...d, id: 'bump', amount: 20, parent_order: 'main' },
      ],
    };
  await f.send(c, paid);
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT SUM(amount) AS n FROM sales WHERE project_id='workspace'").get().n,
    117.35,
  );
  assert.equal((await f.send(c, paid)).data.duplicate, true);
  const c2 = await f.create('cakto');
  await f.prime(c2, cakto('purchase_approved', { id: 'test-secondary' }));
  await f.send(c2, { ...paid, data: paid.data.map((r) => ({ ...r, createdAt: stamp() })) });
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='workspace'").get().n,
    2,
  );
  await f.send(c, cakto('refund', { id: 'main', status: 'refunded', refundedAt: stamp() }));
  await f.app.locals.platforms.drain();
  await f.send(c, cakto('pix_gerado', { id: 'main', status: 'waiting_payment' }));
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT status FROM sales WHERE external_id='main'").get().status,
    'refunded',
  );
  await f.send(c, { secret, event: 'subscription_canceled', data: {} });
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT status FROM sales WHERE external_id='bump'").get().status,
    'approved',
  );
  assert.equal((await f.send(c, cakto('purchase_approved', { currency: 'USD' }))).status, 400);
  const rejected = f.db
    .prepare(
      "SELECT * FROM webhook_receipts WHERE status='failed' ORDER BY received_at DESC LIMIT 1",
    )
    .get();
  assert.match(rejected.last_error, /Moeda/);
  assert.equal(rejected.payload_cipher, null);
  assert.equal(f.count('capi_queue'), 0);
});

test('Hotmart approval and completion count once, bind checkout xcod to the correct operation, and retain the offer price', async (t) => {
  const f = await fixture(t),
    h = await f.create('hotmart');
  await f.prime(h, hotmart());
  const pixel = (
    await f.call('/pixels', {
      project_id: 'workspace',
      name: 'Pixel atribuição',
      domain: 'https://site.example',
    })
  ).data;
  const code = 'wt0123456789abcdef012345';
  assert.equal(
    (
      await f.call(
        '/collect/' + pixel.id,
        {
          event_id: 'event-checkout-reference',
          visitor_id: 'visitor-checkout-reference',
          attribution_code: code,
          event_name: 'PageView',
          page_url: 'https://site.example/',
          utm_source: 'facebook',
          utm_campaign: 'campaign-live',
          utm_content: 'ad-live',
          utm_term: 'set-live',
        },
        'POST',
        { Origin: 'https://site.example' },
      )
    ).status,
    200,
  );
  await f.send(h, hotmart('PURCHASE_BILLET_PRINTED', { status: 'WAITING_PAYMENT', origin: {} }));
  await f.app.locals.platforms.drain();
  await f.send(h, hotmart('PURCHASE_APPROVED', { origin: { xcod: code } }));
  await f.app.locals.platforms.drain();
  await f.send(h, hotmart('PURCHASE_COMPLETE', { origin: { xcod: code } }));
  await f.app.locals.platforms.drain();
  const sale = f.db.prepare("SELECT * FROM sales WHERE project_id='workspace'").get();
  assert.equal(sale.amount, 97.35);
  assert.equal(sale.utm_source, 'facebook');
  assert.equal(sale.utm_campaign, 'campaign-live');
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='workspace'").get().n,
    1,
  );
  assert.equal(
    f.db.prepare('SELECT visitor_id FROM sale_attribution WHERE sale_id=?').get(sale.id).visitor_id,
    'visitor-checkout-reference',
  );
  await f.send(h, hotmart('SUBSCRIPTION_CANCELLATION'));
  await f.app.locals.platforms.drain();
  assert.equal(f.db.prepare('SELECT status FROM sales WHERE id=?').get(sale.id).status, 'approved');
  assert.equal(normalizeHotmart(hotmart()).orders[0].customer_phone, '5531999999999');
  const phone = hotmart();
  phone.data.buyer.checkout_phone = '31999999999';
  assert.equal(normalizeHotmart(phone).orders[0].customer_phone, '5531999999999');
  assert.equal(
    (await f.send(h, hotmart('PURCHASE_REFUNDED', { status: 'PARTIALLY_REFUNDED' }))).status,
    400,
  );
});

test('Blackcat verifies status and cent values using only GET; forged paid fields and withdrawal events do not create revenue', async (t) => {
  const f = await fixture(t),
    b = await f.create('blackcat');
  const payload = {
    event: 'transaction.paid',
    transactionId: 'TXN-TEST-001',
    timestamp: stamp(),
    amount: 999999,
    status: 'PAID',
    customer: { name: 'Teste', email: 'test@example.com' },
    utm: { utm_source: 'facebook', utm_campaign: '123' },
  };
  f.objects.set(payload.transactionId, {
    transactionId: payload.transactionId,
    status: 'PENDING',
    paymentMethod: 'PIX',
    amount: 9735,
  });
  await f.prime(b, payload);
  await f.send(b, { ...payload, timestamp: stamp() });
  await f.app.locals.platforms.drain();
  let sale = f.db.prepare("SELECT * FROM sales WHERE project_id='workspace'").get();
  assert.equal(sale.status, 'pending');
  assert.equal(sale.amount, 97.35);
  f.objects.set(payload.transactionId, {
    transactionId: payload.transactionId,
    status: 'PAID',
    paymentMethod: 'PIX',
    amount: 9735,
    paidAt: stamp(),
  });
  await f.send(b, { ...payload, timestamp: stamp() });
  await f.app.locals.platforms.drain();
  sale = f.db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id);
  assert.equal(sale.status, 'approved');
  assert.equal(sale.amount, 97.35);
  f.objects.set(payload.transactionId, {
    transactionId: payload.transactionId,
    status: 'REFUNDED',
    paymentMethod: 'PIX',
    amount: 9735,
  });
  await f.send(b, { ...payload, event: 'transaction.status_changed', timestamp: stamp() });
  await f.app.locals.platforms.drain();
  sale = f.db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id);
  assert.equal(sale.status, 'refunded');
  await f.send(b, { ...payload, event: 'transaction.refunded', timestamp: stamp() });
  await f.app.locals.platforms.drain();
  assert.equal(f.db.prepare('SELECT * FROM sales WHERE id=?').get(sale.id).status, 'refunded');
  const calls = f.calls.length;
  await f.send(b, { event: 'withdrawal.completed', amount: 50000 });
  await f.app.locals.platforms.drain();
  assert.equal(f.calls.length, calls);
  await f.send(b, { ...payload, transactionId: 'not-owned', timestamp: stamp() });
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='workspace'").get().n,
    1,
  );
  assert(f.calls.every((c) => c.method === 'GET'));
});

test('native inbox is durable, encrypted, leased between workers, and can retry transient Blackcat failures', async (t) => {
  const f = await fixture(t),
    b = await f.create('blackcat');
  await f.configure(b);
  f.objects.set('TXN-QUEUE', {
    transactionId: 'TXN-QUEUE',
    status: 'PAID',
    amount: 9900,
    paymentMethod: 'PIX',
    paidAt: stamp(),
  });
  const payload = {
    event: 'transaction.paid',
    transactionId: 'TXN-QUEUE',
    timestamp: stamp(),
    customer: { email: 'private@example.com' },
  };
  await f.send(b, payload);
  const receipt = f.db.prepare('SELECT * FROM webhook_receipts').get();
  assert.equal(receipt.status, 'pending');
  assert(!receipt.payload_cipher.includes('private@example.com'));
  assert.equal(receipt.test_mode, 1);
  f.flags.down = true;
  await f.app.locals.platforms.drain();
  const failed = f.db.prepare('SELECT * FROM webhook_receipts').get();
  assert.equal(failed.status, 'pending');
  assert.equal(failed.attempts, 1);
  assert(!failed.last_error.includes('private transport'));
  assert.equal(
    (await f.call('/platform-receipts/' + failed.id + '/retry', { project_id: 'demo' })).status,
    404,
  );
  await f.call('/platform-receipts/' + failed.id + '/retry', { project_id: 'workspace' });
  f.flags.down = false;
  const app2 = createApp(f.db, { secretKey: f.key, transport: f.transport, serverless: true });
  const reads = f.calls.length;
  await Promise.all([f.app.locals.platforms.drain(), app2.locals.platforms.drain()]);
  assert.equal(f.calls.length, reads + 1);
  assert.equal(f.db.prepare('SELECT status FROM webhook_receipts').get().status, 'test');
  assert.equal((await f.configure(b, { test_mode: false, confirm_live: true })).status, 200);
  // The test receipt is never promoted into a real purchase when production is enabled.
  assert.equal((await f.send(b, payload)).data.duplicate, true);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='workspace'").get().n,
    0,
  );
});

test('Blackcat reconciliation confirms a refund without trusting a new webhook, and old CAPI purchases retain their original date', async (t) => {
  const f = await fixture(t),
    b = await f.create('blackcat');
  const payload = {
    event: 'transaction.paid',
    transactionId: 'TXN-REFUND',
    timestamp: stamp(),
    customer: { email: 'test@example.com' },
  };
  const verified = {
    transactionId: payload.transactionId,
    status: 'PAID',
    paymentMethod: 'PIX',
    amount: 9735,
    paidAt: stamp(),
  };
  f.objects.set(payload.transactionId, verified);
  await f.prime(b, payload);
  await f.send(b, { ...payload, timestamp: stamp() });
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT status FROM sales WHERE project_id='workspace'").get().status,
    'approved',
  );
  f.objects.set(payload.transactionId, { ...verified, status: 'REFUNDED' });
  assert.equal(
    (await f.call(`/platform-connections/${b.id}/reconcile`, { project_id: 'demo' })).status,
    400,
  );
  const reconciled = await f.call(`/platform-connections/${b.id}/reconcile`, {
    project_id: 'workspace',
  });
  assert.equal(reconciled.data.queued, 1);
  await f.app.locals.platforms.drain();
  assert.equal(
    f.db.prepare("SELECT status FROM sales WHERE project_id='workspace'").get().status,
    'refunded',
  );
  const c = await f.create('cakto');
  await f.prime(c, cakto());
  const pixel = (
    await f.call('/pixels', {
      project_id: 'workspace',
      name: 'Pixel para histórico',
      domain: 'https://site.example',
    })
  ).data;
  f.db
    .prepare('INSERT INTO pixel_capi VALUES(?,?,?,?)')
    .run(pixel.id, '4497992933816815', encrypt('fake-capi-token', f.key), null);
  await f.configure(c, {
    test_mode: false,
    confirm_live: true,
    purchase_owner: 'wetrack',
    pixel_id: pixel.id,
    confirm_purchase_owner: true,
  });
  const oldDate = new Date(Date.now() - 9 * 86400000).toISOString();
  await f.send(
    c,
    cakto('purchase_approved', { id: 'old-order', createdAt: oldDate, paidAt: oldDate }),
  );
  await f.app.locals.platforms.drain();
  const queued = f.db.prepare('SELECT * FROM capi_queue').get();
  assert.equal(queued.status, 'failed');
  assert.match(queued.last_error, /janela/);
  assert.equal(JSON.parse(queued.payload).event_time, Math.floor(Date.parse(oldDate) / 1000));
  assert.equal(
    f.db.prepare("SELECT status FROM sales WHERE external_id='old-order'").get().status,
    'approved',
  );
});

test('WeTrack purchase ownership requires explicit confirmation; duplicate approvals enqueue once and refunds stop unsent CAPI', async (t) => {
  const f = await fixture(t),
    c = await f.create('cakto');
  await f.prime(c, cakto());
  const pixel = (
    await f.call('/pixels', {
      project_id: 'workspace',
      name: 'Pixel CAPI teste',
      domain: 'https://site.example',
    })
  ).data;
  f.db
    .prepare('INSERT INTO pixel_capi VALUES(?,?,?,?)')
    .run(pixel.id, '4497992933816815', encrypt('fake-capi-token', f.key), null);
  const settings = {
    test_mode: false,
    confirm_live: true,
    purchase_owner: 'wetrack',
    pixel_id: pixel.id,
  };
  assert.equal((await f.configure(c, settings)).status, 400);
  assert.equal((await f.configure(c, { ...settings, confirm_purchase_owner: true })).status, 200);
  const paid = cakto('purchase_approved', { id: 'capi-order' });
  await f.send(c, paid);
  await f.app.locals.platforms.drain();
  await f.send(c, { ...paid, data: { ...paid.data, utm_medium: 'paid' } });
  await f.app.locals.platforms.drain();
  assert.equal(f.count('capi_queue'), 1);
  await f.send(c, cakto('refund', { id: 'capi-order', status: 'refunded', refundedAt: stamp() }));
  await f.app.locals.platforms.drain();
  await f.app.locals.meta.drain();
  assert.equal(f.db.prepare('SELECT status FROM capi_queue').get().status, 'failed');
  assert.equal(f.calls.length, 0);
  await f.call('/tokens/' + c.id, undefined, 'DELETE');
  assert.equal((await f.send(c, paid)).status, 401);
  assert.equal((await f.call('/integrations?project=workspace')).data.providers.length, 0);
});

test('expired webhook content cannot be retried or become revenue after retention', async (t) => {
  const f = await fixture(t),
    c = await f.create('cakto');
  await f.prime(c, cakto());
  await f.send(c, cakto('purchase_approved', { id: 'expired-pending' }));
  f.db
    .prepare("UPDATE webhook_receipts SET received_at=? WHERE status='pending'")
    .run(new Date(Date.now() - 8 * 86400000).toISOString());
  await f.app.locals.platforms.drain();
  const expired = f.db.prepare("SELECT * FROM webhook_receipts WHERE status='failed'").get();
  assert.equal(expired.payload_cipher, null);
  assert.match(expired.last_error, /expirados/);
  assert.equal(
    (await f.call(`/platform-receipts/${expired.id}/retry`, { project_id: 'workspace' })).status,
    400,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE project_id='workspace'").get().n,
    0,
  );
});
