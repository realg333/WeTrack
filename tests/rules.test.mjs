import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createRuleService } from '../server/rules.mjs';
import { createMetaManagement } from '../server/management.mjs';
import {
  conditionsMatch,
  nextBudget,
  ruleMetrics,
  ruleRange,
  scheduleDue,
} from '../server/rule-model.mjs';
import { dashboardReport } from '../server/reporting.mjs';
import { createApp } from '../server/app.mjs';
import Database from 'libsql';

function fixture(t, databaseOptions = {}) {
  const db = createDatabase(':memory:', { seedDemo: false, ...databaseOptions });
  t.after(() => db.close());
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('workspace', 'Teste regras', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('foreign', 'Outra operação', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run('demo', 'Demonstração', 1);
  const objects = {},
    writes = [],
    flags = {};
  let now = new Date('2026-10-19T15:00:00Z'),
    syncs = 0;
  db.prepare('INSERT INTO meta_connections VALUES(?,?,?,?,?)').run(
    'workspace',
    'encrypted-test-token',
    '[]',
    now.toISOString(),
    null,
  );
  db.prepare('INSERT INTO meta_account_selection VALUES(?,?,?)').run('workspace', 'act_123', 1);
  for (const [id, external, active] of [
    ['bad', '100', 1],
    ['good', '200', 1],
    ['manual-pause', '300', 0],
  ]) {
    db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)').run(
      id,
      'workspace',
      id,
      'Meta Ads',
      50,
      active,
      now.toISOString(),
    );
    db.prepare('INSERT INTO meta_campaigns VALUES(?,?,?)').run(id, external, 'act_123');
    db.prepare('INSERT INTO spend VALUES(?,?,?,?,?)').run(id, '2026-10-19', 120, 1000, 40);
    objects[external] = {
      id: external,
      account_id: '123',
      name: id,
      status: active ? 'ACTIVE' : 'PAUSED',
      effective_status: active ? 'ACTIVE' : 'PAUSED',
      daily_budget: '5000',
    };
  }
  db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)').run(
    'local',
    'workspace',
    'Local',
    'Google Ads',
    0,
    1,
    now.toISOString(),
  );
  function sale(campaign = 'good', status = 'approved', day = '2026-10-19', amount = 150) {
    const id = String(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n + 1);
    db.prepare(
      'INSERT INTO sales(id,project_id,external_id,campaign_id,product,amount,status,created_at,day) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(id, 'workspace', id, campaign, 'Produto teste', amount, status, `${day}T14:00:00Z`, day);
  }
  sale();
  sale();
  sale();
  sale('bad', 'pending');
  sale('bad', 'refunded');
  const management = createMetaManagement(
    db,
    async (external, token, params, method) => {
      assert.equal(token, 'mock-only');
      assert(objects[external], 'Never send traffic to live Meta');
      if (method === 'POST') {
        writes.push({ external, params });
        if (flags.deny)
          throw Object.assign(new Error('Meta: 200. Sem permissão.'), { status: 502 });
        if (!flags.ignoreWrite) {
          Object.assign(objects[external], params);
          objects[external].effective_status = objects[external].status;
        }
        return { success: true };
      }
      flags.onRead?.();
      return structuredClone(objects[external]);
    },
    () => [
      {
        id: 'act_123',
        enabled: Boolean(db.prepare('SELECT enabled FROM meta_account_selection').get()?.enabled),
        supported: true,
        account_status: 1,
        name: 'Teste',
      },
    ],
    () => 'mock-only',
  );
  const meta = {
    management,
    sync: async () => {
      syncs++;
      if (flags.syncError) throw new Error('No sync');
      await flags.onSync?.();
      db.prepare('UPDATE meta_connections SET last_sync=?').run(now.toISOString());
    },
  };
  const options = { clock: () => now };
  const service = createRuleService(db, meta, options);
  const rule = (patch = {}) => ({
    project_id: 'workspace',
    name: 'Gasto sem vendas',
    action: 'pause',
    active: true,
    period: 'today',
    conditions: [
      { metric: 'spend', operator: 'gt', threshold: 100 },
      { metric: 'sales', operator: 'lt', threshold: 2 },
    ],
    ...patch,
  });
  const advance = (minutes) => {
    now = new Date(now.getTime() + minutes * 60000);
  };
  return {
    db,
    service,
    rule,
    objects,
    writes,
    flags,
    meta,
    options,
    sale,
    advance,
    syncs: () => syncs,
  };
}

