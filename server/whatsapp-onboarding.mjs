import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { encrypt, decrypt } from './meta.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digits = z.string().regex(/^\d{5,30}$/);
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sessionInput = z.object({ project_id: z.string(), nonce: nonceSchema });
const binding = (req) =>
  hash(
    req.headers.cookie
      ?.split(';')
      .map((value) => value.trim())
      .find((value) => value.startsWith('wt_session='))
      ?.slice(11) || '',
  );
const configFingerprint = () =>
  hash(
    JSON.stringify([
      process.env.PUBLIC_URL,
      process.env.META_APP_ID,
      process.env.META_APP_SECRET,
      process.env.META_WHATSAPP_CONFIG_ID,
      process.env.META_GRAPH_VERSION,
    ]),
  );

export function whatsAppOnboardingConfiguration(key) {
  let https = false;
  try {
    const url = new URL(process.env.PUBLIC_URL);
    https =
      url.protocol === 'https:' &&
      !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password;
  } catch {}
  const configured = Boolean(
    https &&
    /^\d+$/.test(process.env.META_APP_ID || '') &&
    (process.env.META_APP_SECRET || '').length >= 16 &&
    /^\d+$/.test(process.env.META_WHATSAPP_CONFIG_ID || '') &&
    /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || ''),
  );
  return {
    configured,
    ...(configured
      ? {
          app_id: process.env.META_APP_ID,
          config_id: process.env.META_WHATSAPP_CONFIG_ID,
          graph_version: process.env.META_GRAPH_VERSION,
          session_info_version: '3',
          feature_type: 'whatsapp_business_app_onboarding',
          ...(key
            ? {
                webhook_url: new URL('/api/whatsapp/webhook/app', process.env.PUBLIC_URL).href,
                verify_token: createHmac('sha256', key).update('wa-app-verify').digest('hex'),
              }
            : {}),
        }
      : {}),
    expires_in: 600,
  };
}

export function whatsAppOnboardingDetails(db, connectionId) {
  return (
    db
      .prepare(
        'SELECT created_at,contacts_sync_requested_at,history_sync_requested_at,contacts_sync_request_id,history_sync_request_id,contacts_sync_error,history_sync_error FROM wa_onboarding_connections WHERE connection_id=?',
      )
      .get(connectionId) || null
  );
}

