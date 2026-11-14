import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env, sendText, SmsError, toE164 } from '../lib/sms.mjs';
import { config, currentUser, DbError, hmac, rpc, PROVIDER_TIMEOUT_MS } from '../lib/emergency.mjs';
import { buildVcard } from '../lib/vcard.mjs';

/**
 * POST /api/account: the signed-in owner's own account (V01 task T-10;
 * migration 038; DEC-2026-044, approved for the local build) and its phone
 * (V01 task T-11; migration 039; DEC-2026-045, approved for the local build).
 * The contract is docs/v6/aaroh/api-contract.md §4a and §4b.
 *
 * Body: { op: '<operation>' }. Every operation needs
 * Authorization: Bearer <the customer's access token>.
 *
 *   owner.export   a copy of the account's own data { export, vcard }:
 *                  the JSON (format shygon-account-export/2) and a vCard 3.0
 *                  of the Business profile's public fields (null without a Tap).
 *                  At most 5 per account per 24 hours; each one is recorded in
 *                  the owner's account history (account_events 'data_export').
 *   phone.status         the account phone: masked, verified, usable for card actions
 *   phone.verify.start   texts a 6-digit code to the phone now on the account
 *   phone.verify.confirm { code }: verifies it. A number that replaces a
 *                        verified one may confirm card actions after 24 hours.
 *   age.status           whether the account holder confirmed they are 18 or
 *                        older (V01 task T-13; migration 044; DEC-2026-048)
 *   age.confirm          { adult: true, policiesVersion? }: records that
 *                        confirmation, once, with the server's time, for an
 *                        account that has none (accounts from before the gate)
 *
 * The sign-up confirmation itself is recorded by the database when the account
 * is created (044's trigger reads the sign-up data once); later edits of the
 * sign-up data change nothing.
 *
 * The account phone counts as verified only while profiles.phone, in E.164,
 * equals the verified number: editing it in Settings unverifies it. card-otp
 * and the order-text fallback use only a verified phone (finding F4).
 *
 * Left out, by rule (DEC-2026-044 §4.1): other people's personal data (finders'
 * words, the Connect counterpart, contacts' full numbers, visitors, staff) and
 * security values (codes, keys, hashes, the chip's serial number). The database
 * builds the export from explicit field lists; this function adds nothing.
 * Errors: { error: { code, message, retryAfter?, attemptsLeft? } }. No answer or
 * log line holds content, a full number or a code.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to download your data.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  rate_limited: [429, 'You have downloaded your data several times today. Please try again later.'],
  no_phone: [409, 'Add your mobile number in Settings first.'],
  invalid_phone: [422, 'That mobile number is not valid. Check it in Settings.'],
  already_verified: [409, 'This number is already verified.'],
  verify_cooldown: [429, 'Please wait before sending another code.'],
  verify_rate_limited: [429, 'Too many codes requested. Try again later.'],
  number_rate_limited: [429, 'This number has had too many codes today. Try again tomorrow.'],
  sms_unavailable: [503, 'Text messages are not set up yet, so no code was sent.'],
  sms_failed: [502, 'The code could not be sent. Please try again.'],
  invalid_code: [400, 'Enter the 6-digit code.'],
  no_challenge: [410, 'Request a new code.'],
  code_expired: [410, 'This code has expired. Request a new one.'],
  wrong_code: [400, 'That code is not right.'],
  too_many_attempts: [429, 'Too many wrong attempts. Request a new code.'],
  phone_changed: [409, 'Your number changed after the code was sent. Request a new code.'],
  already_confirmed: [409, 'You have already confirmed that you are 18 or older.'],
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
  if (Number.isInteger(extra.attemptsLeft)) error.attemptsLeft = extra.attemptsLeft;
  return json({ error }, status);
}

/** "+91 ••••• 06633", as card-otp shows it: enough to recognise the number, not to reuse it. */
const masked = (e164) => `${e164.slice(0, 3)} ••••• ${e164.slice(-5)}`;

/** The code's stored form, never the code itself. */
const phoneCodeHash = (secret, userId, code) => hmac(secret, `account-phone:${userId}:${code}`);

/** The text, as registered on DLT (DEC-2026-045 Q5; the adult signatory registers it, F-10). */
function phoneVerifyMessage(code) {
  return {
    text: `SHYGON: ${code} is your code to verify this phone number for your SHYGON account. It expires in 10 minutes. Do not share it with anyone.`,
    msg91: { templateId: env('MSG91_PHONE_VERIFY_TEMPLATE_ID'), vars: { [env('MSG91_OTP_VAR') ?? 'otp']: code } },
  };
}

