import { requestLog } from '../lib/log.mjs';
import { config, currentUser, DbError, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/modes: the Tap owner's mode control (migration 034, DEC-2026-041).
 * The contract is docs/v6/aaroh/api-contract.md §6.
 *
 * Body: { op: '<operation>', ...fields }. Every operation needs
 * Authorization: Bearer <the customer's access token>.
 *
 *   owner.state          the active mode, its version, and each mode's availability
 *   owner.activate       { mode: 'business' | 'info', expectedVersion, idempotencyKey }
 *   owner.info.get       my Info record and its publication status
 *   owner.info.save      { fields: { title?, shortDescription?, category?, detailedInformation? }, expectedVersion }
 *   owner.info.clear     delete my Info record (refused while Info is live)
 *   owner.preview        { mode }: exactly what a visitor would get
 *
 * Visitors read the public side through the database function
 * get_public_tap_mode(p_slug), not through this endpoint.
 * Errors: { error: { code, message, field?, reason?, missing?, current? } }.
 * Messages are fixed text and never repeat a submitted value.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to manage your Tap.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_mode: [400, 'Choose business or info.'],
  invalid_expected_version: [400, 'Send the version you last saw.'],
  invalid_idempotency_key: [400, 'Send a new idempotency key: 16 to 64 letters, digits, "-" or "_".'],
  invalid_field: [422, 'One of the fields is not valid.'],
  no_tap: [404, 'You do not have a Tap yet.'],
  tap_suspended: [409, 'Your Tap is suspended, so its mode cannot change.'],
  mode_unavailable: [409, 'That mode is not available yet.'],
  needs_setup: [409, 'Finish setting up Info first.'],
  stale_version: [409, 'This changed somewhere else. Reload and try again.'],
  mode_active: [409, 'Info is live. Switch your Tap to Business first.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const MODES = new Set(['business', 'info']);
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_BODY = 16 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  const error = { code: ERRORS[code] ? code : 'internal', message };
  // Only these structured details are passed on: field and reason names, the
  // missing field names, and the current version. Never a submitted value.
  if (typeof extra.field === 'string') error.field = extra.field;
  if (typeof extra.reason === 'string') error.reason = extra.reason;
  if (Array.isArray(extra.missing)) error.missing = extra.missing;
  if (extra.current && typeof extra.current === 'object') error.current = extra.current;
  return json({ error }, status);
}

function fromDb(error, log) {
  if (error instanceof DbError && error.appCode && ERRORS[error.appCode]) return fail(error.appCode);
  log.error('modes.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

/** A database answer { ok: false, code, ... } becomes the matching error. */
const answer = (r, status = 200) => {
  if (r && r.ok === false) return fail(r.code, r);
  const { ok: _ok, ...rest } = r ?? {};
  return json(rest, status);
};

const version = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

const OPS = {
  'owner.state': async (cfg, user) => answer(await rpc(cfg, 'modes_owner_state', { p_user: user.id })),
  'owner.activate': async (cfg, user, body, log) => {
    if (!MODES.has(body.mode)) return fail('invalid_mode');
    if (version(body.expectedVersion) === null) return fail('invalid_expected_version');
    if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) return fail('invalid_idempotency_key');
    const r = await rpc(cfg, 'modes_owner_activate', {
      p_user: user.id, p_mode: body.mode, p_expected_version: body.expectedVersion, p_idempotency_key: body.idempotencyKey,
    });
    if (r?.ok === false) log.warn('modes.activate-refused', { code: r.code });
    else log.info('modes.activated', { mode: r?.activeMode, replayed: r?.replayed === true });
    return answer(r);
  },
  'owner.info.get': async (cfg, user) => answer(await rpc(cfg, 'modes_info_get', { p_user: user.id })),
  'owner.info.save': async (cfg, user, body, log) => {
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields)) return fail('invalid_request');
    if (version(body.expectedVersion) === null) return fail('invalid_expected_version');
    const r = await rpc(cfg, 'modes_info_save', { p_user: user.id, p_fields: body.fields, p_expected_version: body.expectedVersion });
    if (r?.ok === false) log.warn('modes.info-save-refused', { code: r.code, field: r.field ?? null, reason: r.reason ?? null });
    return answer(r);
  },
  'owner.info.clear': async (cfg, user) => answer(await rpc(cfg, 'modes_info_clear', { p_user: user.id })),
  'owner.preview': async (cfg, user, body) => {
    if (!MODES.has(body.mode)) return fail('invalid_mode');
    return answer(await rpc(cfg, 'modes_preview', { p_user: user.id, p_mode: body.mode }));
  },
};

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('modes.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return fail('invalid_request');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('invalid_request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');
  // Own keys only: `constructor`, `toString` or `__proto__` are not operations.
  const op = Object.hasOwn(OPS, body.op) ? OPS[body.op] : null;
  if (!op) return fail('unknown_op');
  try {
    // The role comes only from the verified token; nothing in the body or URL can claim one.
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
  const log = requestLog('modes', request);
  return log.respond(await handle(request, log));
};
