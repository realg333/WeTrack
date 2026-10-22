import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { decrypt } from '../server/meta.mjs';
import Database from 'libsql';

const appSecret = 'embedded-signup-app-secret-test';
const businessToken = 'embedded-signup-business-token-test';
async function fixture(t, options = {}) {
  const fields = [
    'PUBLIC_URL',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_WHATSAPP_CONFIG_ID',
    'META_LOGIN_CONFIG_ID',
    'META_GRAPH_VERSION',
  ];
  const previous = Object.fromEntries(fields.map((name) => [name, process.env[name]]));
  Object.assign(process.env, {
    PUBLIC_URL: 'https://tracking.example.test',
    META_APP_ID: '123456789',
    META_APP_SECRET: appSecret,
    META_WHATSAPP_CONFIG_ID: '987654321',
    META_LOGIN_CONFIG_ID: '222222222',
    META_GRAPH_VERSION: 'v23.0',
  });
  t.after(() => {
    for (const [name, value] of Object.entries(previous))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });
  const db = createDatabase(':memory:', {
      seedDemo: false,
      ...(options.Driver ? { Driver: options.Driver } : {}),
    }),
    key = randomBytes(32),
    calls = [];
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('work', 'Operação', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('other', 'Outra operação', 0);
  db.prepare('INSERT INTO pixels VALUES(?,?,?,?,?,?,?)').run(
    'pixel',
    'work',
    'Pixel',
    'https://site.test',
    null,
    1,
    new Date().toISOString(),
  );
  const transport = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, ...init });
    const override = options.respond?.(url, init);
    const body =
      override ??
      (url.pathname.endsWith('/oauth/access_token')
        ? { access_token: businessToken }
        : url.pathname.endsWith('/debug_token')
          ? {
              data: {
                app_id: '123456789',
                is_valid: true,
                scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
              },
            }
          : url.pathname.endsWith('/phone_numbers')
            ? { data: [{ id: '1234567' }] }
            : url.pathname.endsWith('/smb_app_data')
              ? { request_id: 'request-' + JSON.parse(init.body).sync_type }
              : init.method === 'POST'
                ? { success: true }
                : {
                    id: '1234567',
                    display_phone_number: '5511999999999',
                    verified_name: 'Atendimento',
                    is_on_biz_app: true,
                    platform_type: 'CLOUD_API',
                  });
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  const app = createApp(db, { password: 'admin-test-password', secretKey: key, transport });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.close();
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const login = async () => {
    const response = await fetch(base + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'admin-test-password' }),
    });
    return response.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await login();
  const req = async (path, body, options = {}) => {
    const response = await fetch(base + path, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...options.headers },
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
  const start = async () => {
    const response = await req('/whatsapp/onboarding/session', {
      project_id: 'work',
      pixel_id: 'pixel',
      name: 'Atendimento',
    });
    assert.equal(response.status, 201);
    return response.data.nonce;
  };
  const exchange = (nonce) =>
    req('/whatsapp/onboarding/exchange', {
      project_id: 'work',
      nonce,
      code: 'one-time-meta-authorization-code',
    });
  const complete = (nonce, extra = {}) =>
    req('/whatsapp/onboarding/complete', {
      project_id: 'work',
      nonce,
      waba_id: '9876543',
      phone_number_id: '1234567',
      ...extra,
    });
  const connect = async () => {
    const nonce = await start();
    assert.equal((await exchange(nonce)).status, 200);
    const result = await complete(nonce);
    assert.equal(result.status, 201);
    return result.data.id;
  };
  return { db, key, calls, base, login, req, start, exchange, complete, connect };
}

