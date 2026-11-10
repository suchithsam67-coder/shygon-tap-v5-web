// Time-based one-time passwords (RFC 6238 over RFC 4226, HMAC-SHA1, 30 s, 6
// digits), as authenticator apps compute them. The local auth stand-in uses it
// for second factors (DEC-2026-046), and tests use it to play the phone.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 as authenticator apps expect. */
export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

/** The code for `timeMs` (RFC 6238 §4, dynamic truncation per RFC 4226 §5.3). */
export function totp(secret, timeMs = Date.now(), { step = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 1000 / step)));
  const mac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const number = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(number).padStart(digits, '0');
}

/** True when `code` is the code for now, or for one step either side (clock drift). */
export function totpMatches(secret, code, timeMs = Date.now(), window = 1) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return false;
  for (let drift = -window; drift <= window; drift++) {
    const expected = Buffer.from(totp(secret, timeMs + drift * 30_000));
    if (crypto.timingSafeEqual(expected, Buffer.from(String(code)))) return true;
  }
  return false;
}
