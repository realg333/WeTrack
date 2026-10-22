import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey } from '../server/domain.mjs';
import Database from 'libsql';
import { recordSale } from '../server/sales.mjs';

const secret = 'whatsapp-app-secret-test-123456';
async function fixture(t, options = {}) {
  const db = createDatabase(':memory:', {
    seedDemo: false,
    ...(options.Driver ? { Driver: options.Driver } : {}),
  });
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('work', 'Operação', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('other', 'Outra operação', 0);
  const prior = process.env.META_GRAPH_VERSION,
    priorPublic = process.env.PUBLIC_URL;
  process.env.META_GRAPH_VERSION = 'v23.0';
  process.env.PUBLIC_URL = 'https://tracking.example.test';
  t.after(() => {
    if (prior === undefined) delete process.env.META_GRAPH_VERSION;
    else process.env.META_GRAPH_VERSION = prior;
    if (priorPublic === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = priorPublic;
  });
  let calls = 0;
  const transport =
    options.transport ||
    (async (url, init) => {
      calls++;
      return {
        ok: true,
        status: 200,
        json: async () =>
          init?.method === 'POST'
            ? { success: true }
            : new URL(url).pathname.endsWith('/phone_numbers')
              ? { data: [{ id: '1234567' }] }
              : {
                  id: '1234567',
                  display_phone_number: '5511999999999',
                  verified_name: 'Atendimento',
                },
      };
    });
  const app = createApp(db, {
    password: options.password || '',
    secretKey: randomBytes(32),
    transport,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie;
  if (options.password) {
    const login = await fetch(base + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: options.password }),
    });
    cookie = login.headers.get('set-cookie').split(';')[0];
  }
  const req = async (path, body, method = body ? 'POST' : 'GET', headers = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: response.status, data };
  };
  const pixel = (
    await req('/pixels', {
      project_id: 'work',
      name: 'Pixel WhatsApp',
      domain: 'https://site.test',
    })
  ).data;
  const conn = (
    await req('/whatsapp/connections', {
      project_id: 'work',
      pixel_id: pixel.id,
      name: 'Atendimento',
      waba_id: '9876543',
      phone_number_id: '1234567',
      app_secret: secret,
      access_token: 'whatsapp-access-token-test',
    })
  ).data;
  const setup = (await req(`/whatsapp/connections/${conn.id}/setup?project=work`)).data;
  const activate = async () => {
    assert.equal(
      (await req(`/whatsapp/connections/${conn.id}/check`, { project_id: 'work' })).status,
      200,
    );
    assert.equal(
      (await req(`/whatsapp/connections/${conn.id}/subscribe`, { project_id: 'work' })).status,
      200,
    );
    assert.equal(
      (
        await req(
          `/whatsapp/webhook/${conn.id}?${new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': setup.verify_token, 'hub.challenge': 'challenge-test' })}`,
        )
      ).status,
      200,
    );
    assert.equal((await deliver(envelope([message('wamid.activation-test')]))).data.accepted, 1);
    assert.equal(
      (
        await req(
          `/whatsapp/connections/${conn.id}`,
          { project_id: 'work', test_mode: false },
          'PATCH',
        )
      ).status,
      200,
    );
  };
  const envelope = (messages, overrides = {}) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '9876543',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1234567' },
              contacts: [{ wa_id: '5511888888888', profile: { name: 'Ana' } }],
              messages,
              ...overrides,
            },
          },
        ],
      },
    ],
  });
  const message = (id, extra = {}) => ({
    id,
    from: '5511888888888',
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body: 'Mensagem privada sem armazenamento' },
    ...extra,
  });
  const deliver = (body, signature) => {
    const raw = JSON.stringify(body);
    return req(`/whatsapp/webhook/${conn.id}`, raw, 'POST', {
      'x-hub-signature-256':
        signature || 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    });
  };
  return {
    db,
    app,
    base,
    req,
    pixel,
    conn,
    setup,
    activate,
    envelope,
    message,
    deliver,
    calls: () => calls,
  };
}