test('embedded signup publishes only safe config, requires its own config ID and protects authorization with login', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/whatsapp/onboarding/config')).status, 401);
  const config = (await f.req('/whatsapp/onboarding/config')).data;
  assert.equal(config.config_id, '987654321');
  assert.equal(config.session_info_version, '3');
  assert.equal(config.feature_type, 'whatsapp_business_app_onboarding');
  assert.equal(config.webhook_url, 'https://tracking.example.test/api/whatsapp/webhook/app');
  assert.ok(config.verify_token);
  assert.ok(!JSON.stringify(config).includes(appSecret));
  delete process.env.META_WHATSAPP_CONFIG_ID;
  assert.deepEqual((await f.req('/whatsapp/onboarding/config')).data, {
    configured: false,
    expires_in: 600,
  });
  assert.equal(
    (
      await f.req('/whatsapp/onboarding/session', {
        project_id: 'work',
        pixel_id: 'pixel',
        name: 'Atendimento',
      })
    ).status,
    503,
  );
  assert.equal(f.calls.length, 0);
});

test('embedded authorization exchanges code immediately, keeps tokens server side and creates a verified test connection once', async (t) => {
  const f = await fixture(t, { Driver: Database }),
    nonce = await f.start();
  assert.equal((await f.complete(nonce)).status, 409);
  assert.equal((await f.exchange(nonce)).status, 200);
  assert.equal((await f.exchange(nonce)).status, 409);
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0].url.pathname.endsWith('/oauth/access_token'));
  assert.equal(f.calls[0].url.searchParams.get('client_secret'), appSecret);
  assert.equal(f.calls[0].url.searchParams.has('redirect_uri'), false);
  const pending = f.db.prepare('SELECT * FROM wa_onboarding_sessions').get();
  assert.ok(!JSON.stringify(pending).includes(nonce));
  assert.ok(!JSON.stringify(pending).includes(businessToken));
  assert.equal(decrypt(pending.token_cipher, f.key), businessToken);
  const result = await f.complete(nonce);
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.data), ['id']);
  assert.equal((await f.complete(nonce)).status, 409);
  const connection = f.db.prepare('SELECT * FROM wa_connections').get();
  assert.equal(connection.project_id, 'work');
  assert.equal(connection.test_mode, 1);
  assert.ok(connection.api_checked_at);
  assert.equal(connection.subscribed_at, null);
  assert.equal(connection.verified_at, null);
  assert.equal(decrypt(connection.secret_cipher, f.key), appSecret);
  assert.equal(decrypt(connection.token_cipher, f.key), businessToken);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_onboarding_sessions').get().n, 0);
  assert.ok(
    (await f.req(`/whatsapp/connections/${connection.id}/setup?project=work`)).data.onboarding,
  );
  assert.ok(f.calls.every((call) => !call.url.pathname.endsWith('/register')));
});

