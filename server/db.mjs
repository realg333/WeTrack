import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { dateKey, money } from './domain.mjs';
import { seedAnalyticsDemo } from './demo-analytics.mjs';

export function createDatabase(
  path = process.env.DATABASE_PATH || './data/wetrack.sqlite',
  options = {},
) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const Driver = options.Driver || DatabaseSync;
  const db = new Driver(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, demo INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, source TEXT NOT NULL, budget REAL DEFAULT 0, active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS spend (campaign_id TEXT REFERENCES campaigns(id), day TEXT NOT NULL, amount REAL NOT NULL, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, PRIMARY KEY(campaign_id,day));
    CREATE TABLE IF NOT EXISTS integrations (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, platform TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, token_hint TEXT, active INTEGER DEFAULT 1, last_used TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), external_id TEXT NOT NULL, integration_id TEXT, campaign_id TEXT, customer_name TEXT, customer_email TEXT, product TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL, payment_method TEXT, utm_source TEXT, utm_campaign TEXT, utm_medium TEXT, utm_content TEXT, created_at TEXT NOT NULL, day TEXT NOT NULL, UNIQUE(integration_id,external_id));
    CREATE TABLE IF NOT EXISTS pixels (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, domain TEXT NOT NULL, checkout_url TEXT, active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, pixel_id TEXT REFERENCES pixels(id), project_id TEXT REFERENCES projects(id), visitor_id TEXT NOT NULL, event_name TEXT NOT NULL, page_url TEXT, utm_source TEXT, utm_campaign TEXT, created_at TEXT NOT NULL, day TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT NOT NULL, metric TEXT NOT NULL, operator TEXT NOT NULL, threshold REAL NOT NULL, active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rule_configs (rule_id TEXT PRIMARY KEY REFERENCES rules(id) ON DELETE CASCADE, config TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rule_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, rule_id TEXT NOT NULL, rule_name TEXT NOT NULL, campaign_id TEXT NOT NULL, campaign_name TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, metrics TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rule_runs_history ON rule_runs(project_id,created_at);
    CREATE INDEX IF NOT EXISTS rule_runs_campaign ON rule_runs(rule_id,campaign_id,created_at);
    CREATE TABLE IF NOT EXISTS rule_campaign_state (campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id), mode TEXT NOT NULL, rule_id TEXT NOT NULL, changed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rule_worker_state (project_id TEXT PRIMARY KEY REFERENCES projects(id), lease_until INTEGER NOT NULL DEFAULT 0, next_run INTEGER NOT NULL DEFAULT 0, last_attempt TEXT, last_run TEXT, last_error TEXT);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_connections (project_id TEXT PRIMARY KEY REFERENCES projects(id), token_cipher TEXT NOT NULL, accounts TEXT NOT NULL, connected_at TEXT NOT NULL, last_sync TEXT);
    CREATE TABLE IF NOT EXISTS meta_campaigns (campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id), external_id TEXT NOT NULL, account_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pixel_capi (pixel_id TEXT PRIMARY KEY REFERENCES pixels(id), meta_pixel_id TEXT NOT NULL, token_cipher TEXT NOT NULL, test_event_code TEXT);
    CREATE TABLE IF NOT EXISTS integration_pixels (integration_id TEXT PRIMARY KEY, pixel_id TEXT REFERENCES pixels(id));
    CREATE TABLE IF NOT EXISTS capi_queue (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, pixel_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0, next_attempt INTEGER DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_account_selection (project_id TEXT REFERENCES projects(id), account_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,account_id));
    CREATE TABLE IF NOT EXISTS ad_sets (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id), external_id TEXT, name TEXT NOT NULL, active INTEGER DEFAULT 1, budget REAL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ads (id TEXT PRIMARY KEY, adset_id TEXT NOT NULL REFERENCES ad_sets(id), external_id TEXT, name TEXT NOT NULL, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS ad_insights (ad_id TEXT REFERENCES ads(id), day TEXT NOT NULL, amount REAL NOT NULL, impressions INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0, PRIMARY KEY(ad_id,day));
    CREATE TABLE IF NOT EXISTS campaign_funnel (campaign_id TEXT REFERENCES campaigns(id), day TEXT NOT NULL, link_clicks INTEGER DEFAULT 0, landing_views INTEGER DEFAULT 0, checkouts INTEGER DEFAULT 0, meta_purchases INTEGER DEFAULT 0, PRIMARY KEY(campaign_id,day));
    CREATE TABLE IF NOT EXISTS event_details (event_id TEXT PRIMARY KEY REFERENCES events(id), session_id TEXT, page_title TEXT, referrer TEXT, section TEXT, target_url TEXT, utm_medium TEXT, utm_content TEXT, utm_term TEXT);
    CREATE TABLE IF NOT EXISTS event_engagement (event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE, page_view_id TEXT, duration_ms INTEGER, active_ms INTEGER, scroll_depth INTEGER, reason TEXT, away_ms INTEGER, occurred_at TEXT);
    CREATE INDEX IF NOT EXISTS engagement_page_view ON event_engagement(page_view_id);
    CREATE TABLE IF NOT EXISTS sale_attribution (sale_id TEXT PRIMARY KEY REFERENCES sales(id), visitor_id TEXT, adset_id TEXT, ad_id TEXT);
    CREATE TABLE IF NOT EXISTS sale_tracking (sale_id TEXT PRIMARY KEY REFERENCES sales(id), utm_term TEXT, adset_reference TEXT, ad_reference TEXT);
    CREATE TABLE IF NOT EXISTS manual_sale_attribution (sale_id TEXT PRIMARY KEY REFERENCES sales(id), updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_links (ticket_hash TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), expires_at INTEGER NOT NULL, used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), cookie_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS admin_sessions (id_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS provider_connections (integration_id TEXT PRIMARY KEY REFERENCES integrations(id), provider TEXT NOT NULL, url_cipher TEXT NOT NULL, secret_cipher TEXT, test_mode INTEGER NOT NULL DEFAULT 1, purchase_owner TEXT NOT NULL DEFAULT 'checkout');
    CREATE TABLE IF NOT EXISTS webhook_receipts (id TEXT PRIMARY KEY, integration_id TEXT NOT NULL, event_key TEXT NOT NULL, event_name TEXT NOT NULL, status TEXT NOT NULL, test_mode INTEGER NOT NULL, payload_cipher TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, received_at TEXT NOT NULL, processed_at TEXT, last_error TEXT, UNIQUE(integration_id,event_key));
    CREATE TABLE IF NOT EXISTS provider_orders (project_id TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT NOT NULL, sale_id TEXT NOT NULL REFERENCES sales(id), updated_at INTEGER NOT NULL, PRIMARY KEY(project_id,provider,external_id));
    CREATE TABLE IF NOT EXISTS checkout_refs (project_id TEXT NOT NULL, code TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY(project_id,code));
    CREATE INDEX IF NOT EXISTS webhook_receipts_queue ON webhook_receipts(status,next_attempt,locked_until);
    CREATE INDEX IF NOT EXISTS checkout_refs_expiry ON checkout_refs(expires_at);
    CREATE INDEX IF NOT EXISTS events_visitor ON events(project_id,visitor_id,created_at);
    CREATE INDEX IF NOT EXISTS attribution_visitor ON sale_attribution(visitor_id);
    CREATE INDEX IF NOT EXISTS sales_project_day ON sales(project_id,day);
    CREATE INDEX IF NOT EXISTS events_project_day ON events(project_id,day);
  `);
  if (options.seedDemo !== false) {
    if (!db.prepare('SELECT id FROM projects LIMIT 1').get()) seed(db);
    seedAnalyticsDemo(db);
  }
  return db;
}

function seed(db) {
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO projects VALUES(?,?,?)').run('demo', 'Operação principal', 1);
    db.prepare('INSERT INTO projects VALUES(?,?,?)').run('workspace', 'Minha operação', 0);
    const campaigns = [
      ['c1', '[CONVERSÃO] Método Liberdade', 'Meta Ads', 350, 1],
      ['c2', '[ESCALA] Receitas que vendem', 'Meta Ads', 250, 1],
      ['c3', '[REMARKETING] Carrinho 7D', 'Meta Ads', 120, 1],
      ['c4', '[TESTE] Criativos · Outubro', 'Meta Ads', 150, 1],
      ['c5', '[SEARCH] Curso de fotografia', 'Google Ads', 180, 0],
    ];
    const products = [
      'Método Liberdade',
      'Receitas que vendem',
      'Método Liberdade',
      'Planner de produtividade',
      'Fotografia do zero',
    ];
    const names = [
      'Mariana Costa',
      'Lucas Oliveira',
      'Ana Beatriz',
      'Pedro Santos',
      'Juliana Almeida',
      'Rafael Lima',
      'Camila Rodrigues',
      'Bruno Ferreira',
      'Fernanda Souza',
      'Gabriel Martins',
      'Isabela Rocha',
      'Thiago Ribeiro',
    ];
    const created = new Date().toISOString();
    campaigns.forEach((c) =>
      db
        .prepare('INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)')
        .run(c[0], 'demo', c[1], c[2], c[3], c[4], created),
    );
    db.prepare('INSERT INTO pixels VALUES(?,?,?,?,?,?,?)').run(
      'px_demo',
      'demo',
      'Pixel principal',
      'https://minhaloja.exemplo.com.br',
      'https://minhaloja.exemplo.com.br/checkout',
      1,
      created,
    );
    const insertSale = db.prepare('INSERT INTO sales VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insertEvent = db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)');
    for (let d = 29; d >= 0; d--) {
      const now = new Date();
      now.setUTCDate(now.getUTCDate() - d);
      const day = dateKey(now);
      campaigns.forEach((c, i) => {
        const spent = money((95 + i * 23) * (1 + Math.sin(d * 1.8 + i) * 0.3));
        db.prepare('INSERT INTO spend VALUES(?,?,?,?,?)').run(
          c[0],
          day,
          spent,
          Math.round(spent * 170),
          Math.round(spent * 2.7),
        );
      });
      const count = 36 + ((d * 13) % 31);
      for (let n = 0; n < count; n++) {
        const ci = n % 5;
        const time = new Date(
          `${day}T${String(6 + (n % 16)).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}:00-03:00`,
        ).toISOString();
        const status = n % 17 === 0 ? 'refunded' : n % 11 === 0 ? 'pending' : 'approved';
        insertSale.run(
          `s_${d}_${n}`,
          'demo',
          `WT${day.replaceAll('-', '')}${String(n + 1).padStart(4, '0')}`,
          'demo',
          campaigns[ci][0],
          names[n % names.length],
          `cliente${n + 1}@exemplo.com`,
          products[ci],
          [97, 47.9, 97, 29.9, 147][ci],
          status,
          n % 4 === 0 ? 'credit_card' : 'pix',
          ci === 4 ? 'google' : 'facebook',
          campaigns[ci][1],
          'paid',
          `criativo_${(n % 5) + 1}`,
          time,
          day,
        );
      }
      for (let n = 0; n < 440 + ((d * 37) % 320); n++) {
        const source = ['facebook', 'facebook', 'google', 'instagram', 'direct'][n % 5];
        insertEvent.run(
          `e_${d}_${n}`,
          'px_demo',
          'demo',
          `v_${d}_${n}`,
          'PageView',
          'https://minhaloja.exemplo.com.br',
          source,
          campaigns[n % 5][1],
          `${day}T12:00:00.000Z`,
          day,
        );
      }
    }
    db.prepare('INSERT INTO rules VALUES(?,?,?,?,?,?,?,?)').run(
      'rule_demo',
      'demo',
      'Acompanhar campanhas com CPA alto',
      'cpa',
      'gt',
      25,
      1,
      created,
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