test('WhatsApp configuration encrypts secrets, validates access, scopes projects and protects webhooks', async (t) => {
  const f = await fixture(t, { password: 'admin-pass-test' });
  assert.equal((await fetch(f.base + '/whatsapp?project=work')).status, 401);
  assert.equal(
    (await fetch(f.base + `/whatsapp/connections/${f.conn.id}/setup?project=work`)).status,
    401,
  );
  assert.equal((await f.req(`/whatsapp/connections/${f.conn.id}/setup?project=other`)).status, 404);
  const rows = JSON.stringify(f.db.prepare('SELECT * FROM wa_connections').all());
  assert.ok(!rows.includes(secret));
  assert.ok(!rows.includes('whatsapp-access-token-test'));
  const list = (await f.req('/whatsapp?project=work')).data;
  assert.ok(!JSON.stringify(list).includes(f.setup.verify_token));
  assert.equal(
    (
      await f.req(
        `/whatsapp/connections/${f.conn.id}`,
        { project_id: 'work', test_mode: false },
        'PATCH',
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.req(
        `/whatsapp/webhook/${f.conn.id}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc`,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.deliver(f.envelope([f.message('wamid.bad')]), 'sha256=' + '0'.repeat(64))).status,
    401,
  );
  await f.activate();
  assert.equal(f.calls(), 4);
  assert.equal(
    (
      await f.req(
        `/whatsapp/connections/${f.conn.id}`,
        { project_id: 'other', active: false },
        'PATCH',
      )
    ).status,
    404,
  );
  await f.req(`/whatsapp/connections/${f.conn.id}`, { project_id: 'work', active: false }, 'PATCH');
  assert.equal((await f.deliver(f.envelope([f.message('wamid.inactive')]))).status, 404);
});

test('test deliveries and status notifications cannot create contacts, conversations or revenue; real messages deduplicate', async (t) => {
  const f = await fixture(t);
  const body = f.envelope([f.message('wamid.test')]);
  assert.equal((await f.deliver(body)).data.test_mode, true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_contacts').get().n, 0);
  await f.activate();
  assert.equal((await f.deliver(body)).data.accepted, 1);
  assert.equal((await f.deliver(body)).data.ignored, 1);
  const wrong = f.envelope([f.message('wamid.wrong')]);
  wrong.entry[0].id = '9999999';
  await f.deliver(wrong);
  await f.deliver(
    f.envelope([f.message('wamid.wrong-phone')], { metadata: { phone_number_id: '0000000' } }),
  );
  await f.deliver(
    f.envelope(undefined, { statuses: [{ id: 'wamid.status', status: 'delivered' }] }),
  );
  await f.deliver(f.envelope([f.message('wamid.reaction', { type: 'reaction' })]));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_contacts').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  assert.ok(
    !JSON.stringify(f.db.prepare('SELECT * FROM wa_messages').all()).includes('Mensagem privada'),
  );
  const first = f.db.prepare('SELECT * FROM wa_conversations').get();
  const earlier = String(Math.floor(Date.now() / 1000) - 3600);
  await f.deliver(f.envelope([f.message('wamid.late', { timestamp: earlier })]));
  const updated = f.db.prepare('SELECT * FROM wa_conversations').get();
  assert.equal(updated.id, first.id);
  assert.ok(updated.started_at < first.started_at);
  assert.equal(updated.last_message_at, first.last_message_at);
});

test('smart link reference joins the website journey and CRM stages without interpreting message text as payment', async (t) => {
  const f = await fixture(t);
  await f.activate();
  const code = 'wt1234567890abcdef123456';
  f.db.prepare('INSERT INTO checkout_refs VALUES(?,?,?,?)').run(
    'work',
    code,
    JSON.stringify({
      visitor_id: 'visitor-site-original',
      utm_source: 'facebook',
      utm_campaign: 'Campanha da página',
      utm_medium: 'paid',
      utm_content: 'criativo',
      utm_term: 'conjunto',
    }),
    Date.now() + 86400000,
  );
  await f.deliver(
    f.envelope([f.message('wamid.link', { text: { body: `Pedido confirmado R$ 900 [${code}]` } })]),
  );
  const conv = f.db.prepare('SELECT * FROM wa_conversations').get();
  assert.equal(conv.visitor_id, 'visitor-site-original');
  assert.equal(conv.attribution_method, 'smart_link');
  assert.equal(conv.utm_campaign, 'Campanha da página');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  const id = conv.contact_id;
  await f.req(`/whatsapp/contacts/${id}`, { project_id: 'work', stage: 'qualified' }, 'PATCH');
  await f.req(`/whatsapp/contacts/${id}`, { project_id: 'work', stage: 'negotiating' }, 'PATCH');
  await f.req(`/whatsapp/contacts/${id}`, { project_id: 'work', stage: 'qualified' }, 'PATCH');
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_name='Lead'").get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_stage_history').get().n, 3);
  const journey = (await f.req(`/visitors/visitor-site-original?project=work`)).data;
  assert.ok(
    journey.events.some((e) => e.event_name === 'ConversationStarted' && e.channel === 'whatsapp'),
  );
  assert.equal((await f.req(`/whatsapp/contacts/${id}?project=other`)).status, 404);
  const report = (await f.req('/whatsapp?project=work&stage=qualified')).data;
  assert.equal(report.total, 1);
  assert.equal(report.pipeline.qualified, 1);
});

test('CTWA ad references populate campaign metrics and only approved checkout orders convert conversations', async (t) => {
  const f = await fixture(t);
  await f.activate();
  const at = new Date(Date.now() - 60000).toISOString(),
    day = dateKey();
  f.db
    .prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)')
    .run('campaign', 'work', 'Campanha WhatsApp', 'Meta Ads', 100, 1, at);
  f.db.prepare('INSERT INTO meta_campaigns VALUES(?,?,?)').run('campaign', '1111111', 'act_test');
  f.db.prepare('INSERT INTO meta_account_selection VALUES(?,?,?)').run('work', 'act_test', 1);
  f.db
    .prepare('INSERT INTO ad_sets VALUES(?,?,?,?,?,?)')
    .run('set', 'campaign', '2222222', 'Conjunto', 1, 100);
  f.db.prepare('INSERT INTO ads VALUES(?,?,?,?,?)').run('ad', 'set', '3333333', 'Anúncio', 1);
  f.db.prepare('INSERT INTO spend VALUES(?,?,?,?,?)').run('campaign', day, 50, 1000, 100);
  await f.deliver(
    f.envelope([
      f.message('wamid.ctwa', {
        timestamp: String(Math.floor(Date.now() / 1000) - 30),
        referral: { source_type: 'ad', source_id: '3333333', ctwa_clid: 'meta-click-id' },
      }),
    ]),
  );
  const conv = f.db.prepare('SELECT * FROM wa_conversations').get();
  assert.equal(conv.ad_reference, '3333333');
  assert.equal(conv.ctwa_clid, 'meta-click-id');
  const token = (
    await f.req('/tokens', {
      project_id: 'work',
      name: 'Checkout WhatsApp',
      platform: 'API personalizada',
    })
  ).data;
  const order = {
    order_id: 'checkout-whatsapp-1',
    product: 'Curso',
    amount: 197,
    status: 'pending',
    customer_phone: '5511888888888',
    utm_source: 'direct',
  };
  await f.req(`/webhooks/${token.token}`, order);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_sale_links').get().n, 1);
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.sales, 0);
  await f.req(`/webhooks/${token.token}`, { ...order, status: 'approved' });
  const report = (await f.req('/whatsapp?project=work')).data;
  assert.equal(report.metrics.sales, 1);
  assert.equal(report.metrics.revenue, 197);
  assert.equal(report.metrics.wa_conversion, 100);
  assert.equal(report.metrics.cost_per_conversation, 50);
  const hierarchy = (await f.req('/ad-hierarchy?project=work&level=campaigns')).data.rows[0];
  assert.equal(hierarchy.wa_conversations, 1);
  assert.equal(hierarchy.wa_revenue, 197);
  assert.equal(hierarchy.wa_conversion, 100);
  await f.req(`/webhooks/${token.token}`, { ...order, status: 'refunded' });
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.wa_conversion, 0);
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.revenue, 0);
  const detail = (await f.req(`/whatsapp/contacts/${conv.contact_id}?project=work`)).data;
  assert.equal(detail.sales[0].status, 'refunded');
});