test('onboarding sessions reject another operation, another admin session, expired sessions and inactive pixels', async (t) => {
  const f = await fixture(t);
  let nonce = await f.start();
  const otherCookie = await f.login();
  assert.equal(
    (
      await f.req(
        '/whatsapp/onboarding/exchange',
        { project_id: 'work', nonce, code: 'code' },
        { headers: { Cookie: otherCookie } },
      )
    ).status,
    409,
  );
  assert.equal(
    (await f.req('/whatsapp/onboarding/exchange', { project_id: 'other', nonce, code: 'code' }))
      .status,
    409,
  );
  f.db.prepare('UPDATE wa_onboarding_sessions SET expires_at=0').run();
  assert.equal((await f.exchange(nonce)).status, 409);
  assert.equal(f.calls.length, 0);
  nonce = await f.start();
  assert.equal((await f.exchange(nonce)).status, 200);
  f.db.prepare('UPDATE pixels SET active=0').run();
  assert.equal((await f.complete(nonce)).status, 400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_connections').get().n, 0);
});

test('reauthorization preserves the same operation history and resets readiness without moving a phone to another operation', async (t) => {
  const f = await fixture(t),
    id = await f.connect(),
    before = f.db.prepare('SELECT * FROM wa_connections WHERE id=?').get(id);
  const at = new Date().toISOString();
  f.db
    .prepare(
      'UPDATE wa_connections SET active=0,test_mode=0,subscribed_at=?,verified_at=? WHERE id=?',
    )
    .run(at, at, id);
  f.db.prepare('INSERT INTO wa_connection_tests VALUES(?,?)').run(id, at);
  f.db
    .prepare("INSERT INTO wa_messages VALUES(?,?,NULL,'outbound',?,'text')")
    .run('old-message', id, at);
  f.db
    .prepare(
      'UPDATE wa_onboarding_connections SET contacts_sync_requested_at=?,history_sync_requested_at=?,contacts_sync_request_id=?,history_sync_request_id=? WHERE connection_id=?',
    )
    .run(at, at, 'old-contacts', 'old-history', id);
  f.db
    .prepare('INSERT INTO pixels VALUES(?,?,?,?,?,?,?)')
    .run('pixel-new', 'work', 'Novo pixel', 'https://site.test', null, 1, at);
  const started = await f.req('/whatsapp/onboarding/session', {
    project_id: 'work',
    pixel_id: 'pixel-new',
    name: 'Atendimento reconectado',
  });
  const nonce = started.data.nonce;
  assert.equal((await f.exchange(nonce)).status, 200);
  const completed = await f.complete(nonce);
  assert.equal(completed.status, 201);
  assert.equal(completed.data.id, id);
  const after = f.db.prepare('SELECT * FROM wa_connections WHERE id=?').get(id);
  assert.equal(after.created_at, before.created_at);
  assert.equal(after.active, 1);
  assert.equal(after.test_mode, 1);
  assert.equal(after.pixel_id, 'pixel-new');
  assert.equal(after.name, 'Atendimento reconectado');
  assert.equal(after.subscribed_at, null);
  assert.equal(after.verified_at, null);
  assert.notEqual(after.verify_cipher, before.verify_cipher);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_connection_tests').get().n, 0);
  assert.equal(
    f.db.prepare('SELECT COUNT(*) AS n FROM wa_messages WHERE connection_id=?').get(id).n,
    1,
  );
  const state = f.db
    .prepare('SELECT * FROM wa_onboarding_connections WHERE connection_id=?')
    .get(id);
  assert.equal(state.contacts_sync_request_id, null);
  assert.equal(state.history_sync_requested_at, null);
  f.db
    .prepare('INSERT INTO pixels VALUES(?,?,?,?,?,?,?)')
    .run('pixel-other', 'other', 'Outra operação', 'https://site.test', null, 1, at);
  const foreign = (
    await f.req('/whatsapp/onboarding/session', {
      project_id: 'other',
      pixel_id: 'pixel-other',
      name: 'Tentativa de mover',
    })
  ).data.nonce;
  assert.equal(
    (
      await f.req('/whatsapp/onboarding/exchange', {
        project_id: 'other',
        nonce: foreign,
        code: 'new-code',
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.req('/whatsapp/onboarding/complete', {
        project_id: 'other',
        nonce: foreign,
        waba_id: '9876543',
        phone_number_id: '1234567',
      })
    ).status,
    409,
  );
  assert.equal(
    f.db.prepare('SELECT project_id FROM wa_connections WHERE id=?').get(id).project_id,
    'work',
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_connections').get().n, 1);
});

test('onboarding never trusts browser asset IDs, foreign app tokens or a number without coexistence', async (t) => {
  for (const scenario of ['app', 'permission', 'coexistence', 'membership']) {
    await t.test(scenario, async (t) => {
      const f = await fixture(t, {
        respond: (url) => {
          if (scenario === 'app' && url.pathname.endsWith('/debug_token'))
            return {
              data: {
                app_id: '111111111',
                is_valid: true,
                scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
              },
            };
          if (scenario === 'permission' && url.pathname.endsWith('/debug_token'))
            return { data: { app_id: '123456789', is_valid: true, scopes: ['ads_read'] } };
          if (scenario === 'coexistence' && url.pathname.endsWith('/1234567'))
            return { id: '1234567', is_on_biz_app: false, platform_type: 'CLOUD_API' };
          if (scenario === 'membership' && url.pathname.endsWith('/phone_numbers'))
            return { data: [{ id: '7654321' }] };
        },
      });
      const nonce = await f.start();
      assert.equal((await f.exchange(nonce)).status, 200);
      assert.equal((await f.complete(nonce)).status, 400);
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_connections').get().n, 0);
    });
  }
});

test('initial coexistence sync requires subscription and records both one-time requests without counting history', async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  assert.equal(
    (await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'work' })).status,
    400,
  );
  assert.equal(
    (await f.req(`/whatsapp/connections/${id}/subscribe`, { project_id: 'work' })).status,
    200,
  );
  assert.equal(
    (await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'other' })).status,
    404,
  );
  const result = await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'work' });
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.onboarding.contacts_sync_request_id, 'request-smb_app_state_sync');
  assert.equal(result.data.onboarding.history_sync_request_id, 'request-history');
  assert.equal(
    (await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'work' })).status,
    200,
  );
  const calls = f.calls.filter((call) => call.url.pathname.endsWith('/smb_app_data'));
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => JSON.parse(call.body)),
    [
      { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' },
      { messaging_product: 'whatsapp', sync_type: 'history' },
    ],
  );
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
});

