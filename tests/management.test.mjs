import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { encrypt } from '../server/meta.mjs';

async function fixture(t, currency = 'BRL') {
  const previous = process.env.META_GRAPH_VERSION;
  process.env.META_GRAPH_VERSION = 'v99.0';
  const db = createDatabase(':memory:'),
    key = randomBytes(32),
    writes = [];
  const objects = {
    100: {
      id: '100',
      account_id: '123',
      name: 'Campanha Meta',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      daily_budget: '5000',
      lifetime_budget: '0',
    },
    200: {
      id: '200',
      account_id: '123',
      campaign_id: '100',
      name: 'Conjunto Meta',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
      daily_budget: '2000',
      lifetime_budget: '0',
    },
    300: {
      id: '300',
      account_id: '123',
      campaign_id: '100',
      adset_id: '200',
      name: 'Anúncio Meta',
      status: 'ACTIVE',
      effective_status: 'ACTIVE',
    },
  };
  db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)').run(
    'managed',
    'workspace',
    'Campanha Meta',
    'Meta Ads',
    50,
    1,
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO meta_campaigns VALUES(?,?,?)').run('managed', '100', 'act_123');
  db.prepare('INSERT INTO ad_sets VALUES(?,?,?,?,?,?)').run(
    'set-managed',
    'managed',
    '200',
    'Conjunto Meta',
    1,
    20,
  );
  db.prepare('INSERT INTO ads VALUES(?,?,?,?,?)').run(
    'ad-managed',
    'set-managed',
    '300',
    'Anúncio Meta',
    1,
  );
  db.prepare('INSERT INTO meta_connections VALUES(?,?,?,?,?)').run(
    'workspace',
    encrypt('fake-management-token', key),
    JSON.stringify([{ id: 'act_123', name: 'Conta de teste', currency, account_status: 1 }]),
    new Date().toISOString(),
    null,
  );
  db.prepare('INSERT INTO meta_account_selection VALUES(?,?,?)').run('workspace', 'act_123', 1);
  const flags = {};
  const transport = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fake-management-token');
    assert(!String(url).includes('fake-management-token'));
    const external = new URL(url).pathname.split('/').at(-1);
    assert(objects[external], 'All Meta traffic must remain mocked');
    if (options.method === 'POST') {
      const changes = JSON.parse(options.body);
      writes.push({ external, changes });
      if (flags.deny)
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: { code: 200, message: 'Denied' } }),
        };
      if (flags.timeout) throw new Error('Network interrupted');
      if (!flags.ignoreWrite) {
        Object.assign(objects[external], changes);
        if (changes.status) objects[external].effective_status = changes.status;
      }
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (flags.afterReadError && writes.length) throw new Error('Read unavailable');
    if (flags.disableOnRead) db.prepare('UPDATE meta_account_selection SET enabled=0').run();
    return { ok: true, json: async () => structuredClone(objects[external]) };
  };
  const server = createApp(db, { password: '', secretKey: key, transport }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    db.close();
    if (previous === undefined) delete process.env.META_GRAPH_VERSION;
    else process.env.META_GRAPH_VERSION = previous;
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, body) => {
    const response = await fetch(base + path, {
      ...(body ? { method: 'PATCH', body: JSON.stringify(body) } : {}),
      headers: { 'Content-Type': 'application/json' },
    });
    return { status: response.status, data: await response.json() };
  };
  const inspect = async (level = 'campaigns', id = 'managed') =>
    call(`/meta/entities/${level}/${id}?project=workspace`);
  const update = async (changes, level = 'campaigns', id = 'managed', revision) =>
    call(`/meta/entities/${level}/${id}`, {
      project_id: 'workspace',
      expected_revision: revision || (await inspect(level, id)).data.revision,
      ...changes,
    });
  return { db, objects, writes, flags, inspect, update, call };
}

test('Meta writes daily and lifetime budgets in cents and confirms status and names at all levels', async (t) => {
  const f = await fixture(t);
  const daily = await f.update({ budget: 73.29, name: 'Novo nome', active: false });
  assert.equal(daily.status, 200);
  assert.equal(daily.data.confirmed, true);
  assert.deepEqual(f.writes[0], {
    external: '100',
    changes: { name: 'Novo nome', status: 'PAUSED', daily_budget: 7329 },
  });
  assert.equal(
    f.db.prepare('SELECT budget,active FROM campaigns WHERE id=?').get('managed').budget,
    73.29,
  );
  f.objects[100].daily_budget = '0';
  f.objects[100].lifetime_budget = '10000';
  const total = await f.update({ budget: 240.37 });
  assert.equal(total.status, 200);
  assert.deepEqual(f.writes.at(-1).changes, { lifetime_budget: 24037 });
  assert.equal(total.data.entity.budget_type, 'lifetime');
  assert.equal(f.db.prepare('SELECT budget FROM campaigns WHERE id=?').get('managed').budget, 0);
  f.objects[100].lifetime_budget = '0';
  assert.equal(
    (await f.update({ budget: 36.15, active: false }, 'adsets', 'set-managed')).status,
    200,
  );
  assert.deepEqual(f.writes.at(-1).changes, { status: 'PAUSED', daily_budget: 3615 });
  assert.equal(
    (await f.update({ active: false, name: 'Anúncio editado' }, 'ads', 'ad-managed')).status,
    200,
  );
  assert.equal(f.db.prepare('SELECT name,active FROM ads WHERE id=?').get('ad-managed').active, 0);
});

