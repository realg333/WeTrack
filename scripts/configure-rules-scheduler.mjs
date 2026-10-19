import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Pass the official Vercel vc.js path. Secrets travel only through stdin.
const cli = process.argv[2];
if (!cli || !existsSync(cli)) throw new Error('Informe o caminho do vc.js da CLI oficial Vercel.');
const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
if (
  project.projectId !== 'prj_POcaMQQecPbbF76XF25YxjLnwJU4' ||
  project.orgId !== 'team_3u9EVq6Af2cAPT8cdNrNZb0u'
)
  throw new Error('O projeto não corresponde à WeTrack autorizada.');
mkdirSync('data', { recursive: true });
const path = 'data/rules-scheduler.json';
if (!existsSync(path))
  writeFileSync(path, JSON.stringify({ secret: randomBytes(32).toString('base64url') }), {
    mode: 0o600,
    flag: 'wx',
  });
const { secret } = JSON.parse(readFileSync(path, 'utf8'));
if (!/^[A-Za-z0-9_-]{43}$/.test(secret || ''))
  throw new Error('Chave de agendamento local inválida.');
try {
  execFileSync(
    process.execPath,
    [
      cli,
      'env',
      'add',
      'RULES_CRON_SECRET',
      'production',
      '--scope',
      project.orgId,
      '--project',
      project.projectId,
      '--yes',
      '--force',
      '--sensitive',
    ],
    { input: secret, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  console.log('RULES_CRON_SECRET configurada na Vercel (production).');
  execFileSync('gh', ['secret', 'set', 'WETRACK_RULES_CRON_SECRET', '--repo', 'realg333/WeTrack'], {
    input: secret,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  console.log('WETRACK_RULES_CRON_SECRET configurada no GitHub Actions.');
} catch {
  throw new Error(
    'Não foi possível concluir a configuração do agendador. Nenhuma credencial foi exibida.',
  );
}
