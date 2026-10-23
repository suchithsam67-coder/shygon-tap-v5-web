import { env } from './sms.mjs';

/**
 * The visitor's address, exactly as the HOST reports it (B-9 Part B, V6-126).
 *
 * Each host sets its own header and replaces a visitor's copy of it: Netlify
 * x-nf-client-connection-ip, Vercel x-vercel-forwarded-for. A header the
 * current host does not set is only text the visitor chose, so which one to
 * trust is a deploy setting, TRUSTED_CLIENT_IP_HEADER, never a guess and never
 * a fallback from one header to another. Unset or anything else: null, and
 * every caller refuses (fail-closed). X-Forwarded-For and X-Real-IP are never
 * read.
 */
export const TRUSTED_CLIENT_IP_HEADERS = ['x-nf-client-connection-ip', 'x-vercel-forwarded-for'];

/** The trusted header's name, or null when the host has not named a valid one. */
export function trustedClientIpHeader() {
  const name = env('TRUSTED_CLIENT_IP_HEADER')?.toLowerCase() ?? null;
  return name && TRUSTED_CLIENT_IP_HEADERS.includes(name) ? name : null;
}

/** The first address in the trusted header, or null. */
export function clientAddress(request) {
  const name = trustedClientIpHeader();
  if (!name) return null;
  const first = String(request.headers.get(name) ?? '').split(',')[0].trim();
  return first || null;
}
