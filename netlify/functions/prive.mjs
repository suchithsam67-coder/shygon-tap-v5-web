import { requestLog } from '../lib/log.mjs';
import { config, currentUser, DbError, isUuid, rpc } from '../lib/emergency.mjs';
import { DEMO_NOTICE, demoProvider, hotelProviderId, UnsupportedProviderError } from '../lib/hospitality.mjs';

/**
 * POST /api/prive: SHYGON Privé, demo only (migration 033). The contract is
 * docs/v6/aaroh/api-contract.md §10c.
 *
 *   hotels.list        the sample hotels and their sample services (no sign-in)
 *   requests.create    a demo service request at a sample hotel (signed in)
 *   requests.list / requests.get   my demo requests, with every step
 *   requests.cancel    while not completed
 *
 * Every response carries demo: true and the demo notice. The "hotel" is a
 * simulator inside SHYGON (netlify/lib/hospitality.mjs); nothing reaches a
 * real hotel, booking, room or door, and nothing says so.
 * Errors: { error: { code, message, retryAfter? }, demo: true }.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to try Privé requests.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_idempotency_key: [400, 'Send a new idempotency key: 16 to 64 letters, digits, "-" or "_".'],
  invalid_request_id: [400, 'Choose a request.'],
  hotel_not_found: [404, 'That sample hotel does not exist.'],
  invalid_service: [400, 'That sample hotel does not offer this service.'],
  rate_limited: [429, 'Too many demo requests. Try again later.'],
  request_not_found: [404, 'Request not found.'],
  already_closed: [409, 'This demo request is already finished.'],
  not_supported: [503, 'Only the Privé demo is available in this release.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9-]{3,40}$/;
const SERVICE = /^[a-z_]{2,40}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify({ ...body, demo: true, notice: DEMO_NOTICE }), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  const error = { code: ERRORS[code] ? code : 'internal', message };
  if (Number.isFinite(extra.retryAfter) && status === 429) error.retryAfter = extra.retryAfter;
  return json({ error }, status);
}

function fromDb(error, log) {
  if (error instanceof DbError && error.appCode && ERRORS[error.appCode]) return fail(error.appCode);
  log.error('prive.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('prive.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  try {
    hotelProviderId();
  } catch (error) {
    if (error instanceof UnsupportedProviderError) {
      log.error('prive.unsupported-provider', {});
      return fail('not_supported');
    }
    throw error;
  }
  const hotels = demoProvider(rpc, cfg);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');
  try {
    if (body.op === 'hotels.list') return json({ hotels: await hotels.listHotels() });
    const user = ['requests.create', 'requests.list', 'requests.get', 'requests.cancel'].includes(body.op)
      ? await currentUser(cfg, request)
      : undefined;
    if (user === undefined) return fail('unknown_op');
    if (!user) {
      log.warn('security.session-refused', { op: body.op });
      return fail('unauthenticated');
    }
    if (body.op === 'requests.create') {
      if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) return fail('invalid_idempotency_key');
      if (typeof body.hotelSlug !== 'string' || !SLUG.test(body.hotelSlug)) return fail('hotel_not_found');
      if (typeof body.service !== 'string' || !SERVICE.test(body.service)) return fail('invalid_service');
      const r = await hotels.submitRequest({ userId: user.id, hotelSlug: body.hotelSlug, service: body.service, idempotencyKey: body.idempotencyKey });
      if (!r.ok) return fail(r.code, { retryAfter: r.retryAfter });
      const [created] = await hotels.requestStatus({ userId: user.id, requestId: r.requestId });
      return json({ request: created, replayed: r.replayed }, r.replayed ? 200 : 201);
    }
    if (body.op === 'requests.list') return json({ requests: await hotels.requestStatus({ userId: user.id }) });
    if (!isUuid(body.requestId)) return fail('invalid_request_id');
    if (body.op === 'requests.cancel') await hotels.cancelRequest({ userId: user.id, requestId: body.requestId });
    const [found] = await hotels.requestStatus({ userId: user.id, requestId: body.requestId });
    return found ? json({ request: found }) : fail('request_not_found');
  } catch (error) {
    return fromDb(error, log);
  }
}

export default async (request) => {
  const log = requestLog('prive', request);
  return log.respond(await handle(request, log));
};
