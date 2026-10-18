import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createDatabase } from '../server/db.mjs';
import { cloudTables } from '../server/cloud.mjs';
import { encrypt, loadSecretKey } from '../server/meta.mjs';

// Run locally. Credentials are passed to the official CLI through stdin, never arguments/logs.
const cli = process.argv[2];
if (!cli || !existsSync(cli)) throw new Error('Informe o caminho do vc.js da CLI oficial Vercel.');
const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
if (
  project.projectId !== 'prj_POcaMQQecPbbF76XF25YxjLnwJU4' ||
  project.orgId !== 'team_3u9EVq6Af2cAPT8cdNrNZb0u'
)
  throw new Error('O projeto Vercel não corresponde à WeTrack autorizada.');
mkdirSync('data', { recursive: true });
const configPath = resolve('data/cloud-config.json');
let config;
if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
else {
  const db = createDatabase();
  try {
    const snapshot = Object.fromEntries(
      cloudTables.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all()]),
    );
    for (const t of cloudTables) {
      const columns = db.prepare(`PRAGMA table_info(${t})`).all();
      if (columns.some((c) => c.name === 'project_id'))
        snapshot[t] = snapshot[t].filter((r) => r.project_id === 'workspace');
    }
    snapshot.projects = snapshot.projects.filter((r) => r.id === 'workspace');
    const ids = (t) => new Set(snapshot[t].map((r) => r.id));
    const campaigns = ids('campaigns'),
      pixels = ids('pixels'),
      integrations = ids('integrations'),
      sales = ids('sales'),
      events = ids('events');
    for (const t of ['spend', 'meta_campaigns', 'campaign_funnel', 'ad_sets'])
      snapshot[t] = snapshot[t].filter((r) => campaigns.has(r.campaign_id));
    const sets = ids('ad_sets');
    snapshot.ads = snapshot.ads.filter((r) => sets.has(r.adset_id));
    const ads = ids('ads');
    snapshot.ad_insights = snapshot.ad_insights.filter((r) => ads.has(r.ad_id));
    snapshot.pixel_capi = snapshot.pixel_capi.filter((r) => pixels.has(r.pixel_id));
    snapshot.integration_pixels = snapshot.integration_pixels.filter(
      (r) => integrations.has(r.integration_id) && pixels.has(r.pixel_id),
    );
    snapshot.event_details = snapshot.event_details.filter((r) => events.has(r.event_id));
    snapshot.sale_attribution = snapshot.sale_attribution.filter((r) => sales.has(r.sale_id));
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > 25000)
      throw new Error('A migração excede o limite de bootstrap. Use uma migração direta de banco.');
    const key = loadSecretKey();
    config = {
      SECRETS_KEY: key.toString('hex'),
      ADMIN_PASSWORD: randomBytes(24).toString('base64url'),
      CRON_SECRET: randomBytes(32).toString('base64url'),
      WETRACK_BOOTSTRAP: encrypt(serialized, key),
      META_GRAPH_VERSION: 'v26.0',
    };
    writeFileSync(configPath, JSON.stringify(config), { mode: 0o600, flag: 'wx' });
    writeFileSync(
      'data/production-access.txt',
      `WeTrack — acesso ao painel publicado\nProjeto: wetrack / Wetrack\nSenha: ${config.ADMIN_PASSWORD}\n\nGuarde este arquivo em local privado. Não o envie ao GitHub.\n`,
      { mode: 0o600, flag: 'wx' },
    );
    console.log('Bootstrap preparado: somente a operação workspace; demonstração excluída.');
  } finally {
    db.close();
  }
}
for (const [name, value] of Object.entries(config)) {
  const args = [
    cli,
    'env',
    'add',
    name,
    'production',
    '--scope',
    project.orgId,
    '--project',
    project.projectId,
    '--yes',
    '--force',
  ];
  if (name !== 'META_GRAPH_VERSION') args.push('--sensitive');
  try {
    execFileSync(process.execPath, args, {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    console.log(`${name}: configurada em production.`);
  } catch {
    throw new Error(`Não foi possível configurar ${name}. Nenhum valor de credencial foi exibido.`);
  }
}
console.log('Acesso salvo em data/production-access.txt.');
