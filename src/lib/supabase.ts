import { createClient } from '@supabase/supabase-js';

/**
 * The one Supabase client for the browser.
 *
 * Only the anon key is ever used here. It is safe to ship — every table it can
 * reach is behind RLS, and the privileged operations (marking an order paid,
 * granting an entitlement) run in the Netlify functions with the service role.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Missing configuration used to surface as `Invalid URL` from deep inside the
 * SDK on the first query. Failing here instead means a misconfigured deploy is
 * obvious at boot rather than at checkout.
 */
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
  ]
    .filter(Boolean)
    .join(', ');
  throw new Error(
    `Supabase is not configured: ${missing} is missing. Copy .env.example to .env and fill it in.`,
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'shygon-tap-auth',
  },
});

/** Razorpay's key id is public by design; the secret lives only on the server. */
export const razorpayKeyId = import.meta.env.VITE_RAZORPAY_KEY_ID ?? '';

/** True when the failure is "the migration has not been applied yet". */
export function isMissingSchema(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  return (
    // PGRST205 table not found, PGRST202 function not found, PGRST301 no
    // schema, 42P01 undefined table, 42703 undefined column, 42883 undefined
    // function/operator.
    ['PGRST205', 'PGRST202', 'PGRST301', '42P01', '42703', '42883'].includes(
      candidate.code ?? '',
    ) || /does not exist|schema cache/i.test(candidate.message ?? '')
  );
}

/**
 * Turns whatever Supabase/PostgREST threw into something a customer can read,
 * while keeping the technical detail in the console for us.
 *
 * Checked BEFORE anything else: a raw Postgres/PostgREST message (a table,
 * column or function name, sometimes the query shape) must never reach the
 * customer — that includes anonymous visitors on the public Tap page, who see
 * this from a codebase they cannot inspect.
 */
export function describeError(error: unknown, fallback = 'Something went wrong.'): string {
  if (!error) return fallback;

  if (isMissingSchema(error)) {
    return 'This feature is not set up on the server yet. Please contact support.';
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: string; message?: string; details?: string };

    // PostgREST codes that mean something specific to a customer.
    switch (candidate.code) {
      case '42501':
        return 'You are not allowed to make that change.';
      case '23505':
        return 'That value is already taken.';
      case 'PGRST116':
        return 'We could not find that record.';
      default:
        break;
    }

    // Anything else from PostgREST/Postgres is an internal detail, not
    // something to show verbatim — a constraint name or query fragment is
    // meaningless to a customer and is not safe to expose.
    if (candidate.code) return fallback;
    if (candidate.message) return candidate.message;
  }

  if (error instanceof Error) return error.message;
  return fallback;
}
