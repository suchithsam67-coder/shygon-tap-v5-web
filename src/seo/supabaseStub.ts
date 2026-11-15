/**
 * Stands in for src/lib/supabase.ts while the build renders the landing's
 * static first paint (src/seo/landingStatic.tsx). That render runs no effects,
 * so nothing here is ever called for data; the real client cannot be built in
 * Node 20 (no WebSocket) and must not be, since a build talks to no database.
 */
const signedOut = {
  getUser: async () => ({ data: { user: null }, error: null }),
  getSession: async () => ({ data: { session: null }, error: null }),
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
};

export const supabase = {
  auth: signedOut,
  from() {
    throw new Error('No database while the build renders the landing.');
  },
  rpc() {
    throw new Error('No database while the build renders the landing.');
  },
} as never;

export const razorpayKeyId = '';
export const isMissingSchema = () => false;
export const describeError = (_error: unknown, fallback = 'Something went wrong.') => fallback;
