import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { dateKey } from './domain.mjs';

export const eventNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{1,63}$/);
export const signalSchema = z.object({
  value: z.number().finite().min(0).max(10000000).optional(),
  currency: z.enum(['BRL']).default('BRL'),
  content_id: z.string().max(120).optional(),
  content_name: z.string().max(150).optional(),
  click_ids: z
    .object({
      fbclid: z.string().max(300).optional(),
      gclid: z.string().max(300).optional(),
      ttclid: z.string().max(300).optional(),
      msclkid: z.string().max(300).optional(),
      gbraid: z.string().max(300).optional(),
      wbraid: z.string().max(300).optional(),
      kwai_click_id: z.string().max(300).optional(),
    })
    .optional(),
  first_touch: z
    .object({
      utm_source: z.string().max(100).optional(),
      utm_campaign: z.string().max(200).optional(),
      utm_medium: z.string().max(100).optional(),
      utm_content: z.string().max(200).optional(),
      utm_term: z.string().max(200).optional(),
    })
    .optional(),
});
const digest = (v) => createHash('sha256').update(v).digest('hex');
export const cleanTrackingUrl = (value) => {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.origin + u.pathname : null;
  } catch {
    return null;
  }
};
export function saveSignals(db, data, channel) {
  const signal = signalSchema.parse(data);
  db.prepare('INSERT OR IGNORE INTO event_signals VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    data.event_id,
    channel,
    signal.value ?? null,
    signal.currency,
    signal.content_id || null,
    signal.content_name || null,
    data.fbp || null,
    data.fbc || null,
    JSON.stringify(signal.click_ids || {}),
    JSON.stringify(signal.first_touch || {}),
  );
}
export function recoverReference(db, projectId, data) {
  if (!data.attribution_code) return data;
  const row = db
    .prepare('SELECT payload FROM checkout_refs WHERE project_id=? AND code=? AND expires_at>?')
    .get(projectId, data.attribution_code, Date.now());
  if (!row)
    throw Object.assign(
      new Error('Referência de atribuição inválida ou expirada nesta operação.'),
      { status: 400 },
    );
  const saved = JSON.parse(row.payload);
  if (data.visitor_id && data.visitor_id !== saved.visitor_id)
    throw Object.assign(new Error('Referência pertence a outro visitante.'), { status: 400 });
  data.visitor_id ||= saved.visitor_id;
  for (const key of [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbp',
    'fbc',
  ])
    if (!data[key] || (key === 'utm_source' && data[key] === 'direct'))
      data[key] = saved[key] || data[key];
  return data;
}
const columnList = z
  .array(z.string().regex(/^[a-z_]{2,40}$/))
  .min(1)
  .max(100)
  .refine((v) => new Set(v).size === v.length);
