import { z } from 'zod';
import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { encrypt, decrypt } from './meta.mjs';
import { resolveAd } from './attribution.mjs';
import { saveSignals } from './tracking.mjs';
import { dateKey } from './domain.mjs';
import { phoneHash, reconcileWhatsAppSales } from './whatsapp-sales.mjs';
import { whatsAppReport, contactDetails } from './whatsapp-reporting.mjs';
import { saleCurrency } from './currencies.mjs';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const uid = (prefix) => prefix + randomUUID().replaceAll('-', '');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digits = z.string().regex(/^\d{5,30}$/);
const stageSchema = z.enum(['new', 'qualified', 'negotiating', 'lost']);
const messageSchema = z.object({
  id: z.string().min(1).max(300),
  from: z.string().max(30).optional(),
  to: z.string().max(30).optional(),
  timestamp: z.string().regex(/^\d{10,11}$/),
  type: z.string().max(40),
  text: z.object({ body: z.string().max(10000) }).optional(),
  referral: z
    .object({
      source_id: z.string().max(100).optional(),
      source_type: z.string().max(20).optional(),
      ctwa_clid: z.string().max(1000).optional(),
    })
    .optional(),
  errors: z.array(z.unknown()).optional(),
});
const supported = new Set([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contacts',
  'button',
  'interactive',
  'order',
]);

