import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env } from '../lib/sms.mjs';
import { config, currentUser, DbError, hmac, isUuid, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/rescue: SHYGON Return-to-Owner relay (migration 031).
 * The contract is docs/v6/aaroh/api-contract.md §11 (AAROH-API); keep them in step.
 *
 * Body: { op: '<operation>', ...fields }.
 *
 * Finder operations (no sign-in; only where RESCUE_RELAY=on is set on the host):
 *   public.status    { available, hint } for /t/<slug>
 *   public.start     first message; returns the finder token, the only key to the thread
 *   finder.view      the thread's status and messages
 *   finder.post      a follow-up message
 * Owner operations (Authorization: Bearer <the customer's access token>):
 *   settings.get / settings.set     relay on or off (default off), a public hint
 *   threads.list / threads.get      inbox; opening a thread marks it read
 *   threads.reply                   a reply the finder sees
 *   threads.close / threads.block / threads.report
 *
 * Neither side receives the other's details: the finder gets no owner field,
 * the owner sees only what the finder writes. Links are removed from every
 * message. Errors: { error: { code, message, retryAfter? } }.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in again.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_setting: [400, 'Say whether finders may message you.'],
  invalid_message: [400, 'Write a message (up to 500 characters).'],
  invalid_idempotency_key: [400, 'Send a new idempotency key: 16 to 64 letters, digits, "-" or "_".'],
  invalid_thread: [400, 'Choose a conversation.'],
  invalid_token: [400, 'This link is not valid.'],
  unavailable: [404, 'Messages to this card’s owner are not available.'],
  thread_not_found: [404, 'Conversation not found.'],
  thread_expired: [410, 'This conversation has expired.'],
  thread_closed: [409, 'This conversation is closed.'],
  already_blocked: [409, 'This conversation is already blocked.'],
  awaiting_owner: [409, 'Please wait for the owner to reply before writing again.'],
  rate_limited: [429, 'Too many messages. Please try again later.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  const error = { code: ERRORS[code] ? code : 'internal', message };
  if (Number.isFinite(extra.retryAfter) && status === 429) error.retryAfter = extra.retryAfter;
  const response = json({ error }, status);
  if (error.retryAfter) response.headers.set('retry-after', String(error.retryAfter));
  return response;
}

function fromDb(error, log) {
  if (error instanceof DbError && error.appCode && ERRORS[error.appCode]) return fail(error.appCode);
  log.error('rescue.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

/** Public operations run only where RESCUE_RELAY=on (off until DEC-2026-038 Q12). */
const relayAllowed = () => env('RESCUE_RELAY') === 'on';

/** The finder's token: derived, never stored (only its SHA-256), so a retry of the same start returns it again. */
const finderToken = (secret, ownerId, key) =>
  crypto.createHmac('sha256', secret).update(`rescue-finder|${ownerId}|${key}`).digest('base64url');
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** A finder, for limits and blocks only: an HMAC of the host-reported client address. */
function finderDigest(secret, request) {
  const ip =
    request.headers.get('x-nf-client-connection-ip') ??
    request.headers.get('x-vercel-forwarded-for') ??
    request.headers.get('x-real-ip');
  if (!ip || !String(ip).trim()) return null;
  return hmac(secret, `rescue-finder-ip|${String(ip).split(',')[0].trim()}`);
}

const message = (value) => (typeof value === 'string' && value.trim() && value.length <= 2000 ? value : null);

// --- finders ------------------------------------------------------------------

async function publicStatus(cfg, body) {
  const slug = String(body.slug ?? '').trim();
  if (!relayAllowed() || !SLUG.test(slug)) return json({ available: false, hint: null });
  const target = await rpc(cfg, 'rescue_public_target', { p_slug: slug });
  return json({ available: Boolean(target), hint: target?.publicHint ?? null });
}

async function publicStart(cfg, request, body, log) {
  if (!relayAllowed()) return fail('unavailable');
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || !KEY.test(key)) return fail('invalid_idempotency_key');
  const text = message(body.message);
  if (!text) return fail('invalid_message');
  const slug = String(body.slug ?? '').trim();
  if (!SLUG.test(slug)) return fail('unavailable');
  const digest = finderDigest(cfg.secret, request);
  if (!digest) {
    log.warn('rescue.no-client-address', {});
    return fail('unavailable');
  }
  const target = await rpc(cfg, 'rescue_public_target', { p_slug: slug });
  if (!target) return fail('unavailable');
  const token = finderToken(cfg.secret, target.userId, key);
  const opened = await rpc(cfg, 'rescue_thread_open', {
    p_user: target.userId, p_tap_profile_id: target.tapProfileId, p_idempotency_key: key,
    p_finder_digest: digest, p_token_hash: tokenHash(token), p_body: text,
  });
  if (!opened.ok) {
    log.warn('rescue.thread-refused', { code: opened.code });
    return fail(opened.code, { retryAfter: opened.retryAfter });
  }
  log.info('rescue.thread-opened', { threadId: opened.threadId, replayed: opened.replayed });
  const view = await rpc(cfg, 'rescue_finder_view', { p_token_hash: tokenHash(token) });
  return json({ finderToken: token, replayed: opened.replayed, thread: view.ok ? view.thread : null }, opened.replayed ? 200 : 201);
}

async function finderView(cfg, body) {
  if (typeof body.finderToken !== 'string' || !TOKEN.test(body.finderToken)) return fail('invalid_token');
  const view = await rpc(cfg, 'rescue_finder_view', { p_token_hash: tokenHash(body.finderToken) });
  return view.ok ? json({ thread: view.thread }) : fail(view.code, { retryAfter: view.retryAfter });
}

async function finderPost(cfg, body) {
  if (typeof body.finderToken !== 'string' || !TOKEN.test(body.finderToken)) return fail('invalid_token');
  if (typeof body.clientKey !== 'string' || !KEY.test(body.clientKey)) return fail('invalid_idempotency_key');
  const text = message(body.message);
  if (!text) return fail('invalid_message');
  const hash = tokenHash(body.finderToken);
  const posted = await rpc(cfg, 'rescue_finder_post', { p_token_hash: hash, p_body: text, p_client_key: body.clientKey });
  if (!posted.ok) return fail(posted.code, { retryAfter: posted.retryAfter });
  const view = await rpc(cfg, 'rescue_finder_view', { p_token_hash: hash });
  return json({ replayed: posted.replayed, thread: view.ok ? view.thread : null });
}

// --- owners -------------------------------------------------------------------

const OWNER_OPS = {
  'settings.get': async (cfg, user) => json({ settings: { ...(await rpc(cfg, 'rescue_settings_for', { p_user: user.id })), relayAllowed: relayAllowed() } }),
  'settings.set': async (cfg, user, body) => {
    if (typeof body.enabled !== 'boolean') return fail('invalid_setting');
    if (body.publicHint !== undefined && body.publicHint !== null && (typeof body.publicHint !== 'string' || body.publicHint.length > 280)) {
      return fail('invalid_request');
    }
    const settings = await rpc(cfg, 'rescue_settings_set', { p_user: user.id, p_enabled: body.enabled, p_public_hint: body.publicHint ?? null });
    return json({ settings: { ...settings, relayAllowed: relayAllowed() } });
  },
  'threads.list': async (cfg, user, body) =>
    json({ threads: await rpc(cfg, 'rescue_threads_for', { p_user: user.id, p_limit: Number.isInteger(body.limit) ? body.limit : 50 }) }),
  'threads.get': async (cfg, user, body) => {
    if (!isUuid(body.threadId)) return fail('invalid_thread');
    const thread = await rpc(cfg, 'rescue_thread_detail', { p_user: user.id, p_thread_id: body.threadId });
    return thread ? json({ thread }) : fail('thread_not_found');
  },
  'threads.reply': async (cfg, user, body) => {
    if (!isUuid(body.threadId)) return fail('invalid_thread');
    if (typeof body.clientKey !== 'string' || !KEY.test(body.clientKey)) return fail('invalid_idempotency_key');
    const text = message(body.message);
    if (!text) return fail('invalid_message');
    const thread = await rpc(cfg, 'rescue_owner_reply', {
      p_user: user.id, p_thread_id: body.threadId, p_body: text, p_client_key: body.clientKey,
    });
    const { replayed, ...rest } = thread;
    return json({ thread: rest, replayed });
  },
};
for (const action of ['close', 'block', 'report']) {
  OWNER_OPS[`threads.${action}`] = async (cfg, user, body) => {
    if (!isUuid(body.threadId)) return fail('invalid_thread');
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 300)) return fail('invalid_request');
    const thread = await rpc(cfg, 'rescue_thread_moderate', {
      p_user: user.id, p_thread_id: body.threadId, p_action: action, p_reason: body.reason ?? null,
    });
    return json({ thread });
  };
}

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('rescue.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');
  try {
    if (body.op === 'public.status') return await publicStatus(cfg, body);
    if (body.op === 'public.start') return await publicStart(cfg, request, body, log);
    if (body.op === 'finder.view') return relayAllowed() ? await finderView(cfg, body) : fail('unavailable');
    if (body.op === 'finder.post') return relayAllowed() ? await finderPost(cfg, body) : fail('unavailable');
    const op = OWNER_OPS[body.op];
    if (!op) return fail('unknown_op');
    const user = await currentUser(cfg, request);
    if (!user) {
      log.warn('security.session-refused', { op: body.op });
      return fail('unauthenticated');
    }
    return await op(cfg, user, body, log);
  } catch (error) {
    return fromDb(error, log);
  }
}

export default async (request) => {
  const log = requestLog('rescue', request);
  return log.respond(await handle(request, log));
};
