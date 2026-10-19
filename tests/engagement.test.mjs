import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey } from '../server/domain.mjs';
import { initializeCloud } from '../server/cloud.mjs';

test('journey consolidates cumulative timing, orders client steps and isolates visitors', async () => {
  const db = createDatabase(':memory:');
  const server = createApp(db, { password: '' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const origin = 'https://engagement.example.com';
  const day = dateKey();
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(path.startsWith('/collect/') ? { Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const pixel = (
      await request('/pixels', { project_id: 'workspace', name: 'Tempo', domain: origin })
    ).data;
    const collect = (event_id, event_name, extra = {}) =>
      request(`/collect/${pixel.id}`, {
        event_id,
        event_name,
        visitor_id: 'visitor-engagement',
        session_id: 'session-engagement',
        page_view_id: 'page-view-one',
        page_url: origin + '/oferta?email=private',
        duration_ms: 0,
        active_ms: 0,
        scroll_depth: 0,
        ...extra,
      });
    assert.equal(
      (await collect('timing-view-1', 'PageView', { occurred_at: `${day}T12:00:00.000Z` })).status,
      200,
    );
    // An exit can arrive before an earlier scroll event.
    await collect('timing-exit-1', 'PageExit', {
      duration_ms: 35000,
      active_ms: 30000,
      scroll_depth: 75,
      occurred_at: `${day}T12:00:35.000Z`,
      reason: 'exit',
    });
    await collect('timing-scroll', 'ScrollDepth', {
      duration_ms: 15000,
      active_ms: 15000,
      scroll_depth: 75,
      occurred_at: `${day}T12:00:15.000Z`,
    });
    for (const duration_ms of [15000, 30000])
      await collect(`heartbeat-${duration_ms}`, 'PageEngagement', {
        duration_ms,
        active_ms: duration_ms,
        scroll_depth: 50,
        reason: 'heartbeat',
      });
    await collect('timing-return', 'CheckoutReturn', {
      away_ms: 45000,
      target_url: 'https://pay.example.com/offer?email=private',
      occurred_at: `${day}T12:01:20.000Z`,
      reason: 'after_checkout_click',
    });
    await collect('timing-view-2', 'PageView', {
      page_view_id: 'page-view-two',
      page_url: origin + '/oferta',
    });
    await collect('timing-next-exit', 'PageExit', {
      page_view_id: 'page-view-two',
      duration_ms: 5000,
      active_ms: 5000,
    });
    await collect('other-visitor-event', 'PageEngagement', {
      visitor_id: 'visitor-other',
      duration_ms: 999999,
      active_ms: 999999,
      scroll_depth: 100,
    });
    // Duplicate IDs never overwrite a recorded measurement.
    await collect('timing-exit-1', 'PageExit', { duration_ms: 50000, active_ms: 50000 });
    const journey = (
      await request(
        `/visitors/visitor-engagement?project=workspace&start=${day}&end=${day}`,
        null,
        'GET',
      )
    ).data;
    assert.equal(journey.events.filter((e) => e.event_name === 'PageEngagement').length, 0);
    const first = journey.events.find((e) => e.id === 'timing-view-1');
    assert.equal(first.duration_ms, 35000);
    assert.equal(first.active_ms, 30000);
    assert.equal(first.scroll_depth, 75);
    assert.equal(first.page_url, origin + '/oferta');
    assert.equal(journey.events.find((e) => e.id === 'timing-view-2').duration_ms, 5000);
    assert.ok(
      journey.events.findIndex((e) => e.id === 'timing-scroll') <
        journey.events.findIndex((e) => e.id === 'timing-exit-1'),
    );
    const returned = journey.events.find((e) => e.event_name === 'CheckoutReturn');
    assert.equal(returned.away_ms, 45000);
    assert.equal(returned.target_url, 'https://pay.example.com/offer');
    assert.ok(!JSON.stringify(journey).includes('email=private'));
    const before = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
    for (const invalid of [
      { duration_ms: -1 },
      { active_ms: 10, duration_ms: 5 },
      { duration_ms: 1.5 },
      { scroll_depth: 101 },
      { away_ms: 86400001 },
    ])
      assert.equal((await collect('invalid-timing-event', 'PageEngagement', invalid)).status, 400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, before);
    await collect('timing-purchase', 'Purchase');
    const dashboard = (
      await request(`/dashboard?project=workspace&start=${day}&end=${day}`, null, 'GET')
    ).data;
    assert.equal(dashboard.metrics.sales, 0);
    assert.equal(dashboard.metrics.revenue, 0);
    assert.equal(
      (
        await request(
          `/visitors/visitor-engagement?project=demo&start=${day}&end=${day}`,
          null,
          'GET',
        )
      ).status,
      404,
    );
    assert.equal((await request(`/pixels/${pixel.id}`, null, 'DELETE')).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM event_engagement').get().n, 0);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('cloud adds engagement storage to an initialized installation without resetting data', async () => {
  const client = createClient({ url: 'file::memory:' });
  try {
    await client.batch(
      [
        'CREATE TABLE schema_migrations (name TEXT PRIMARY KEY)',
        "INSERT INTO schema_migrations VALUES('cloud-bootstrap-v1')",
        'CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, demo INTEGER DEFAULT 0)',
        "INSERT INTO projects VALUES('workspace','Operação existente',0)",
      ],
      'write',
    );
    await initializeCloud(client, randomBytes(32));
    await initializeCloud(client, randomBytes(32));
    assert.equal(
      (await client.execute('SELECT name FROM projects')).rows[0].name,
      'Operação existente',
    );
    assert.equal((await client.execute('SELECT COUNT(*) AS n FROM event_engagement')).rows[0].n, 0);
  } finally {
    client.close();
  }
});
