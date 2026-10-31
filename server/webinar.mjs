import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const events = [
  'registered',
  'confirmed',
  'opened',
  'joined',
  'rejoined',
  'left',
  'completed',
  'noshow',
  'offer',
  'offer_reached',
  'watch_progress',
  'timeline_sent',
  'recovery_sent',
  'recovery_failed',
  'recovery_uncertain',
  'member_access_sent',
  'member_accessed',
  'purchase',
];
const incoming = z
  .object({
    version: z.literal(1),
    id: z.string().min(1).max(160),
    event: z.enum(events),
    occurredAt: z.string().datetime(),
    webinarId: z.string().min(1).max(100),
    lead: z.object({
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
      name: z.string().max(200),
      phone: z.string().max(30).default(''),
    }),
    session: z
      .object({
        id: z.string().min(1).max(100),
        startsAt: z.string().datetime(),
        watchedSec: z.number().int().min(0).max(86400),
        maxSec: z.number().int().min(0).max(86400),
        status: z.string().max(30),
      })
      .optional(),
    sec: z.number().int().min(0).max(86400).default(0),
    dispatch: z
      .object({ trigger: z.string().max(100), status: z.enum(['sent', 'failed', 'uncertain']) })
      .optional(),
    purchase: z
      .object({
        transaction: z.string().min(1).max(120),
        productId: z.string().max(100),
        status: z.enum(['approved', 'pending', 'refunded', 'chargeback', 'canceled', 'disputed']),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.event === 'purchase' && !v.purchase)
      ctx.addIssue({ code: 'custom', message: 'Compra sem transação.' });
  });

export function registerWebinar(app, db, { project, range }) {
  app.post('/api/webinar/connections', (req, res) => {
    const p = project(z.string().parse(req.body.project_id));
    if (p.demo) return res.status(400).json({ error: 'Selecione uma operação real.' });
    const token = `wtw_${randomBytes(32).toString('hex')}`,
      id = `webinar_${randomUUID()}`;
    db.prepare(
      'INSERT INTO integrations(id,project_id,name,platform,token_hash,token_hint,created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      id,
      p.id,
      'Webinar Meet',
      'Webinar Meet',
      hash(token),
      token.slice(-6),
      new Date().toISOString(),
    );
    res.status(201).json({
      id,
      token,
      url: `${process.env.PUBLIC_URL || req.protocol + '://' + req.get('host')}/api/webhooks/webinar`,
    });
  });
  app.post('/api/webhooks/webinar', (req, res) => {
    const token = String(req.get('Authorization') || '').replace(/^Bearer /, '');
    const integration = db
      .prepare(
        "SELECT * FROM integrations WHERE token_hash=? AND active=1 AND platform='Webinar Meet'",
      )
      .get(hash(token));
    if (!integration) return res.status(401).json({ error: 'Integração inválida.' });
    const data = incoming.parse(req.body),
      eventId = hash(`${integration.id}:${data.id}`);
    const personId = hash(`${integration.id}:${data.webinarId}:${data.lead.email}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT id FROM webinar_events WHERE id=?').get(eventId)) {
        db.exec('COMMIT');
        return res.json({ ok: true, duplicate: true });
      }
      db.prepare(
        `INSERT INTO webinar_people VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        name=CASE WHEN excluded.last_seen>=last_seen THEN excluded.name ELSE name END,
        phone=CASE WHEN excluded.phone<>'' AND excluded.last_seen>=last_seen THEN excluded.phone ELSE phone END,
        last_seen=MAX(last_seen,excluded.last_seen)`,
      ).run(
        personId,
        integration.project_id,
        integration.id,
        data.webinarId,
        data.lead.email,
        data.lead.name,
        data.lead.phone,
        data.occurredAt,
        data.occurredAt,
        new Date().toISOString(),
      );
      db.prepare('INSERT INTO webinar_events VALUES(?,?,?,?,?,?,?)').run(
        eventId,
        personId,
        data.id,
        data.event,
        data.occurredAt,
        data.sec,
        JSON.stringify({ session: data.session, dispatch: data.dispatch, purchase: data.purchase }),
      );
      if (data.session) {
        const s = data.session;
        db.prepare(
          `INSERT INTO webinar_sessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(person_id,id) DO UPDATE SET
          watched_sec=MAX(watched_sec,excluded.watched_sec),max_sec=MAX(max_sec,excluded.max_sec),
          status=CASE WHEN excluded.updated_at>=updated_at THEN excluded.status ELSE status END,updated_at=MAX(updated_at,excluded.updated_at)`,
        ).run(personId, s.id, s.startsAt, s.watchedSec, s.maxSec, s.status, data.occurredAt);
      }
      if (data.purchase) {
        const p = data.purchase;
        db.prepare(
          `INSERT INTO webinar_orders VALUES(?,?,?,?,?) ON CONFLICT(person_id,transaction_id) DO UPDATE SET
          status=excluded.status,updated_at=excluded.updated_at WHERE excluded.updated_at>updated_at
          OR (excluded.updated_at=updated_at AND excluded.status IN ('refunded','chargeback','disputed','canceled'))`,
        ).run(personId, p.transaction, p.productId, p.status, data.occurredAt);
      }
      db.prepare('UPDATE integrations SET last_used=? WHERE id=?').run(
        new Date().toISOString(),
        integration.id,
      );
      db.exec('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });
  app.get('/api/webinar', (req, res) => {
    const p = project(req.query.project),
      { start, end } = range(req.query);
    const q = z
        .string()
        .max(200)
        .parse(req.query.q || ''),
      page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(req.query.page || 1);
    const where = `p.project_id=? AND (p.email LIKE ? OR p.name LIKE ?) AND EXISTS
      (SELECT 1 FROM webinar_events e WHERE e.person_id=p.id AND substr(e.occurred_at,1,10) BETWEEN ? AND ?)`;
    const args = [p.id, `%${q}%`, `%${q}%`, start, end];
    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM webinar_people p WHERE ${where}`)
      .get(...args).n;
    const people = db
      .prepare(
        `SELECT p.*,
      (SELECT COALESCE(SUM(watched_sec),0) FROM webinar_sessions s WHERE s.person_id=p.id) AS watched_sec,
      (SELECT COUNT(*) FROM webinar_events e WHERE e.person_id=p.id AND e.event='rejoined') AS returns,
      EXISTS(SELECT 1 FROM webinar_orders o WHERE o.person_id=p.id AND o.status='approved') AS purchased,
      (SELECT COUNT(*) FROM webinar_events e WHERE e.person_id=p.id AND e.event IN ('timeline_sent','recovery_sent','member_access_sent')) AS sends
      FROM webinar_people p WHERE ${where} ORDER BY p.last_seen DESC,p.id LIMIT 20 OFFSET ?`,
      )
      .all(...args, (page - 1) * 20);
    res.json({
      people,
      total,
      size: 20,
      connections: db
        .prepare(
          "SELECT id,name,active,last_used,token_hint FROM integrations WHERE project_id=? AND platform='Webinar Meet' ORDER BY created_at DESC",
        )
        .all(p.id),
    });
  });
  app.get('/api/webinar/people/:id', (req, res) => {
    const p = project(req.query.project);
    const person = db
      .prepare('SELECT * FROM webinar_people WHERE id=? AND project_id=?')
      .get(req.params.id, p.id);
    if (!person) return res.status(404).json({ error: 'Participante não encontrado.' });
    res.json({
      person,
      events: db
        .prepare(
          'SELECT * FROM webinar_events WHERE person_id=? ORDER BY occurred_at,id LIMIT 2000',
        )
        .all(person.id)
        .map((e) => ({ ...e, details: JSON.parse(e.details) })),
      sessions: db
        .prepare('SELECT * FROM webinar_sessions WHERE person_id=? ORDER BY starts_at')
        .all(person.id),
      orders: db
        .prepare(
          'SELECT transaction_id,product_id,status,updated_at FROM webinar_orders WHERE person_id=?',
        )
        .all(person.id),
    });
  });
}