test('rules use AND, approved attributed sales and an independent Brasília period; undefined ratios never match', (t) => {
  const f = fixture(t);
  const row = f.db.prepare('SELECT * FROM campaigns WHERE id=?').get('bad');
  const m = ruleMetrics(f.db, row, 'today', new Date('2026-10-19T15:00:00Z'));
  assert.equal(m.sales, 0);
  assert.equal(m.cpa, null);
  assert.equal(m.roas, 0);
  assert.equal(conditionsMatch(f.service.parse(f.rule()), m), true);
  assert.equal(
    conditionsMatch(
      f.service.parse(f.rule({ conditions: [{ metric: 'cpa', operator: 'lt', threshold: 100 }] })),
      m,
    ),
    false,
  );
  assert.equal(conditionsMatch(f.service.parse(f.rule({ min_spend: 200 })), m), false);
  assert.deepEqual(ruleRange('today', new Date('2026-10-20T01:00:00Z')), {
    start: '2026-10-19',
    end: '2026-10-19',
  });
  assert.deepEqual(ruleRange('7d', new Date('2026-10-19T15:00:00Z')), {
    start: '2026-10-13',
    end: '2026-10-19',
  });
  f.service.save(f.rule({ action: 'alert' }));
  assert.deepEqual(
    dashboardReport(f.db, { id: 'workspace' }, '2026-09-01', '2026-09-02').rules[0].matches,
    ['bad'],
  );
});

test('preview never writes or synchronizes, validates scope and defaults automated rules to inactive', (t) => {
  const f = fixture(t);
  const result = f.service.preview(f.rule());
  assert.deepEqual(
    result.matches.map((c) => c.id),
    ['bad'],
  );
  assert.equal(f.syncs(), 0);
  assert.equal(f.writes.length, 0);
  const input = f.rule();
  delete input.active;
  const { id } = f.service.save(input);
  assert.equal(f.db.prepare('SELECT active FROM rules WHERE id=?').get(id).active, 0);
  assert.throws(() => f.service.save(f.rule({ campaign_ids: ['foreign-campaign'] })));
  assert.throws(() =>
    f.service.save(f.rule({ conditions: [{ metric: 'sales', operator: 'lt', threshold: 1.5 }] })),
  );
  assert.throws(() => f.service.save(f.rule({ conditions: [] })));
});

test('pause synchronizes first, confirms Meta status, preserves winners and deduplicates executions', async (t) => {
  const f = fixture(t);
  f.service.save(f.rule());
  assert.deepEqual(await f.service.run('workspace'), { success: 1, failures: 0, error: null });
  assert.equal(f.syncs(), 1);
  assert.deepEqual(f.writes, [{ external: '100', params: { status: 'PAUSED' } }]);
  assert.equal(f.objects['200'].status, 'ACTIVE');
  assert.equal(f.db.prepare('SELECT mode FROM rule_campaign_state').get().mode, 'pause');
  assert.equal((await f.service.run('workspace')).skipped, true);
  await f.service.run('workspace', { force: true });
  assert.equal(f.writes.length, 1);
  assert.equal(f.service.history('workspace')[0].status, 'success');
});

