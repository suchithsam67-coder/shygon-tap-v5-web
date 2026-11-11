import { requestLog } from '../lib/log.mjs';
import { env } from '../lib/sms.mjs';
import { config, currentUser, DbError, rpc } from '../lib/emergency.mjs';
import { buildVcard } from '../lib/vcard.mjs';

/**
 * POST /api/account: the signed-in owner's own account (V01 task T-10;
 * migration 038; DEC-2026-044, approved for the local build). The contract is
 * docs/v6/aaroh/api-contract.md §4a.
 *
 * Body: { op: '<operation>' }. Every operation needs
 * Authorization: Bearer <the customer's access token>.
 *
 *   owner.export   a copy of the account's own data { export, vcard }:
 *                  the JSON (format shygon-account-export/2) and a vCard 3.0
 *                  of the Business profile's public fields (null without a Tap).
 *                  At most 5 per account per 24 hours; each one is recorded in
 *                  the owner's account history (account_events 'data_export').
 *
 * Left out, by rule (DEC-2026-044 §4.1): other people's personal data (finders'
 * words, the Connect counterpart, contacts' full numbers, visitors, staff) and
 * security values (codes, keys, hashes, the chip's serial number). The database
 * builds the export from explicit field lists; this function adds nothing.
 * Errors: { error: { code, message, retryAfter? } }. No log line holds content.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to download your data.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  rate_limited: [429, 'You have downloaded your data several times today. Please try again later.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const MAX_BODY = 4 * 1024;

/** The public address for the vCard's Tap link; the production domain is founder decision F-5. */
const site = () => (env('SITE_URL') ?? env('VITE_SITE_URL') ?? 'https://shygontech.com').replace(/\/+$/, '');

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  const error = { code: ERRORS[code] ? code : 'internal', message };
  if (Number.isInteger(extra.retryAfter)) error.retryAfter = extra.retryAfter;
  return json({ error }, status);
}

function fromDb(error, log) {
  if (error instanceof DbError && error.appCode && ERRORS[error.appCode]) return fail(error.appCode);
  log.error('account.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

const OPS = {
  'owner.export': async (cfg, user, _body, log) => {
    const r = await rpc(cfg, 'account_export_request', { p_user: user.id });
    if (r?.ok !== true) {
      log.warn('account.export-refused', { code: r?.code ?? null });
      return fail(r?.code === 'rate_limited' ? 'rate_limited' : 'internal', r ?? {});
    }
    const vcard = r.card ? buildVcard(r.card, site()) : null;
    log.info('account.exported', { truncated: Array.isArray(r.export?.truncated) ? r.export.truncated.length : null, vcard: vcard !== null });
    return json({ export: r.export, vcard });
  },
};

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('account.misconfigured', { missing: 'database settings' });
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
    // The account comes only from the verified token; nothing in the body or URL can name one.
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
  const log = requestLog('account', request);
  return log.respond(await handle(request, log));
};