/** The phone on the account, as typed (profiles.phone), and its E.164 form or null. */
async function accountPhone(cfg, userId) {
  const response = await fetch(`${cfg.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=phone`, {
    headers: { apikey: cfg.serviceKey, authorization: `Bearer ${cfg.serviceKey}` },
  });
  if (!response.ok) throw new DbError(response.status, await response.json().catch(() => null));
  const [row] = await response.json();
  const raw = typeof row?.phone === 'string' && row.phone.trim() ? row.phone : null;
  return { raw, e164: raw ? toE164(raw) : null };
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
  'phone.status': async (cfg, user) => {
    const phone = await accountPhone(cfg, user.id);
    const state = await rpc(cfg, 'account_phone_state', { p_user: user.id, p_phone_e164: phone.e164 });
    return json({
      phone: phone.e164 ? masked(phone.e164) : null, phoneValid: phone.raw === null || phone.e164 !== null,
      verified: state.verified === true, verifiedAt: state.verifiedAt ?? null, usableFrom: state.usableFrom ?? null,
    });
  },
  'phone.verify.start': async (cfg, user, _body, log) => {
    // Always the phone now on the account: nothing in the body can name a number.
    const phone = await accountPhone(cfg, user.id);
    if (!phone.raw) return fail('no_phone');
    if (!phone.e164) return fail('invalid_phone');
    const challengeId = crypto.randomUUID();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const started = await rpc(cfg, 'account_phone_start', {
      p_user: user.id, p_phone_e164: phone.e164, p_challenge_id: challengeId, p_code_hash: phoneCodeHash(cfg.secret, user.id, code),
    });
    if (started?.ok !== true) {
      log.warn('account.phone-verify-refused', { code: started?.code ?? null });
      return fail(started?.code, started ?? {});
    }
    const message = phoneVerifyMessage(code);
    try {
      await sendText({ to: phone.e164, text: message.text, msg91: message.msg91, timeoutMs: PROVIDER_TIMEOUT_MS });
    } catch (error) {
      // The code never reached the owner: retire it at once.
      await rpc(cfg, 'account_phone_abort', { p_user: user.id, p_challenge_id: challengeId }).catch(() => undefined);
      if (error instanceof SmsError) {
        log.warn('account.phone-verify-not-sent', { kind: error.kind, httpStatus: error.httpStatus });
        return fail(error.kind === 'not_configured' ? 'sms_unavailable' : 'sms_failed');
      }
      throw error;
    }
    log.info('account.phone-verify-sent', { last4: phone.e164.slice(-4) });
    return json({ phoneMasked: masked(phone.e164), expiresAt: started.expiresAt, resendAfter: 45 });
  },
  'phone.verify.confirm': async (cfg, user, body, log) => {
    const code = String(body.code ?? '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) return fail('invalid_code');
    const phone = await accountPhone(cfg, user.id);
    if (!phone.raw) return fail('no_phone');
    if (!phone.e164) return fail('invalid_phone');
    const r = await rpc(cfg, 'account_phone_confirm', {
      p_user: user.id, p_phone_e164: phone.e164, p_code_hash: phoneCodeHash(cfg.secret, user.id, code),
    });
    if (r?.ok !== true) {
      log.warn('account.phone-confirm-refused', { code: r?.code ?? null });
      return fail(r?.code, r ?? {});
    }
    log.info('account.phone-verified', { replaced: r.replaced === true });
    return json({ verified: true, verifiedAt: r.verifiedAt, usableFrom: r.usableFrom });
  },
  'age.status': async (cfg, user) => {
    const s = await rpc(cfg, 'account_age_status', { p_user: user.id });
    return json({ confirmed: s?.confirmed === true, confirmedAt: s?.confirmedAt ?? null, source: s?.source ?? null });
  },
  'age.confirm': async (cfg, user, body, log) => {
    // An explicit statement only: the body must say so, as the sign-up box does.
    if (body.adult !== true) return fail('invalid_request');
    const version = body.policiesVersion;
    if (version !== undefined && (typeof version !== 'string' || version.length > 40)) return fail('invalid_request');
    const r = await rpc(cfg, 'account_age_confirm', { p_user: user.id, p_policies_version: version ?? null });
    if (r?.ok !== true) {
      log.warn('account.age-confirm-refused', { code: r?.code ?? null });
      return fail(r?.code === 'already_confirmed' ? 'already_confirmed' : 'internal');
    }
    log.info('account.age-confirmed', { source: 'reconfirm' });
    return json({ confirmed: true, confirmedAt: r.confirmedAt });
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