test('an ambiguous initial sync failure is recorded and never automatically submitted a second time', async (t) => {
  const f = await fixture(t, {
    respond: (url) =>
      url.pathname.endsWith('/smb_app_data')
        ? { error: { message: 'private remote details' } }
        : undefined,
  });
  const id = await f.connect();
  f.db
    .prepare('UPDATE wa_connections SET subscribed_at=? WHERE id=?')
    .run(new Date().toISOString(), id);
  assert.equal(
    (await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'work' })).status,
    502,
  );
  const repeated = await f.req(`/whatsapp/onboarding/${id}/sync`, { project_id: 'work' });
  assert.equal(repeated.status, 502);
  assert.ok(repeated.data.onboarding.contacts_sync_error);
  assert.ok(!JSON.stringify(repeated.data).includes('private remote details'));
  assert.equal(f.calls.filter((call) => call.url.pathname.endsWith('/smb_app_data')).length, 2);
});

test('the app callback verifies its secret, routes embedded phone messages and ignores account/history events', async (t) => {
  const f = await fixture(t),
    id = await f.connect();
  const config = (await f.req('/whatsapp/onboarding/config')).data;
  const params = new URLSearchParams({
    'hub.mode': 'subscribe',
    'hub.verify_token': config.verify_token,
    'hub.challenge': 'app-challenge',
  });
  assert.equal((await fetch(f.base + '/whatsapp/webhook/app?' + params)).status, 200);
  assert.equal(
    (
      await fetch(
        f.base +
          '/whatsapp/webhook/app?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc',
      )
    ).status,
    403,
  );
  f.db.prepare('UPDATE wa_connections SET test_mode=0 WHERE id=?').run(id);
  const body = {
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
              messages: [
                {
                  id: 'wamid.embedded',
                  from: '5511888888888',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'Conteúdo privado' },
                },
              ],
            },
          },
          { field: 'account_update', value: { event: 'ACCOUNT_OFFBOARDED' } },
          {
            field: 'history',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1234567' },
              history: [{ errors: [{ code: 2593109 }] }],
            },
          },
        ],
      },
    ],
  };
  const raw = JSON.stringify(body);
  assert.equal((await f.req('/whatsapp/webhook/app', raw)).status, 401);
  const headers = {
    'x-hub-signature-256': 'sha256=' + createHmac('sha256', appSecret).update(raw).digest('hex'),
  };
  assert.equal((await f.req('/whatsapp/webhook/app', raw, { headers })).data.accepted, 1);
  assert.equal((await f.req('/whatsapp/webhook/app', raw, { headers })).data.accepted, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_conversations').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM wa_messages').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get().n, 0);
  assert.ok(
    !JSON.stringify(f.db.prepare('SELECT * FROM wa_messages').all()).includes('Conteúdo privado'),
  );
});
