import { requestLog } from '../lib/log.mjs';
import { config, currentUser, DbError, isUuid, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/connect: SHYGON Connect between two SHYGON accounts, on the consent
 * ledger (migration 032). The contract is docs/v6/aaroh/api-contract.md §10b.
 *
 * Body: { op: '<operation>', ...fields }. Every operation except public.status
 * needs Authorization: Bearer <the customer's access token>.
 *
 *   public.status        { available } for /t/<slug> (no sign-in)
 *   settings.get / set   whether others may send me requests (off by default)
 *   requests.create      ask the owner of /t/<slug> to connect, sharing chosen fields
 *   requests.accept      the target accepts, choosing what it shares back
 *   requests.decline / requests.block
 *   connections.list     mine, with what each side shares (values read live,
 *                        only while the other side's grant is active)
 *   connections.share    change what I share (a new grant version)
 *   connections.remove   end it (or withdraw a request): every grant revoked
 *   consents.list        my consent ledger, revoked grants included
 *
 * Shared values are self-reported account fields: nothing verifies them.
 * Errors: { error: { code, message, retryAfter? } }.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to connect.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_setting: [400, 'Say whether others may send you requests.'],
  invalid_share: [400, 'Choose what to share from: phone, email, company, job_title.'],
  invalid_note: [400, 'Keep the note to 200 characters.'],
  invalid_connection: [400, 'Choose a connection.'],
  invalid_idempotency_key: [400, 'Send a new idempotency key: 16 to 64 letters, digits, "-" or "_".'],
  unavailable: [404, 'Connecting is not available for this profile.'],
  self: [400, 'You cannot connect with yourself.'],
  already_connected: [409, 'You already have a request or a connection with this person.'],
  recently_declined: [429, 'This person declined your request recently. Try again later.'],
  rate_limited: [429, 'Too many requests. Try again later.'],
  target_busy: [409, 'This person has too many pending requests. Try again later.'],
  connection_not_found: [404, 'Connection not found.'],
  already_decided: [409, 'This request has already been answered.'],
  not_open: [409, 'This connection has ended.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/i;
const STATUSES = new Set(['requested', 'accepted', 'declined', 'blocked', 'expired', 'removed']);

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
  log.error('connect.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

const shareOf = (value) => (Array.isArray(value) && value.length <= 4 && value.every((f) => typeof f === 'string') ? value : null);

async function connectionOf(cfg, userId, id) {
  const list = await rpc(cfg, 'connect_list', { p_user: userId, p_filter: null });
  return list.find((c) => c.id === id) ?? null;
}

const OPS = {
  'settings.get': async (cfg, user) => json({ settings: await rpc(cfg, 'connect_settings_for', { p_user: user.id }) }),
  'settings.set': async (cfg, user, body) => {
    if (typeof body.enabled !== 'boolean') return fail('invalid_setting');
    return json({ settings: await rpc(cfg, 'connect_settings_set', { p_user: user.id, p_enabled: body.enabled }) });
  },
  'requests.create': async (cfg, user, body, log) => {
    if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) return fail('invalid_idempotency_key');
    const share = shareOf(body.share ?? []);
    if (!share) return fail('invalid_share');
    if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 200)) return fail('invalid_note');
    const slug = String(body.slug ?? '').trim();
    if (!SLUG.test(slug)) return fail('unavailable');
    const r = await rpc(cfg, 'connect_request', {
      p_requester: user.id, p_slug: slug, p_share: share, p_note: body.note ?? null, p_idempotency_key: body.idempotencyKey,
    });
    if (!r.ok) {
      log.warn('connect.request-refused', { code: r.code });
      return fail(r.code, { retryAfter: r.retryAfter });
    }
    return json({ connection: await connectionOf(cfg, user.id, r.connectionId), replayed: r.replayed }, r.replayed ? 200 : 201);
  },
  'connections.list': async (cfg, user, body) => {
    if (body.status !== undefined && !STATUSES.has(body.status)) return fail('invalid_request');
    return json({ connections: await rpc(cfg, 'connect_list', { p_user: user.id, p_filter: body.status ?? null }) });
  },
  'connections.share': async (cfg, user, body) => {
    if (!isUuid(body.connectionId)) return fail('invalid_connection');
    const share = shareOf(body.share);
    if (!share) return fail('invalid_share');
    await rpc(cfg, 'connect_share', { p_user: user.id, p_connection: body.connectionId, p_share: share });
    return json({ connection: await connectionOf(cfg, user.id, body.connectionId) });
  },
  'connections.remove': async (cfg, user, body) => {
    if (!isUuid(body.connectionId)) return fail('invalid_connection');
    const r = await rpc(cfg, 'connect_remove', { p_user: user.id, p_connection: body.connectionId });
    return json({ removed: true, grantsRevoked: r.grantsRevoked, connection: await connectionOf(cfg, user.id, body.connectionId) });
  },
  'consents.list': async (cfg, user) => json({ consents: await rpc(cfg, 'connect_consents_for', { p_user: user.id }) }),
};
for (const decision of ['accept', 'decline', 'block']) {
  OPS[`requests.${decision}`] = async (cfg, user, body) => {
    if (!isUuid(body.connectionId)) return fail('invalid_connection');
    let share = null;
    if (decision === 'accept') {
      share = shareOf(body.share ?? []);
      if (!share) return fail('invalid_share');
    }
    await rpc(cfg, 'connect_decide', { p_user: user.id, p_connection: body.connectionId, p_decision: decision, p_share: share });
    return json({ connection: await connectionOf(cfg, user.id, body.connectionId) });
  };
}

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('connect.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');
  try {
    if (body.op === 'public.status') {
      const slug = String(body.slug ?? '').trim();
      if (!SLUG.test(slug)) return json({ available: false });
      return json({ available: Boolean(await rpc(cfg, 'connect_public_target', { p_slug: slug })) });
    }
    const op = OPS[body.op];
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
  const log = requestLog('connect', request);
  return log.respond(await handle(request, log));
};
