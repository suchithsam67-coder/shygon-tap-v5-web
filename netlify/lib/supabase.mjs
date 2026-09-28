import { createClient } from '@supabase/supabase-js';

/**
 * Fail-closed access to server-only configuration.
 *
 * Nothing here may ever be prefixed VITE_ — Vite inlines those into the browser
 * bundle. If a secret is missing we refuse to run rather than falling back to a
 * literal or to the anon key (which would silently hit RLS and fail while still
 * returning 200).
 */
export class MissingSecretError extends Error {
  constructor(secretName) {
    super(`Server misconfiguration: required secret ${secretName} is not set`);
    this.secretName = secretName;
  }
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || String(value).trim().length === 0) {
    throw new MissingSecretError(name);
  }
  return String(value).trim();
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * supabase-js builds a realtime client inside createClient, which needs a
 * native WebSocket (Node 22+). The functions never subscribe to anything, so
 * on an older runtime a stand-in that refuses to connect is enough to let the
 * REST and auth calls work instead of every payment call failing with a 500.
 */
class NoRealtime {
  constructor() {
    throw new Error('Realtime is not used by the server functions.');
  }
}

/** The project URL is public; hosts often only have the VITE_ copy set. */
function supabaseUrl() {
  const value = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!value || !String(value).trim()) throw new MissingSecretError('SUPABASE_URL');
  return String(value).trim();
}

/** Service-role client. Bypasses RLS — never expose its results verbatim. */
export function adminClient() {
  return createClient(supabaseUrl(), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: globalThis.WebSocket ?? NoRealtime },
  });
}

/**
 * Resolves the caller's Supabase user from the Authorization header.
 * Returns null when the request is unauthenticated or the token is invalid.
 */
export async function getRequestUser(admin, request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
