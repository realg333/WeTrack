import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { createMetaService, encrypt, decrypt } from '../server/meta.mjs';
import { createApp } from '../server/app.mjs';
import { dateKey } from '../server/domain.mjs';

test('tokens are encrypted with authenticated encryption', () => {
  const key = randomBytes(32),
    token = 'sensitive-test-token',
    cipher = encrypt(token, key);
  assert.ok(!cipher.includes(token));
  assert.equal(decrypt(cipher, key), token);
  assert.throws(() => decrypt(cipher, randomBytes(32)));
});
test('Meta selects accounts, imports the three levels once and sends deduplicated CAPI', async () => {
  process.env.META_GRAPH_VERSION = 'v99.0'; // Fake version: transport is fully mocked, no network to Meta.
  const db = createDatabase(':memory:');
  const key = randomBytes(32);
  const calls = [];
  let failCapi = false;
  let invalidInsights = false;
  const transport = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/me/adaccounts'))
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: 'act_123', name: 'Conta BRL', currency: 'BRL', account_status: 1 },
            { id: 'act_456', name: 'USD', currency: 'USD' },
            { id: 'act_666', name: 'Segunda conta BRL', currency: 'BRL', account_status: 1 },
          ],
        }),
      };
    const parsed = new URL(url),
      second = parsed.pathname.includes('act_666'),
      campaign = second ? '987655' : '987654',
      set = second ? '666100' : '123100',
      ad = second ? '666101' : '123101';
    if (parsed.pathname.endsWith('/campaigns'))
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: campaign,
              name: 'Campanha Meta',
              daily_budget: '5000',
              effective_status: 'ACTIVE',
            },
          ],
        }),
      };
    if (parsed.pathname.endsWith('/adsets'))
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: set,
              campaign_id: campaign,
              name: 'Conjunto Meta',
              daily_budget: '5000',
              effective_status: 'ACTIVE',
            },
          ],
        }),
      };
    if (parsed.pathname.endsWith('/ads'))
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: ad,
              adset_id: set,
              campaign_id: campaign,
              name: 'Anúncio Meta',
              effective_status: 'ACTIVE',
            },
          ],
        }),
      };
    if (String(url).includes('/insights'))
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              campaign_id: campaign,
              campaign_name: 'Campanha Meta',
              date_start: dateKey(),
              spend: invalidInsights ? '-1' : second ? '70.90' : '120.50',
              impressions: '2000',
              clicks: '80',
              inline_link_clicks: '70',
              actions: [
                { action_type: 'landing_page_view', value: '60' },
                { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: '10' },
                { action_type: 'omni_initiated_checkout', value: '10' },
              ],
              ...(parsed.searchParams.get('level') === 'ad'
                ? { adset_id: set, adset_name: 'Conjunto Meta', ad_id: ad, ad_name: 'Anúncio Meta' }
                : {}),
            },
          ],
        }),
      };
    if (String(url).includes('/events'))
      return {
        ok: !failCapi,
        status: failCapi ? 500 : 200,
        json: async () => (failCapi ? { error: { code: 1 } } : { events_received: 1 }),
      };
    throw new Error('Unexpected network request');
  };
  const app = createApp(db, { password: '', secretKey: key, transport });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const req = async (path, body, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const earlierToken = await req('/tokens', {
      project_id: 'workspace',
      name: 'Pedidos antes de importar',
      platform: 'API personalizada',
    });
    const earlierSale = await req(`/webhooks/${earlierToken.data.token}`, {
      order_id: 'BEFORE-SYNC',
      status: 'pending',
      amount: 97,
      product: 'Antes da sincronização',
      ad_id: '123101',
    });
    assert.equal(
      db.prepare('SELECT campaign_id FROM sales WHERE id=?').get(earlierSale.data.id).campaign_id,
      null,
    );
    const connect = await req('/meta/connect', {
      project_id: 'workspace',
      access_token: 'test-meta-access-token',
    });
    assert.equal(connect.status, 200);
    assert.equal(connect.data.accounts.length, 3);
    assert.equal(connect.data.skipped, 1);
    assert.ok(connect.data.accounts.every((a) => !a.enabled));
    assert.equal(
      (await req('/meta/sync', { project_id: 'workspace', start: dateKey(), end: dateKey() }))
        .status,
      400,
    );
    assert.equal(
      (await req('/meta/accounts/act_456', { project_id: 'workspace', enabled: true }, 'PUT'))
        .status,
      400,
    );
    assert.equal(
      (await req('/meta/accounts/act_missing', { project_id: 'workspace', enabled: true }, 'PUT'))
        .status,
      404,
    );
    assert.equal(
      (await req('/meta/accounts/act_123', { project_id: 'demo', enabled: true }, 'PUT')).status,
      404,
    );
    assert.equal(
      (await req('/meta/accounts/act_123', { project_id: 'workspace', enabled: true }, 'PUT'))
        .status,
      200,
    );
    assert.ok(
      !db
        .prepare('SELECT token_cipher FROM meta_connections')
        .get()
        .token_cipher.includes('test-meta-access-token'),
    );
    for (let n = 0; n < 2; n++)
      assert.equal(
        (await req('/meta/sync', { project_id: 'workspace', start: dateKey(), end: dateKey() }))
          .status,
        200,
      );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE project_id='workspace'").get()
        .count,
      1,
    );
    const summary = (
      await req(`/dashboard?project=workspace&start=${dateKey()}&end=${dateKey()}`, null, 'GET')
    ).data;
    assert.equal(summary.metrics.spend, 120.5);
    assert.equal(summary.metrics.clicks, 80);
    assert.equal(summary.funnel.meta[0].value, 70);
    assert.equal(summary.funnel.meta[2].value, 10); // aliases cannot double count checkout.
    assert.ok(!calls.some((c) => /act_(456|666)\//.test(c.url)));
    const sets = (
      await req(
        `/ad-hierarchy?project=workspace&start=${dateKey()}&end=${dateKey()}&level=adsets&parent=${summary.campaigns[0].id}`,
        null,
        'GET',
      )
    ).data.rows;
    assert.equal(sets.length, 1);
    assert.equal(sets[0].spend, 120.5);
    assert.equal(sets[0].budget, 50);
    const ads = (
      await req(
        `/ad-hierarchy?project=workspace&start=${dateKey()}&end=${dateKey()}&level=ads&parent=${sets[0].id}`,
        null,
        'GET',
      )
    ).data.rows;
    assert.equal(ads.length, 1);
    assert.equal(ads[0].spend, 120.5);
    assert.equal(
      db.prepare('SELECT campaign_id FROM sales WHERE id=?').get(earlierSale.data.id).campaign_id,
      summary.campaigns[0].id,
    );
    assert.equal(ads[0].pending, 1);
    assert.equal(
      (
        await req(
          `/ad-hierarchy?project=demo&level=adsets&parent=${summary.campaigns[0].id}`,
          null,
          'GET',
        )
      ).status,
      404,
    );
    const manual = await req(
      `/campaigns/${summary.campaigns[0].id}/spend`,
      { day: dateKey(), amount: 12 },
      'PUT',
    );
    assert.equal(manual.status, 400);
    const pixel = await req('/pixels', {
      name: 'Pixel CAPI',
      project_id: 'workspace',
      domain: 'https://loja.example.com',
      meta_pixel_id: '123456789',
      capi_token: 'capi-secret-test-token',
      test_event_code: 'TEST123',
    });
    assert.equal(pixel.status, 201);
    const integrations = (await req('/integrations?project=workspace', null, 'GET')).data;
    const listedPixel = integrations.pixels.find((p) => p.id === pixel.data.id);
    assert.equal(listedPixel.meta_pixel_id, '123456789');
    assert.equal(listedPixel.test_event_code, 'TEST123');
    assert.equal(listedPixel.capi_configured, 1);
    assert.ok(!JSON.stringify(integrations).includes('capi-secret-test-token'));
    assert.ok(!Object.hasOwn(listedPixel, 'token_cipher'));
    const token = await req('/tokens', {
      name: 'Pedidos CAPI',
      platform: 'API personalizada',
      project_id: 'workspace',
      pixel_id: pixel.data.id,
    });
    const sale = {
      order_id: 'CAPI-1',
      status: 'approved',
      amount: 197,
      product: 'Produto teste',
      customer_email: 'cliente@example.com',
      utm_campaign: '987654',
      ad_id: '123101',
    };
    const result = await req(`/webhooks/${token.data.token}`, sale);
    assert.equal(result.data.capi, 'queued');
    assert.equal((await req(`/webhooks/${token.data.token}`, sale)).data.duplicate, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM capi_queue').get().count, 1);
    const payload = JSON.parse(db.prepare('SELECT payload FROM capi_queue').get().payload);
    assert.equal(
      payload.user_data.em[0],
      createHash('sha256').update('cliente@example.com').digest('hex'),
    );
    assert.equal(payload.event_id, result.data.id);
    assert.equal(payload.custom_data.value, 197);
    assert.equal(
      db.prepare('SELECT ad_id FROM sale_attribution WHERE sale_id=?').get(result.data.id).ad_id,
      ads[0].id,
    );
    await req('/meta/accounts/act_123', { project_id: 'workspace', enabled: false }, 'PUT');
    const hidden = (await req(`/dashboard?project=workspace`, null, 'GET')).data;
    assert.equal(hidden.metrics.spend, 0);
    assert.equal(hidden.metrics.revenue, 0);
    assert.equal(hidden.campaigns.length, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM spend WHERE campaign_id=?').get(summary.campaigns[0].id)
        .n,
      1,
    );
    await req('/meta/accounts/act_123', { project_id: 'workspace', enabled: true }, 'PUT');
    await req('/meta/accounts/act_666', { project_id: 'workspace', enabled: true }, 'PUT');
    assert.equal(
      (await req('/meta/sync', { project_id: 'workspace', start: dateKey(), end: dateKey() }))
        .status,
      200,
    );
    const both = (await req('/dashboard?project=workspace', null, 'GET')).data;
    assert.equal(both.metrics.spend, 191.4);
    assert.equal(both.metrics.revenue, 197);
    invalidInsights = true;
    await assert.rejects(
      () => app.locals.meta.sync('workspace', dateKey(), dateKey()),
      /inválidos/,
    );
    invalidInsights = false;
    assert.equal(
      (await req('/dashboard?project=workspace', null, 'GET')).data.metrics.spend,
      191.4,
    );
    // Duplicate names across accounts are ambiguous; an ID still resolves exactly.
    const ambiguous = await req(`/webhooks/${token.data.token}`, {
      ...sale,
      order_id: 'AMBIGUOUS',
      utm_campaign: 'Campanha Meta',
      ad_id: undefined,
      status: 'pending',
    });
    assert.equal(
      db.prepare('SELECT campaign_id FROM sales WHERE id=?').get(ambiguous.data.id).campaign_id,
      null,
    );
    failCapi = true;
    await app.locals.meta.drain();
    assert.equal(db.prepare('SELECT status FROM capi_queue').get().status, 'pending');
    db.prepare('UPDATE capi_queue SET next_attempt=0').run();
    failCapi = false;
    await app.locals.meta.drain();
    assert.equal(db.prepare('SELECT status FROM capi_queue').get().status, 'sent');
    const events = calls.filter((c) => c.url.includes('/events'));
    assert.equal(events.length, 2);
    assert.equal(JSON.parse(events[1].options.body).test_event_code, 'TEST123');
    assert.ok(
      !JSON.stringify((await req('/integrations?project=workspace', null, 'GET')).data).includes(
        'capi-secret-test-token',
      ),
    );
    assert.equal((await req(`/pixels/${pixel.data.id}`, null, 'DELETE')).status, 200);
    // A manual correction to another account must survive the next structure import.
    const attributionOptions = (
      await req('/sale-attribution-options?project=workspace', null, 'GET')
    ).data;
    const targetCampaign = attributionOptions.campaigns.find((c) => c.external_id === '987655');
    const targetSet = attributionOptions.adsets.find((a) => a.campaign_id === targetCampaign.id);
    const targetAd = attributionOptions.ads.find((ad) => ad.adset_id === targetSet.id);
    const corrected = await req(
      `/sales/${earlierSale.data.id}/attribution`,
      {
        project_id: 'workspace',
        campaign_id: targetCampaign.id,
        adset_id: targetSet.id,
        ad_id: targetAd.id,
      },
      'PATCH',
    );
    assert.equal(corrected.status, 200);
    await app.locals.meta.sync('workspace', dateKey(), dateKey());
    const preserved = (await req('/dashboard?project=workspace', null, 'GET')).data.sales.find(
      (s) => s.id === earlierSale.data.id,
    );
    assert.equal(preserved.campaign_id, targetCampaign.id);
    assert.equal(preserved.adset_id, targetSet.id);
    assert.equal(preserved.ad_id, targetAd.id);
    assert.equal(preserved.attribution_method, 'manual');
    assert.equal(preserved.ad_reference, '123101');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    delete process.env.META_GRAPH_VERSION;
  }
});
test('Meta refuses to connect when Graph API version is not configured', async () => {
  const db = createDatabase(':memory:');
  const meta = createMetaService(db, randomBytes(32), () => {
    throw new Error('Network must not be called');
  });
  await assert.rejects(() => meta.connect('workspace', 'token'), /META_GRAPH_VERSION/);
  db.close();
});
