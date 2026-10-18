import { createDatabase } from './db.mjs';
import { createApp } from './app.mjs';
import { loadSecretKey } from './meta.mjs';
const host = process.env.HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.ADMIN_PASSWORD)
  throw new Error('Configure ADMIN_PASSWORD antes de expor o painel na rede.');
const db = createDatabase();
const app = createApp(db, {
  secretKey: loadSecretKey(process.env.SECRETS_KEY_PATH || './data/secret.key'),
});
const worker = setInterval(
  () => void app.locals.meta.drain().catch((e) => console.error('CAPI worker:', e.message)),
  30000,
);
worker.unref();
const server = app.listen(Number(process.env.PORT || 3001), host, () =>
  console.log(`WeTrack API: http://${host}:${process.env.PORT || 3001}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(worker);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