test('session inactivity creates a second conversation, outbound echoes never start one and sales before contact do not match', async (t) => {
  const f = await fixture(t);
  await f.activate();
  const old = String(Math.floor(Date.now() / 1000) - 26 * 3600);
  await f.deliver(f.envelope([f.message('wamid.old', { timestamp: old })]));
  await f.deliver(f.envelope([f.message('wamid.current')]));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get().n, 2);
  const echo = f.envelope(undefined, {
    message_echoes: [
      {
        id: 'wamid.echo',
        from: '5511999999999',
        to: '5511888888888',
        type: 'text',
        timestamp: String(Math.floor(Date.now() / 1000)),
        text: { body: 'Resposta privada' },
      },
    ],
  });
  echo.entry[0].changes[0].field = 'smb_message_echoes';
  await f.deliver(echo);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get().n, 2);
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM wa_messages WHERE direction='outbound'").get().n,
    1,
  );
  const token = (
    await f.req('/tokens', { project_id: 'work', name: 'Checkout', platform: 'API personalizada' })
  ).data;
  await f.req(`/webhooks/${token.token}`, {
    order_id: 'before-contact',
    product: 'Curso',
    amount: 100,
    status: 'approved',
    customer_phone: '5511888888888',
    created_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_sale_links').get().n, 0);
});

