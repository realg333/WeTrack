import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey, summarize } from '../server/domain.mjs';
import { ruleMetrics } from '../server/rule-model.mjs';

test('fees apply only to approved revenue and preserve negative profit and gross ROAS', () => {
  const sales = [
    { status: 'approved', amount: 1000 },
    { status: 'pending', amount: 300 },
    { status: 'refunded', amount: 200 },
  ];
  const result = summarize(sales, 950, 10, { gateway_percent: 4.99, tax_percent: 6 });
  assert.equal(result.revenue, 1000);
  assert.equal(result.gateway_fee, 49.9);
  assert.equal(result.tax, 60);
  assert.equal(result.profit, -59.9);
  assert.equal(result.margin, -5.99);
  assert.equal(result.roas, 1000 / 950);
  assert.equal(summarize([], 10, 0, { gateway_percent: 5, tax_percent: 6 }).profit, -10);
  assert.equal(summarize(sales, 200, 10).profit, 800);
});

test('fee settings persist per operation and feed dashboard, hierarchy, daily series and rules', async () => {
  const db = createDatabase(':memory:');
  const app = createApp(db, { password: '' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (path, body) => {
    const response = await fetch(
      base + path,
      body
        ? {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    return { status: response.status, body: await response.json() };
  };
  try {
    const fees = { gateway_percent: 4.99, tax_percent: 6 };
    assert.deepEqual((await request('/fees?project=demo')).body, {
      gateway_percent: 0,
      tax_percent: 0,
    });
    for (const values of [
      { gateway_percent: -1 },
      { tax_percent: 101 },
      { tax_percent: '6' },
      { unexpected: 1 },
    ])
      assert.equal(
        (await request('/fees', { project_id: 'demo', ...fees, ...values })).status,
        400,
      );
    assert.equal((await request('/fees?project=missing')).status, 404);
    assert.equal((await request('/fees', { project_id: 'missing', ...fees })).status, 404);
    const range = `project=demo&start=${dateKey()}&end=${dateKey()}`;
    const before = (await request(`/dashboard?${range}`)).body;
    assert.equal((await request('/fees', { project_id: 'demo', ...fees })).status, 200);
    assert.deepEqual((await request('/fees?project=demo')).body, fees);
    assert.deepEqual((await request('/fees?project=workspace')).body, {
      gateway_percent: 0,
      tax_percent: 0,
    });
    assert.deepEqual(
      JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get('fees:demo').value),
      fees,
    );
    const report = (await request(`/dashboard?${range}`)).body;
    assert.deepEqual(report.fees, fees);
    const expected = summarize(report.sales, report.metrics.spend, report.metrics.visits, fees);
    assert.equal(report.metrics.profit, expected.profit);
    assert.equal(report.metrics.margin, expected.margin);
    assert.equal(report.daily[0].profit, expected.profit);
    assert.equal(report.metrics.revenue, before.metrics.revenue);
    assert.equal(report.metrics.roas, before.metrics.roas);
    const hierarchy = (await request(`/ad-hierarchy?${range}&level=campaigns`)).body;
    // Match each campaign's calculation, including the rule engine's current-day profit.
    for (const campaign of report.campaigns) {
      const expectedCampaign = summarize(
        report.sales.filter((sale) => sale.campaign_id === campaign.id),
        campaign.spend,
        0,
        fees,
      );
      assert.equal(campaign.profit, expectedCampaign.profit);
      assert.equal(ruleMetrics(db, campaign, 'today', new Date()).profit, expectedCampaign.profit);
      const row = hierarchy.rows.find((entry) => entry.id === campaign.id);
      assert.equal(row.profit, expectedCampaign.profit);
      assert.equal(row.margin, campaign.revenue ? expectedCampaign.margin : null);
    }
    await request('/fees', { project_id: 'demo', gateway_percent: 0, tax_percent: 0 });
    assert.equal((await request(`/dashboard?${range}`)).body.metrics.profit, before.metrics.profit);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('fee settings require an authenticated session', async () => {
  const db = createDatabase(':memory:');
  const server = createApp(db, { password: 'test-password' }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/fees`;
    assert.equal((await fetch(base + '?project=demo')).status, 401);
    assert.equal(
      (
        await fetch(base, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: 'demo', gateway_percent: 5, tax_percent: 0 }),
        })
      ).status,
      401,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
