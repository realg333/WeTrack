import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Database from 'libsql';
import { createClient } from '@libsql/client';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { cloudCredentials, initializeCloud } from '../server/cloud.mjs';
import { encrypt } from '../server/meta.mjs';
import { EventEmitter } from 'node:events';
import { afterResponse } from '../server/background.mjs';

test('cloud bootstrap is atomic and idempotent, carries encrypted configuration and excludes the demo', async () => {
  const client = createClient({ url: 'file::memory:' }),
    key = randomBytes(32);
  const snapshot = { projects: [{ id: 'workspace', name: 'Operação publicada', demo: 0 }] };
  try {
    await initializeCloud(client, key, encrypt(JSON.stringify(snapshot), key));
    await client.execute(
      "INSERT INTO campaigns VALUES('cloud-campaign','workspace','Permanente','Meta Ads',0,1,'2026-10-18T00:00:00Z')",
    );
    await initializeCloud(
      client,
      key,
      encrypt(
        JSON.stringify({
          ...snapshot,
          projects: [{ id: 'workspace', name: 'Não substituir', demo: 0 }],
        }),
        key,
      ),
    );
    assert.equal(
      (await client.execute('SELECT name FROM projects')).rows[0].name,
      'Operação publicada',
    );
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM campaigns')).rows[0].n, 1);
    assert.equal(
      (await client.execute("SELECT COUNT(*) AS n FROM projects WHERE id='demo'")).rows[0].n,
      0,
    );
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM admin_sessions')).rows[0].n, 0);
  } finally {
    client.close();
  }
});
test('Turso synchronous driver preserves webhook transactions and sessions survive independent app instances', async () => {
  const db = createDatabase(':memory:', { Driver: Database, seedDemo: false });
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('workspace', 'Teste nuvem', 0);
  const make = () => createApp(db, { password: 'test-cloud-password' }).listen(0, '127.0.0.1'),
    a = make(),
    b = make();
  await Promise.all([a, b].map((s) => new Promise((r) => s.once('listening', r))));
  const url = (s) => `http://127.0.0.1:${s.address().port}/api`;
  try {
    const login = await fetch(url(a) + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-cloud-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await (
      await fetch(url(b) + '/session', { headers: { Cookie: cookie } })
    ).json();
    assert.equal(session.authenticated, true);
    const saved = db.prepare('SELECT id_hash FROM admin_sessions').get();
    assert.ok(!cookie.includes(saved.id_hash));
    const created = await fetch(url(a) + '/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        project_id: 'workspace',
        name: 'Pedidos teste nuvem',
        platform: 'API personalizada',
      }),
    });
    assert.equal(created.status, 201);
    const token = await created.json();
    const order = {
      order_id: 'CLOUD-ORDER-1',
      status: 'approved',
      amount: 12.3,
      product: 'Teste da transação',
    };
    const deliver = () =>
      fetch(url(a) + '/webhooks/' + token.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
    assert.equal((await deliver()).status, 200);
    assert.equal((await (await deliver()).json()).duplicate, true);
    const report = await (
      await fetch(url(b) + '/dashboard?project=workspace', { headers: { Cookie: cookie } })
    ).json();
    assert.equal(report.metrics.revenue, 12.3);
    assert.equal(report.metrics.sales, 1);
    await fetch(url(b) + '/logout', { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(
      (await (await fetch(url(a) + '/session', { headers: { Cookie: cookie } })).json())
        .authenticated,
      false,
    );
    assert.equal((await fetch(url(a) + '/internal/capi-drain')).status, 401);
    db.exec('BEGIN');
    db.prepare('INSERT INTO settings VALUES(?,?)').run('transaction-test', '1');
    db.exec('ROLLBACK');
    assert.equal(
      db.prepare("SELECT value FROM settings WHERE key='transaction-test'").get(),
      undefined,
    );
  } finally {
    await Promise.all([a, b].map((s) => new Promise((r) => s.close(r))));
    db.close();
  }
});
test('cloud credential selection uses injected secrets and rejects unavailable redacted values', () => {
  assert.deepEqual(
    cloudCredentials({
      DATABASE_TURSO_DATABASE_URL: 'libsql://example.turso.io',
      DATABASE_TURSO_AUTH_TOKEN: 'mock-token',
    }),
    { url: 'libsql://example.turso.io', authToken: 'mock-token' },
  );
  assert.throws(
    () => cloudCredentials({ TURSO_DATABASE_URL: '[SENSITIVE]', TURSO_AUTH_TOKEN: '[SENSITIVE]' }),
    /ENV_MISSING/,
  );
});

test('serverless background work survives normal response close and skips aborted responses', async () => {
  const response = new EventEmitter();
  let release,
    done = false;
  const result = afterResponse(
    response,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  ).then(() => {
    done = true;
  });
  response.emit('finish');
  await Promise.resolve();
  response.emit('close');
  await Promise.resolve();
  assert.equal(done, false);
  release();
  await result;
  assert.equal(done, true);
  const aborted = new EventEmitter();
  let called = false;
  const canceled = afterResponse(aborted, () => {
    called = true;
  });
  aborted.emit('close');
  await canceled;
  aborted.emit('finish');
  await Promise.resolve();
  assert.equal(called, false);
});
