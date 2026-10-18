import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createMetaOAuth } from '../server/oauth.mjs';
import { createApp } from '../server/app.mjs';
import { decrypt } from '../server/meta.mjs';

function configure() {
  const names = [
    'PUBLIC_URL',
    'META_APP_ID',
    'META_APP_SECRET',
    'META_GRAPH_VERSION',
    'META_LOGIN_CONFIG_ID',
  ];
  const original = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  Object.assign(process.env, {
    PUBLIC_URL: 'https://wetrack.example.com',
    META_APP_ID: '123456789',
    META_APP_SECRET: 'mock-app-secret',
    META_GRAPH_VERSION: 'v99.0',
  });
  delete process.env.META_LOGIN_CONFIG_ID;
  return () =>
    names.forEach((n) => {
      if (original[n] === undefined) delete process.env[n];
      else process.env[n] = original[n];
    });
}
test('OAuth requires HTTPS and app configuration, expires tickets and rejects state/cookie replay', async () => {
  const restore = configure(),
    db = createDatabase(':memory:');
  let connected;
  const oauth = createMetaOAuth(
    db,
    {
      connect: async (project, token) => {
        connected = { project, token };
        return { accounts: [{ id: 'act_123' }] };
      },
    },
    async (url) => ({
      ok: true,
      json: async () => ({
        access_token: new URL(url).searchParams.has('code')
          ? 'mock-short-token'
          : 'mock-long-token',
      }),
    }),
  );
  try {
    process.env.PUBLIC_URL = 'http://127.0.0.1:5173';
    assert.equal(oauth.configuration().configured, false);
    assert.throws(() => oauth.createLink('workspace'), /HTTPS/);
    process.env.PUBLIC_URL = 'https://wetrack.example.com';
    const link = oauth.createLink('workspace');
    const ticket = new URL(link.url).pathname.split('/').at(-1);
    const stored = db.prepare('SELECT * FROM oauth_links').get();
    assert.notEqual(stored.ticket_hash, ticket);
    assert.ok(!JSON.stringify(stored).includes(ticket));
    const start = oauth.start(ticket),
      url = new URL(start.url),
      state = url.searchParams.get('state'),
      cookie = start.cookie.split(';')[0];
    assert.equal(url.origin, 'https://www.facebook.com');
    assert.equal(url.searchParams.get('scope'), 'ads_read');
    assert.equal(
      url.searchParams.get('redirect_uri'),
      'https://wetrack.example.com/api/meta/oauth/callback',
    );
    assert.match(start.cookie, /HttpOnly; Secure; SameSite=Lax/);
    assert.throws(() => oauth.start(ticket), /utilizado/);
    await assert.rejects(
      () => oauth.callback({ state: 'wrong', code: 'mock-code' }, cookie),
      /não confere/,
    );
    await assert.rejects(
      () => oauth.callback({ state, code: 'mock-code' }, 'wt_oauth_bind=wrong'),
      /não confere/,
    );
    const result = await oauth.callback({ state, code: 'mock-code' }, cookie);
    assert.deepEqual(result, { project_id: 'workspace', accounts: 1 });
    assert.deepEqual(connected, { project: 'workspace', token: 'mock-long-token' });
    await assert.rejects(() => oauth.callback({ state, code: 'mock-code' }, cookie), /não confere/);
    const expired = oauth.createLink('workspace');
    db.prepare('UPDATE oauth_links SET expires_at=0').run();
    assert.throws(() => oauth.start(new URL(expired.url).pathname.split('/').at(-1)), /expirado/);
    const pending = oauth.start(
      new URL(oauth.createLink('workspace').url).pathname.split('/').at(-1),
    );
    db.prepare('UPDATE oauth_states SET expires_at=0').run();
    await assert.rejects(
      () =>
        oauth.callback(
          { state: new URL(pending.url).searchParams.get('state'), code: 'mock-code' },
          pending.cookie,
        ),
      /não confere/,
    );
    const denied = oauth.start(
      new URL(oauth.createLink('workspace').url).pathname.split('/').at(-1),
    );
    await assert.rejects(
      () =>
        oauth.callback(
          { state: new URL(denied.url).searchParams.get('state'), error: 'access_denied' },
          denied.cookie,
        ),
      /cancelada/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM oauth_states').get().n, 0);
  } finally {
    db.close();
    restore();
  }
});

test('OAuth HTTP callback connects the intended project, encrypts credentials and grants no admin session', async () => {
  const restore = configure(),
    db = createDatabase(':memory:'),
    key = randomBytes(32),
    calls = [];
  const app = createApp(db, {
      password: 'mock-admin-password',
      secretKey: key,
      transport: async (url) => {
        const u = new URL(url);
        calls.push(u.pathname);
        if (u.pathname.endsWith('/oauth/access_token'))
          return {
            ok: true,
            json: async () => ({
              access_token: u.searchParams.has('code') ? 'mock-short-token' : 'mock-long-token',
            }),
          };
        if (u.pathname.endsWith('/me/adaccounts'))
          return {
            ok: true,
            json: async () => ({
              data: [
                { id: 'act_123', name: 'Conta autorizada', currency: 'BRL', account_status: 1 },
              ],
            }),
          };
        throw new Error('Unexpected request');
      },
    }),
    server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const post = (path, body, cookie = '') =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });
    assert.equal((await post('/meta/oauth/links', { project_id: 'workspace' })).status, 401);
    const login = await post('/login', { password: 'mock-admin-password' }),
      adminCookie = login.headers.get('set-cookie').split(';')[0];
    const created = await post('/meta/oauth/links', { project_id: 'workspace' }, adminCookie);
    assert.equal(created.status, 201);
    const link = await created.json(),
      start = await fetch(base + new URL(link.url).pathname.replace('/api', ''), {
        redirect: 'manual',
      });
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')).searchParams.get('state'),
      binding = start.headers.get('set-cookie').split(';')[0];
    const callback = await fetch(base + `/meta/oauth/callback?state=${state}&code=mock-code`, {
      headers: { Cookie: binding },
    });
    assert.equal(callback.status, 200);
    assert.match(await callback.text(), /Conexão concluída/);
    assert.ok(!callback.headers.get('set-cookie').includes('wt_session='));
    assert.equal(
      (await fetch(base + '/integrations?project=workspace', { headers: { Cookie: binding } }))
        .status,
      401,
    );
    const integrations = await (
      await fetch(base + '/integrations?project=workspace', { headers: { Cookie: adminCookie } })
    ).json();
    assert.equal(integrations.meta.accounts.length, 1);
    assert.equal(integrations.meta.accounts[0].enabled, false);
    assert.ok(!JSON.stringify(integrations).includes('mock-long-token'));
    assert.ok(!JSON.stringify(integrations).includes('mock-app-secret'));
    const row = db.prepare('SELECT project_id,token_cipher FROM meta_connections').get();
    assert.equal(row.project_id, 'workspace');
    assert.equal(decrypt(row.token_cipher, key), 'mock-long-token');
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM meta_connections WHERE project_id='demo'").get().n,
      0,
    );
    assert.deepEqual(calls, [
      '/v99.0/oauth/access_token',
      '/v99.0/oauth/access_token',
      '/v99.0/me/adaccounts',
    ]);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    restore();
  }
});
