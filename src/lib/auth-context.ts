import { createContext, useContext } from 'react';
import type { Session, User } from '@supabase/supabase-js';

/**
 * The signed-in session, shared by every page.
 *
 * Split out of the provider file so that one exports only components — React
 * Fast Refresh refuses to hot-update a module that also exports a hook, which
 * made every edit to the provider reload the whole app.
 */

export interface AuthContextValue {
  user: User | null;
  session: Session | null;
  /** True until the persisted session has been read from storage. */
  loading: boolean;
  /**
   * True after arriving from a password-reset email. Supabase signs the visitor
   * in with a recovery session; without noticing that, the reset link landed on
   * a normal settings page with no way to actually set a new password.
   */
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signOut: () => Promise<void>;
  /** Fresh access token for the Netlify functions, or null if signed out. */
  getAccessToken: () => Promise<string | null>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
