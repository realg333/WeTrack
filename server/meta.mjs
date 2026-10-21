import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolveCampaign, resolveAd, resolveAdset } from './attribution.mjs';
import { createMetaManagement } from './management.mjs';

export function loadSecretKey(path = './data/secret.key') {
  if (process.env.SECRETS_KEY) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.SECRETS_KEY))
      throw new Error('SECRETS_KEY deve ter 64 caracteres hexadecimais.');
    return Buffer.from(process.env.SECRETS_KEY, 'hex');
  }
  if (existsSync(path)) return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
  mkdirSync(dirname(resolve(path)), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString('hex'), { mode: 0o600, flag: 'wx' });
  return key;
}
export function encrypt(value, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64')).join('.');
}
export function decrypt(value, key) {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
const digest = (value) => createHash('sha256').update(value).digest('hex');
export function createMetaService(db, key, transport = fetch) {
  const version = () => {
    const value = process.env.META_GRAPH_VERSION;
    if (!/^v\d+\.\d+$/.test(value || ''))
      throw Object.assign(
        new Error('Configure META_GRAPH_VERSION com uma versão suportada pela sua aplicação Meta.'),
        { status: 503 },
      );
    return value;
  };
  async function graph(path, token, params = {}, method = 'GET') {
    const url = new URL(`https://graph.facebook.com/${version()}/${path}`);
    if (method === 'GET')
      Object.entries(params).forEach(([k, v]) =>
        url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v)),
      );
    const response = await transport(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok || result.error)
      throw Object.assign(
        new Error(
          `Meta: ${result.error?.code || response.status}. Verifique a validade do token, as permissões e a versão da API.`,
        ),
        { status: 502 },
      );
    return result;
  }
  async function list(path, token, params) {
    const items = [];
    let after;
    for (let page = 0; page < 100; page++) {
      const result = await graph(path, token, { ...params, ...(after ? { after } : {}) });
      if (!Array.isArray(result.data)) throw new Error('Resposta inesperada da Meta.');
      items.push(...result.data);
      if (!result.paging?.next) return items;
      after = result.paging?.cursors?.after;
      if (!after) throw new Error('Não foi possível concluir a paginação da Meta.');
    }
    throw new Error('O relatório ultrapassou o limite de páginas. Reduza o intervalo.');
  }
  function accountsFor(projectId) {
    const connection = db
      .prepare('SELECT accounts FROM meta_connections WHERE project_id=?')
      .get(projectId);
    if (!connection) return [];
    return JSON.parse(connection.accounts).map((a) => ({
      ...a,
      supported: a.currency === 'BRL',
      enabled: Boolean(
        db
          .prepare('SELECT enabled FROM meta_account_selection WHERE project_id=? AND account_id=?')
          .get(projectId, a.id)?.enabled,
      ),
    }));
  }
  function selectAccount(projectId, accountId, enabled) {
    const account = accountsFor(projectId).find((a) => a.id === accountId);
    if (!account)
      throw Object.assign(new Error('Conta não encontrada nesta operação.'), { status: 404 });
    if (enabled && !account.supported)
      throw Object.assign(new Error('Esta versão consolida somente contas em BRL.'), {
        status: 400,
      });
    db.prepare(
      'INSERT INTO meta_account_selection VALUES(?,?,?) ON CONFLICT(project_id,account_id) DO UPDATE SET enabled=excluded.enabled',
    ).run(projectId, accountId, Number(enabled));
    return accountsFor(projectId);
  }
  async function connect(projectId, token) {
    const accounts = await list('me/adaccounts', token, {
      fields: 'id,name,currency,account_status',
      limit: '100',
    });
    if (!accounts.length)
      throw Object.assign(new Error('Nenhuma conta de anúncios acessível com esta autorização.'), {
        status: 400,
      });
    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO meta_connections VALUES(?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET token_cipher=excluded.token_cipher,accounts=excluded.accounts,connected_at=excluded.connected_at',
      ).run(
        projectId,
        encrypt(token, key),
        JSON.stringify(accounts),
        new Date().toISOString(),
        null,
      );
      const available = new Set(accounts.map((a) => a.id));
      for (const old of db
        .prepare('SELECT account_id FROM meta_account_selection WHERE project_id=?')
        .all(projectId))
        if (!available.has(old.account_id))
          db.prepare(
            'UPDATE meta_account_selection SET enabled=0 WHERE project_id=? AND account_id=?',
          ).run(projectId, old.account_id);
      for (const account of accounts)
        db.prepare('INSERT OR IGNORE INTO meta_account_selection VALUES(?,?,0)').run(
          projectId,
          account.id,
        );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return {
      accounts: accountsFor(projectId),
      skipped: accounts.filter((a) => a.currency !== 'BRL').length,
    };
  }
  const campaignKey = (projectId, external) =>
    `meta_${digest(projectId + ':' + external).slice(0, 20)}`;
  const entityKey = (kind, projectId, external) =>
    `${kind}_${digest(projectId + ':' + external).slice(0, 20)}`;
  const action = (actions, types) => {
    for (const type of types) {
      const a = (actions || []).find((a) => a.action_type === type);
      if (a) return Math.max(0, Math.floor(Number(a.value) || 0));
    }
    return 0;
  };
  async function sync(projectId, start, end) {
    const connection = db
      .prepare('SELECT * FROM meta_connections WHERE project_id=?')
      .get(projectId);
    if (!connection)
      throw Object.assign(new Error('Conecte uma conta Meta antes de sincronizar.'), {
        status: 400,
      });
    const selected = accountsFor(projectId).filter((a) => a.enabled && a.supported);
    if (!selected.length)
      throw Object.assign(new Error('Ative pelo menos uma conta de anúncios para sincronizar.'), {
        status: 400,
      });
    const token = decrypt(connection.token_cipher, key),
      datasets = [];
    for (const account of selected) {
      const time = { time_increment: '1', time_range: { since: start, until: end }, limit: '500' };
      const [catalog, sets, ads, campaignRows, adRows] = await Promise.all([
        list(`${account.id}/campaigns`, token, {
          fields: 'id,name,status,effective_status,daily_budget',
          limit: '500',
        }),
        list(`${account.id}/adsets`, token, {
          fields: 'id,name,campaign_id,status,effective_status,daily_budget',
          limit: '500',
        }),
        list(`${account.id}/ads`, token, {
          fields: 'id,name,campaign_id,adset_id,status,effective_status',
          limit: '500',
        }),
        list(`${account.id}/insights`, token, {
          ...time,
          fields: 'campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions',
          level: 'campaign',
        }),
        list(`${account.id}/insights`, token, {
          ...time,
          fields:
            'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions',
          level: 'ad',
        }),
      ]);
      for (const r of [...campaignRows, ...adRows])
        if (
          !/^\d+$/.test(r.campaign_id || '') ||
          !/^\d{4}-\d{2}-\d{2}$/.test(r.date_start || '') ||
          r.date_start < start ||
          r.date_start > end ||
          !Number.isFinite(Number(r.spend)) ||
          Number(r.spend) < 0
        )
          throw new Error('Dados de insights inválidos. A sincronização foi cancelada.');
      for (const r of adRows)
        if (!/^\d+$/.test(r.ad_id || '') || !/^\d+$/.test(r.adset_id || ''))
          throw new Error('A Meta não retornou a hierarquia completa dos anúncios.');
      datasets.push({ account, catalog, sets, ads, campaignRows, adRows });
    }
    db.exec('BEGIN');
    try {
      for (const d of datasets) {
        const aid = d.account.id;
        db.prepare(
          "DELETE FROM entity_funnel WHERE project_id=? AND day BETWEEN ? AND ? AND ((level='campaign' AND entity_id IN (SELECT campaign_id FROM meta_campaigns WHERE account_id=?)) OR (level='ad' AND entity_id IN (SELECT ad.id FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN meta_campaigns m ON m.campaign_id=a.campaign_id WHERE m.account_id=?)))",
        ).run(projectId, start, end, aid, aid);
        db.prepare(
          'DELETE FROM spend WHERE campaign_id IN (SELECT campaign_id FROM meta_campaigns WHERE account_id=?) AND campaign_id IN (SELECT id FROM campaigns WHERE project_id=?) AND day BETWEEN ? AND ?',
        ).run(aid, projectId, start, end);
        db.prepare(
          'DELETE FROM campaign_funnel WHERE campaign_id IN (SELECT campaign_id FROM meta_campaigns WHERE account_id=?) AND campaign_id IN (SELECT id FROM campaigns WHERE project_id=?) AND day BETWEEN ? AND ?',
        ).run(aid, projectId, start, end);
        db.prepare(
          'DELETE FROM ad_insights WHERE ad_id IN (SELECT ad.id FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN meta_campaigns m ON m.campaign_id=a.campaign_id JOIN campaigns c ON c.id=m.campaign_id WHERE m.account_id=? AND c.project_id=?) AND day BETWEEN ? AND ?',
        ).run(aid, projectId, start, end);
        const saveCampaign = (r) => {
          const cid = campaignKey(projectId, r.id);
          db.prepare(
            'INSERT INTO campaigns VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,budget=excluded.budget,active=excluded.active',
          ).run(
            cid,
            projectId,
            r.name || 'Campanha Meta',
            'Meta Ads',
            Number(r.daily_budget || 0) / 100,
            ['PAUSED', 'ARCHIVED', 'DELETED'].includes(r.status || r.effective_status) ? 0 : 1,
            new Date().toISOString(),
          );
          db.prepare(
            'INSERT INTO meta_campaigns VALUES(?,?,?) ON CONFLICT(campaign_id) DO UPDATE SET account_id=excluded.account_id',
          ).run(cid, r.id, aid);
          return cid;
        };
        const catalog = new Map(d.catalog.map((r) => [r.id, r]));
        for (const r of [...d.campaignRows, ...d.adRows])
          if (!catalog.has(r.campaign_id))
            catalog.set(r.campaign_id, { id: r.campaign_id, name: r.campaign_name });
        for (const r of catalog.values()) saveCampaign(r);
        const sets = new Map(d.sets.map((r) => [r.id, r]));
        for (const r of d.adRows)
          if (!sets.has(r.adset_id))
            sets.set(r.adset_id, {
              id: r.adset_id,
              name: r.adset_name,
              campaign_id: r.campaign_id,
            });
        for (const r of sets.values())
          if (catalog.has(r.campaign_id))
            db.prepare(
              'INSERT INTO ad_sets VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET campaign_id=excluded.campaign_id,name=excluded.name,active=excluded.active,budget=excluded.budget',
            ).run(
              entityKey('set', projectId, r.id),
              campaignKey(projectId, r.campaign_id),
              r.id,
              r.name || 'Conjunto Meta',
              ['PAUSED', 'ARCHIVED', 'DELETED'].includes(r.status || r.effective_status) ? 0 : 1,
              Number(r.daily_budget || 0) / 100,
            );
        const ads = new Map(d.ads.map((r) => [r.id, r]));
        for (const r of d.adRows)
          if (!ads.has(r.ad_id))
            ads.set(r.ad_id, { id: r.ad_id, name: r.ad_name, adset_id: r.adset_id });
        for (const r of ads.values())
          if (sets.has(r.adset_id))
            db.prepare(
              'INSERT INTO ads VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET adset_id=excluded.adset_id,name=excluded.name,active=excluded.active',
            ).run(
              entityKey('ad', projectId, r.id),
              entityKey('set', projectId, r.adset_id),
              r.id,
              r.name || 'Anúncio Meta',
              ['PAUSED', 'ARCHIVED', 'DELETED'].includes(r.status || r.effective_status) ? 0 : 1,
            );
        const saveFunnel = (r, level) =>
          db
            .prepare('INSERT OR REPLACE INTO entity_funnel VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(
              projectId,
              level,
              level === 'campaign'
                ? campaignKey(projectId, r.campaign_id)
                : entityKey('ad', projectId, r.ad_id),
              r.adset_id ? entityKey('set', projectId, r.adset_id) : null,
              r.date_start,
              r.inline_link_clicks === undefined
                ? action(r.actions, ['link_click'])
                : Number(r.inline_link_clicks) || 0,
              action(r.actions, ['landing_page_view']),
              action(r.actions, [
                'offsite_conversion.fb_pixel_initiate_checkout',
                'omni_initiated_checkout',
                'initiate_checkout',
              ]),
              action(r.actions, [
                'offsite_conversion.fb_pixel_purchase',
                'omni_purchase',
                'purchase',
              ]),
              action(r.actions, [
                'offsite_conversion.fb_pixel_lead',
                'onsite_conversion.lead_grouped',
                'lead',
              ]),
              action(r.actions, [
                'offsite_conversion.fb_pixel_add_to_cart',
                'omni_add_to_cart',
                'add_to_cart',
              ]),
            );
        for (const r of d.campaignRows) {
          saveFunnel(r, 'campaign');
          const cid = campaignKey(projectId, r.campaign_id);
          db.prepare(
            'INSERT INTO spend VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET amount=excluded.amount,impressions=excluded.impressions,clicks=excluded.clicks',
          ).run(
            cid,
            r.date_start,
            Number(r.spend),
            Number(r.impressions) || 0,
            Number(r.clicks) || 0,
          );
          db.prepare(
            'INSERT INTO campaign_funnel VALUES(?,?,?,?,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET link_clicks=excluded.link_clicks,landing_views=excluded.landing_views,checkouts=excluded.checkouts,meta_purchases=excluded.meta_purchases',
          ).run(
            cid,
            r.date_start,
            r.inline_link_clicks === undefined
              ? action(r.actions, ['link_click'])
              : Number(r.inline_link_clicks) || 0,
            action(r.actions, ['landing_page_view']),
            action(r.actions, [
              'offsite_conversion.fb_pixel_initiate_checkout',
              'omni_initiated_checkout',
              'initiate_checkout',
            ]),
            action(r.actions, [
              'offsite_conversion.fb_pixel_purchase',
              'omni_purchase',
              'purchase',
            ]),
          );
        }
        for (const r of d.adRows) {
          saveFunnel(r, 'ad');
          db.prepare(
            'INSERT INTO ad_insights VALUES(?,?,?,?,?) ON CONFLICT(ad_id,day) DO UPDATE SET amount=excluded.amount,impressions=excluded.impressions,clicks=excluded.clicks',
          ).run(
            entityKey('ad', projectId, r.ad_id),
            r.date_start,
            Number(r.spend),
            Number(r.impressions) || 0,
            Number(r.clicks) || 0,
          );
        }
      }
      // Resolve webhooks that arrived before this campaign/ad was imported.
      for (const sale of db
        .prepare(
          'SELECT s.id,s.utm_campaign,sa.ad_id,sa.adset_id FROM sales s LEFT JOIN sale_attribution sa ON sa.sale_id=s.id WHERE s.project_id=? AND NOT EXISTS (SELECT 1 FROM manual_sale_attribution ma WHERE ma.sale_id=s.id)',
        )
        .all(projectId)) {
        const ad = resolveAd(db, projectId, sale.ad_id),
          set = ad || resolveAdset(db, projectId, sale.adset_id),
          campaign = set
            ? { id: set.campaign_id }
            : resolveCampaign(db, projectId, sale.utm_campaign);
        if (campaign)
          db.prepare('UPDATE sales SET campaign_id=? WHERE id=?').run(campaign.id, sale.id);
        if (set)
          db.prepare(
            'UPDATE sale_attribution SET adset_id=?,ad_id=COALESCE(?,ad_id) WHERE sale_id=?',
          ).run(set.adset_id, ad?.id || null, sale.id);
      }
      db.prepare('UPDATE meta_connections SET last_sync=? WHERE project_id=?').run(
        new Date().toISOString(),
        projectId,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return {
      rows: datasets.reduce((v, d) => v + d.campaignRows.length, 0),
      campaigns: new Set(datasets.flatMap((d) => d.campaignRows.map((r) => r.campaign_id))).size,
      adsets: datasets.reduce((v, d) => v + d.sets.length, 0),
      ads: datasets.reduce((v, d) => v + d.ads.length, 0),
    };
  }
  function configurePixel(pixelId, metaPixelId, token, testCode) {
    version();
    db.prepare(
      'INSERT INTO pixel_capi VALUES(?,?,?,?) ON CONFLICT(pixel_id) DO UPDATE SET meta_pixel_id=excluded.meta_pixel_id,token_cipher=excluded.token_cipher,test_event_code=excluded.test_event_code',
    ).run(pixelId, metaPixelId, encrypt(token, key), testCode || null);
  }
  function enqueue(saleId, integrationId, data) {
    const pixel = db
      .prepare(
        'SELECT p.* FROM pixels p JOIN integration_pixels i ON i.pixel_id=p.id JOIN pixel_capi c ON c.pixel_id=p.id WHERE i.integration_id=? AND p.active=1',
      )
      .get(integrationId);
    if (!pixel) return false;
    const userData = {};
    if (data.customer_email) userData.em = [digest(data.customer_email.trim().toLowerCase())];
    if (data.customer_phone) userData.ph = [digest(data.customer_phone.replace(/\D/g, ''))];
    if (data.visitor_id) userData.external_id = [digest(data.visitor_id)];
    if (data.fbp) userData.fbp = data.fbp;
    if (data.fbc) userData.fbc = data.fbc;
    const payload = {
      event_name: 'Purchase',
      event_time: Math.floor(new Date(data.approved_at || Date.now()).getTime() / 1000),
      event_id: saleId,
      action_source: data.action_source || 'website',
      event_source_url: pixel.domain,
      user_data: userData,
      custom_data: {
        value: data.amount,
        currency: 'BRL',
        content_name: data.product,
        order_id: data.order_id,
      },
    };
    let error = Object.keys(userData).length
      ? null
      : 'Envie e-mail, telefone ou visitor_id para identificar o comprador.';
    if (
      payload.event_time < Date.now() / 1000 - 7 * 86400 ||
      payload.event_time > Date.now() / 1000 + 300
    )
      error = 'Data da compra fora da janela de envio CAPI. O histórico financeiro foi preservado.';
    const result = db
      .prepare('INSERT OR IGNORE INTO capi_queue VALUES(?,?,?,?,?,?,?,?,?)')
      .run(
        saleId,
        pixel.project_id,
        pixel.id,
        JSON.stringify(payload),
        error ? 'failed' : 'pending',
        error ? 5 : 0,
        0,
        error,
        new Date().toISOString(),
      );
    return Boolean(result.changes);
  }
  function enqueueEvent(pixelId, queueId, data) {
    const supported = new Set([
      'PageView',
      'ViewContent',
      'AddToCart',
      'AddToWishlist',
      'InitiateCheckout',
      'AddPaymentInfo',
      'Lead',
      'CompleteRegistration',
      'Contact',
      'Schedule',
      'Search',
      'Subscribe',
      'StartTrial',
      'SubmitApplication',
      'Donate',
      'CustomizeProduct',
      'FindLocation',
    ]);
    // Operational events and browser Purchases never become confirmed conversions.
    if (!supported.has(data.event_name) && !data.send_capi) return false;
    if (data.event_name === 'Purchase') return false;
    const pixel = db
      .prepare(
        'SELECT p.* FROM pixels p JOIN pixel_capi c ON c.pixel_id=p.id WHERE p.id=? AND p.active=1',
      )
      .get(pixelId);
    if (!pixel) return false;
    const user = {};
    if (data.visitor_id) user.external_id = [digest(data.visitor_id)];
    if (data.customer_email) user.em = [digest(data.customer_email.trim().toLowerCase())];
    if (data.customer_phone) user.ph = [digest(data.customer_phone.replace(/\D/g, ''))];
    if (data.fbp) user.fbp = data.fbp;
    if (data.fbc) user.fbc = data.fbc;
    if (data.client_ip_address) user.client_ip_address = data.client_ip_address;
    if (data.client_user_agent) user.client_user_agent = data.client_user_agent;
    const eventTime = Math.floor(new Date(data.occurred_at || Date.now()).getTime() / 1000);
    const error =
      eventTime < Date.now() / 1000 - 7 * 86400 || eventTime > Date.now() / 1000 + 300
        ? 'Data do evento fora da janela de envio CAPI.'
        : null;
    const payload = {
      event_name: data.event_name,
      event_time: eventTime,
      event_id: data.event_id || queueId,
      action_source: data.action_source || 'website',
      event_source_url: pixel.domain,
      user_data: user,
      custom_data: {
        ...(data.value != null ? { value: data.value, currency: data.currency || 'BRL' } : {}),
        ...(data.content_id ? { content_ids: [data.content_id], content_type: 'product' } : {}),
        ...(data.content_name ? { content_name: data.content_name } : {}),
      },
    };
    return Boolean(
      db
        .prepare('INSERT OR IGNORE INTO capi_queue VALUES(?,?,?,?,?,?,?,?,?)')
        .run(
          'event_' + digest(pixelId + ':' + queueId).slice(0, 32),
          pixel.project_id,
          pixel.id,
          JSON.stringify(payload),
          error ? 'failed' : 'pending',
          error ? 5 : 0,
          0,
          error,
          new Date().toISOString(),
        ).changes,
    );
  }
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      const items = db
        .prepare(
          "SELECT * FROM capi_queue WHERE status='pending' AND next_attempt<=? ORDER BY created_at LIMIT 20",
        )
        .all(Date.now());
      for (const item of items) {
        const sale = db.prepare('SELECT status FROM sales WHERE id=?').get(item.id);
        if (sale && sale.status !== 'approved') {
          db.prepare(
            "UPDATE capi_queue SET status='failed',attempts=5,last_error=? WHERE id=?",
          ).run('A compra deixou de estar aprovada. Envio cancelado.', item.id);
          continue;
        }
        const config = db.prepare('SELECT * FROM pixel_capi WHERE pixel_id=?').get(item.pixel_id);
        if (!config) {
          db.prepare("UPDATE capi_queue SET status='failed',last_error=? WHERE id=?").run(
            'Configuração CAPI removida.',
            item.id,
          );
          continue;
        }
        try {
          const response = await graph(
            `${config.meta_pixel_id}/events`,
            decrypt(config.token_cipher, key),
            {
              data: [JSON.parse(item.payload)],
              ...(config.test_event_code ? { test_event_code: config.test_event_code } : {}),
            },
            'POST',
          );
          if (response.events_received !== 1)
            throw new Error('A Meta não confirmou o recebimento do evento.');
          db.prepare(
            "UPDATE capi_queue SET status='sent',attempts=attempts+1,last_error=NULL WHERE id=?",
          ).run(item.id);
        } catch (error) {
          const attempt = item.attempts + 1;
          db.prepare(
            'UPDATE capi_queue SET status=?,attempts=?,next_attempt=?,last_error=? WHERE id=?',
          ).run(
            attempt >= 5 ? 'failed' : 'pending',
            attempt,
            Date.now() + Math.min(3600000, 30000 * 2 ** attempt),
            error.message.slice(0, 200),
            item.id,
          );
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    management: createMetaManagement(db, graph, accountsFor, (cipher) => decrypt(cipher, key)),
    connect,
    accountsFor,
    selectAccount,
    sync,
    configurePixel,
    enqueue,
    enqueueEvent,
    drain,
    configured: Boolean(/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || '')),
  };
}
