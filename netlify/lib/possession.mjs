import crypto from 'node:crypto';

/**
 * The possession proof (DEC-2026-047, "tap to activate"): what a genuine
 * Verified Tap on a card that is not yet active hands the /d/<code> page, so
 * the signed-in owner can activate that card. It proves the card was in hand a
 * few minutes ago; it names the chip's code and the SUN counter that was just
 * accepted, so the database can make it single use.
 *
 *   <code>.<counter>.<expires, unix seconds>.<HMAC-SHA256 hex>
 *
 * Opaque to the page. Signed with the server's OTP_SECRET (service key as the
 * fallback, as for every other server HMAC); never logged.
 */

export const POSSESSION_SECONDS = 600;
const CODE = /^[a-z2-7]{16}$/;

const mac = (secret, body) => crypto.createHmac('sha256', secret).update(`possession|${body}`).digest('hex');

export function possessionProof(secret, code, counter, now = Date.now()) {
  const body = `${code}.${counter}.${Math.floor(now / 1000) + POSSESSION_SECONDS}`;
  return `${body}.${mac(secret, body)}`;
}

/** { ok: true, code, counter } or { ok: false, reason: 'invalid' | 'expired' }. */
export function readPossession(secret, proof, now = Date.now()) {
  const parts = typeof proof === 'string' && proof.length <= 200 ? proof.split('.') : [];
  if (parts.length !== 4) return { ok: false, reason: 'invalid' };
  const [code, counterText, expText, given] = parts;
  if (!CODE.test(code) || !/^\d{1,8}$/.test(counterText) || !/^\d{1,12}$/.test(expText) || !/^[0-9a-f]{64}$/.test(given)) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = Buffer.from(mac(secret, `${code}.${counterText}.${expText}`), 'hex');
  if (!crypto.timingSafeEqual(expected, Buffer.from(given, 'hex'))) return { ok: false, reason: 'invalid' };
  if (Number(expText) * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, code, counter: Number(counterText) };
}
