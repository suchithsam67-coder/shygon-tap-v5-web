import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env } from '../lib/sms.mjs';
import { config, dispatchDue, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/emergency-dispatch: the emergency sweep (migration 029). Run it
 * every minute from the host's scheduler with Authorization: Bearer
 * <CRON_SECRET>. It
 *   - closes attempts whose lease ran out (the server stopped mid-send) as
 *     lease_expired, and retries them if attempts remain;
 *   - sends every retry that is due (30 s after the first failure, 2 minutes
 *     after the second; at most 3 attempts per recipient);
 *   - applies retention (emergency_purge; rescue_purge for the Return-to-Owner
 *     relay, 031; connect_purge for Connect requests and ended connections, 032).
 *
 * Without CRON_SECRET it refuses to run (fail closed): the schedule is a
 * deployment setting (docs/v6/aaroh/provider-requirements.md).
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function sameSecret(a, b) {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(x, y);
}

async function handle(request, log) {
  if (request.method !== 'POST' && request.method !== 'GET') {
    return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  }
  const secret = env('CRON_SECRET');
  const cfg = config();
  if (!secret || !cfg) {
    log.error('emergency-dispatch.misconfigured', { hasSecret: Boolean(secret), hasDb: Boolean(cfg) });
    return json({ error: { code: 'not_configured', message: 'The dispatcher is not configured.' } }, 503);
  }
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !sameSecret(given, secret)) {
    log.warn('security.dispatch-refused', { reason: 'bad-secret' });
    return json({ error: { code: 'unauthenticated', message: 'Not allowed.' } }, 401);
  }
  try {
    const dispatched = await dispatchDue(cfg, { limit: 100, log });
    const purged = await rpc(cfg, 'emergency_purge');
    const rescue = await rpc(cfg, 'rescue_purge');
    const connect = await rpc(cfg, 'connect_purge');
    log.info('emergency-dispatch.done', { ...dispatched, ...purged, ...rescue, ...connect });
    return json({ dispatched, purged, rescue, connect });
  } catch (error) {
    log.error('emergency-dispatch.error', { error });
    return json({ error: { code: 'internal', message: 'The sweep failed.' } }, 500);
  }
}

export default async (request) => {
  const log = requestLog('emergency-dispatch', request);
  return log.respond(await handle(request, log));
};
