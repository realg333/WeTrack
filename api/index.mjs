import { waitUntil } from '@vercel/functions';
import { cloudApp } from '../server/cloud.mjs';
import { afterResponse } from '../server/background.mjs';

export default async function handler(req, res) {
  try {
    const app = await cloudApp();
    if (
      req.method === 'POST' &&
      (/^\/api\/webhooks\//.test(req.url) || /^\/api\/capi\/[^/]+\/retry/.test(req.url))
    ) {
      waitUntil(afterResponse(res, () => app.locals.meta.drain()));
    }
    app(req, res);
  } catch (error) {
    const code = /^[A-Z0-9_]{1,80}$/.test(error.code || error.message || '')
      ? error.code || error.message
      : 'CLOUD_INIT_FAILED';
    console.error('WeTrack cloud initialization:', code);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      JSON.stringify({ error: 'A API está inicializando. Tente novamente em instantes.', code }),
    );
  }
}
