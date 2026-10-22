import Database from 'libsql';
import { pathToFileURL } from 'node:url';
import { cloudCredentials } from '../server/cloud.mjs';
import { createMetaService } from '../server/meta.mjs';
import { createRuleService } from '../server/rules.mjs';

// One invocation, one cycle, then exit. It never starts the local HTTP server or its timers.
export async function runRulesWorker({ env = process.env, checkOnly = true, db } = {}) {
  const credentials = cloudCredentials(env);
  if (!/^[a-f0-9]{64}$/i.test(env.SECRETS_KEY || ''))
    throw new Error('WETRACK_WORKER_SECRETS_KEY_MISSING');
  if (!/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION || ''))
    throw new Error('WETRACK_WORKER_META_VERSION_MISSING');
  const connection = db || new Database(credentials.url, { authToken: credentials.authToken });
  try {
    // The production application owns migrations. Fail rather than bootstrap another database.
    connection.prepare('SELECT COUNT(*) AS n FROM rule_configs').get();
    const rules = createRuleService(
      connection,
      createMetaService(connection, Buffer.from(env.SECRETS_KEY, 'hex')),
    );
    if (checkOnly) return { ok: true, check_only: true, scheduler: rules.schedulerStatus() };
    const result = await rules.runScheduled({ source: 'standalone' });
    return { ...result, scheduler: rules.schedulerStatus() };
  } finally {
    if (!db) connection.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args[0] && !['--run', '--check-only'].includes(args[0])))
      throw new Error('WETRACK_WORKER_INVALID_ARGUMENTS');
    const result = await runRulesWorker({ checkOnly: args[0] !== '--run' });
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    // Errors from database drivers may include connection information; never print them.
    const code = /^WETRACK_[A-Z_]+$/.test(error.message || '')
      ? error.message
      : 'WETRACK_RULES_WORKER_FAILED';
    console.error(JSON.stringify({ ok: false, code }));
    process.exitCode = 1;
  }
}
