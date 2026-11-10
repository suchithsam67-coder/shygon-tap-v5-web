import { requestLog } from '../lib/log.mjs';
import { env } from '../lib/sms.mjs';
import { clientAddress, trustedClientIpHeader } from '../lib/client-address.mjs';
import { config, hmac, rpc } from '../lib/emergency.mjs';
import { diversifyKey, verifySun } from '../lib/sun.mjs';
import { possessionProof } from '../lib/possession.mjs';

/**
 * POST /api/verify: Verified Tap (U1; migration 037; DEC-2026-043, approved for
 * the local build only). The contract is docs/v6/aaroh/api-contract.md §10c.
 *
 * Body: { op: 'tap.verify', code, e?, c? }. No sign-in. The /d/<code> page's
 * script calls it after the page has loaded, never on a plain GET, so link
 * previews and prefetch consume no counter. `e` (32 hex) and `c` (16 hex) are
 * the NTAG 424 DNA SUN values the chip appends; without them the answer is
 * `not_verified` and nothing is consumed.
 *
 * Answers { slug, verdict, edition? }:
 *   genuine          the MAC matched and the counter is new (consumed, once)
 *   already_checked  the MAC matched but this counter was already seen
 *   not_confirmed    decryption, the MAC or the chip's UID did not match
 *   needs_service    the card is retired or at its counter limit
 *   unavailable      the server cannot decide now (no keys for the epoch)
 *   not_verified     no SUN values: a QR, a typed or a shared link
 *   null             the Tap is in Lost mode: the lifecycle answer instead
 * A card issued to an owner but not yet active (DEC-2026-047) answers with
 * slug null, and a genuine tap adds `possession`: an opaque, 10-minute,
 * single-use proof for /api/cards owner.card.activate.
 * A failure never says which check failed. The UID, the keys, `e` and `c` never
 * appear in an answer or a log line.
 *
 * Host settings (server side only, never VITE_):
 *   VERIFIED_TAP=on                      the switch; unset means 404 for everything
 *   VERIFY_META_MASTER_<epoch>,
 *   VERIFY_FILE_MASTER_<epoch>           32 hex each. TEST KEYS ONLY until DEC-2026-043 Q2
 *   VERIFY_UID_PEPPER                    32+ characters; uid_hmac = HMAC-SHA256(pepper, uid hex)
 *   TRUSTED_CLIENT_IP_HEADER             as for the emergency and relay functions (B-9)
 */

const ERRORS = {
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  unavailable: [404, 'This Tap is not available.'],
  rate_limited: [429, 'Too many checks. Please try again later.'],
  temporarily_unavailable: [503, 'Verification is temporarily unavailable. Please try again shortly.'],
};

const CODE = /^[a-z2-7]{16}$/;
const E_HEX = /^[0-9A-Fa-f]{32}$/;
const C_HEX = /^[0-9A-Fa-f]{16}$/;
const KEY_HEX = /^[0-9A-Fa-f]{32}$/;
const MAX_BODY = 2048;

const verifiedTapAllowed = () => env('VERIFIED_TAP') === 'on';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
  });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code];
  const error = { code, message };
  if (Number.isInteger(extra.retryAfter)) error.retryAfter = extra.retryAfter;
  return json({ error }, status);
}

/** A visitor for rate limiting only: a daily HMAC of the host-reported address. */
function visitorOf(secret, request) {
  const ip = clientAddress(request);
  return ip ? hmac(secret, `verify-visitor|${new Date().toISOString().slice(0, 10)}|${ip}`) : null;
}

/** The epoch's two master keys. Custody in production is DEC-2026-043 Q2; locally, test keys. */
function mastersFor(epoch) {
  const meta = env(`VERIFY_META_MASTER_${epoch}`);
  const file = env(`VERIFY_FILE_MASTER_${epoch}`);
  return KEY_HEX.test(meta ?? '') && KEY_HEX.test(file ?? '') ? { meta, file } : null;
}

