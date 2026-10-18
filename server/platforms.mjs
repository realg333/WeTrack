import { randomBytes, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { encrypt, decrypt } from './meta.mjs';
import {
  providerNames,
  providerSchema,
  normalizeCakto,
  normalizeHotmart,
  normalizeBlackcat,
} from './platform-adapters.mjs';
import { recordSale } from './sales.mjs';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const equal = (a, b) =>
  timingSafeEqual(Buffer.from(hash(String(a || ''))), Buffer.from(hash(String(b || ''))));
const now = () => new Date().toISOString();

export function createPlatformService(db, key, meta, transport = fetch) {
  const get = (id) =>
    db
      .prepare(
        'SELECT c.*,i.project_id,i.active,i.name,ip.pixel_id FROM provider_connections c JOIN integrations i ON i.id=c.integration_id LEFT JOIN integration_pixels ip ON ip.integration_id=i.id WHERE c.integration_id=?',
      )
      .get(id);
  const base = () => {
    const url = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;
    return new URL(url).origin;
  };
  async function blackcat(path, secret) {
    let response;
    try {
      response = await transport(new URL(`https://api.blackcatoficial.com/api/${path}`), {
        method: 'GET',
        headers: { 'X-API-Key': secret, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw fail(
        'A consulta à Blackcat não respondeu. O evento permanece disponível para nova tentativa.',
        502,
      );
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true || !result.data)
      throw fail(
        `Não foi possível confirmar os dados na Blackcat (HTTP ${response.status}). Confira a API Key.`,
        502,
      );
    return result.data;
  }
  function list(project) {
    return db
      .prepare(
        'SELECT c.integration_id FROM provider_connections c JOIN integrations i ON i.id=c.integration_id WHERE i.project_id=? AND i.active=1 ORDER BY i.created_at',
      )
      .all(project)
      .map(({ integration_id }) => {
        const c = get(integration_id);
        return {
          id: c.integration_id,
          provider: c.provider,
          name: c.name,
          configured: Boolean(c.secret_cipher),
          url: `${base()}/api/webhooks/${decrypt(c.url_cipher, key)}`,
          test_mode: Boolean(c.test_mode),
          purchase_owner: c.purchase_owner,
          pixel_id: c.pixel_id || '',
          last_event:
            db
              .prepare(
                'SELECT status,received_at,last_error FROM webhook_receipts WHERE integration_id=? ORDER BY received_at DESC LIMIT 1',
              )
              .get(c.integration_id) || null,
        };
      });
  }
  function create(project, provider, name) {
    providerSchema.parse(provider);
    const token = `wt_${randomBytes(24).toString('hex')}`,
      id = `int_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    db.exec('BEGIN');
    try {
      db.prepare('INSERT INTO integrations VALUES(?,?,?,?,?,?,?,?,?)').run(
        id,
        project,
        name || providerNames[provider],
        providerNames[provider],
        hash(token),
        token.slice(-6),
        1,
        null,
        now(),
      );
      db.prepare('INSERT INTO provider_connections VALUES(?,?,?,?,?,?)').run(
        id,
        provider,
        encrypt(token, key),
        null,
        1,
        'checkout',
      );
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return list(project).find((c) => c.id === id);
  }
  async function configure(id, project, data) {
    const c = get(id);
    if (!c || c.project_id !== project || !c.active)
      throw fail('Conexão não encontrada nesta operação.', 404);
    const secret = data.secret || (c.secret_cipher ? decrypt(c.secret_cipher, key) : '');
    if (!secret) throw fail('Informe a credencial da plataforma antes de salvar.');
    if (
      !data.test_mode &&
      data.secret &&
      (!c.secret_cipher || data.secret !== decrypt(c.secret_cipher, key))
    )
      throw fail(
        'Salve a nova credencial em modo de teste e valide uma entrega antes de liberar vendas reais.',
      );
    if (data.secret && c.provider === 'blackcat') await blackcat('sales/seller', secret);
    if (
      !data.test_mode &&
      !db
        .prepare("SELECT 1 FROM webhook_receipts WHERE integration_id=? AND status='test' LIMIT 1")
        .get(id)
    )
      throw fail('Receba e valide um evento em modo de teste antes de liberar vendas reais.');
    if (data.purchase_owner === 'wetrack') {
      const pixel = db
        .prepare(
          'SELECT p.id FROM pixels p JOIN pixel_capi pc ON pc.pixel_id=p.id WHERE p.id=? AND p.project_id=? AND p.active=1',
        )
        .get(data.pixel_id, project);
      if (!pixel || !data.confirm_purchase_owner)
        throw fail(
          'Selecione um pixel com CAPI e confirme que a compra duplicada foi desativada no checkout.',
        );
    }
    db.exec('BEGIN');
    try {
      db.prepare(
        'UPDATE provider_connections SET secret_cipher=?,test_mode=?,purchase_owner=? WHERE integration_id=?',
      ).run(encrypt(secret, key), Number(data.test_mode), data.purchase_owner, id);
      db.prepare('UPDATE integrations SET name=? WHERE id=?').run(data.name, id);
      db.prepare('DELETE FROM integration_pixels WHERE integration_id=?').run(id);
      if (data.purchase_owner === 'wetrack')
        db.prepare('INSERT INTO integration_pixels VALUES(?,?)').run(id, data.pixel_id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return list(project).find((row) => row.id === id);
  }
  function authenticate(c, payload, headers, rawBody) {
    if (!c.secret_cipher) throw fail('A conexão ainda precisa da credencial da plataforma.', 401);
    const secret = decrypt(c.secret_cipher, key);
    if (c.provider === 'hotmart' && !equal(headers['x-hotmart-hottok'], secret))
      throw fail('Hottok inválido.', 401);
    if (c.provider === 'cakto') {
      const ts = headers['x-cakto-timestamp'],
        signature = headers['x-cakto-signature'];
      if (ts || signature) {
        if (
          typeof ts !== 'string' ||
          !/^\d{1,12}$/.test(ts) ||
          Math.abs(Date.now() / 1000 - Number(ts)) > 300 ||
          !Buffer.isBuffer(rawBody)
        )
          throw fail('Assinatura Cakto inválida ou expirada.', 401);
        const digest = createHmac('sha256', secret).update(`${ts}.`).update(rawBody).digest('hex');
        if (
          typeof signature !== 'string' ||
          !signature.split(',').some((s) => equal(s.trim(), `v1=${digest}`))
        )
          throw fail('Assinatura Cakto inválida.', 401);
      } else if (!equal(payload.secret, secret)) throw fail('Secret Cakto inválido.', 401);
    }
    // Blackcat documents no signature. The opaque URL identifies the connection;
    // transaction status and amount must be verified with its API before recording.
  }
  function receive(integration, payload, headers, rawBody) {
    const c = get(integration.id);
    if (!c || !c.active) throw fail('Conexão não encontrada.', 401);
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      typeof payload.event !== 'string' ||
      !payload.event ||
      payload.event.length > 100
    )
      throw fail('Envelope de webhook inválido.');
    authenticate(c, payload, headers, rawBody);
    let normalized;
    try {
      if (c.provider === 'cakto') normalized = normalizeCakto(payload);
      else if (c.provider === 'hotmart') normalized = normalizeHotmart(payload);
      else {
        const supported = [
          'transaction.created',
          'transaction.paid',
          'transaction.failed',
        ].includes(payload.event);
        const customer = payload.customer || {};
        normalized = {
          event: typeof payload.event === 'string' ? payload.event.slice(0, 100) : '',
          ...(supported
            ? {
                blackcat: {
                  event: payload.event,
                  transactionId: payload.transactionId,
                  timestamp: payload.timestamp,
                  currency: payload.currency,
                  customer: { name: customer.name, email: customer.email, phone: customer.phone },
                  utm: payload.utm,
                },
              }
            : { ignored: 'Evento sem alteração de venda. Saques não são faturamento.' }),
        };
        if (
          supported &&
          (typeof payload.transactionId !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,120}$/.test(payload.transactionId))
        )
          throw fail('transactionId Blackcat inválido.');
      }
    } catch (e) {
      db.prepare('INSERT OR IGNORE INTO webhook_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        `wh_${randomUUID().replaceAll('-', '')}`,
        integration.id,
        hash(JSON.stringify(payload)),
        payload.event,
        'failed',
        c.test_mode,
        null,
        0,
        0,
        0,
        now(),
        now(),
        e.status ? e.message.slice(0, 250) : 'Formato de entrega inválido.',
      );
      throw e;
    }
    const eventKey =
      c.provider === 'hotmart' && typeof payload.id === 'string'
        ? hash(payload.id)
        : hash(JSON.stringify(normalized));
    const id = `wh_${randomUUID().replaceAll('-', '')}`;
    const envelope = {
      ...normalized,
      purchase_owner: c.purchase_owner,
      pixel_id: c.pixel_id || '',
    };
    const inserted = db
      .prepare('INSERT OR IGNORE INTO webhook_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        id,
        integration.id,
        eventKey,
        normalized.event || 'desconhecido',
        'pending',
        c.test_mode,
        encrypt(JSON.stringify(envelope), key),
        0,
        0,
        0,
        now(),
        null,
        null,
      );
    return {
      ok: true,
      accepted: true,
      duplicate: !inserted.changes,
      test_mode: Boolean(c.test_mode),
    };
  }
  function receipts(project, integrationId) {
    if (get(integrationId)?.project_id !== project)
      throw fail('Conexão não encontrada nesta operação.', 404);
    return db
      .prepare(
        'SELECT id,event_name,status,test_mode,attempts,received_at,processed_at,last_error,payload_cipher IS NOT NULL AS can_retry FROM webhook_receipts WHERE integration_id=? ORDER BY received_at DESC LIMIT 50',
      )
      .all(integrationId);
  }
  function retry(project, id) {
    const row = db
      .prepare(
        'SELECT r.*,i.project_id FROM webhook_receipts r JOIN integrations i ON i.id=r.integration_id WHERE r.id=?',
      )
      .get(id);
    if (!row || row.project_id !== project) throw fail('Entrega não encontrada.', 404);
    if (!row.payload_cipher || !['failed', 'pending'].includes(row.status))
      throw fail('Esta entrega não pode ser reenviada.');
    db.prepare(
      "UPDATE webhook_receipts SET status='pending',next_attempt=0,attempts=0,locked_until=0 WHERE id=?",
    ).run(id);
  }
  function reconcile(project, id) {
    const c = get(id);
    if (
      !c ||
      c.project_id !== project ||
      !c.active ||
      c.provider !== 'blackcat' ||
      !c.secret_cipher
    )
      throw fail(
        'Configure a conexão Blackcat desta operação antes de conferir as transações.',
        400,
      );
    const sales = db
      .prepare(
        'SELECT s.* FROM provider_orders p JOIN sales s ON s.id=p.sale_id WHERE p.project_id=? AND p.provider=? AND s.integration_id=? ORDER BY p.updated_at DESC LIMIT 20',
      )
      .all(project, 'blackcat', id);
    for (const sale of sales)
      receive(
        { id },
        {
          event: 'transaction.paid',
          transactionId: sale.external_id,
          timestamp: now(),
          customer: { name: sale.customer_name, email: sale.customer_email },
          utm: {
            utm_source: sale.utm_source,
            utm_campaign: sale.utm_campaign,
            utm_medium: sale.utm_medium,
            utm_content: sale.utm_content,
          },
        },
        {},
        undefined,
      );
    return { queued: sales.length };
  }
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      db.prepare('DELETE FROM checkout_refs WHERE expires_at<?').run(Date.now());
      db.prepare(
        "UPDATE webhook_receipts SET payload_cipher=NULL,status='failed',last_error='Dados da entrega expirados após 7 dias. Reenvie pela plataforma.' WHERE payload_cipher IS NOT NULL AND received_at<? AND locked_until<?",
      ).run(new Date(Date.now() - 7 * 86400000).toISOString(), Date.now());
      db.prepare('DELETE FROM webhook_receipts WHERE received_at<? AND payload_cipher IS NULL').run(
        new Date(Date.now() - 30 * 86400000).toISOString(),
      );
      const items = db
        .prepare(
          "SELECT * FROM webhook_receipts WHERE ((status='pending' AND next_attempt<=?) OR status='processing') AND locked_until<=? ORDER BY received_at LIMIT 20",
        )
        .all(Date.now(), Date.now());
      for (const row of items) {
        const claimed = db
          .prepare(
            "UPDATE webhook_receipts SET status='processing',locked_until=? WHERE id=? AND locked_until<=? AND (status='processing' OR (status='pending' AND next_attempt<=?))",
          )
          .run(Date.now() + 120000, row.id, Date.now(), Date.now());
        if (!claimed.changes) continue;
        try {
          const c = get(row.integration_id),
            envelope = JSON.parse(decrypt(row.payload_cipher, key));
          let normalized = envelope;
          if (!c?.active) normalized = { ignored: 'Conexão revogada antes do processamento.' };
          else if (envelope.blackcat)
            normalized = normalizeBlackcat(
              envelope.blackcat,
              await blackcat(
                `sales/${encodeURIComponent(envelope.blackcat.transactionId)}/status`,
                decrypt(c.secret_cipher, key),
              ),
            );
          if (!normalized.ignored && !row.test_mode) {
            for (const order of normalized.orders)
              recordSale(db, meta, { id: row.integration_id, project_id: c.project_id }, order, {
                provider: c.provider,
                skipCapi:
                  envelope.purchase_owner !== 'wetrack' ||
                  c.purchase_owner !== 'wetrack' ||
                  (c.pixel_id || '') !== envelope.pixel_id,
              });
          }
          db.prepare(
            'UPDATE webhook_receipts SET status=?,payload_cipher=NULL,attempts=attempts+1,locked_until=0,processed_at=?,last_error=? WHERE id=?',
          ).run(
            normalized.ignored ? 'ignored' : row.test_mode ? 'test' : 'processed',
            now(),
            normalized.ignored || null,
            row.id,
          );
        } catch (e) {
          const attempts = row.attempts + 1;
          const retryable = e.status === 502 || !e.status;
          db.prepare(
            'UPDATE webhook_receipts SET status=?,attempts=?,next_attempt=?,locked_until=0,last_error=? WHERE id=?',
          ).run(
            retryable && attempts < 5 ? 'pending' : 'failed',
            attempts,
            Date.now() + Math.min(3600000, 30000 * 2 ** attempts),
            e.status
              ? e.message.slice(0, 250)
              : 'Falha ao processar a entrega. Consulte os dados e tente novamente.',
            row.id,
          );
        }
      }
    } finally {
      running = false;
    }
  }
  return { create, configure, list, receive, receipts, retry, reconcile, drain };
}