test('a new CTWA click on the same ad starts a new conversation while repeated referrals and organic replies stay in it', async (t) => {
  const f = await fixture(t);
  await f.activate();
  for (const [id, ago, click] of [
    ['first', 120, 'click-first'],
    ['second', 90, 'click-second'],
    ['repeat', 60, 'click-second'],
    ['reply', 30, null],
  ]) {
    const result = await f.deliver(
      f.envelope([
        f.message('wamid.click.' + id, {
          timestamp: String(Math.floor(Date.now() / 1000) - ago),
          ...(click
            ? { referral: { source_type: 'ad', source_id: '3333333', ctwa_clid: click } }
            : {}),
        }),
      ]),
    );
    assert.equal(result.data.accepted, 1);
  }
  const conversations = f.db.prepare('SELECT * FROM wa_conversations ORDER BY started_at').all();
  assert.equal(conversations.length, 2);
  assert.equal(conversations[0].ctwa_clid, 'click-first');
  assert.equal(conversations[1].ctwa_clid, 'click-second');
  assert.equal(
    f.db
      .prepare('SELECT COUNT(*) AS n FROM wa_messages WHERE conversation_id=?')
      .get(conversations[1].id).n,
    3,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM events WHERE event_name='ConversationStarted'").get().n,
    2,
  );
});

test('a new smart-link campaign from the same visitor starts a separate conversation and keeps its attribution', async (t) => {
  const f = await fixture(t);
  await f.activate();
  for (const [suffix, campaign, ago] of [
    ['1234567890abcdef', 'campaign-first', 90],
    ['abcdef1234567890', 'campaign-second', 60],
    ['abcdef1234567890', 'campaign-second', 30],
  ]) {
    const code = 'wt' + suffix;
    f.db.prepare('INSERT OR REPLACE INTO checkout_refs VALUES(?,?,?,?)').run(
      'work',
      code,
      JSON.stringify({
        visitor_id: 'returning-site-visitor',
        utm_source: 'facebook',
        utm_campaign: campaign,
      }),
      Date.now() + 86400000,
    );
    await f.deliver(
      f.envelope([
        f.message('wamid.campaign.' + ago, {
          timestamp: String(Math.floor(Date.now() / 1000) - ago),
          text: { body: `Olá [${code}]` },
        }),
      ]),
    );
  }
  const conversations = f.db.prepare('SELECT * FROM wa_conversations ORDER BY started_at').all();
  assert.equal(conversations.length, 2);
  assert.deepEqual(
    conversations.map((v) => v.utm_campaign),
    ['campaign-first', 'campaign-second'],
  );
  assert.ok(conversations.every((v) => v.visitor_id === 'returning-site-visitor'));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_contacts').get().n, 1);
});