/** D-a (DEC-2026-043 Q8): both keys are diversified by the device id, the 16 bytes of cards.id. */
const deviceInput = (cardId) => Buffer.from(String(cardId).replace(/-/g, ''), 'hex');

async function tapVerify(cfg, request, body, log) {
  const code = typeof body.code === 'string' ? body.code : '';
  if (!CODE.test(code)) return fail('invalid_request');
  const hasE = Object.hasOwn(body, 'e');
  const hasC = Object.hasOwn(body, 'c');
  if (hasE !== hasC) return fail('invalid_request');
  if (hasE && !(typeof body.e === 'string' && E_HEX.test(body.e) && typeof body.c === 'string' && C_HEX.test(body.c))) {
    return fail('invalid_request');
  }

  const visitor = visitorOf(cfg.secret, request);
  if (!visitor) {
    log.warn('verify.no-client-address', { trustedHeaderConfigured: Boolean(trustedClientIpHeader()) });
    return fail('unavailable');
  }

  const device = await rpc(cfg, 'verify_device_lookup', { p_code: code, p_visitor: visitor });
  if (device?.state === 'rate_limited') return fail('rate_limited', { retryAfter: device.retryAfter });
  if (device?.state === 'lost') return json({ slug: device.slug, verdict: null });
  // DEC-2026-047: a card issued to an owner but not yet active ('pairing') is
  // checked like any other, opens no Tap, and a genuine tap carries a possession
  // proof for "tap to activate".
  const pairing = device?.state === 'pairing';
  if (!pairing && device?.state !== 'ready' && device?.state !== 'retired') return fail('unavailable');
  const slug = pairing ? null : device.slug;
  if (!hasE) return json({ slug, verdict: 'not_verified' });

  const keys = mastersFor(device.keyEpoch);
  const pepper = env('VERIFY_UID_PEPPER');
  if (!keys || !pepper || pepper.length < 32) {
    log.warn('verify.keys-unavailable', { keyEpoch: device.keyEpoch, pepperSet: Boolean(pepper) });
    return json({ slug, verdict: 'unavailable' });
  }
  const input = deviceInput(device.cardId);
  const tap = verifySun({
    encPiccHex: body.e,
    macHex: body.c,
    metaReadKey: diversifyKey(keys.meta, input),
    fileReadKey: diversifyKey(keys.file, input),
  });
  const result = await rpc(cfg, 'verify_tap_result', {
    p_code: code,
    p_crypto_ok: tap.ok,
    p_uid_hmac: tap.ok ? hmac(pepper, tap.uid) : null,
    p_counter: tap.ok ? tap.readCounter : null,
    p_visitor: visitor,
  });
  log.info('verify.checked', { verdict: result?.verdict ?? 'unavailable', refusal: tap.ok ? null : tap.reason, pairing });
  const answer = { slug, verdict: result?.verdict ?? 'unavailable', ...(result?.edition ? { edition: result.edition } : {}) };
  if (pairing && answer.verdict === 'genuine') answer.possession = possessionProof(cfg.secret, code, tap.readCounter);
  return json(answer);
}

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  // Off: nothing is read, looked up or consumed.
  if (!verifiedTapAllowed()) return fail('unavailable');
  const cfg = config();
  if (!cfg) {
    log.error('verify.misconfigured', { missing: 'database settings' });
    return fail('temporarily_unavailable');
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
  if (body.op !== 'tap.verify') return fail('unknown_op');
  try {
    return await tapVerify(cfg, request, body, log);
  } catch (error) {
    // Never a positive verdict when anything fails (DEC-2026-043 P-4).
    log.error('verify.failed', { status: error?.status, code: error?.code });
    return fail('temporarily_unavailable');
  }
}

export default async (request) => {
  const log = requestLog('verify', request);
  return log.respond(await handle(request, log));
};