test('stale spending is never used after sync failure and denied/unconfirmed writes never claim success', async (t) => {
  const f = fixture(t);
  f.service.save(f.rule());
  f.flags.syncError = true;
  assert.equal((await f.service.run('workspace')).failures, 1);
  assert.equal(f.writes.length, 0);
  assert.equal(f.service.history('workspace').length, 0);
  f.flags.syncError = false;
  f.flags.deny = true;
  await f.service.run('workspace', { force: true });
  assert.equal(f.service.history('workspace')[0].status, 'error');
  assert.equal(f.db.prepare('SELECT active FROM campaigns WHERE id=?').get('bad').active, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rule_campaign_state').get().n, 0);
  f.advance(61);
  f.flags.deny = false;
  f.flags.ignoreWrite = true;
  await f.service.run('workspace');
  assert.equal(f.service.history('workspace')[0].status, 'error');
  assert.equal(f.db.prepare('SELECT active FROM campaigns WHERE id=?').get('bad').active, 1);
});

test('pause protections and cooldown prevent flapping; only campaigns paused by rules can resume', async (t) => {
  const f = fixture(t);
  const pause = f.service.save(f.rule());
  await f.service.run('workspace');
  f.service.save(
    f.rule({
      name: 'Retomar',
      action: 'resume',
      conditions: [{ metric: 'spend', operator: 'gte', threshold: 0 }],
    }),
  );
  f.advance(61);
  await f.service.run('workspace');
  assert.equal(f.writes.length, 1, 'active pause condition blocks resume');
  f.db.prepare('UPDATE rules SET active=0 WHERE id=?').run(pause.id);
  await f.service.run('workspace', { force: true });
  assert.equal(f.writes.at(-1).params.status, 'ACTIVE');
  assert.equal(f.objects['300'].status, 'PAUSED', 'manual pause is never resumed');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rule_campaign_state').get().n, 0);
});

test('stop outranks pause/resume and survives rule deletion until a confirmed manual reactivation', async (t) => {
  const f = fixture(t);
  f.service.save(f.rule());
  const stop = f.service.save(f.rule({ name: 'Corte', action: 'stop' }));
  f.service.save(
    f.rule({
      name: 'Retomar',
      action: 'resume',
      conditions: [{ metric: 'spend', operator: 'gte', threshold: 0 }],
    }),
  );
  await f.service.run('workspace');
  assert.equal(f.db.prepare('SELECT mode FROM rule_campaign_state').get().mode, 'stop');
  f.db.prepare('DELETE FROM rules WHERE id=?').run(stop.id);
  f.db.prepare("UPDATE rules SET active=0 WHERE name='Gasto sem vendas'").run();
  f.advance(61);
  await f.service.run('workspace');
  assert.equal(f.writes.length, 1);
  const before = await f.meta.management.inspect('workspace', 'campaigns', 'bad');
  await f.meta.management.update('workspace', 'campaigns', 'bad', {
    active: true,
    expected_revision: before.revision,
  });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rule_campaign_state').get().n, 0);
});

test('daily resume observes Brasília schedule, cooldown and the once-per-day limit', async (t) => {
  const f = fixture(t);
  f.objects['100'].status = f.objects['100'].effective_status = 'PAUSED';
  f.db.prepare("UPDATE campaigns SET active=0 WHERE id='bad'").run();
  f.db
    .prepare('INSERT INTO rule_campaign_state VALUES(?,?,?,?)')
    .run('bad', 'pause', 'prior', '2026-10-19T13:30:00Z');
  f.service.save(
    f.rule({ name: 'Retomar às 12h', action: 'resume', schedule_time: '12:00', conditions: [] }),
  );
  assert.equal(scheduleDue({ schedule_time: '07:00' }, new Date('2026-10-19T10:59:00Z')), true);
  assert.equal(scheduleDue({ schedule_time: '07:00' }, new Date('2026-10-19T11:00:00Z')), false);
  await f.service.run('workspace');
  assert.equal(f.writes.length, 1);
  f.objects['100'].status = f.objects['100'].effective_status = 'PAUSED';
  f.db.prepare("UPDATE campaigns SET active=0 WHERE id='bad'").run();
  f.db
    .prepare('INSERT INTO rule_campaign_state VALUES(?,?,?,?)')
    .run('bad', 'pause', 'prior', '2026-10-19T13:30:00Z');
  f.advance(20);
  await f.service.run('workspace');
  assert.equal(
    f.writes.length,
    1,
    'scheduled resume happens at most once a day even after another pause',
  );
});

test('database lease serializes independent workers and disabled/changed rules are checked before the write', async (t) => {
  const f = fixture(t),
    saved = f.service.save(f.rule());
  let release, started;
  const ready = new Promise((r) => {
    started = r;
  });
  f.flags.onSync = () => {
    started();
    return new Promise((r) => {
      release = r;
    });
  };
  const first = f.service.run('workspace');
  await ready;
  const other = createRuleService(f.db, f.meta, f.options);
  assert.equal((await other.run('workspace', { force: true })).skipped, true);
  f.flags.onRead = () => f.db.prepare('UPDATE rules SET active=0 WHERE id=?').run(saved.id);
  release();
  await first;
  assert.equal(f.writes.length, 0);
  assert.equal(f.db.prepare('SELECT lease_until FROM rule_worker_state').get().lease_until, 0);
});

test('a newly approved sale during Meta reads cancels a zero-sale pause before sending it', async (t) => {
  const f = fixture(t);
  f.service.save(
    f.rule({
      conditions: [
        { metric: 'spend', operator: 'gt', threshold: 100 },
        { metric: 'sales', operator: 'eq', threshold: 0 },
      ],
    }),
  );
  let reads = 0;
  f.flags.onRead = () => {
    reads++;
    if (reads === 2) f.sale('bad');
  };
  await f.service.run('workspace');
  assert.equal(f.writes.length, 0);
});

test('production libsql driver supports durable rule configuration, leases, history and confirmed pauses', async (t) => {
  const f = fixture(t, { Driver: Database });
  f.service.save(f.rule({ campaign_ids: ['bad'] }));
  const result = await f.service.run('workspace');
  assert.equal(result.success, 1);
  assert.equal(result.failures, 0);
  assert.equal(f.db.prepare('SELECT mode FROM rule_campaign_state').get().mode, 'pause');
  assert.equal(f.service.history('workspace')[0].status, 'success');
});

test('scope restrictions and the global pause cooldown apply to new resume rules', async (t) => {
  const f = fixture(t);
  const pause = f.service.save(f.rule({ campaign_ids: ['bad'] }));
  await f.service.run('workspace');
  f.db.prepare('UPDATE rules SET active=0 WHERE id=?').run(pause.id);
  f.service.save(
    f.rule({
      name: 'Retomar cedo',
      action: 'resume',
      campaign_ids: ['bad'],
      conditions: [{ metric: 'spend', operator: 'gte', threshold: 0 }],
    }),
  );
  await f.service.run('workspace', { force: true });
  assert.equal(f.writes.length, 1, 'a new resume rule cannot bypass the campaign cooldown');
  f.advance(61);
  await f.service.run('workspace');
  assert.equal(f.writes.length, 2);
  assert.equal(f.objects['300'].status, 'PAUSED');
});

test('rule HTTP endpoints require sessions, isolate operations and protect the scheduler secret', async (t) => {
  const f = fixture(t),
    app = createApp(f.db, { password: 'test-rules', serverless: true }),
    server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  assert.equal((await fetch(`${base}/rules?project=workspace`)).status, 401);
  assert.equal((await fetch(`${base}/internal/rules-run`)).status, 401);
  const previousSecret = process.env.RULES_CRON_SECRET;
  process.env.RULES_CRON_SECRET = 'scheduler-test-secret';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.RULES_CRON_SECRET;
    else process.env.RULES_CRON_SECRET = previousSecret;
  });
  let schedulerInvoked = false;
  app.locals.rules.runAll = async () => {
    schedulerInvoked = true;
    return [];
  };
  const diagnostic = await fetch(`${base}/internal/rules-run?check_only=1`, {
    headers: { Authorization: 'Bearer scheduler-test-secret' },
  });
  assert.equal(diagnostic.status, 200);
  assert.deepEqual(await diagnostic.json(), { ok: true, check_only: true });
  assert.equal(schedulerInvoked, false, 'diagnostics cannot run or mutate campaigns');
  const login = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-rules' }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (path, method = 'GET', body) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const created = await call('/rules', 'POST', f.rule({ active: false }));
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(
    (await call(`/rules/${id}`, 'PATCH', { project_id: 'foreign', active: true })).status,
    404,
  );
  assert.equal((await call(`/rules/${id}?project=foreign`, 'DELETE')).status, 404);
  assert.equal((await call(`/rules/${id}`, 'PUT', f.rule({ project_id: 'foreign' }))).status, 404);
  assert.equal(
    (await call(`/rules/${id}`, 'PUT', f.rule({ name: 'Editada', active: false }))).status,
    200,
  );
  const report = await (await call('/rules?project=workspace')).json();
  assert.equal(report.rules[0].name, 'Editada');
  assert.equal((await call('/rules/preview', 'POST', f.rule())).status, 200);
  assert.equal((await call(`/rules/${id}?project=workspace`, 'DELETE')).status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rule_configs').get().n, 0);
});

