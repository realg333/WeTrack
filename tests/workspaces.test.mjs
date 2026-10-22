import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Database from 'libsql';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { encrypt } from '../server/meta.mjs';
import { dateKey } from '../server/domain.mjs';

async function fixture(t, options = {}) {
  const db = createDatabase(':memory:', { seedDemo: false, ...options });
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('workspace', 'Operação original', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('demo', 'Exemplo', 1);
  const key = randomBytes(32);
  const server = createApp(db, { password: options.password || '', secretKey: key }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const request = async (path, body, method = body ? 'POST' : 'GET', headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  const dashboard = (id) => request(`/dashboard?project=${id}&start=${dateKey()}&end=${dateKey()}`);
  return { db, key, request, dashboard };
}

for (const Driver of [undefined, Database]) {
  test(`workspace creation and renaming validate names and preserve data (${Driver ? 'production libsql' : 'SQLite'})`, async (t) => {
    const { db, request, dashboard } = await fixture(t, { Driver });
    const stable = (value) =>
      JSON.stringify(value, (key, item) => (key === '_metadata' ? undefined : item));
    const before = stable((await dashboard('workspace')).data);
    const created = await request('/projects', { name: '  Nova operação  ' });
    assert.equal(created.status, 201);
    assert.match(created.data.id, /^ws_/);
    assert.equal(created.data.name, 'Nova operação');
    assert.equal(created.data.demo, 0);
    const clean = (await dashboard(created.data.id)).data;
    for (const value of Object.values(clean.metrics)) assert.equal(value, 0);
    for (const key of ['sales', 'campaigns', 'rules', 'sources', 'pages'])
      assert.equal(clean[key].length, 0);
    assert.equal(stable((await dashboard('workspace')).data), before);
    for (const name of ['', ' ', 'x', 'x'.repeat(81)])
      assert.equal((await request('/projects', { name })).status, 400);
    assert.equal((await request('/projects', { name: 'NOVA OPERAÇÃO' })).status, 409);
    assert.equal((await request('/projects', { name: 'Invalid', demo: 1 })).status, 400);
    assert.equal(
      (await request('/projects', { name: 'Missing source', reuse_meta_from: 'missing' })).status,
      404,
    );
    assert.equal(
      (await request('/projects', { name: 'Demo source', reuse_meta_from: 'demo' })).status,
      400,
    );
    assert.equal(
      (await request(`/projects/${created.data.id}`, { name: 'Operação original' }, 'PATCH'))
        .status,
      409,
    );
    assert.equal((await request('/projects/missing', { name: 'Novo nome' }, 'PATCH')).status, 404);
    assert.equal((await request('/projects/demo', { name: 'Novo nome' }, 'PATCH')).status, 400);
    const renamed = await request(`/projects/${created.data.id}`, { name: 'Operação B' }, 'PATCH');
    assert.equal(renamed.data.id, created.data.id);
    assert.equal(renamed.data.name, 'Operação B');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 3);
    assert.ok(
      (await request('/projects')).data.some(
        (p) => p.id === created.data.id && p.name === 'Operação B',
      ),
    );
  });
}

test('reusing Meta authorization copies no history, credentials stay private and account activation is independent', async (t) => {
  const { db, key, request, dashboard } = await fixture(t);
  const accounts = JSON.stringify([
    { id: 'act_123', name: 'Minha conta', currency: 'BRL', account_status: 1 },
  ]);
  const cipher = encrypt('private-meta-access-token', key);
  db.prepare('INSERT INTO meta_connections VALUES(?,?,?,?,?)').run(
    'workspace',
    cipher,
    accounts,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO meta_account_selection VALUES(?,?,?)').run('workspace', 'act_123', 1);
  const fresh = (await request('/projects', { name: 'Sem conexão' })).data;
  assert.equal((await request(`/integrations?project=${fresh.id}`)).data.meta.connected, false);
  const created = await request('/projects', {
    name: 'Com autorização',
    reuse_meta_from: 'workspace',
  });
  assert.equal(created.status, 201);
  assert.ok(!JSON.stringify(created.data).includes(cipher));
  const project = created.data.id;
  const integrations = (await request(`/integrations?project=${project}`)).data;
  assert.equal(integrations.meta.connected, true);
  assert.equal(integrations.meta.accounts.length, 1);
  assert.equal(integrations.meta.accounts[0].enabled, false);
  assert.ok(!JSON.stringify(integrations).includes('private-meta-access-token'));
  assert.equal(integrations.pixels.length, 0);
  assert.equal(integrations.tokens.length, 0);
  assert.equal(integrations.providers.length, 0);
  assert.equal(
    db.prepare('SELECT last_sync FROM meta_connections WHERE project_id=?').get(project).last_sync,
    null,
  );
  await request('/meta/accounts/act_123', { project_id: project, enabled: true }, 'PUT');
  await request('/meta/accounts/act_123', { project_id: 'workspace', enabled: false }, 'PUT');
  assert.equal(
    (await request(`/integrations?project=${project}`)).data.meta.accounts[0].enabled,
    true,
  );
  assert.equal((await dashboard(project)).data.metrics.spend, 0);
  await request(`/meta/${project}`, null, 'DELETE');
  assert.equal((await request('/integrations?project=workspace')).data.meta.connected, true);
});

test('sales, pixel events, fees and preferences stay isolated across newly created workspaces', async (t) => {
  const { request, dashboard } = await fixture(t);
  const project = (await request('/projects', { name: 'Outra operação' })).data.id;
  const prefs = {
    name: 'Conta original',
    email: 'original@example.com',
    sale_alerts: false,
    rule_alerts: false,
  };
  await request('/settings', prefs, 'PUT');
  assert.equal((await request('/settings?project=workspace')).data.name, prefs.name);
  assert.deepEqual((await request(`/settings?project=${project}`)).data, {});
  await request('/settings', { ...prefs, name: 'Conta nova', project_id: project }, 'PUT');
  assert.equal((await request('/settings?project=workspace')).data.name, prefs.name);
  assert.equal((await request(`/settings?project=${project}`)).data.name, 'Conta nova');
  await request('/fees', { project_id: 'workspace', gateway_percent: 10, tax_percent: 5 }, 'PUT');
  const originalFees = (await request('/fees?project=workspace')).data;
  assert.notDeepEqual((await request(`/fees?project=${project}`)).data, originalFees);
  for (const [workspace, amount] of [
    ['workspace', 100],
    [project, 250],
  ]) {
    const pixel = (
      await request('/pixels', {
        project_id: workspace,
        name: 'Meu pixel',
        domain: 'https://example.com',
      })
    ).data;
    const token = (
      await request('/tokens', {
        project_id: workspace,
        name: 'Checkout',
        platform: 'API personalizada',
      })
    ).data;
    await request(`/webhooks/${token.token}`, {
      order_id: 'same-order',
      status: 'approved',
      product: 'Produto',
      amount,
    });
    const event = await request(
      `/collect/${pixel.id}`,
      {
        event_id: `event-${workspace}`,
        visitor_id: 'same-visitor',
        event_name: 'PageView',
        page_url: 'https://example.com',
      },
      'POST',
      { Origin: 'https://example.com' },
    );
    assert.equal(event.status, 200);
    const report = (await dashboard(workspace)).data;
    assert.equal(report.metrics.revenue, amount);
    assert.equal(report.metrics.visits, 1);
    assert.equal(report.sales.length, 1);
    assert.equal((await request(`/integrations?project=${workspace}`)).data.pixels.length, 1);
    await request(`/pixels/${pixel.id}`, { active: false }, 'PATCH');
    assert.equal(
      (
        await request(`/collect/${pixel.id}`, {
          event_name: 'PageView',
          visitor_id: 'paused',
          page_url: 'https://example.com',
        })
      ).status,
      404,
    );
  }
  assert.equal((await dashboard('workspace')).data.metrics.revenue, 100);
  assert.equal((await dashboard(project)).data.metrics.revenue, 250);
});

test('workspace management requires the administrator session', async (t) => {
  const { request } = await fixture(t, { password: 'test-password' });
  assert.equal((await request('/projects')).status, 401);
  assert.equal((await request('/projects', { name: 'Unauthorized' })).status, 401);
  assert.equal(
    (await request('/projects/workspace', { name: 'Unauthorized' }, 'PATCH')).status,
    401,
  );
});