test('manual contacts and order links cannot fabricate conversations or payment, and removed links stay excluded', async (t) => {
  const f = await fixture(t, { Driver: Database });
  const contact = (
    await f.req('/whatsapp/contacts', {
      project_id: 'work',
      name: 'Manual',
      phone: '+5511777777777',
    })
  ).data;
  assert.equal(
    (
      await f.req('/whatsapp/contacts', {
        project_id: 'work',
        name: 'Duplicado',
        phone: '5511777777777',
      })
    ).status,
    409,
  );
  const token = (
    await f.req('/tokens', { project_id: 'work', name: 'Pedidos', platform: 'API personalizada' })
  ).data;
  const order = { order_id: 'manual-order-1', status: 'pending', amount: 100, product: 'Curso' };
  const sale = (await f.req(`/webhooks/${token.token}`, order)).data;
  assert.equal(
    (
      await f.req(`/whatsapp/contacts/${contact.id}/sales`, {
        project_id: 'other',
        sale_id: sale.id,
      })
    ).status,
    404,
  );
  await f.req(`/whatsapp/contacts/${contact.id}/sales`, { project_id: 'work', sale_id: sale.id });
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.sales, 0);
  await f.req(`/webhooks/${token.token}`, { ...order, status: 'approved' });
  const report = (await f.req('/whatsapp?project=work')).data;
  assert.equal(report.metrics.sales, 1);
  assert.equal(report.metrics.wa_conversations, 0);
  assert.equal(report.metrics.wa_conversion, null);
  await f.req(`/whatsapp/contacts/${contact.id}/sales/${sale.id}?project=work`, null, 'DELETE');
  await f.req(`/webhooks/${token.token}`, { ...order, status: 'approved' });
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.sales, 0);
});

test('validating a mismatched account fails and rotating credentials returns collection to test mode', async (t) => {
  const f = await fixture(t);
  await f.activate();
  await f.req(
    `/whatsapp/connections/${f.conn.id}`,
    { project_id: 'work', access_token: 'replacement-token-test' },
    'PATCH',
  );
  const row = f.db.prepare('SELECT * FROM wa_connections').get();
  assert.equal(row.test_mode, 1);
  assert.equal(row.api_checked_at, null);
  assert.equal(row.subscribed_at, null);
  assert.ok(row.verified_at);
  assert.equal(
    (await f.req(`/whatsapp/connections/${f.conn.id}/setup?project=work`)).data.test_received,
    false,
  );
  const g = await fixture(t, {
    transport: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'another-phone' }], id: '1234567' }),
    }),
  });
  assert.equal(
    (await g.req(`/whatsapp/connections/${g.conn.id}/check`, { project_id: 'work' })).status,
    400,
  );
  assert.equal(
    g.db.prepare('SELECT api_checked_at FROM wa_connections').get().api_checked_at,
    null,
  );
});