export function registerWhatsAppOnboarding(
  app,
  db,
  { project, pixelFor, connection, key, transport = fetch },
) {
  const requireConfiguration = () => {
    if (!whatsAppOnboardingConfiguration().configured)
      throw fail(
        'Configure PUBLIC_URL HTTPS, META_APP_ID, META_APP_SECRET, META_GRAPH_VERSION e META_WHATSAPP_CONFIG_ID para conectar pelo Facebook.',
        503,
      );
  };
  const session = (req, input) => {
    requireConfiguration();
    project(input.project_id);
    const row = db
      .prepare(
        'SELECT * FROM wa_onboarding_sessions WHERE nonce_hash=? AND project_id=? AND binding_hash=? AND config_hash=? AND expires_at>?',
      )
      .get(hash(input.nonce), input.project_id, binding(req), configFingerprint(), Date.now());
    if (!row)
      throw fail(
        'A sessão WhatsApp expirou, foi utilizada ou pertence a outro acesso. Inicie uma nova conexão.',
        409,
      );
    return row;
  };
  const graph = async (path, token, params = {}, method = 'GET') => {
    const url = new URL(`https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/${path}`);
    if (method === 'GET')
      Object.entries(params).forEach(([name, value]) => url.searchParams.set(name, value));
    let response, result;
    try {
      response = await transport(url, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(method === 'POST' ? { body: JSON.stringify(params) } : {}),
        signal: AbortSignal.timeout(12000),
      });
      result = await response.json();
    } catch {
      throw fail(
        'A Meta não respondeu à configuração WhatsApp. Inicie outra conexão se a autorização expirou.',
        502,
      );
    }
    if (!response.ok || !result || result.error)
      throw fail(
        `A Meta recusou a configuração WhatsApp (HTTP ${response.status}). Confira o aplicativo, permissões e a elegibilidade do número.`,
        502,
      );
    return result;
  };
  app.get('/api/whatsapp/onboarding/config', (_req, res) =>
    res.json(whatsAppOnboardingConfiguration(key)),
  );
  app.post('/api/whatsapp/onboarding/session', (req, res) => {
    requireConfiguration();
    const input = z
      .object({
        project_id: z.string(),
        pixel_id: z.string(),
        name: z.string().trim().min(2).max(80),
      })
      .parse(req.body);
    project(input.project_id);
    pixelFor(input.pixel_id, input.project_id);
    db.prepare(
      'DELETE FROM wa_onboarding_sessions WHERE expires_at<=? OR (project_id=? AND binding_hash=?)',
    ).run(Date.now(), input.project_id, binding(req));
    const nonce = randomBytes(32).toString('base64url'),
      expires = Date.now() + 600000;
    db.prepare(
      'INSERT INTO wa_onboarding_sessions(nonce_hash,project_id,pixel_id,name,binding_hash,config_hash,expires_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      hash(nonce),
      input.project_id,
      input.pixel_id,
      input.name,
      binding(req),
      configFingerprint(),
      expires,
    );
    res.status(201).json({ nonce, expires_at: new Date(expires).toISOString() });
  });
  app.post('/api/whatsapp/onboarding/exchange', async (req, res) => {
    const input = sessionInput.extend({ code: z.string().min(1).max(8000) }).parse(req.body);
    const row = session(req, input);
    const claim = db
      .prepare(
        'UPDATE wa_onboarding_sessions SET exchange_started=1 WHERE nonce_hash=? AND exchange_started=0 AND token_cipher IS NULL',
      )
      .run(row.nonce_hash);
    if (!claim.changes)
      throw fail(
        'Esta autorização já foi trocada. Inicie outra conexão se ela não foi concluída.',
        409,
      );
    const result = await graph('oauth/access_token', null, {
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      code: input.code,
    });
    if (typeof result.access_token !== 'string' || result.access_token.length < 10)
      throw fail('A Meta não devolveu um token WhatsApp válido. Inicie outra conexão.', 502);
    session(req, input);
    db.prepare('UPDATE wa_onboarding_sessions SET token_cipher=? WHERE nonce_hash=?').run(
      encrypt(result.access_token, key),
      row.nonce_hash,
    );
    res.json({ ok: true });
  });
  app.post('/api/whatsapp/onboarding/complete', async (req, res) => {
    const input = sessionInput.extend({ waba_id: digits, phone_number_id: digits }).parse(req.body);
    const row = session(req, input);
    if (!row.token_cipher)
      throw fail('Aguarde a troca de autorização com a Meta antes de concluir.', 409);
    const existing = db
      .prepare('SELECT * FROM wa_connections WHERE phone_number_id=?')
      .get(input.phone_number_id);
    if (existing && (existing.project_id !== row.project_id || existing.waba_id !== input.waba_id))
      throw fail('Este ID de número já está conectado a outra operação ou conta WhatsApp.', 409);
    const token = decrypt(row.token_cipher, key);
    const debug = await graph(
      'debug_token',
      `${process.env.META_APP_ID}|${process.env.META_APP_SECRET}`,
      { input_token: token },
    );
    if (
      !debug.data?.is_valid ||
      String(debug.data.app_id) !== process.env.META_APP_ID ||
      (debug.data.expires_at && Number(debug.data.expires_at) * 1000 <= Date.now()) ||
      !['whatsapp_business_management', 'whatsapp_business_messaging'].every((scope) =>
        debug.data.scopes?.includes(scope),
      )
    )
      throw fail(
        'O token não pertence ao aplicativo WhatsApp configurado, expirou ou não possui as permissões necessárias.',
        400,
      );
    const phone = await graph(input.phone_number_id, token, {
      fields: 'id,display_phone_number,verified_name,is_on_biz_app,platform_type',
    });
    if (
      phone.id !== input.phone_number_id ||
      phone.is_on_biz_app !== true ||
      phone.platform_type !== 'CLOUD_API'
    )
      throw fail(
        'A Meta ainda não confirmou coexistência deste número com o WhatsApp Business e a Cloud API. Conclua o onboarding de coexistência.',
        400,
      );
    let found = false,
      after;
    for (let page = 0; page < 10; page++) {
      const phones = await graph(`${input.waba_id}/phone_numbers`, token, {
        fields: 'id',
        limit: '100',
        ...(after ? { after } : {}),
      });
      found =
        Array.isArray(phones.data) && phones.data.some((item) => item.id === input.phone_number_id);
      if (found || !phones.paging?.next) break;
      const next = phones.paging?.cursors?.after;
      if (!next || next === after) break;
      after = next;
    }
    if (!found) throw fail('O número não pertence à conta WhatsApp autorizada.', 400);
    const current = session(req, input);
    if (current.token_cipher !== row.token_cipher)
      throw fail('A autorização mudou. Inicie outra conexão.', 409);
    pixelFor(row.pixel_id, row.project_id);
    const previous = db
      .prepare('SELECT * FROM wa_connections WHERE phone_number_id=?')
      .get(input.phone_number_id);
    if (previous && (previous.project_id !== row.project_id || previous.waba_id !== input.waba_id))
      throw fail('Este ID de número já está conectado a outra operação ou conta WhatsApp.', 409);
    const id = previous?.id || 'wac_' + randomUUID().replaceAll('-', ''),
      at = new Date().toISOString();
    db.exec('BEGIN');
    try {
      const consumed = db
        .prepare('DELETE FROM wa_onboarding_sessions WHERE nonce_hash=? AND token_cipher=?')
        .run(row.nonce_hash, row.token_cipher);
      if (!consumed.changes) throw fail('Esta sessão já foi utilizada.', 409);
      if (previous) {
        db.prepare(
          'UPDATE wa_connections SET pixel_id=?,name=?,secret_cipher=?,token_cipher=?,verify_cipher=?,active=1,test_mode=1,api_checked_at=?,subscribed_at=NULL,verified_at=NULL WHERE id=?',
        ).run(
          row.pixel_id,
          row.name,
          encrypt(process.env.META_APP_SECRET, key),
          row.token_cipher,
          encrypt(randomBytes(32).toString('hex'), key),
          at,
          id,
        );
        db.prepare('DELETE FROM wa_connection_tests WHERE connection_id=?').run(id);
      } else
        db.prepare(
          'INSERT INTO wa_connections(id,project_id,pixel_id,name,waba_id,phone_number_id,secret_cipher,token_cipher,verify_cipher,api_checked_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          row.project_id,
          row.pixel_id,
          row.name,
          input.waba_id,
          input.phone_number_id,
          encrypt(process.env.META_APP_SECRET, key),
          row.token_cipher,
          encrypt(randomBytes(32).toString('hex'), key),
          at,
          at,
        );
      db.prepare(
        'INSERT INTO wa_onboarding_connections(connection_id,created_at) VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET created_at=excluded.created_at,contacts_sync_requested_at=NULL,history_sync_requested_at=NULL,contacts_sync_request_id=NULL,history_sync_request_id=NULL,contacts_sync_error=NULL,history_sync_error=NULL',
      ).run(id, at);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (
        db
          .prepare('SELECT id FROM wa_connections WHERE phone_number_id=?')
          .get(input.phone_number_id)
      )
        throw fail('Este ID de número já possui uma conexão.', 409);
      throw error;
    }
    res.status(201).json({ id });
  });
  app.post('/api/whatsapp/onboarding/:id/sync', async (req, res) => {
    requireConfiguration();
    const input = z.object({ project_id: z.string() }).parse(req.body);
    const c = connection(req.params.id, project(input.project_id).id);
    const state = whatsAppOnboardingDetails(db, c.id);
    if (!state)
      throw fail(
        'A sincronização inicial só está disponível para conexões criadas pelo Facebook.',
        400,
      );
    if (!c.active || !c.subscribed_at)
      throw fail('Conecte as entregas do número antes de solicitar a sincronização inicial.', 400);
    if (Date.now() - Date.parse(state.created_at) >= 86400000)
      throw fail(
        'A janela de 24 horas da sincronização inicial expirou. Confira o onboarding com a Meta.',
        400,
      );
    for (const [kind, syncType] of [
      ['contacts', 'smb_app_state_sync'],
      ['history', 'history'],
    ]) {
      // Claim before the request: a network timeout may still mean Meta accepted this one-time request.
      const claim = db
        .prepare(
          `UPDATE wa_onboarding_connections SET ${kind}_sync_requested_at=? WHERE connection_id=? AND ${kind}_sync_requested_at IS NULL`,
        )
        .run(new Date().toISOString(), c.id);
      if (!claim.changes) continue;
      try {
        const result = await graph(
          `${c.phone_number_id}/smb_app_data`,
          decrypt(c.token_cipher, key),
          { messaging_product: 'whatsapp', sync_type: syncType },
          'POST',
        );
        if (typeof result.request_id !== 'string' || !result.request_id)
          throw fail(
            'A Meta não confirmou a solicitação de sincronização. Confira a configuração na Meta antes de tentar outro onboarding.',
            502,
          );
        db.prepare(
          `UPDATE wa_onboarding_connections SET ${kind}_sync_request_id=? WHERE connection_id=?`,
        ).run(result.request_id, c.id);
      } catch (error) {
        db.prepare(
          `UPDATE wa_onboarding_connections SET ${kind}_sync_error=? WHERE connection_id=?`,
        ).run(error.message, c.id);
      }
    }
    const onboarding = whatsAppOnboardingDetails(db, c.id);
    res.status(onboarding.contacts_sync_error || onboarding.history_sync_error ? 502 : 200).json({
      ok: Boolean(onboarding.contacts_sync_request_id && onboarding.history_sync_request_id),
      onboarding,
    });
  });
}
