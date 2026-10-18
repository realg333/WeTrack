import Database from 'libsql';
import { createClient } from '@libsql/client';
import { createDatabase } from './db.mjs';
import { createApp } from './app.mjs';
import { decrypt } from './meta.mjs';

export const cloudTables = [
  'projects',
  'campaigns',
  'spend',
  'pixels',
  'integrations',
  'sales',
  'events',
  'rules',
  'settings',
  'meta_connections',
  'meta_campaigns',
  'pixel_capi',
  'integration_pixels',
  'capi_queue',
  'ad_sets',
  'ads',
  'ad_insights',
  'campaign_funnel',
  'event_details',
  'sale_attribution',
  'provider_connections',
  'provider_orders',
  'webhook_receipts',
  'checkout_refs',
];
export function cloudCredentials(env = process.env) {
  for (const prefix of ['DATABASE_', '']) {
    const url = env[`${prefix}TURSO_DATABASE_URL`],
      authToken = env[`${prefix}TURSO_AUTH_TOKEN`];
    if (url && /^(libsql|https):\/\//.test(url) && authToken && authToken !== '[SENSITIVE]')
      return { url, authToken };
  }
  throw new Error('WETRACK_TURSO_ENV_MISSING');
}
export function cloudSchema() {
  const template = createDatabase(':memory:', { seedDemo: false });
  try {
    return template
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC,rowid",
      )
      .all()
      .map((r) =>
        r.sql
          .replace(/^CREATE TABLE(?: IF NOT EXISTS)? /i, 'CREATE TABLE IF NOT EXISTS ')
          .replace(/^CREATE INDEX(?: IF NOT EXISTS)? /i, 'CREATE INDEX IF NOT EXISTS '),
      );
  } finally {
    template.close();
  }
}
export async function initializeCloud(client, key, bootstrap) {
  await client.batch(cloudSchema(), 'write');
  const tx = await client.transaction('write');
  try {
    const initialized = await tx.execute(
      "SELECT name FROM schema_migrations WHERE name='cloud-bootstrap-v1'",
    );
    if (!initialized.rows.length) {
      if (!bootstrap) throw new Error('WETRACK_BOOTSTRAP_MISSING');
      const snapshot = JSON.parse(decrypt(bootstrap, key));
      const schema = createDatabase(':memory:', { seedDemo: false });
      try {
        for (const table of cloudTables) {
          const allowedColumns = schema
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((c) => c.name);
          const rows = snapshot[table] || [];
          if (!Array.isArray(rows)) throw new Error('WETRACK_BOOTSTRAP_INVALID');
          const statements = rows.map((row) => ({
            sql: `INSERT OR IGNORE INTO ${table}(${allowedColumns.join(',')}) VALUES(${allowedColumns.map(() => '?').join(',')})`,
            args: allowedColumns.map((c) => row[c] ?? null),
          }));
          if (statements.length) await tx.batch(statements);
        }
        await tx.execute("INSERT INTO schema_migrations VALUES('cloud-bootstrap-v1')");
      } finally {
        schema.close();
      }
    }
    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  } finally {
    tx.close();
  }
}
let application;
export function cloudApp() {
  if (!application)
    application = (async () => {
      if (!process.env.ADMIN_PASSWORD || !/^[a-f0-9]{64}$/i.test(process.env.SECRETS_KEY || ''))
        throw new Error('WETRACK_ACCESS_ENV_MISSING');
      const credentials = cloudCredentials(),
        key = Buffer.from(process.env.SECRETS_KEY, 'hex'),
        client = createClient(credentials);
      try {
        await initializeCloud(client, key, process.env.WETRACK_BOOTSTRAP);
      } finally {
        client.close();
      }
      const db = new Database(credentials.url, { authToken: credentials.authToken });
      if (!process.env.PUBLIC_URL) {
        const hostname = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
        if (!hostname) throw new Error('WETRACK_PUBLIC_URL_MISSING');
        process.env.PUBLIC_URL = `https://${hostname}`;
      }
      return createApp(db, { secretKey: key, serverless: true });
    })().catch((error) => {
      application = undefined;
      throw error;
    });
  return application;
}
