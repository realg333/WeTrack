import { createHash, randomBytes } from 'node:crypto';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const failure = (message) => Object.assign(new Error(message), { status: 400 });
export function createMetaOAuth(db, meta, transport = fetch) {
  const configuration = () => {
    const base = process.env.PUBLIC_URL || '';
    let publicHttps = false;
    try {
      const url = new URL(base);
      publicHttps =
        url.protocol === 'https:' &&
        !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password;
    } catch {}
    const configured = Boolean(
      publicHttps &&
      /^\d+$/.test(process.env.META_APP_ID || '') &&
      process.env.META_APP_SECRET &&
      (!process.env.META_LOGIN_CONFIG_ID || /^\d+$/.test(process.env.META_LOGIN_CONFIG_ID)) &&
      /^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION || ''),
    );
    return {
      configured,
      redirect_uri: base ? `${base.replace(/\/$/, '')}/api/meta/oauth/callback` : '',
      expires_in: 900,
    };
  };
  function cleanup() {
    db.prepare('DELETE FROM oauth_links WHERE expires_at<?').run(Date.now());
    db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
  }
  function createLink(projectId) {
    const config = configuration();
    if (!config.configured)
      throw Object.assign(
        new Error(
          'Configure um domínio HTTPS, META_APP_ID e META_APP_SECRET para gerar o link de conexão.',
        ),
        { status: 503 },
      );
    cleanup();
    const ticket = random(),
      expires = Date.now() + 900000;
    db.prepare('INSERT INTO oauth_links VALUES(?,?,?,0)').run(hash(ticket), projectId, expires);
    return {
      url: `${process.env.PUBLIC_URL.replace(/\/$/, '')}/api/meta/oauth/start/${ticket}`,
      expires_at: new Date(expires).toISOString(),
    };
  }
  function start(ticket) {
    if (!configuration().configured) throw failure('O aplicativo Meta não está configurado.');
    cleanup();
    const row = db
      .prepare('SELECT * FROM oauth_links WHERE ticket_hash=? AND used=0 AND expires_at>?')
      .get(hash(ticket), Date.now());
    if (!row) throw failure('Link inválido, expirado ou já utilizado. Gere outro link na WeTrack.');
    const state = random(),
      binding = random();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE oauth_links SET used=1 WHERE ticket_hash=?').run(hash(ticket));
      db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?)').run(
        hash(state),
        row.project_id,
        hash(binding),
        Date.now() + 600000,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    const url = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION}/dialog/oauth`);
    Object.entries({
      client_id: process.env.META_APP_ID,
      redirect_uri: configuration().redirect_uri,
      response_type: 'code',
      state,
      ...(process.env.META_LOGIN_CONFIG_ID
        ? { config_id: process.env.META_LOGIN_CONFIG_ID }
        : { scope: 'ads_read,ads_management' }),
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return {
      url: url.href,
      cookie: `wt_oauth_bind=${binding}; HttpOnly; Secure; SameSite=Lax; Path=/api/meta/oauth; Max-Age=600`,
    };
  }
  async function exchange(params) {
    const url = new URL(
      `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}/oauth/access_token`,
    );
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let response;
    try {
      response = await transport(url.href, { method: 'GET', signal: AbortSignal.timeout(20000) });
    } catch {
      throw failure(
        'Não foi possível concluir a troca de autorização com a Meta. Gere outro link e tente novamente.',
      );
    }
    const result = await response.json();
    if (!response.ok || result.error || !result.access_token)
      throw failure(
        `A Meta não concluiu a autorização (${result.error?.code || response.status}). Gere um novo link e confira as permissões do aplicativo.`,
      );
    return result.access_token;
  }
  async function callback(query, cookieHeader = '') {
    if (!configuration().configured) throw failure('O aplicativo Meta não está configurado.');
    const state = typeof query.state === 'string' ? query.state : '';
    const binding =
      cookieHeader
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('wt_oauth_bind='))
        ?.slice(14) || '';
    const row = db
      .prepare('SELECT * FROM oauth_states WHERE state_hash=? AND expires_at>?')
      .get(hash(state), Date.now());
    if (!row || !binding || row.cookie_hash !== hash(binding))
      throw failure(
        'A sessão de autorização não confere. Abra um novo link no mesmo navegador até concluir.',
      );
    db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(hash(state));
    if (query.error || typeof query.code !== 'string' || !query.code)
      throw failure('A conexão com o Facebook foi cancelada ou não autorizada.');
    const token = await exchange({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: configuration().redirect_uri,
      code: query.code,
    });
    const extended = process.env.META_LOGIN_CONFIG_ID
      ? token
      : await exchange({
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: token,
        });
    const result = await meta.connect(row.project_id, extended);
    return { project_id: row.project_id, accounts: result.accounts.length };
  }
  return { configuration, createLink, start, callback };
}