test('real collection requires a fresh inbound test delivery; echoes and earlier credential tests do not activate it', async (t) => {
  const f = await fixture(t);
  const path = `/whatsapp/connections/${f.conn.id}`;
  await f.req(path + '/check', { project_id: 'work' });
  await f.req(path + '/subscribe', { project_id: 'work' });
  await f.req(
    `/whatsapp/webhook/${f.conn.id}?${new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': f.setup.verify_token, 'hub.challenge': 'challenge-test' })}`,
  );
  assert.equal((await f.req(path, { project_id: 'work', test_mode: false }, 'PATCH')).status, 400);
  const echo = f.envelope(undefined, {
    message_echoes: [
      {
        id: 'wamid.test-echo',
        to: '5511888888888',
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Resposta em teste' },
      },
    ],
  });
  echo.entry[0].changes[0].field = 'smb_message_echoes';
  assert.equal((await f.deliver(echo)).data.accepted, 1);
  assert.equal((await f.req(path + '/setup?project=work')).data.test_received, false);
  assert.equal((await f.req(path, { project_id: 'work', test_mode: false }, 'PATCH')).status, 400);
  await f.deliver(f.envelope([f.message('wamid.inbound-test')]));
  assert.equal((await f.req(path + '/setup?project=work')).data.test_received, true);
  await f.req(path + '/subscribe', { project_id: 'work' });
  assert.equal((await f.req(path + '/setup?project=work')).data.test_received, false);
  assert.equal((await f.req(path, { project_id: 'work', test_mode: false }, 'PATCH')).status, 400);
  await f.deliver(f.envelope([f.message('wamid.inbound-retest')]));
  assert.equal((await f.req(path, { project_id: 'work', test_mode: false }, 'PATCH')).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_contacts').get().n, 0);
});

test('delivery setup requires verified account access, configures only this phone and never claims a rejected subscription', async (t) => {
  const calls = [];
  let deny = false;
  const f = await fixture(t, {
    transport: async (url, init) => {
      calls.push({ url: String(url), ...init });
      return {
        ok: !deny,
        status: deny ? 403 : 200,
        json: async () =>
          init.method === 'POST'
            ? { success: !deny }
            : String(url).includes('/phone_numbers')
              ? { data: [{ id: '1234567' }] }
              : { id: '1234567' },
      };
    },
  });
  const path = `/whatsapp/connections/${f.conn.id}`;
  assert.equal((await f.req(path + '/subscribe', { project_id: 'work' })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await f.req(path + '/check', { project_id: 'work' })).status, 200);
  deny = true;
  assert.equal((await f.req(path + '/subscribe', { project_id: 'work' })).status, 502);
  assert.equal(f.db.prepare('SELECT subscribed_at FROM wa_connections').get().subscribed_at, null);
  deny = false;
  assert.equal((await f.req(path + '/subscribe', { project_id: 'work' })).status, 200);
  const posts = calls.filter((c) => c.method === 'POST');
  assert.ok(posts.at(-2).url.endsWith('/9876543/subscribed_apps'));
  assert.ok(posts.at(-1).url.endsWith('/1234567'));
  assert.deepEqual(JSON.parse(posts.at(-1).body), {
    webhook_configuration: {
      override_callback_uri: `https://tracking.example.test/api/whatsapp/webhook/${f.conn.id}`,
      verify_token: f.setup.verify_token,
    },
  });
  assert.ok(calls.every((c) => !c.url.includes('whatsapp-access-token-test')));
  assert.equal(
    (await f.req(path, { project_id: 'work', test_mode: false }, 'PATCH')).status,
    400,
    'a subscription alone cannot bypass callback verification',
  );
});

test('native checkout ingestion links an approved order to the preceding conversation and preserves it through refunds', async (t) => {
  const f = await fixture(t, { Driver: Database });
  await f.activate();
  await f.deliver(
    f.envelope([
      f.message('wamid.native', { timestamp: String(Math.floor(Date.now() / 1000) - 60) }),
    ]),
  );
  const token = (
    await f.req('/tokens', {
      project_id: 'work',
      name: 'Checkout nativo',
      platform: 'API personalizada',
    })
  ).data;
  const integration = f.db.prepare('SELECT * FROM integrations WHERE id=?').get(token.id);
  const data = {
    order_id: 'native-wa-order',
    product: 'Produto',
    amount: 97,
    status: 'approved',
    customer_name: 'Ana',
    customer_email: 'ana@example.test',
    customer_phone: '5511888888888',
    payment_method: 'pix',
    utm_source: 'direct',
    utm_campaign: '',
    created_at: new Date().toISOString(),
    occurred_at: new Date().toISOString(),
  };
  const first = recordSale(f.db, null, integration, data, { provider: 'hotmart', skipCapi: true });
  assert.equal((await f.req('/whatsapp?project=work')).data.metrics.sales, 1);
  const link = f.db.prepare('SELECT * FROM wa_sale_links WHERE sale_id=?').get(first.id);
  assert.equal(link.method, 'phone');
  recordSale(
    f.db,
    null,
    integration,
    { ...data, status: 'refunded', occurred_at: new Date(Date.now() + 1000).toISOString() },
    { provider: 'hotmart', skipCapi: true },
  );
  const report = (await f.req('/whatsapp?project=work')).data;
  assert.equal(report.metrics.sales, 0);
  assert.equal(report.metrics.wa_converted, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 1);
});

test('WhatsApp keeps BRL and USD purchases, attributed costs and campaign columns separate', async (t) => {
  const f = await fixture(t);
  await f.activate();
  const at = new Date(Date.now() - 60000).toISOString(),
    day = dateKey();
  for (const [code, currency, spend, phone, ad] of [
    ['brl', 'BRL', 50, '5511444444444', '111111'],
    ['usd', 'USD', 10, '5511555555555', '222222'],
  ]) {
    f.db
      .prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)')
      .run(code, 'work', code, 'Meta Ads', 100, 1, at);
    f.db.prepare('INSERT INTO campaign_currencies VALUES(?,?)').run(code, currency);
    f.db
      .prepare('INSERT INTO ad_sets VALUES(?,?,?,?,?,?)')
      .run('set_' + code, code, 'ext_' + code, code, 1, 100);
    f.db.prepare('INSERT INTO ads VALUES(?,?,?,?,?)').run('ad_' + code, 'set_' + code, ad, code, 1);
    f.db.prepare('INSERT INTO spend VALUES(?,?,?,?,?)').run(code, day, spend, 100, 10);
    await f.deliver(
      f.envelope([
        f.message('wamid.' + code, {
          from: phone,
          timestamp: String(Math.floor(Date.now() / 1000) - 30),
          referral: { source_type: 'ad', source_id: ad },
        }),
      ]),
    );
  }
  const token = (
    await f.req('/tokens', {
      project_id: 'work',
      name: 'Moedas WhatsApp',
      platform: 'API personalizada',
    })
  ).data;
  for (const [currency, amount, phone] of [
    ['BRL', 197, '5511444444444'],
    ['USD', 25, '5511555555555'],
  ])
    assert.equal(
      (
        await f.req(`/webhooks/${token.token}`, {
          order_id: 'wa-' + currency,
          product: 'Produto',
          amount,
          currency,
          status: 'approved',
          customer_phone: phone,
        })
      ).status,
      200,
    );
  const brl = (await f.req('/whatsapp?project=work&currency=BRL')).data;
  const usd = (await f.req('/whatsapp?project=work&currency=USD')).data;
  assert.equal(brl.metrics.revenue, 197);
  assert.equal(usd.metrics.revenue, 25);
  assert.equal(brl.metrics.cost_per_conversation, 50);
  assert.equal(usd.metrics.cost_per_conversation, 10);
  assert.equal(brl.metrics.attributed_conversations, 1);
  assert.equal(usd.metrics.attributed_conversations, 1);
  assert.equal(brl.metrics.wa_conversations, 2);
  assert.equal(usd.metrics.wa_conversations, 2);
  assert.equal(brl.metrics.sales, 1);
  assert.equal(usd.metrics.sales, 1);
  const rows = (await f.req('/ad-hierarchy?project=work&level=campaigns&currency=USD')).data.rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wa_revenue, 25);
  assert.equal(rows[0].wa_cost_per_conversation, 10);
  const contact = usd.contacts.find((c) => c.wa_id === '5511555555555');
  assert.equal(
    (await f.req(`/whatsapp/contacts/${contact.id}?project=work`)).data.sales[0].currency,
    'USD',
  );
});
