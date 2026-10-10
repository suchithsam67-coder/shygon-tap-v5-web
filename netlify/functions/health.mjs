import { adminClient, json } from '../lib/supabase.mjs';
import { requestLog } from '../lib/log.mjs';

/**
 * GET /api/health (V6-018).
 *
 *   /api/health          liveness and configuration: is every server setting present?
 *   /api/health?deep=1   readiness: also, does the database answer?
 *
 * 200 {"status":"ok"} when all is well, 503 {"status":"degraded"} otherwise.
 * The answer never says WHICH setting is missing, and never shows a value:
 * the setting names go to the function log only. Safe to point an uptime
 * monitor at.
 */

const REQUIRED = ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];
const DATABASE_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export default async (request) => {
  const log = requestLog('health', request);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return log.respond(json({ error: 'Method not allowed' }, 405));
  }

  const missing = REQUIRED.filter((name) => !String(process.env[name] ?? '').trim());
  if (!String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()) missing.push('SUPABASE_URL');
  const checks = { config: missing.length ? 'missing' : 'ok' };
  if (missing.length) log.warn('health.config-missing', { settings: missing });

  if (new URL(request.url).searchParams.get('deep') === '1') {
    if (missing.length) {
      checks.database = 'skipped';
    } else {
      try {
        const { error } = await withTimeout(adminClient().from('products').select('id').limit(1), DATABASE_TIMEOUT_MS);
        checks.database = error ? 'error' : 'ok';
        if (error) log.error('health.database', { code: error.code, message: error.message });
      } catch (error) {
        checks.database = 'error';
        log.error('health.database', { error });
      }
    }
  }

  const healthy = Object.values(checks).every((value) => value === 'ok');
  return log.respond(
    new Response(JSON.stringify({ status: healthy ? 'ok' : 'degraded', time: new Date().toISOString(), checks }), {
      status: healthy ? 200 : 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }),
  );
};