const columnSchema = z.object({
  selected: columnList,
  presets: z
    .array(z.object({ name: z.string().trim().min(1).max(50), columns: columnList }))
    .max(20)
    .refine((v) => new Set(v.map((p) => p.name)).size === v.length),
});
export function registerTracking(app, db, { project, range, meta }) {
  app.get('/api/report-columns', (req, res) => {
    const p = project(req.query.project);
    const saved = db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get(`report-columns:${p.id}`);
    res.json(saved ? JSON.parse(saved.value) : null);
  });
  app.put('/api/report-columns', (req, res) => {
    const p = project(req.query.project),
      config = columnSchema.parse(req.body);
    db.prepare(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).run(`report-columns:${p.id}`, JSON.stringify(config));
    res.json(config);
  });
  app.get('/api/tracking', (req, res) => {
    const p = project(req.query.project),
      { start, end } = range(req.query);
    const events = db
      .prepare(
        `SELECT e.event_name,COALESCE(s.channel,'browser') AS channel,COUNT(*) AS count,
      COUNT(DISTINCT e.visitor_id) AS visitors,MAX(e.created_at) AS last_seen
      FROM events e LEFT JOIN event_signals s ON s.event_id=e.id WHERE e.project_id=? AND e.day BETWEEN ? AND ?
      GROUP BY e.event_name,COALESCE(s.channel,'browser') ORDER BY last_seen DESC`,
      )
      .all(p.id, start, end);
    const links = db
      .prepare('SELECT * FROM smart_links WHERE project_id=? ORDER BY created_at DESC')
      .all(p.id);
    const pixels = db
      .prepare(
        `SELECT p.id,p.name,p.domain,p.active,COALESCE(t.capi_events,0) AS capi_events,
      EXISTS(SELECT 1 FROM pixel_capi c WHERE c.pixel_id=p.id) AS capi_configured FROM pixels p LEFT JOIN pixel_tracking t ON t.pixel_id=p.id WHERE p.project_id=?`,
      )
      .all(p.id);
    res.json({
      events,
      links: links.map((l) => ({
        ...l,
        url: `${process.env.PUBLIC_URL || req.protocol + '://' + req.get('host')}/api/r/${l.id}`,
      })),
      pixels,
      start,
      end,
    });
  });
  app.put('/api/pixels/:id/tracking', (req, res) => {
    const data = z.object({ project_id: z.string(), capi_events: z.boolean() }).parse(req.body);
    if (
      !db
        .prepare('SELECT id FROM pixels WHERE id=? AND project_id=?')
        .get(req.params.id, data.project_id)
    )
      return res.status(404).json({ error: 'Pixel não encontrado.' });
    db.prepare(
      'INSERT INTO pixel_tracking VALUES(?,?) ON CONFLICT(pixel_id) DO UPDATE SET capi_events=excluded.capi_events',
    ).run(req.params.id, Number(data.capi_events));
    res.json({ ok: true });
  });
  const incoming = z
    .object({
      pixel_id: z.string(),
      event_id: z.string().min(8).max(100),
      visitor_id: z.string().min(8).max(100).optional(),
      attribution_code: z
        .string()
        .regex(/^wt[a-zA-Z0-9]{16,26}$/)
        .optional(),
      event_name: eventNameSchema.refine(
        (v) => !['Purchase', 'PageEngagement', 'PageExit', 'ScrollDepth'].includes(v),
        'Compras confirmadas devem usar o webhook de vendas.',
      ),
      utm_source: z.string().max(100).default('direct'),
      utm_campaign: z.string().max(200).default(''),
      utm_medium: z.string().max(100).default(''),
      utm_content: z.string().max(200).default(''),
      utm_term: z.string().max(200).default(''),
      fbp: z.string().max(200).optional(),
      fbc: z.string().max(300).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      send_capi: z.boolean().default(false),
      customer_email: z.string().email().max(200).optional(),
      customer_phone: z
        .string()
        .regex(/^\+?[1-9][0-9]{7,14}$/)
        .optional(),
      client_ip_address: z.string().ip().optional(),
      client_user_agent: z.string().max(500).optional(),
      action_source: z
        .enum(['website', 'system_generated', 'chat', 'physical_store'])
        .default('system_generated'),
    })
    .merge(signalSchema);
  const receive = (raw, projectId, channel) => {
    const data = recoverReference(db, projectId, incoming.parse(raw));
    if (!data.visitor_id)
      throw Object.assign(
        new Error('Envie visitor_id ou attribution_code para relacionar a jornada.'),
        { status: 400 },
      );
    if (data.utm_source === 'direct') {
      const previous = db
        .prepare(
          `SELECT e.utm_source,e.utm_campaign,d.utm_medium,d.utm_content,d.utm_term FROM events e LEFT JOIN event_details d ON d.event_id=e.id WHERE e.project_id=? AND e.visitor_id=? AND e.created_at>=? AND e.utm_source NOT IN ('direct','') ORDER BY e.created_at DESC LIMIT 1`,
        )
        .get(projectId, data.visitor_id, new Date(Date.now() - 7 * 86400000).toISOString());
      if (previous)
        for (const key of ['utm_source', 'utm_campaign', 'utm_medium', 'utm_content', 'utm_term'])
          if (!data[key] || (key === 'utm_source' && data[key] === 'direct'))
            data[key] = previous[key] || data[key];
    }
    const pixel = db
      .prepare('SELECT * FROM pixels WHERE id=? AND project_id=? AND active=1')
      .get(data.pixel_id, projectId);
    if (!pixel)
      throw Object.assign(new Error('Pixel ativo não encontrado nesta operação.'), { status: 404 });
    const timestamp = data.created_at || new Date().toISOString();
    if (Date.parse(timestamp) > Date.now() + 300000)
      throw Object.assign(new Error('Data do evento no futuro.'), { status: 400 });
    // Namespaced IDs protect other operations and preserve the original ID sent to CAPI.
    const eventId = 'sv_' + digest(`${projectId}:${pixel.id}:${data.event_id}`).slice(0, 32);
    let inserted,
      queued = false;
    db.exec('BEGIN');
    try {
      inserted = db
        .prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(
          eventId,
          pixel.id,
          projectId,
          data.visitor_id,
          data.event_name,
          pixel.domain,
          data.utm_source,
          data.utm_campaign,
          timestamp,
          dateKey(new Date(timestamp)),
        );
      if (inserted.changes) {
        db.prepare('INSERT INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
          eventId,
          data.visitor_id,
          null,
          null,
          null,
          null,
          data.utm_medium,
          data.utm_content,
          data.utm_term,
        );
        saveSignals(db, { ...data, event_id: eventId }, channel);
        if (data.send_capi)
          queued = meta.enqueueEvent(pixel.id, eventId, {
            ...data,
            event_id: data.event_id,
            occurred_at: timestamp,
          });
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return {
      ok: true,
      id: eventId,
      duplicate: !inserted.changes,
      capi: queued ? 'queued' : 'not_queued',
    };
  };
  app.post('/api/tracking/events', (req, res) => {
    const p = project(req.body.project_id);
    res.json(receive(req.body, p.id, 'manual'));
  });
  app.post('/api/track-events', (req, res) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const integration = db
      .prepare('SELECT * FROM integrations WHERE token_hash=? AND active=1')
      .get(digest(token));
    if (!integration) return res.status(401).json({ error: 'Token inválido ou revogado.' });
    res.json(receive(req.body, integration.project_id, 'server'));
  });
  app.post('/api/smart-links', (req, res) => {
    const data = z
      .object({
        project_id: z.string(),
        pixel_id: z.string(),
        name: z.string().trim().min(2).max(80),
        destination: z
          .string()
          .url()
          .max(2000)
          .refine((v) => {
            const u = new URL(v);
            return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password;
          }),
        event_name: z.enum(['LinkClick', 'WhatsAppClick', 'InitiateCheckout']).default('LinkClick'),
      })
      .parse(req.body);
    project(data.project_id);
    if (
      !db
        .prepare('SELECT id FROM pixels WHERE id=? AND project_id=? AND active=1')
        .get(data.pixel_id, data.project_id)
    )
      return res.status(400).json({ error: 'Selecione um pixel ativo da operação.' });
    const id = randomUUID().replaceAll('-', '').slice(0, 20);
    db.prepare('INSERT INTO smart_links VALUES(?,?,?,?,?,?,?,?)').run(
      id,
      data.project_id,
      data.pixel_id,
      data.name,
      data.destination,
      data.event_name,
      1,
      new Date().toISOString(),
    );
    res.json({ id });
  });
  app.patch('/api/smart-links/:id', (req, res) => {
    const data = z.object({ project_id: z.string(), active: z.boolean() }).parse(req.body);
    const result = db
      .prepare('UPDATE smart_links SET active=? WHERE id=? AND project_id=?')
      .run(Number(data.active), req.params.id, data.project_id);
    if (!result.changes) return res.status(404).json({ error: 'Link não encontrado.' });
    res.json({ ok: true });
  });
  app.get('/api/r/:id', (req, res) => {
    const link = db
      .prepare(
        'SELECT l.* FROM smart_links l JOIN pixels p ON p.id=l.pixel_id AND p.active=1 WHERE l.id=? AND l.active=1',
      )
      .get(req.params.id);
    if (!link) return res.status(404).json({ error: 'Link inativo ou inexistente.' });
    const url = new URL(link.destination);
    const attribution = {};
    for (const key of [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'fbclid',
      'gclid',
      'ttclid',
      'msclkid',
      'gbraid',
      'wbraid',
      'kwai_click_id',
    ]) {
      const value =
        typeof req.query[key] === 'string'
          ? req.query[key].slice(0, 200)
          : url.searchParams.get(key)?.slice(0, 200);
      if (value) {
        url.searchParams.set(key, value);
        attribution[key] = value;
      }
    }
    attribution.utm_source ||= attribution.fbclid
      ? 'facebook'
      : attribution.gclid
        ? 'google'
        : attribution.ttclid
          ? 'tiktok'
          : 'direct';
    const cookie = String(req.headers.cookie || '').match(
      /(?:^|;\s*)wt_link_visitor=([a-f0-9]{32})/,
    )?.[1];
    const visitor = cookie || randomUUID().replaceAll('-', '');
    const code = 'wt' + randomUUID().replaceAll('-', '').slice(0, 22);
    res.cookie('wt_link_visitor', visitor, {
      httpOnly: true,
      secure: req.secure || process.env.PUBLIC_URL?.startsWith('https:'),
      sameSite: 'lax',
      maxAge: 7 * 86400000,
    });
    const eventId = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(
        eventId,
        link.pixel_id,
        link.project_id,
        visitor,
        link.event_name,
        cleanTrackingUrl(link.destination),
        attribution.utm_source,
        attribution.utm_campaign || '',
        new Date().toISOString(),
        dateKey(),
      );
      db.prepare('INSERT INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
        eventId,
        visitor,
        link.name,
        null,
        null,
        cleanTrackingUrl(link.destination),
        attribution.utm_medium || '',
        attribution.utm_content || '',
        attribution.utm_term || '',
      );
      saveSignals(db, { event_id: eventId }, 'smart_link');
      db.prepare('INSERT INTO checkout_refs VALUES(?,?,?,?)').run(
        link.project_id,
        code,
        JSON.stringify({ ...attribution, visitor_id: visitor }),
        Date.now() + 30 * 86400000,
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname)) {
      url.searchParams.set('text', `${url.searchParams.get('text') || ''}\n[${code}]`.trim());
    } else {
      if (!url.searchParams.has('visitor_id')) url.searchParams.set('visitor_id', visitor);
      if (!url.searchParams.has('wt_ref')) url.searchParams.set('wt_ref', code);
      if (url.hostname === 'pay.hotmart.com' && !url.searchParams.has('xcod'))
        url.searchParams.set('xcod', code);
      if (url.hostname === 'pay.cakto.com.br' && !url.searchParams.has('sck'))
        url.searchParams.set('sck', code);
    }
    res.redirect(302, url.href);
  });
}