test('Meta rejects stale revisions and inherited budgets without sending writes', async (t) => {
  const f = await fixture(t),
    before = (await f.inspect()).data;
  f.objects[100].daily_budget = '6000';
  assert.equal(
    (await f.update({ budget: 90 }, 'campaigns', 'managed', before.revision)).status,
    409,
  );
  assert.equal((await f.update({ budget: 30 }, 'adsets', 'set-managed')).status, 400);
  assert.equal((await f.update({ budget: 30 }, 'ads', 'ad-managed')).status, 400);
  f.objects[100].daily_budget = '0';
  assert.equal((await f.update({ budget: 30 })).status, 400);
  assert.equal(f.writes.length, 0);
});

test('Meta rejects disabled, foreign, disconnected and moved entities before writing', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/meta/entities/campaigns/managed?project=demo')).status, 404);
  assert.equal((await f.inspect('campaigns', 'c1')).status, 404);
  f.objects[100].account_id = '456';
  assert.equal((await f.inspect()).status, 409);
  f.objects[100].account_id = '123';
  f.objects[300].adset_id = '999';
  assert.equal((await f.inspect('ads', 'ad-managed')).status, 409);
  f.db.prepare('UPDATE meta_account_selection SET enabled=0').run();
  assert.equal((await f.inspect()).status, 403);
  f.db.prepare('DELETE FROM meta_connections').run();
  assert.equal((await f.inspect()).status, 403);
  assert.equal(f.writes.length, 0);
});

test('Meta selection is checked again before a write and archived objects stay immutable', async (t) => {
  const f = await fixture(t),
    revision = (await f.inspect()).data.revision;
  f.flags.disableOnRead = true;
  assert.equal((await f.update({ active: false }, 'campaigns', 'managed', revision)).status, 403);
  f.flags.disableOnRead = false;
  f.db.prepare('UPDATE meta_account_selection SET enabled=1').run();
  f.objects[100].status = 'ARCHIVED';
  assert.equal((await f.update({ active: true })).status, 400);
  assert.equal(f.writes.length, 0);
});

test('Meta failures and unconfirmed results never update the local cache', async (t) => {
  const f = await fixture(t);
  f.flags.deny = true;
  assert.equal((await f.update({ budget: 88 })).status, 502);
  f.flags.deny = false;
  f.flags.timeout = true;
  const timeout = await f.update({ budget: 88 });
  assert.equal(timeout.status, 409);
  assert.match(timeout.data.error, /interrompida/);
  f.flags.timeout = false;
  f.flags.ignoreWrite = true;
  assert.equal((await f.update({ budget: 88 })).status, 409);
  f.flags.ignoreWrite = false;
  f.writes.length = 0;
  f.flags.afterReadError = true;
  assert.equal((await f.update({ budget: 88 })).status, 409);
  assert.equal(f.db.prepare('SELECT budget FROM campaigns WHERE id=?').get('managed').budget, 50);
});

test('Meta HTTP validation and legacy routes cannot silently bypass the management flow', async (t) => {
  const f = await fixture(t);
  const revision = (await f.inspect()).data.revision;
  for (const budget of [0, -1, 1.001, 1000001])
    assert.equal((await f.update({ budget }, 'campaigns', 'managed', revision)).status, 400);
  assert.equal((await f.update({ name: ' ' })).status, 400);
  assert.equal((await f.update({ access_token: 'untrusted-token' })).status, 400);
  assert.equal((await f.call('/campaigns/managed', { active: false })).status, 409);
  assert.equal(
    (await f.call('/ad-entities/adsets/set-managed', { project_id: 'workspace', active: false }))
      .status,
    409,
  );
  assert.equal(
    (await f.call('/ad-entities/ads/ad-managed', { project_id: 'workspace', active: false }))
      .status,
    409,
  );
  assert.equal(f.writes.length, 0);
});

test('USD management keeps budgets in dollars and sends dollar cents to Meta', async (t) => {
  const f = await fixture(t, 'USD');
  const current = await f.inspect();
  assert.equal(current.data.currency, 'USD');
  const result = await f.update({ budget: 17.23 });
  assert.equal(result.status, 200);
  assert.equal(result.data.entity.currency, 'USD');
  assert.equal(result.data.entity.budget, 17.23);
  assert.deepEqual(f.writes[0].changes, { daily_budget: 1723 });
});