test('nextBudget applies percent, fixed amount, cap and the R$ 1 floor', () => {
  const up = { mode: 'percent', amount: 20, limit: null };
  assert.equal(nextBudget(50, up, 'increase_budget'), 60);
  assert.equal(nextBudget(50, { ...up, limit: 55 }, 'increase_budget'), 55);
  assert.equal(nextBudget(55, { ...up, limit: 55 }, 'increase_budget'), null);
  assert.equal(nextBudget(50, { mode: 'percent', amount: 80, limit: null }, 'decrease_budget'), 10);
  assert.equal(nextBudget(50, { mode: 'fixed', amount: 15, limit: 40 }, 'decrease_budget'), 40);
  assert.equal(
    nextBudget(50, { mode: 'percent', amount: 99, limit: null }, 'decrease_budget'),
    null,
  );
  assert.equal(nextBudget(0, up, 'increase_budget'), null);
});

test('budget rules scale CBO within the cap and a killed campaign stays blocked', async (t) => {
  const f = fixture(t);
  const change = { mode: 'percent', amount: 20, limit: 55 };
  f.db
    .prepare('INSERT INTO rule_campaign_state VALUES(?,?,?,?)')
    .run('bad', 'stop', 'prior', '2026-10-19T12:00:00Z');
  const blocked = f.service.preview(
    f.rule({ name: 'Escala', action: 'increase_budget', budget_change: change }),
  );
  assert.match(blocked.matches[0].blocked, /Corte definitivo/);
  f.db.prepare('DELETE FROM rule_campaign_state').run();
  f.service.save(f.rule({ name: 'Escala', action: 'increase_budget', budget_change: change }));
  assert.deepEqual(await f.service.run('workspace'), { success: 1, failures: 0, error: null });
  assert.deepEqual(f.writes, [{ external: '100', params: { daily_budget: 5500 } }]);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rule_campaign_state').get().n, 0);
  assert.equal(f.objects['200'].daily_budget, '5000');
  f.advance(61);
  await f.service.run('workspace');
  assert.equal(f.writes.length, 1);
  assert.equal(f.service.history('workspace')[0].status, 'skipped');
  assert.throws(() =>
    f.service.save(
      f.rule({
        name: 'Redução inválida',
        action: 'decrease_budget',
        budget_change: { mode: 'percent', amount: 100, limit: null },
      }),
    ),
  );
});

test('alert push preference is stored and campaign rules do not keep it', (t) => {
  const f = fixture(t);
  const alert = f.service.save(f.rule({ action: 'alert', notify_push: false }));
  const pause = f.service.save(f.rule({ name: 'Pausa sem push', notify_push: true }));
  const read = (id) =>
    JSON.parse(f.db.prepare('SELECT config FROM rule_configs WHERE rule_id=?').get(id).config);
  assert.equal(read(alert.id).notify_push, false);
  assert.equal(read(alert.id).action, 'alert');
  assert.equal(read(pause.id).notify_push, false);
  assert.equal(read(pause.id).budget_change, null);
});
