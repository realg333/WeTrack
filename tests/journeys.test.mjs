import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { seedAnalyticsDemo } from '../server/demo-analytics.mjs';
import { dateKey } from '../server/domain.mjs';

test('visitor journeys keep ordered sessions, complete search results and project/date isolation', async () => {
  const db = createDatabase(':memory:'),
    server = createApp(db, { password: '' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`,
    day = dateKey();
  const req = async (path, body, method = 'POST', origin) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const origin = 'https://journey.example.com',
      pixel = (await req('/pixels', { project_id: 'workspace', name: 'Journey', domain: origin }))
        .data;
    const collect = (event_id, event_name, page_url, session_id = 'session-0001') =>
      req(
        `/collect/${pixel.id}`,
        {
          event_id,
          visitor_id: 'visitor-journey-1',
          session_id,
          event_name,
          page_url,
          utm_source: 'facebook',
          utm_campaign: 'Campanha jornada',
          page_title: 'Página da oferta',
          referrer: 'https://facebook.com/feed?token=private',
          section: event_name === 'SectionView' ? 'precos' : '',
          target_url:
            event_name === 'Click' ? 'https://pay.example.com/order?email=private@example.com' : '',
        },
        'POST',
        origin,
      );
    const sequence = [
      ['event-0001', 'PageView', origin + '/?email=private@example.com'],
      ['event-0002', 'SectionView', origin + '/'],
      ['event-0003', 'Click', origin + '/'],
      ['event-0004', 'InitiateCheckout', origin + '/'],
      ['event-0005', 'PageView', origin + '/oferta?private=secret'],
      ['event-0006', 'Purchase', origin + '/oferta'],
    ];
    for (const [i, event] of sequence.entries()) {
      assert.equal((await collect(...event, i < 4 ? 'session-0001' : 'session-0002')).status, 200);
      db.prepare('UPDATE events SET created_at=? WHERE id=?').run(
        `${day}T12:${String(i).padStart(2, '0')}:00.000Z`,
        event[0],
      );
    }
    await collect(...sequence[0]); // duplicate IDs cannot append another step/detail.
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM event_details WHERE event_id LIKE ?')
      .get('event-%').n;
    assert.equal(count, 6);
    const oldDay = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
      'event-outside',
      pixel.id,
      'workspace',
      'visitor-journey-1',
      'PageView',
      origin + '/outside',
      'google',
      '',
      `${oldDay}T12:00:00Z`,
      oldDay,
    );
    const params = `project=workspace&start=${day}&end=${day}`;
    const list = (await req(`/visitors?${params}&q=oferta`, null, 'GET')).data;
    assert.equal(list.total, 1);
    assert.equal(list.visitors[0].events, 6);
    assert.equal(list.visitors[0].pages, 2);
    assert.equal(list.visitors[0].sessions, 2);
    assert.equal(list.visitors[0].checkout, 1);
    assert.equal(list.visitors[0].source, 'facebook');
    const journey = (await req(`/visitors/visitor-journey-1?${params}`, null, 'GET')).data;
    assert.deepEqual(
      journey.events.map((e) => e.event_name),
      sequence.map((e) => e[1]),
    );
    assert.equal(journey.events[0].page_url, origin + '/');
    assert.equal(journey.events[0].referrer, 'https://facebook.com/feed');
    assert.equal(journey.events[2].target_url, 'https://pay.example.com/order');
    assert.ok(!JSON.stringify(journey).includes('private@example.com'));
    assert.equal(journey.events[1].section, 'precos');
    assert.equal(
      (await req(`/visitors/visitor-journey-1?project=demo&start=${day}&end=${day}`, null, 'GET'))
        .status,
      404,
    );
    assert.equal(
      (
        await req(
          '/visitors/visitor-journey-1?project=workspace&start=2020-01-01&end=2020-01-01',
          null,
          'GET',
        )
      ).status,
      404,
    );
    assert.equal((await req('/visitors?project=workspace&page=0', null, 'GET')).status, 400);
    const token = (
      await req('/tokens', {
        project_id: 'workspace',
        name: 'Pedidos jornada',
        platform: 'API personalizada',
      })
    ).data;
    const sale = {
      order_id: 'JOURNEY-1',
      product: 'Curso',
      amount: 97,
      status: 'approved',
      visitor_id: 'visitor-journey-1',
    };
    await req(`/webhooks/${token.token}`, sale);
    await req(`/webhooks/${token.token}`, sale);
    await req(`/webhooks/${token.token}`, { ...sale, order_id: 'JOURNEY-2', status: 'pending' });
    const confirmed = (await req(`/visitors/visitor-journey-1?${params}`, null, 'GET')).data;
    assert.equal(confirmed.sales.length, 2);
    const dashboard = (await req(`/dashboard?${params}`, null, 'GET')).data;
    assert.equal(dashboard.metrics.revenue, 97);
    assert.equal(dashboard.funnel.site[0].value, 2);
    assert.equal(dashboard.funnel.site[1].value, 1);
    assert.equal(dashboard.funnel.site[2].value, 1);
    assert.equal(dashboard.funnel.site[3].value, 2);
    assert.equal(dashboard.funnel.site[4].value, 1);
    assert.equal(
      dashboard.funnel.hourly.reduce((s, h) => s + h.sales, 0),
      1,
    );
    // Pagination is server-side and stable, even when timestamps tie.
    for (let n = 0; n < 24; n++)
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
        `page-event-${n}`,
        pixel.id,
        'workspace',
        `pagination-${String(n).padStart(2, '0')}`,
        'PageView',
        origin + '/',
        'direct',
        '',
        `${day}T12:00:00Z`,
        day,
      );
    const p1 = (await req(`/visitors?${params}&q=pagination`, null, 'GET')).data,
      p2 = (await req(`/visitors?${params}&q=pagination&page=2`, null, 'GET')).data;
    assert.equal(p1.total, 24);
    assert.equal(p1.visitors.length, 20);
    assert.equal(p2.visitors.length, 4);
    assert.ok(!p1.visitors.some((v) => p2.visitors.some((w) => v.visitor_id === w.visitor_id)));
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('analytics demo migration is idempotent and child spending never increases dashboard costs', async () => {
  const db = createDatabase(':memory:');
  try {
    const count = () => db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
      initial = count();
    seedAnalyticsDemo(db);
    assert.equal(count(), initial);
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id WHERE c.project_id='workspace'",
        )
        .get().n,
      0,
    );
    const { dashboardReport, hierarchyReport } = await import('../server/reporting.mjs');
    const day = dateKey(),
      p = db.prepare("SELECT * FROM projects WHERE id='demo'").get();
    const report = dashboardReport(db, p, day, day),
      sets = hierarchyReport(db, p.id, day, day, 'adsets', 'c1');
    const parent = report.campaigns.find((c) => c.id === 'c1');
    assert.equal(
      Math.round(sets.reduce((v, s) => v + s.spend, 0) * 100),
      Math.round(parent.spend * 100),
    );
    assert.equal(
      report.metrics.spend,
      Math.round(report.campaigns.reduce((v, c) => v + c.spend, 0) * 100) / 100,
    );
    assert.equal(
      sets.reduce((v, s) => v + s.sales, 0),
      parent.sales,
    );
  } finally {
    db.close();
  }
});
