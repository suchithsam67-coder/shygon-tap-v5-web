// HS256 JSON Web Tokens for the local stack (V6, D-4).
//
// Supabase signs its anon key, service-role key and user access tokens with
// one project JWT secret. The local stack does the same with a secret it
// generates per run, so no production value is ever needed or read.
import crypto from 'node:crypto';

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signJwt(payload, secret) {
  const data = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`;
  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/** Resolves to `{ payload }`, or `{ error }` naming why the token is refused. */
export function verifyJwt(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return { error: 'malformed' };
  const [header, body, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { error: 'signature' };
  }
  let parsedHeader;
  let payload;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { error: 'malformed' };
  }
  if (parsedHeader.alg !== 'HS256') return { error: 'algorithm' };
  if (typeof payload.exp === 'number' && payload.exp <= nowSeconds) return { error: 'expired' };
  return { payload };
}

/** The two API keys a Supabase project issues, signed with `secret`. */
export function projectKeys(secret) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 10 * 365 * 24 * 3600;
  return {
    anonKey: signJwt({ iss: 'supabase-local', role: 'anon', iat, exp }, secret),
    serviceRoleKey: signJwt({ iss: 'supabase-local', role: 'service_role', iat, exp }, secret),
  };
}
