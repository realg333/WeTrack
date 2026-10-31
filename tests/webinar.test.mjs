import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';

test('webinar authenticates, deduplicates and preserves email journeys and latest purchase status within each operation', async () => {
  const db = createDatabase(':memory:'),
    server = createApp(db, { password: '' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, body, token, method = body ? 'POST' : 'GET') {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  }
  try {
    const c = (await request('/webinar/connections', { project_id: 'workspace' })).data;
    const at = new Date().toISOString(),
      day = at.slice(0, 10);
    const payload = {
      version: 1,
      id: 'registered-1',
      event: 'registered',
      occurredAt: at,
      webinarId: 'powerayuno',
      lead: { name: 'María', email: 'MARIA@example.com', phone: '573101234567' },
      session: { id: 'session-1', startsAt: at, watchedSec: 0, maxSec: 0, status: 'registered' },
    };
    assert.equal((await request('/webhooks/webinar', payload)).status, 401);
    assert.equal((await request('/webhooks/webinar', payload, 'invalid')).status, 401);
    assert.equal(
      (await request('/webhooks/webinar', { ...payload, event: 'unknown' }, c.token)).status,
      400,
    );
    assert.equal((await request('/webhooks/webinar', payload, c.token)).status, 200);
    assert.equal((await request('/webhooks/webinar', payload, c.token)).data.duplicate, true);
    const send = (id, event, extra = {}) =>
      request(
        '/webhooks/webinar',
        { ...payload, id, event, lead: { ...payload.lead, email: 'maria@example.com' }, ...extra },
        c.token,
      );
    await send('left-1', 'left', {
      session: { ...payload.session, watchedSec: 120, maxSec: 150, status: 'left' },
    });
    await send('rejoined-1', 'rejoined', {
      session: { ...payload.session, watchedSec: 180, maxSec: 220, status: 'watching' },
    });
    await send('old-progress', 'watch_progress', {
      occurredAt: new Date(Date.parse(at) - 1000).toISOString(),
      session: { ...payload.session, watchedSec: 30, maxSec: 60, status: 'left' },
    });
    await send('dispatch-1', 'member_access_sent', {
      dispatch: { trigger: 'member_access', status: 'sent' },
      session: undefined,
    });
    const purchase = { transaction: 'HP123', productId: '123', status: 'approved' };
    await send('purchase-1', 'purchase', { purchase, session: undefined });
    await send('refund-1', 'purchase', {
      occurredAt: new Date(Date.parse(at) + 1000).toISOString(),
      purchase: { ...purchase, status: 'refunded' },
      session: undefined,
    });
    await send('approval-old', 'purchase', { purchase, session: undefined });
    const params = `project=workspace&start=${day}&end=${day}`;
    const list = (await request(`/webinar?${params}`)).data;
    assert.equal(list.total, 1);
    assert.equal(list.people[0].email, 'maria@example.com');
    assert.equal(list.people[0].watched_sec, 180);
    assert.equal(list.people[0].returns, 1);
    assert.equal(list.people[0].sends, 1);
    assert.equal(list.people[0].purchased, 0);
    const journey = (await request(`/webinar/people/${list.people[0].id}?project=workspace`)).data;
    assert.equal(journey.orders[0].status, 'refunded');
    assert.equal(journey.sessions[0].status, 'watching');
    assert.equal(journey.events.length, 8);
    assert.equal((await request(`/webinar/people/${list.people[0].id}?project=demo`)).status, 404);
    assert.equal((await request(`/webinar?project=demo&start=${day}&end=${day}`)).data.total, 0);
    assert.equal((await request(`/webinar?${params}&q=MARIA`)).data.total, 1);
    await request(`/tokens/${c.id}`, null, null, 'DELETE');
    assert.equal((await send('after-revoke', 'joined')).status, 401);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('webinar reports and connection creation require the admin session', async () => {
  const db = createDatabase(':memory:'),
    server = createApp(db, { password: 'private-test' }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api`;
    assert.equal((await fetch(base + '/webinar?project=workspace')).status, 401);
    assert.equal(
      (
        await fetch(base + '/webinar/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: 'workspace' }),
        })
      ).status,
      401,
    );
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
});