export function registerWhatsApp(app, db, { project, range, key, transport = fetch }) {
  const connection = (id, projectId) => {
    const c = db
      .prepare('SELECT * FROM wa_connections WHERE id=? AND project_id=?')
      .get(id, projectId);
    if (!c) throw fail('Conexão WhatsApp não encontrada nesta operação.', 404);
    return c;
  };
  const safe = (c) => ({
    id: c.id,
    name: c.name,
    pixel_id: c.pixel_id,
    waba_id: c.waba_id,
    phone_number_id: c.phone_number_id,
    active: c.active,
    test_mode: c.test_mode,
    api_checked_at: c.api_checked_at,
    subscribed_at: c.subscribed_at,
    verified_at: c.verified_at,
    last_received_at: c.last_received_at,
  });
  const pixelFor = (pixelId, projectId) => {
    const p = db
      .prepare('SELECT * FROM pixels WHERE id=? AND project_id=? AND active=1')
      .get(pixelId, projectId);
    if (!p) throw fail('Escolha um pixel ativo desta operação.');
    return p;
  };
  const emit = (c, conversation, eventName, eventId, at) => {
    const p =
      c.pixel_id && db.prepare('SELECT * FROM pixels WHERE id=? AND active=1').get(c.pixel_id);
    if (!p) return;
    const inserted = db
      .prepare('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(
        eventId,
        p.id,
        c.project_id,
        conversation.visitor_id,
        eventName,
        p.domain,
        conversation.utm_source,
        conversation.utm_campaign,
        at,
        dateKey(new Date(at)),
      );
    if (inserted.changes) {
      db.prepare('INSERT INTO event_details VALUES(?,?,?,?,?,?,?,?,?)').run(
        eventId,
        conversation.id,
        null,
        null,
        null,
        null,
        conversation.utm_medium,
        conversation.utm_content,
        conversation.utm_term,
      );
      saveSignals(db, { event_id: eventId }, 'whatsapp');
    }
  };
  app.get('/api/whatsapp', (req, res) => {
    const p = project(req.query.project),
      dates = range(req.query);
    const input = z
      .object({
        q: z.string().max(200).default(''),
        stage: z.enum(['all', 'new', 'qualified', 'negotiating', 'lost', 'buyers']).default('all'),
        page: z.coerce.number().int().min(1).default(1),
        currency: z.enum(['BRL', 'USD']).default('BRL'),
      })
      .parse(req.query);
    const report = whatsAppReport(db, p.id, dates.start, dates.end, input);
    res.json({
      ...report,
      connections: db
        .prepare('SELECT * FROM wa_connections WHERE project_id=? ORDER BY created_at DESC')
        .all(p.id)
        .map(safe),
      pixels: db.prepare('SELECT id,name FROM pixels WHERE project_id=? AND active=1').all(p.id),
      ...dates,
    });
  });
  app.post('/api/whatsapp/connections', (req, res) => {
    const data = z
      .object({
        project_id: z.string(),
        pixel_id: z.string(),
        name: z.string().trim().min(2).max(80),
        waba_id: digits,
        phone_number_id: digits,
        app_secret: z.string().trim().min(16).max(500),
        access_token: z.string().trim().min(10).max(8000),
      })
      .parse(req.body);
    project(data.project_id);
    pixelFor(data.pixel_id, data.project_id);
    if (
      db.prepare('SELECT id FROM wa_connections WHERE phone_number_id=?').get(data.phone_number_id)
    )
      throw fail('Este ID de número já possui uma conexão. Edite a conexão existente.', 409);
    const id = uid('wac_');
    db.prepare(
      'INSERT INTO wa_connections(id,project_id,pixel_id,name,waba_id,phone_number_id,secret_cipher,token_cipher,verify_cipher,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      data.project_id,
      data.pixel_id,
      data.name,
      data.waba_id,
      data.phone_number_id,
      encrypt(data.app_secret, key),
      encrypt(data.access_token, key),
      encrypt(randomBytes(32).toString('hex'), key),
      new Date().toISOString(),
    );
    res.status(201).json({ id });
  });
  app.get('/api/whatsapp/connections/:id/setup', (req, res) => {
    const c = connection(req.params.id, project(req.query.project).id);
    res.json({
      ...safe(c),
      webhook_url: `${process.env.PUBLIC_URL || req.protocol + '://' + req.get('host')}/api/whatsapp/webhook/${c.id}`,
      verify_token: decrypt(c.verify_cipher, key),
      receipts: db
        .prepare(
          'SELECT received_at,test_mode,accepted,ignored FROM wa_receipts WHERE connection_id=? ORDER BY received_at DESC,rowid DESC LIMIT 20',
        )
        .all(c.id),
    });
  });
  app.patch('/api/whatsapp/connections/:id', (req, res) => {
    const v = z
      .object({
        project_id: z.string(),
        active: z.boolean().optional(),
        test_mode: z.boolean().optional(),
        pixel_id: z.string().optional(),
        app_secret: z.string().trim().min(16).max(500).optional(),
        access_token: z.string().trim().min(10).max(8000).optional(),
      })
      .parse(req.body);
    const c = connection(req.params.id, v.project_id);
    if (v.pixel_id) pixelFor(v.pixel_id, c.project_id);
    if (
      v.test_mode === false &&
      (!c.verified_at || !c.api_checked_at || !c.subscribed_at || v.app_secret || v.access_token)
    )
      throw fail(
        'Valide o acesso, conecte as entregas e confirme a URL do webhook antes de ativar a coleta real.',
      );
    db.prepare(
      'UPDATE wa_connections SET active=?,test_mode=?,pixel_id=?,secret_cipher=?,token_cipher=?,verified_at=?,api_checked_at=?,subscribed_at=? WHERE id=?',
    ).run(
      Number(v.active ?? Boolean(c.active)),
      v.app_secret || v.access_token ? 1 : Number(v.test_mode ?? Boolean(c.test_mode)),
      v.pixel_id || c.pixel_id,
      v.app_secret ? encrypt(v.app_secret, key) : c.secret_cipher,
      v.access_token ? encrypt(v.access_token, key) : c.token_cipher,
      v.app_secret ? null : c.verified_at,
      v.access_token ? null : c.api_checked_at,
      v.app_secret || v.access_token ? null : c.subscribed_at,
      c.id,
    );
    res.json({ ok: true });
  });
  app.post('/api/whatsapp/connections/:id/check', async (req, res) => {
    const c = connection(
      req.params.id,
      z.object({ project_id: z.string() }).parse(req.body).project_id,
    );
    if (!c.active) throw fail('Ative a conexão antes de validar o acesso.');
    const version = process.env.META_GRAPH_VERSION;
    if (!/^v\d+\.\d+$/.test(version || ''))
      throw fail('Configure META_GRAPH_VERSION no servidor.', 503);
    const get = async (path, params) => {
      const url = new URL(`https://graph.facebook.com/${version}/${path}`);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      let response;
      try {
        response = await transport(url, {
          headers: { Authorization: `Bearer ${decrypt(c.token_cipher, key)}` },
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        throw fail('A Meta não respondeu à validação. Tente novamente.', 502);
      }
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error || !body)
        throw fail(
          `A Meta recusou a consulta (HTTP ${response.status}). Confira token, permissões e IDs.`,
          502,
        );
      return body;
    };
    const phone = await get(c.phone_number_id, { fields: 'id,display_phone_number,verified_name' });
    let found = false,
      after;
    for (let i = 0; i < 10; i++) {
      const accounts = await get(`${c.waba_id}/phone_numbers`, {
        fields: 'id',
        limit: '100',
        ...(after ? { after } : {}),
      });
      found = (accounts.data || []).some((p) => p.id === c.phone_number_id);
      if (found || !accounts.paging?.next) break;
      const next = accounts.paging?.cursors?.after;
      if (!next || next === after) break;
      after = next;
    }
    if (phone.id !== c.phone_number_id || !found)
      throw fail('O número não foi confirmado dentro da conta WhatsApp informada.', 400);
    const current = connection(c.id, c.project_id);
    if (current.token_cipher !== c.token_cipher || !current.active)
      throw fail('A conexão mudou durante a validação. Confira novamente.', 409);
    db.prepare('UPDATE wa_connections SET api_checked_at=? WHERE id=?').run(
      new Date().toISOString(),
      c.id,
    );
    res.json({
      ok: true,
      display_phone_number: phone.display_phone_number || '',
      verified_name: phone.verified_name || '',
    });
  });
  app.post('/api/whatsapp/connections/:id/subscribe', async (req, res) => {
    const c = connection(
      req.params.id,
      z.object({ project_id: z.string() }).parse(req.body).project_id,
    );
    if (!c.active || !c.api_checked_at)
      throw fail('Ative a conexão e valide o acesso ao número primeiro.');
    const version = process.env.META_GRAPH_VERSION;
    if (!/^v\d+\.\d+$/.test(version || ''))
      throw fail('Configure META_GRAPH_VERSION no servidor.', 503);
    let callback;
    try {
      callback = new URL(`/api/whatsapp/webhook/${c.id}`, process.env.PUBLIC_URL);
      if (callback.protocol !== 'https:') throw Error();
    } catch {
      throw fail('Configure PUBLIC_URL com o endereço HTTPS público da WeTrack.', 503);
    }
    const post = async (path, body) => {
      let response;
      try {
        response = await transport(`https://graph.facebook.com/${version}/${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${decrypt(c.token_cipher, key)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(12000),
        });
      } catch {
        throw fail('A Meta não respondeu à conexão das entregas. Tente novamente.', 502);
      }
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true)
        throw fail(
          `A Meta recusou a conexão das entregas (HTTP ${response.status}). Confira as permissões whatsapp_business_management e whatsapp_business_messaging e a configuração de Webhooks do aplicativo.`,
          502,
        );
    };
    await post(`${c.waba_id}/subscribed_apps`, {});
    // A callback per phone avoids routing another phone in the same WABA to this connection.
    await post(c.phone_number_id, {
      webhook_configuration: {
        override_callback_uri: callback.href,
        verify_token: decrypt(c.verify_cipher, key),
      },
    });
    const current = connection(c.id, c.project_id);
    if (
      current.token_cipher !== c.token_cipher ||
      current.secret_cipher !== c.secret_cipher ||
      !current.active
    )
      throw fail('A conexão mudou durante a configuração. Confira novamente.', 409);
    db.prepare('UPDATE wa_connections SET subscribed_at=? WHERE id=?').run(
      new Date().toISOString(),
      c.id,
    );
    res.json({ ok: true });
  });
  app.get('/api/whatsapp/webhook/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM wa_connections WHERE id=? AND active=1').get(req.params.id);
    if (
      !c ||
      req.query['hub.mode'] !== 'subscribe' ||
      typeof req.query['hub.verify_token'] !== 'string' ||
      typeof req.query['hub.challenge'] !== 'string' ||
      req.query['hub.challenge'].length > 2000 ||
      !timingSafeEqual(
        Buffer.from(hash(req.query['hub.verify_token'])),
        Buffer.from(hash(decrypt(c.verify_cipher, key))),
      )
    )
      return res.status(403).json({ error: 'Verificação recusada.' });
    db.prepare('UPDATE wa_connections SET verified_at=? WHERE id=?').run(
      new Date().toISOString(),
      c.id,
    );
    res.type('text/plain').send(req.query['hub.challenge']);
  });
  app.post('/api/whatsapp/webhook/:id', (req, res) => {
    const c = db.prepare('SELECT * FROM wa_connections WHERE id=? AND active=1').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Conexão inativa ou inexistente.' });
    const signature = String(req.headers['x-hub-signature-256'] || '');
    if (
      !req.rawBody ||
      !/^sha256=[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(
        Buffer.from(signature.slice(7), 'hex'),
        createHmac('sha256', decrypt(c.secret_cipher, key)).update(req.rawBody).digest(),
      )
    )
      return res.status(401).json({ error: 'Assinatura WhatsApp inválida.' });
    const body = z
      .object({
        object: z.literal('whatsapp_business_account'),
        entry: z
          .array(
            z.object({
              id: z.string().max(100),
              changes: z
                .array(z.object({ field: z.string().max(80), value: z.record(z.unknown()) }))
                .max(100),
            }),
          )
          .max(100),
      })
      .parse(req.body);
    let accepted = 0,
      ignored = 0;
    const received = new Date().toISOString();
    db.exec('BEGIN');
    try {
      for (const entry of body.entry)
        for (const change of entry.changes) {
          const value = change.value;
          if (
            entry.id !== c.waba_id ||
            value.metadata?.phone_number_id !== c.phone_number_id ||
            value.messaging_product !== 'whatsapp' ||
            !['messages', 'smb_message_echoes'].includes(change.field)
          ) {
            ignored++;
            continue;
          }
          const inbound = change.field === 'messages';
          const raw = inbound ? value.messages : value.message_echoes;
          if (!Array.isArray(raw) || raw.length > 100) {
            ignored++;
            continue;
          }
          const messages = raw
            .map((m) => messageSchema.safeParse(m))
            .filter((m) => {
              if (!m.success) ignored++;
              return m.success;
            })
            .map((m) => m.data)
            .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
          for (const message of messages) {
            const number = inbound ? message.from : message.to;
            const at = new Date(Number(message.timestamp) * 1000).toISOString();
            if (
              !/^[1-9]\d{7,14}$/.test(number || '') ||
              !supported.has(message.type) ||
              message.errors?.length ||
              Date.parse(at) > Date.now() + 300000
            ) {
              ignored++;
              continue;
            }
            if (c.test_mode) {
              accepted++;
              continue;
            }
            const mid = 'wam_' + hash(c.id + ':' + message.id);
            if (db.prepare('SELECT id FROM wa_messages WHERE id=?').get(mid)) {
              ignored++;
              continue;
            }
            let contact = db
              .prepare('SELECT * FROM wa_contacts WHERE project_id=? AND wa_id=?')
              .get(c.project_id, number);
            if (!inbound) {
              const conv =
                contact &&
                db
                  .prepare(
                    'SELECT id FROM wa_conversations WHERE contact_id=? AND connection_id=? AND started_at<=? ORDER BY started_at DESC LIMIT 1',
                  )
                  .get(contact.id, c.id, at);
              db.prepare('INSERT INTO wa_messages VALUES(?,?,?,?,?,?)').run(
                mid,
                c.id,
                conv?.id || null,
                'outbound',
                at,
                message.type,
              );
              accepted++;
              continue;
            }
            const name = (Array.isArray(value.contacts) ? value.contacts : []).find(
              (p) => p?.wa_id === number,
            )?.profile?.name;
            if (!contact) {
              const id = uid('wact_');
              db.prepare('INSERT INTO wa_contacts VALUES(?,?,?,?,?,?,?,?)').run(
                id,
                c.project_id,
                number,
                phoneHash(number),
                String(name || 'Contato WhatsApp').slice(0, 100),
                'new',
                at,
                at,
              );
              contact = db.prepare('SELECT * FROM wa_contacts WHERE id=?').get(id);
            } else
              db.prepare(
                'UPDATE wa_contacts SET last_seen=MAX(last_seen,?),created_at=MIN(created_at,?),name=CASE WHEN name=? THEN ? ELSE name END WHERE id=?',
              ).run(
                at,
                at,
                'Contato WhatsApp',
                String(name || contact.name).slice(0, 100),
                contact.id,
              );
            let origin = {
              visitor_id: 'wa_' + hash(c.project_id + ':' + number).slice(0, 32),
              utm_source: 'whatsapp',
              utm_campaign: '',
              utm_medium: '',
              utm_content: '',
              utm_term: '',
              ad_reference: null,
              ctwa_clid: null,
              attribution_method: 'unattributed',
            };
            const code = message.text?.body.match(/\bwt[a-zA-Z0-9]{16,26}\b/)?.[0];
            const ref =
              code &&
              db
                .prepare(
                  'SELECT payload FROM checkout_refs WHERE project_id=? AND code=? AND expires_at>?',
                )
                .get(c.project_id, code, Date.now());
            if (ref) {
              const saved = JSON.parse(ref.payload);
              for (const k of [
                'visitor_id',
                'utm_source',
                'utm_campaign',
                'utm_medium',
                'utm_content',
                'utm_term',
              ])
                if (typeof saved[k] === 'string') origin[k] = saved[k];
              origin.attribution_method = 'smart_link';
            }
            if (
              message.referral?.source_type === 'ad' &&
              /^\d+$/.test(message.referral.source_id || '')
            ) {
              origin.ad_reference = message.referral.source_id;
              origin.ctwa_clid = message.referral.ctwa_clid || null;
              origin.utm_source = 'facebook';
              origin.utm_content = origin.ad_reference;
              origin.attribution_method = 'meta_ad';
              const ad = resolveAd(db, c.project_id, origin.ad_reference);
              origin.utm_campaign = ad?.campaign_id || '';
              origin.utm_term = ad?.adset_id || '';
            }
            const earlier = new Date(Date.parse(at) - 86400000).toISOString(),
              later = new Date(Date.parse(at) + 86400000).toISOString();
            let conv = db
              .prepare(
                'SELECT * FROM wa_conversations WHERE connection_id=? AND contact_id=? AND started_at<=? AND last_message_at>=? ORDER BY started_at DESC LIMIT 1',
              )
              .get(c.id, contact.id, later, earlier);
            if (
              conv &&
              origin.attribution_method !== 'unattributed' &&
              conv.attribution_method !== 'unattributed' &&
              ((origin.ad_reference &&
                conv.ad_reference &&
                origin.ad_reference !== conv.ad_reference) ||
                (ref && origin.visitor_id !== conv.visitor_id))
            )
              conv = null;
            if (!conv) {
              const id = uid('wacv_');
              db.prepare('INSERT INTO wa_conversations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
                id,
                c.project_id,
                c.id,
                contact.id,
                at,
                at,
                origin.visitor_id,
                origin.utm_source,
                origin.utm_campaign,
                origin.utm_medium,
                origin.utm_content,
                origin.utm_term,
                origin.ad_reference,
                origin.ctwa_clid,
                origin.attribution_method,
              );
              conv = db.prepare('SELECT * FROM wa_conversations WHERE id=?').get(id);
              emit(c, conv, 'Contact', 'wa_contact_' + id, at);
              emit(c, conv, 'ConversationStarted', 'wa_start_' + id, at);
            } else {
              if (at < conv.started_at)
                db.prepare('UPDATE events SET created_at=?,day=? WHERE id IN (?,?)').run(
                  at,
                  dateKey(new Date(at)),
                  'wa_contact_' + conv.id,
                  'wa_start_' + conv.id,
                );
              db.prepare(
                'UPDATE wa_conversations SET started_at=MIN(started_at,?),last_message_at=MAX(last_message_at,?) WHERE id=?',
              ).run(at, at, conv.id);
              if (
                conv.attribution_method === 'unattributed' &&
                origin.attribution_method !== 'unattributed'
              ) {
                db.prepare(
                  'UPDATE wa_conversations SET visitor_id=?,utm_source=?,utm_campaign=?,utm_medium=?,utm_content=?,utm_term=?,ad_reference=?,ctwa_clid=?,attribution_method=? WHERE id=?',
                ).run(
                  origin.visitor_id,
                  origin.utm_source,
                  origin.utm_campaign,
                  origin.utm_medium,
                  origin.utm_content,
                  origin.utm_term,
                  origin.ad_reference,
                  origin.ctwa_clid,
                  origin.attribution_method,
                  conv.id,
                );
                db.prepare(
                  'UPDATE events SET visitor_id=?,utm_source=?,utm_campaign=? WHERE id IN (?,?)',
                ).run(
                  origin.visitor_id,
                  origin.utm_source,
                  origin.utm_campaign,
                  'wa_contact_' + conv.id,
                  'wa_start_' + conv.id,
                );
                db.prepare(
                  'UPDATE event_details SET utm_medium=?,utm_content=?,utm_term=? WHERE event_id IN (?,?)',
                ).run(
                  origin.utm_medium,
                  origin.utm_content,
                  origin.utm_term,
                  'wa_contact_' + conv.id,
                  'wa_start_' + conv.id,
                );
              }
            }
            db.prepare('INSERT INTO wa_messages VALUES(?,?,?,?,?,?)').run(
              mid,
              c.id,
              conv.id,
              'inbound',
              at,
              message.type,
            );
            reconcileWhatsAppSales(db, c.project_id, contact.id);
            accepted++;
          }
        }
      db.prepare('UPDATE wa_connections SET last_received_at=? WHERE id=?').run(received, c.id);
      db.prepare('INSERT INTO wa_receipts VALUES(?,?,?,?,?,?)').run(
        uid('war_'),
        c.id,
        received,
        c.test_mode,
        accepted,
        ignored,
      );
      db.prepare(
        'DELETE FROM wa_receipts WHERE connection_id=? AND id NOT IN (SELECT id FROM wa_receipts WHERE connection_id=? ORDER BY received_at DESC,rowid DESC LIMIT 100)',
      ).run(c.id, c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true, test_mode: Boolean(c.test_mode), accepted, ignored });
  });
  app.get('/api/whatsapp/contacts/:id', (req, res) => {
    const p = project(req.query.project);
    res.json(contactDetails(db, p.id, req.params.id));
  });
  app.post('/api/whatsapp/contacts', (req, res) => {
    const v = z
      .object({
        project_id: z.string(),
        name: z.string().trim().min(1).max(100),
        phone: z.string().regex(/^\+?[1-9]\d{7,14}$/),
      })
      .parse(req.body);
    project(v.project_id);
    const phone = v.phone.replace(/\D/g, '');
    if (
      db
        .prepare('SELECT id FROM wa_contacts WHERE project_id=? AND wa_id=?')
        .get(v.project_id, phone)
    )
      throw fail('Contato já cadastrado nesta operação.', 409);
    const id = uid('wact_'),
      at = new Date().toISOString();
    db.prepare('INSERT INTO wa_contacts VALUES(?,?,?,?,?,?,?,?)').run(
      id,
      v.project_id,
      phone,
      phoneHash(phone),
      v.name,
      'new',
      at,
      at,
    );
    res.status(201).json({ id });
  });
  app.patch('/api/whatsapp/contacts/:id', (req, res) => {
    const v = z
      .object({
        project_id: z.string(),
        stage: stageSchema,
        name: z.string().trim().min(1).max(100).optional(),
      })
      .parse(req.body);
    const contact = db
      .prepare('SELECT * FROM wa_contacts WHERE id=? AND project_id=?')
      .get(req.params.id, v.project_id);
    if (!contact) throw fail('Contato não encontrado.', 404);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE wa_contacts SET stage=?,name=? WHERE id=?').run(
        v.stage,
        v.name || contact.name,
        contact.id,
      );
      if (contact.stage !== v.stage) {
        const at = new Date().toISOString();
        db.prepare('INSERT INTO wa_stage_history VALUES(?,?,?,?)').run(
          uid('wash_'),
          contact.id,
          v.stage,
          at,
        );
        if (v.stage === 'qualified') {
          const conv = db
            .prepare(
              'SELECT * FROM wa_conversations WHERE contact_id=? ORDER BY started_at DESC LIMIT 1',
            )
            .get(contact.id);
          if (conv) {
            const c = connection(conv.connection_id, v.project_id);
            emit(c, conv, 'Lead', 'wa_lead_' + contact.id, at);
          }
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    res.json({ ok: true });
  });
  app.get('/api/whatsapp/sales', (req, res) => {
    const p = project(req.query.project),
      q = z
        .string()
        .max(200)
        .parse(req.query.q || '');
    const rows =
      q.length < 2
        ? []
        : db
            .prepare(
              `SELECT s.id,s.external_id,s.customer_name,s.product,s.amount,${saleCurrency} AS currency,s.status,s.created_at,l.contact_id FROM sales s LEFT JOIN wa_sale_links l ON l.sale_id=s.id WHERE s.project_id=? AND (instr(lower(s.external_id),lower(?))>0 OR instr(lower(s.customer_email),lower(?))>0 OR instr(lower(s.customer_name),lower(?))>0) ORDER BY s.created_at DESC LIMIT 20`,
            )
            .all(p.id, q, q, q);
    res.json(rows);
  });
  app.post('/api/whatsapp/contacts/:id/sales', (req, res) => {
    const v = z.object({ project_id: z.string(), sale_id: z.string() }).parse(req.body);
    const contact = db
        .prepare('SELECT id FROM wa_contacts WHERE id=? AND project_id=?')
        .get(req.params.id, v.project_id),
      sale = db
        .prepare('SELECT * FROM sales WHERE id=? AND project_id=?')
        .get(v.sale_id, v.project_id);
    if (!contact || !sale) throw fail('Contato ou pedido não encontrado nesta operação.', 404);
    const old = db.prepare('SELECT contact_id FROM wa_sale_links WHERE sale_id=?').get(sale.id);
    if (old?.contact_id && old.contact_id !== contact.id)
      throw fail(
        'Pedido já vinculado a outro contato. Remova o vínculo anterior antes de corrigir.',
        409,
      );
    const conv = db
      .prepare(
        'SELECT id FROM wa_conversations WHERE contact_id=? AND started_at<=? AND started_at>=? ORDER BY started_at DESC LIMIT 1',
      )
      .get(
        contact.id,
        new Date(sale.created_at).toISOString(),
        new Date(Date.parse(sale.created_at) - 30 * 86400000).toISOString(),
      );
    db.prepare(
      'INSERT INTO wa_sale_links VALUES(?,?,?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET contact_id=excluded.contact_id,conversation_id=excluded.conversation_id,method=excluded.method,created_at=excluded.created_at',
    ).run(sale.id, v.project_id, contact.id, conv?.id || null, 'manual', new Date().toISOString());
    res.json({ ok: true });
  });
  app.delete('/api/whatsapp/contacts/:id/sales/:saleId', (req, res) => {
    const p = project(req.query.project);
    const result = db
      .prepare(
        "UPDATE wa_sale_links SET contact_id=NULL,conversation_id=NULL,method='excluded' WHERE project_id=? AND contact_id=? AND sale_id=?",
      )
      .run(p.id, req.params.id, req.params.saleId);
    if (!result.changes) throw fail('Vínculo não encontrado.', 404);
    res.json({ ok: true });
  });
}
