import express from 'express';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import {
  dateKey,
  summarize,
  money,
  campaignSchema,
  pixelSchema,
  webhookSchema,
} from './domain.mjs';
import { createMetaService } from './meta.mjs';
import { createMetaOAuth } from './oauth.mjs';
import {
  resolveCampaign,
  resolveAd,
  resolveAdset,
  isManualAttribution,
  saveSaleTracking,
} from './attribution.mjs';
import {
  dashboardReport,
  hierarchyReport,
  visitorList,
  visitorJourney,
  visibleCampaigns,
  reportSales,
} from './reporting.mjs';
import { createPlatformService } from './platforms.mjs';
import { providerSchema } from './platform-adapters.mjs';
import { createRuleService } from './rules.mjs';
import { configuredRules, ruleReport } from './rule-model.mjs';
import {
  registerTracking,
  eventNameSchema,
  signalSchema,
  saveSignals,
  recoverReference,
} from './tracking.mjs';
import { normalizeUtmify } from './utmify-format.mjs';
import { saveSaleCurrency } from './currencies.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const id = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
const now = () => new Date().toISOString();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);

export function createApp(db, options = {}) {
  const app = express();
  const secretKey = options.secretKey || randomBytes(32);
  const meta = createMetaService(db, secretKey, options.transport || fetch);
  const oauth = createMetaOAuth(db, meta, options.transport || fetch);
  const platforms = createPlatformService(db, secretKey, meta, options.transport || fetch);
  const rules = createRuleService(db, meta, options.rulesOptions);
  app.locals.rules = rules;
  const range = (query) => {
    const end = dateSchema.parse(query.end || dateKey()),
      start = dateSchema.parse(query.start || end);
    if (start > end || (Date.parse(end) - Date.parse(start)) / 86400000 > 365)
      throw Object.assign(new Error('Escolha um intervalo válido de até 366 dias.'), {
        status: 400,
      });
    return { start, end };
  };
  app.locals.meta = meta;
  app.locals.platforms = platforms;
  app.locals.drain = async () => {
    await platforms.drain();
    await meta.drain();
  };
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  if (options.serverless) app.set('trust proxy', 1);
  const sessionValid = (sid) =>
    Boolean(
      sid &&
      db
        .prepare('SELECT 1 AS ok FROM admin_sessions WHERE id_hash=? AND expires_at>?')
        .get(hash(sid), Date.now()),
    );
  app.disable('x-powered-by');
  app.use(
    express.json({
      limit: '256kb',
      type: ['application/json', 'text/plain'],
      verify: (req, _res, body) => {
        if (req.originalUrl.startsWith('/api/webhooks/')) req.rawBody = Buffer.from(body);
      },
    }),
  );
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const project = (value) => {
    const p = db.prepare('SELECT * FROM projects WHERE id=?').get(String(value || 'demo'));
    if (!p) throw Object.assign(new Error('Operação não encontrada.'), { status: 404 });
    return p;
  };
  const publicPath = (req) =>
    req.path.startsWith('/api/collect/') ||
    req.path.startsWith('/api/webhooks/') ||
    req.path.startsWith('/api/r/') ||
    req.path === '/api/track-events' ||
    req.path === '/api/compat/utmify' ||
    req.path.startsWith('/api/meta/oauth/start/') ||
    req.path === '/api/meta/oauth/callback' ||
    req.path === '/api/internal/capi-drain' ||
    req.path === '/api/internal/rules-run' ||
    ['/api/health', '/api/session', '/api/login'].includes(req.path);
  app.use('/api', (req, res, next) => {
    // originalUrl retains the /api mount prefix.
    const full = { path: req.originalUrl.split('?')[0] };
    if (publicPath(full)) return next();
    const sessionId = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wt_session='))
      ?.slice(11);
    if (password && !sessionValid(sessionId))
      return res.status(401).json({ error: 'Entre para acessar sua operação.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const allowed = new Set([
        `http://${req.headers.host}`,
        `https://${req.headers.host}`,
        process.env.PUBLIC_URL,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ]);
      if (!allowed.has(req.headers.origin))
        return res.status(403).json({ error: 'Origem não permitida.' });
    }
    next();
  });
  registerTracking(app, db, { project, range, meta });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  if (options.storageCheck)
    app.get('/api/internal/storage-check', async (req, res) => {
      const sessionId = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('wt_session='))
        ?.slice(11);
      if (!password || !sessionValid(sessionId))
        return res.status(401).json({ error: 'Entre para consultar o armazenamento.' });
      res.json(await options.storageCheck());
    });
  app.get('/api/internal/capi-drain', async (req, res) => {
    const expected = process.env.CRON_SECRET;
    if (
      !expected ||
      !timingSafeEqual(
        Buffer.from(hash(req.headers.authorization || '')),
        Buffer.from(hash(`Bearer ${expected}`)),
      )
    )
      return res.status(401).json({ error: 'Não autorizado.' });
    await app.locals.drain();
    res.json({ ok: true });
  });
  app.get('/api/internal/rules-run', async (req, res) => {
    const expected = process.env.RULES_CRON_SECRET;
    if (
      !expected ||
      !timingSafeEqual(
        Buffer.from(hash(req.headers.authorization || '')),
        Buffer.from(hash(`Bearer ${expected}`)),
      )
    )
      return res.status(401).json({ error: 'Não autorizado.' });
    const checkOnly = z.enum(['0', '1']).optional().parse(req.query.check_only);
    if (checkOnly === '1') {
      db.prepare('SELECT COUNT(*) AS count FROM rule_configs').get();
      return res.json({ ok: true, check_only: true });
    }
    const results = await rules.runAll();
    res
      .status(results.some((r) => r.failures) ? 502 : 200)
      .json({ ok: !results.some((r) => r.failures), results });
  });
  app.get('/api/session', (req, res) => {
    const sid = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wt_session='))
      ?.slice(11);
    res.json({
      authenticated: !password || sessionValid(sid),
      local: !password,
    });
  });
  app.post('/api/login', (req, res) => {
    const key = hash(req.ip || 'unknown');
    const attempt = db
      .prepare('SELECT count,expires_at AS until FROM login_attempts WHERE ip_hash=?')
      .get(key) || { count: 0, until: Date.now() + 600000 };
    if (attempt.until < Date.now()) {
      attempt.count = 0;
      attempt.until = Date.now() + 600000;
    }
    attempt.count++;
    db.prepare(
      'INSERT INTO login_attempts VALUES(?,?,?) ON CONFLICT(ip_hash) DO UPDATE SET count=excluded.count,expires_at=excluded.expires_at',
    ).run(key, attempt.count, attempt.until);
    if (attempt.count > 10)
      return res.status(429).json({ error: 'Muitas tentativas. Tente em 10 minutos.' });
    if (
      password &&
      !timingSafeEqual(Buffer.from(hash(String(req.body.password))), Buffer.from(hash(password)))
    )
      return res.status(401).json({ error: 'Senha incorreta.' });
    db.prepare('DELETE FROM login_attempts WHERE ip_hash=?').run(key);
    const sid = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<?').run(Date.now());
    db.prepare('INSERT INTO admin_sessions VALUES(?,?)').run(hash(sid), Date.now() + 86400000);
    res.setHeader(
      'Set-Cookie',
      `wt_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.PUBLIC_URL?.startsWith('https:') ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    const sid = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wt_session='))
      ?.slice(11);
    if (sid) db.prepare('DELETE FROM admin_sessions WHERE id_hash=?').run(hash(sid));
    res.setHeader('Set-Cookie', 'wt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/projects', (_req, res) =>
    res.json(db.prepare('SELECT * FROM projects ORDER BY demo DESC').all()),
  );
  app.get('/api/dashboard', (req, res) => {
    const p = project(req.query.project),
      r = range(req.query);
    const currency = z.enum(['BRL', 'USD']).default('BRL').parse(req.query.currency);
    res.json(dashboardReport(db, p, r.start, r.end, currency));
    if (!options.serverless && !p.demo) void rules.run(p.id).catch(() => {});
  });
  app.get('/api/ad-hierarchy', (req, res) => {
    const p = project(req.query.project),
      r = range(req.query),
      level = z.enum(['campaigns', 'adsets', 'ads']).parse(req.query.level || 'campaigns'),
      parent = z.string().max(100).optional().parse(req.query.parent);
    const currency = z.enum(['BRL', 'USD']).default('BRL').parse(req.query.currency);
    res.json({
      level,
      currency,
      rows: hierarchyReport(db, p.id, r.start, r.end, level, parent, currency),
    });
  });
  app.get('/api/sale-attribution-options', (req, res) => {
    const p = project(req.query.project);
    const campaigns = visibleCampaigns(db, p.id);
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const adsets = db
      .prepare(
        'SELECT a.* FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id WHERE c.project_id=? ORDER BY a.name,a.id',
      )
      .all(p.id)
      .filter((a) => campaignIds.has(a.campaign_id));
    const adsetIds = new Set(adsets.map((a) => a.id));
    const ads = db
      .prepare(
        'SELECT ad.* FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN campaigns c ON c.id=a.campaign_id WHERE c.project_id=? ORDER BY ad.name,ad.id',
      )
      .all(p.id)
      .filter((ad) => adsetIds.has(ad.adset_id));
    res.json({ campaigns, adsets, ads });
  });
  app.patch('/api/sales/:id/attribution', (req, res) => {
    const data = z
      .object({
        project_id: z.string().min(1),
        campaign_id: z.string().min(1).max(100),
        adset_id: z.string().min(1).max(100).nullable().default(null),
        ad_id: z.string().min(1).max(100).nullable().default(null),
      })
      .strict()
      .parse(req.body);
    const p = project(data.project_id);
    const sale = db
      .prepare('SELECT * FROM sales WHERE id=? AND project_id=?')
      .get(req.params.id, p.id);
    if (!sale) return res.status(404).json({ error: 'Venda não encontrada nesta operação.' });
    const campaign = visibleCampaigns(db, p.id).find((c) => c.id === data.campaign_id);
    if (!campaign)
      return res.status(400).json({ error: 'Selecione uma campanha disponível nesta operação.' });
    const adset = data.adset_id ? resolveAdset(db, p.id, data.adset_id) : null;
    if (
      data.adset_id &&
      (!adset || adset.adset_id !== data.adset_id || adset.campaign_id !== campaign.id)
    )
      return res.status(400).json({ error: 'O conjunto deve pertencer à campanha selecionada.' });
    const ad = data.ad_id ? resolveAd(db, p.id, data.ad_id) : null;
    if (data.ad_id && (!ad || ad.id !== data.ad_id || !adset || ad.adset_id !== adset.adset_id))
      return res.status(400).json({ error: 'O anúncio deve pertencer ao conjunto selecionado.' });
    db.exec('BEGIN');
    try {
      // Backfill legacy references before replacing the resolved hierarchy.
      const previous = db.prepare('SELECT * FROM sale_attribution WHERE sale_id=?').get(sale.id);
      if (!isManualAttribution(db, sale.id))
        saveSaleTracking(db, sale.id, '', previous?.adset_id, previous?.ad_id);
      db.prepare('UPDATE sales SET campaign_id=? WHERE id=?').run(campaign.id, sale.id);
      db.prepare(
        'INSERT INTO sale_attribution(sale_id,adset_id,ad_id) VALUES(?,?,?) ON CONFLICT(sale_id) DO UPDATE SET adset_id=excluded.adset_id,ad_id=excluded.ad_id',
      ).run(sale.id, data.adset_id, data.ad_id);
      db.prepare(
        'INSERT INTO manual_sale_attribution VALUES(?,?) ON CONFLICT(sale_id) DO UPDATE SET updated_at=excluded.updated_at',
      ).run(sale.id, now());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json(reportSales(db, p.id, sale.day, sale.day).find((s) => s.id === sale.id));
  });
  app.get('/api/meta/entities/:level/:id', async (req, res) => {
    const p = project(z.string().parse(req.query.project));
    const level = z.enum(['campaigns', 'adsets', 'ads']).parse(req.params.level);
    res.json(await meta.management.inspect(p.id, level, req.params.id));
  });
  app.patch('/api/meta/entities/:level/:id', async (req, res) => {
    const input = z
      .object({
        project_id: z.string(),
        expected_revision: z.string().regex(/^[a-f0-9]{64}$/),
        name: z.string().trim().min(1).max(200).optional(),
        active: z.boolean().optional(),
        budget: z
          .number()
          .positive()
          .max(1000000)
          .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.000001)
          .optional(),
      })
      .strict()
      .refine((v) => v.name !== undefined || v.active !== undefined || v.budget !== undefined)
      .parse(req.body);
    project(input.project_id);
    const level = z.enum(['campaigns', 'adsets', 'ads']).parse(req.params.level);
    res.json(await meta.management.update(input.project_id, level, req.params.id, input));
  });
  app.patch('/api/ad-entities/:level/:id', (req, res) => {
    const data = z.object({ project_id: z.string(), active: z.boolean() }).parse(req.body);
    project(data.project_id);
    const level = z.enum(['adsets', 'ads']).parse(req.params.level);
    const table = level === 'adsets' ? 'ad_sets' : 'ads';
    const entity =
      level === 'adsets'
        ? db
            .prepare(
              'SELECT a.id,m.external_id AS meta_id FROM ad_sets a JOIN campaigns c ON c.id=a.campaign_id LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE a.id=? AND c.project_id=?',
            )
            .get(req.params.id, data.project_id)
        : db
            .prepare(
              'SELECT ad.id,m.external_id AS meta_id FROM ads ad JOIN ad_sets a ON a.id=ad.adset_id JOIN campaigns c ON c.id=a.campaign_id LEFT JOIN meta_campaigns m ON m.campaign_id=c.id WHERE ad.id=? AND c.project_id=?',
            )
            .get(req.params.id, data.project_id);
    if (!entity) return res.status(404).json({ error: 'Item não encontrado nesta operação.' });
    if (entity.meta_id)
      return res.status(409).json({
        error: 'Edite este item pela ação de gestão Meta para confirmar a alteração na plataforma.',
      });
    db.prepare(`UPDATE ${table} SET active=? WHERE id=?`).run(Number(data.active), req.params.id);
    res.json({ ok: true, local_only: true });
  });
  app.get('/api/visitors', (req, res) => {
    const p = project(req.query.project),
      r = range(req.query),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(req.query.page || 1),
      q = z
        .string()
        .max(150)
        .parse(req.query.q || '');
    res.json(visitorList(db, p.id, r.start, r.end, q, page));
  });
  app.get('/api/visitors/:id', (req, res) => {
    const p = project(req.query.project),
      r = range(req.query);
    res.json(visitorJourney(db, p.id, z.string().max(100).parse(req.params.id), r.start, r.end));
  });
  app.post('/api/campaigns', (req, res) => {
    const c = campaignSchema.parse(req.body);
    project(c.project_id);
    const cid = id('cmp');
    db.prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)').run(
      cid,
      c.project_id,
      c.name,
      c.source,
      c.budget,
      1,
      now(),
    );
    db.prepare('INSERT INTO campaign_currencies VALUES(?,?)').run(cid, c.currency);
    res.status(201).json({ id: cid });
  });
  app.patch('/api/campaigns/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Campanha não encontrada.' });
    if (db.prepare('SELECT 1 FROM meta_campaigns WHERE campaign_id=?').get(c.id))
      return res.status(409).json({
        error:
          'Edite esta campanha pela ação de gestão Meta para confirmar a alteração na plataforma.',
      });
    const data = z
      .object({ active: z.boolean().optional(), budget: z.number().min(0).max(1000000).optional() })
      .parse(req.body);
    db.prepare('UPDATE campaigns SET active=?,budget=? WHERE id=?').run(
      data.active === undefined ? c.active : Number(data.active),
      data.budget ?? c.budget,
      c.id,
    );
    res.json({ ok: true, local_only: true });
  });
  app.put('/api/campaigns/:id/spend', (req, res) => {
    const data = z
      .object({
        day: dateSchema,
        amount: z.number().min(0).max(10000000),
        impressions: z.number().int().min(0).max(1000000000).default(0),
        clicks: z.number().int().min(0).max(1000000000).default(0),
      })
      .parse(req.body);
    if (!db.prepare('SELECT id FROM campaigns WHERE id=?').get(req.params.id))
      return res.status(404).json({ error: 'Campanha não encontrada.' });
    if (db.prepare('SELECT campaign_id FROM meta_campaigns WHERE campaign_id=?').get(req.params.id))
      return res
        .status(400)
        .json({ error: 'O investimento desta campanha é sincronizado pela Meta.' });
    db.prepare(
      'INSERT INTO spend VALUES(?,?,?,?,?) ON CONFLICT(campaign_id,day) DO UPDATE SET amount=excluded.amount,impressions=excluded.impressions,clicks=excluded.clicks',
    ).run(req.params.id, data.day, data.amount, data.impressions, data.clicks);
    res.json({ ok: true });
  });
  app.post('/api/meta/connect', async (req, res) => {
    const data = z
      .object({ project_id: z.string(), access_token: z.string().min(15).max(5000) })
      .parse(req.body);
    project(data.project_id);
    res.json(await meta.connect(data.project_id, data.access_token));
  });
  app.put('/api/meta/accounts/:id', (req, res) => {
    const data = z.object({ project_id: z.string(), enabled: z.boolean() }).parse(req.body);
    project(data.project_id);
    res.json({ accounts: meta.selectAccount(data.project_id, req.params.id, data.enabled) });
  });
  app.post('/api/meta/oauth/links', (req, res) => {
    const data = z.object({ project_id: z.string() }).parse(req.body);
    project(data.project_id);
    res.status(201).json(oauth.createLink(data.project_id));
  });
  app.get('/api/meta/oauth/start/:ticket', (req, res) => {
    const result = oauth.start(req.params.ticket);
    res.setHeader('Set-Cookie', result.cookie);
    res.redirect(302, result.url);
  });
  app.get('/api/meta/oauth/callback', async (req, res) => {
    await oauth.callback(req.query, req.headers.cookie || '');
    res.setHeader(
      'Set-Cookie',
      'wt_oauth_bind=; HttpOnly; Secure; SameSite=Lax; Path=/api/meta/oauth; Max-Age=0',
    );
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    res
      .type('html')
      .send(
        '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WeTrack · Conexão concluída</title><body style="font-family:system-ui;background:#0c1018;color:#e9edf6;padding:48px;line-height:1.8"><h1>Conexão concluída.</h1><p>O perfil autorizou a WeTrack. Volte ao painel e selecione as contas de anúncios que deseja incluir.</p><p>Você já pode fechar esta aba. Nenhuma campanha foi alterada.</p></body></html>',
      );
  });
  app.post('/api/meta/sync', async (req, res) => {
    const data = z
      .object({ project_id: z.string(), start: dateSchema, end: dateSchema })
      .parse(req.body);
    project(data.project_id);
    if (data.start > data.end || (Date.parse(data.end) - Date.parse(data.start)) / 86400000 > 90)
      return res.status(400).json({ error: 'Sincronize até 90 dias por vez.' });
    res.json(await meta.sync(data.project_id, data.start, data.end));
  });
  app.delete('/api/meta/:project', (req, res) => {
    project(req.params.project);
    db.prepare('DELETE FROM meta_connections WHERE project_id=?').run(req.params.project);
    res.json({ ok: true });
  });
  app.get('/api/integrations', (req, res) => {
    const p = project(req.query.project);
    const connection = db
      .prepare('SELECT accounts,connected_at,last_sync FROM meta_connections WHERE project_id=?')
      .get(p.id);
    res.json({
      pixels: db
        .prepare(
          'SELECT p.*, (SELECT COUNT(*) FROM events e WHERE e.pixel_id=p.id) AS events, (SELECT MAX(created_at) FROM events e WHERE e.pixel_id=p.id) AS last_event, EXISTS(SELECT 1 FROM pixel_capi pc WHERE pc.pixel_id=p.id) AS capi_configured, (SELECT meta_pixel_id FROM pixel_capi pc WHERE pc.pixel_id=p.id) AS meta_pixel_id, (SELECT test_event_code FROM pixel_capi pc WHERE pc.pixel_id=p.id) AS test_event_code FROM pixels p WHERE project_id=?',
        )
        .all(p.id),
      tokens: db
        .prepare(
          'SELECT id,name,platform,token_hint,active,last_used,created_at FROM integrations WHERE project_id=? AND active=1',
        )
        .all(p.id),
      providers: platforms.list(p.id),
      meta: {
        configured: meta.configured,
        connected: Boolean(connection),
        accounts: meta.accountsFor(p.id),
        oauth: oauth.configuration(),
        last_sync: connection?.last_sync,
      },
      capi: db
        .prepare(
          'SELECT status,COUNT(*) AS count FROM capi_queue WHERE project_id=? GROUP BY status',
        )
        .all(p.id),
      base_url: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`,
    });
  });
  app.post('/api/pixels', (req, res) => {
    const pixel = pixelSchema.parse(req.body);
    project(pixel.project_id);
    const capi = z.object({
      meta_pixel_id: z.string().regex(/^\d{5,30}$/),
      capi_token: z.string().min(15).max(5000),
      test_event_code: z.string().max(100).optional(),
    });
    const config = req.body.meta_pixel_id || req.body.capi_token ? capi.parse(req.body) : null;
    if (config && !meta.configured)
      return res
        .status(503)
        .json({ error: 'Configure META_GRAPH_VERSION no servidor antes de ativar CAPI.' });
    const pid = id('px');
    db.prepare('INSERT INTO pixels VALUES(?,?,?,?,?,?,?)').run(
      pid,
      pixel.project_id,
      pixel.name,
      new URL(pixel.domain).origin,
      pixel.checkout_url,
      1,
      now(),
    );
    if (config)
      meta.configurePixel(pid, config.meta_pixel_id, config.capi_token, config.test_event_code);
    res.status(201).json({ id: pid });
  });
  app.patch('/api/pixels/:id', (req, res) => {
    const data = z.object({ active: z.boolean() }).parse(req.body);
    const result = db
      .prepare('UPDATE pixels SET active=? WHERE id=?')
      .run(Number(data.active), req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Pixel não encontrado.' });
    res.json({ ok: true });
  });
  app.delete('/api/pixels/:id', (req, res) => {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM integration_pixels WHERE pixel_id=?').run(req.params.id);
      db.prepare('DELETE FROM pixel_capi WHERE pixel_id=?').run(req.params.id);
      db.prepare('DELETE FROM capi_queue WHERE pixel_id=?').run(req.params.id);
      db.prepare(
        'DELETE FROM event_details WHERE event_id IN (SELECT id FROM events WHERE pixel_id=?)',
      ).run(req.params.id);
      db.prepare('DELETE FROM events WHERE pixel_id=?').run(req.params.id);
      db.prepare('DELETE FROM pixels WHERE id=?').run(req.params.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });
  app.get('/api/pixels/:id/events', (req, res) =>
    res.json(
      db
        .prepare(
          'SELECT event_name,page_url,utm_source,created_at FROM events WHERE pixel_id=? ORDER BY created_at DESC LIMIT 15',
        )
        .all(req.params.id),
    ),
  );
  app.put('/api/pixels/:id/capi', (req, res) => {
    const data = z
      .object({
        meta_pixel_id: z.string().regex(/^\d{5,30}$/),
        capi_token: z.string().min(15).max(5000),
        test_event_code: z.string().max(100).optional(),
      })
      .parse(req.body);
    if (!db.prepare('SELECT id FROM pixels WHERE id=?').get(req.params.id))
      return res.status(404).json({ error: 'Pixel não encontrado.' });
    meta.configurePixel(req.params.id, data.meta_pixel_id, data.capi_token, data.test_event_code);
    res.json({ ok: true });
  });
  app.get('/api/capi', (req, res) => {
    const p = project(req.query.project);
    res.json(
      db
        .prepare(
          'SELECT q.id,q.status,q.attempts,q.last_error,q.created_at,p.name AS pixel_name FROM capi_queue q LEFT JOIN pixels p ON p.id=q.pixel_id WHERE q.project_id=? ORDER BY q.created_at DESC LIMIT 50',
        )
        .all(p.id),
    );
  });
  app.post('/api/capi/:id/retry', (req, res) => {
    const job = db
      .prepare("SELECT * FROM capi_queue WHERE id=? AND status='failed'")
      .get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Envio com falha não encontrado.' });
    if (!Object.keys(JSON.parse(job.payload).user_data).length)
      return res.status(400).json({
        error:
          'Este evento não possui identificador do comprador. Corrija os dados na origem para novos pedidos.',
      });
    db.prepare(
      "UPDATE capi_queue SET status='pending',attempts=0,next_attempt=0,last_error=NULL WHERE id=?",
    ).run(job.id);
    res.json({ ok: true });
  });
  app.post('/api/tokens', (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(80),
        platform: z.literal('API personalizada'),
        project_id: z.string(),
      })
      .parse(req.body);
    project(data.project_id);
    const token = `wt_${randomBytes(24).toString('hex')}`;
    const tid = id('int');
    if (
      req.body.pixel_id &&
      !db
        .prepare('SELECT id FROM pixels WHERE id=? AND project_id=?')
        .get(String(req.body.pixel_id), data.project_id)
    )
      return res.status(400).json({ error: 'Pixel inválido para esta operação.' });
    db.prepare('INSERT INTO integrations VALUES(?,?,?,?,?,?,?,?,?)').run(
      tid,
      data.project_id,
      data.name,
      data.platform,
      hash(token),
      token.slice(-6),
      1,
      null,
      now(),
    );
    if (req.body.pixel_id)
      db.prepare('INSERT INTO integration_pixels VALUES(?,?)').run(tid, String(req.body.pixel_id));
    res.status(201).json({
      id: tid,
      token,
      url: `${process.env.PUBLIC_URL || 'http://localhost:3001'}/api/webhooks/${token}`,
    });
  });
  app.delete('/api/tokens/:id', (req, res) => {
    db.prepare('DELETE FROM integration_pixels WHERE integration_id=?').run(req.params.id);
    db.prepare('UPDATE integrations SET active=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/platform-connections', (req, res) => {
    const data = z
      .object({
        project_id: z.string(),
        provider: providerSchema,
        name: z.string().trim().min(2).max(80),
      })
      .strict()
      .parse(req.body);
    project(data.project_id);
    res.status(201).json(platforms.create(data.project_id, data.provider, data.name));
  });
  app.patch('/api/platform-connections/:id', async (req, res) => {
    const data = z
      .object({
        project_id: z.string(),
        name: z.string().trim().min(2).max(80),
        secret: z.string().trim().min(8).max(1000).optional(),
        test_mode: z.boolean(),
        purchase_owner: z.enum(['checkout', 'wetrack']),
        pixel_id: z.string().default(''),
        confirm_purchase_owner: z.boolean().default(false),
        confirm_live: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    project(data.project_id);
    if (!data.test_mode && !data.confirm_live)
      return res.status(400).json({ error: 'Confirme a liberação de vendas reais.' });
    res.json(await platforms.configure(req.params.id, data.project_id, data));
  });
  app.get('/api/platform-connections/:id/receipts', (req, res) => {
    const p = project(req.query.project);
    res.json(platforms.receipts(p.id, req.params.id));
  });
  app.post('/api/platform-connections/:id/reconcile', (req, res) => {
    const p = project(z.object({ project_id: z.string() }).parse(req.body).project_id);
    res.json(platforms.reconcile(p.id, req.params.id));
    if (!options.serverless) void app.locals.drain().catch(() => {});
  });
  app.post('/api/platform-receipts/:id/retry', (req, res) => {
    const p = project(z.object({ project_id: z.string() }).parse(req.body).project_id);
    platforms.retry(p.id, req.params.id);
    res.json({ ok: true });
    if (!options.serverless) void app.locals.drain().catch(() => {});
  });
  app.get('/api/rules', (req, res) => {
    const p = project(req.query.project);
    const currency = z.enum(['BRL', 'USD']).default('BRL').parse(req.query.currency);
    res.json({
      rules: ruleReport(db, p.id, visibleCampaigns(db, p.id, currency)).filter(
        (r) => r.currency === currency,
      ),
      campaigns: visibleCampaigns(db, p.id, currency),
      history: rules.history(p.id).filter((r) => (r.metrics.currency || 'BRL') === currency),
      worker:
        db
          .prepare(
            'SELECT last_attempt,last_run,last_error,next_run FROM rule_worker_state WHERE project_id=?',
          )
          .get(p.id) || null,
    });
  });
  app.post('/api/rules/preview', (req, res) => {
    const { rule_id, ...input } = req.body;
    const ruleId = z.string().min(1).optional().parse(rule_id);
    res.json(rules.preview(input, ruleId));
  });
  app.post('/api/rules/run', async (req, res) => {
    const p = project(z.object({ project_id: z.string() }).strict().parse(req.body).project_id);
    res.json(await rules.run(p.id, { force: true }));
  });
  app.post('/api/rules', (req, res) => res.status(201).json(rules.save(req.body)));
  app.put('/api/rules/:id', (req, res) => res.json(rules.save(req.body, req.params.id)));
  app.patch('/api/rules/:id', (req, res) => {
    const d = z.object({ project_id: z.string(), active: z.boolean() }).strict().parse(req.body);
    project(d.project_id);
    if (!configuredRules(db, d.project_id).some((r) => r.id === req.params.id))
      return res.status(404).json({ error: 'Regra não encontrada nesta operação.' });
    db.prepare('UPDATE rules SET active=? WHERE id=? AND project_id=?').run(
      Number(d.active),
      req.params.id,
      d.project_id,
    );
    res.json({ ok: true });
  });
  app.delete('/api/rules/:id', (req, res) => {
    const p = project(z.string().parse(req.query.project));
    const result = db
      .prepare('DELETE FROM rules WHERE id=? AND project_id=?')
      .run(req.params.id, p.id);
    if (!result.changes)
      return res.status(404).json({ error: 'Regra não encontrada nesta operação.' });
    res.json({ ok: true });
  });
  app.get('/api/settings', (_req, res) =>
    res.json(
      Object.fromEntries(
        db
          .prepare('SELECT * FROM settings')
          .all()
          .map((s) => [s.key, JSON.parse(s.value)]),
      ),
    ),
  );
  app.put('/api/settings', (req, res) => {
    const data = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.string().email(),
        sale_alerts: z.boolean(),
        rule_alerts: z.boolean(),
      })
      .parse(req.body);
    const stmt = db.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    );
    Object.entries(data).forEach(([k, v]) => stmt.run(k, JSON.stringify(v)));
    res.json({ ok: true });
  });
  const receiveSale = (req, res) => {
    const integration = db
      .prepare('SELECT * FROM integrations WHERE token_hash=? AND active=1')
      .get(hash(req.params.token));
    if (!integration) return res.status(401).json({ error: 'Token inválido ou revogado.' });
    if (req.utmifyFormat) {
      if (
        db.prepare('SELECT 1 FROM provider_connections WHERE integration_id=?').get(integration.id)
      )
        return res
          .status(400)
          .json({ error: 'Use um token da API personalizada para este formato.' });
      const normalized = normalizeUtmify(req.body);
      if (normalized.isTest) return res.json({ ok: true, test: true });
      req.body = normalized.sale;
    }
    if (
      db.prepare('SELECT 1 FROM provider_connections WHERE integration_id=?').get(integration.id)
    ) {
      const result = platforms.receive(integration, req.body, req.headers, req.rawBody);
      res.json(result);
      if (!options.serverless) void app.locals.drain().catch(() => {});
      return;
    }
    const data = recoverReference(db, integration.project_id, webhookSchema.parse(req.body));
    const campaign = resolveCampaign(db, integration.project_id, data.utm_campaign);
    const previous = db
      .prepare('SELECT id,status FROM sales WHERE integration_id=? AND external_id=?')
      .get(integration.id, data.order_id);
    if (
      req.utmifyFormat &&
      previous &&
      ((['refunded', 'chargeback'].includes(previous.status) &&
        !['refunded', 'chargeback'].includes(data.status)) ||
        (previous.status === 'approved' && ['pending', 'canceled'].includes(data.status)))
    )
      return res.json({
        ok: true,
        id: previous.id,
        duplicate: true,
        ignored: true,
        capi: 'not_queued',
      });
    const time = data.created_at || now();
    const sid = previous?.id || id('sale');
    const manual = isManualAttribution(db, sid);
    let attributionAd = data.ad_id || data.utm_content || '',
      attributionSet = data.adset_id || data.utm_term || '';
    let queued = false;
    db.exec('BEGIN');
    try {
      if (previous) {
        db.prepare('UPDATE sales SET status=?,amount=? WHERE id=?').run(
          data.status,
          data.amount,
          sid,
        );
      } else {
        let source = data.utm_source,
          campaignName = data.utm_campaign;
        if (data.visitor_id && source === 'direct') {
          const since = new Date(Date.now() - 7 * 86400000).toISOString();
          const attribution = db
            .prepare(
              "SELECT e.utm_source,e.utm_campaign,d.utm_medium,d.utm_content,d.utm_term FROM events e LEFT JOIN event_details d ON d.event_id=e.id WHERE e.project_id=? AND e.visitor_id=? AND e.created_at>=? AND e.utm_source NOT IN ('direct','') ORDER BY e.created_at DESC LIMIT 1",
            )
            .get(integration.project_id, data.visitor_id, since);
          if (attribution) {
            source = attribution.utm_source;
            campaignName = attribution.utm_campaign;
            attributionAd ||= attribution.utm_content || '';
            attributionSet ||= attribution.utm_term || '';
            data.utm_medium ||= attribution.utm_medium || '';
            data.utm_content ||= attribution.utm_content || '';
            data.utm_term ||= attribution.utm_term || '';
          }
        }
        const attributed = campaign || resolveCampaign(db, integration.project_id, campaignName);
        db.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
          sid,
          integration.project_id,
          data.order_id,
          integration.id,
          attributed?.id || null,
          data.customer_name,
          data.customer_email || null,
          data.product,
          data.amount,
          data.status,
          data.payment_method,
          source,
          campaignName,
          data.utm_medium,
          data.utm_content,
          time,
          dateKey(new Date(time)),
        );
      }
      saveSaleCurrency(db, sid, data.currency, Boolean(previous));
      const ad = resolveAd(db, integration.project_id, attributionAd);
      const adset = ad || resolveAdset(db, integration.project_id, attributionSet);
      if (adset && !manual)
        db.prepare('UPDATE sales SET campaign_id=? WHERE id=?').run(adset.campaign_id, sid);
      saveSaleTracking(db, sid, data.utm_term, attributionSet, attributionAd);
      db.prepare(
        `INSERT INTO sale_attribution VALUES(?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET visitor_id=COALESCE(excluded.visitor_id,sale_attribution.visitor_id)${manual ? '' : ',adset_id=COALESCE(excluded.adset_id,sale_attribution.adset_id),ad_id=COALESCE(excluded.ad_id,sale_attribution.ad_id)'}`,
      ).run(
        sid,
        data.visitor_id || null,
        adset?.adset_id || attributionSet || null,
        ad?.id || attributionAd || null,
      );
      db.prepare('UPDATE integrations SET last_used=? WHERE id=?').run(now(), integration.id);
      queued =
        data.status === 'approved' && previous?.status !== 'approved'
          ? meta.enqueue(sid, integration.id, data)
          : false;
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({
      ok: true,
      id: sid,
      duplicate: Boolean(previous),
      capi: queued ? 'queued' : 'not_queued',
    });
  };
  app.post('/api/webhooks/:token', receiveSale);
  app.post('/api/compat/utmify', (req, res) => {
    req.params.token = String(req.headers['x-api-token'] || '');
    req.utmifyFormat = true;
    receiveSale(req, res);
  });
  app.options('/api/collect/:pixel', (req, res) => {
    const pixel = db
      .prepare('SELECT domain FROM pixels WHERE id=? AND active=1')
      .get(req.params.pixel);
    if (pixel?.domain === req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', pixel.domain);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST');
    }
    res.sendStatus(204);
  });
  app.post('/api/collect/:pixel', (req, res) => {
    const pixel = db.prepare('SELECT * FROM pixels WHERE id=? AND active=1').get(req.params.pixel);
    if (!pixel) return res.status(404).json({ error: 'Pixel inativo ou inexistente.' });
    if (req.headers.origin !== pixel.domain)
      return res.status(403).json({ error: 'Domínio não autorizado.' });
    res.setHeader('Access-Control-Allow-Origin', pixel.domain);
    const data = z
      .object({
        event_id: z.string().min(8).max(100),
        visitor_id: z.string().min(8).max(100),
        attribution_code: z
          .string()
          .regex(/^wt[a-zA-Z0-9]{16,26}$/)
          .optional(),
        fbp: z.string().max(200).optional(),
        fbc: z.string().max(300).optional(),
        event_name: eventNameSchema,
        page_view_id: z.string().min(8).max(100).optional(),
        duration_ms: z.number().int().min(0).max(86400000).optional(),
        active_ms: z.number().int().min(0).max(86400000).optional(),
        scroll_depth: z.number().int().min(0).max(100).optional(),
        away_ms: z.number().int().min(0).max(86400000).optional(),
        occurred_at: z.string().datetime().optional(),
        reason: z
          .enum([
            'heartbeat',
            'hidden',
            'exit',
            'navigation',
            'visible',
            'history',
            'after_checkout_click',
          ])
          .optional(),
        session_id: z.string().min(8).max(100).optional(),
        page_title: z.string().max(200).optional(),
        referrer: z.string().max(2000).optional(),
        section: z.string().max(120).optional(),
        target_url: z.string().max(2000).optional(),
        utm_medium: z.string().max(100).optional(),
        utm_content: z.string().max(200).optional(),
        utm_term: z.string().max(200).optional(),
        page_url: z.string().url().max(2000),
        utm_source: z.string().max(100).default('direct'),
        utm_campaign: z.string().max(200).default(''),
      })
      .extend(signalSchema.shape)
      .parse(req.body);
    if (data.active_ms != null && data.active_ms > (data.duration_ms ?? 0))
      return res.status(400).json({ error: 'Tempo ativo maior que o tempo na página.' });
    if (new URL(data.page_url).origin !== pixel.domain)
      return res.status(403).json({ error: 'Página fora do domínio autorizado.' });
    // A browser Purchase is an event, never a confirmed sale. Revenue comes from webhooks.
    const inserted = db
      .prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        data.event_id,
        pixel.id,
        pixel.project_id,
        data.visitor_id,
        data.event_name,
        new URL(data.page_url).origin + new URL(data.page_url).pathname,
        data.utm_source,
        data.utm_campaign,
        now(),
        dateKey(),
      );
    const cleanUrl = (value) => {
      try {
        const u = new URL(value);
        return ['http:', 'https:'].includes(u.protocol) ? u.origin + u.pathname : null;
      } catch {
        return null;
      }
    };
    if (inserted.changes)
      db.prepare('INSERT INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
        data.event_id,
        data.session_id || data.visitor_id,
        data.page_title || null,
        cleanUrl(data.referrer),
        data.section || null,
        cleanUrl(data.target_url),
        data.utm_medium || null,
        data.utm_content || null,
        data.utm_term || null,
      );
    if (inserted.changes && data.page_view_id)
      db.prepare('INSERT INTO event_engagement VALUES(?,?,?,?,?,?,?,?)').run(
        data.event_id,
        data.page_view_id,
        data.duration_ms ?? null,
        data.active_ms ?? null,
        data.scroll_depth ?? null,
        data.reason || null,
        data.away_ms ?? null,
        data.occurred_at || null,
      );
    if (data.attribution_code)
      db.prepare(
        "INSERT INTO checkout_refs VALUES(?,?,?,?) ON CONFLICT(project_id,code) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at WHERE json_extract(checkout_refs.payload,'$.visitor_id')=json_extract(excluded.payload,'$.visitor_id')",
      ).run(
        pixel.project_id,
        data.attribution_code,
        JSON.stringify({
          visitor_id: data.visitor_id,
          utm_source: data.utm_source,
          utm_campaign: data.utm_campaign,
          utm_medium: data.utm_medium || '',
          utm_content: data.utm_content || '',
          utm_term: data.utm_term || '',
          fbp: data.fbp,
          fbc: data.fbc,
        }),
        Date.now() + 30 * 86400000,
      );
    if (inserted.changes) {
      saveSignals(db, data, 'browser');
      const enabled = db
        .prepare('SELECT capi_events FROM pixel_tracking WHERE pixel_id=?')
        .get(pixel.id)?.capi_events;
      if (enabled)
        meta.enqueueEvent(pixel.id, data.event_id, {
          ...data,
          client_ip_address: req.ip,
          client_user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
        });
    }
    res.json({ ok: true });
  });
  app.get('/pixel.js', (_req, res) =>
    res.type('application/javascript').sendFile(resolve('server/pixel.js')),
  );
  if (existsSync(resolve('dist/index.html'))) {
    app.use(express.static(resolve('dist')));
    app.get('/{*path}', (req, res, next) =>
      req.path.startsWith('/api/') ? next() : res.sendFile(resolve('dist/index.html')),
    );
  }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint não encontrado.' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError)
      return res
        .status(400)
        .json({ error: 'Verifique os campos informados.', details: error.flatten() });
    const status = error.status || 500;
    if (status === 500) console.error('API error:', error.message);
    res
      .status(status)
      .json({ error: status === 500 ? 'Não foi possível concluir a operação.' : error.message });
  });
  return app;
}
