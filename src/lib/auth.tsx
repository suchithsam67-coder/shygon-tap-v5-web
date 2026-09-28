import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { AuthContext, type AuthContextValue } from './auth-context';

/**
 * One session, resolved once, shared by every page.
 *
 * Previously each page called `supabase.auth.getUser()` in its own effect and
 * redirected on null. That produced a redirect race on first paint (the call is
 * async, so `user` is briefly null even when signed in) and meant an expired
 * token was only noticed by whichever page happened to query next.
 */



export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted.current) return;
        setSession(data.session);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });

    // Covers sign-in, sign-out, token refresh and, importantly, the refresh
    // failing — which is how an expired session reaches the UI.
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      if (!mounted.current) return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
      setSession(next);
      setLoading(false);
    });

    return () => {
      mounted.current = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // Selection state is a UX convenience, not entitlement, but it should not
    // survive into the next person's session on a shared device.
    try {
      localStorage.removeItem('shygon_pending_order');
      localStorage.removeItem('shygon_builder_selection');
      localStorage.removeItem('shygon_customer_card_settings');
    } catch {
      /* storage can be unavailable in private mode */
    }
  }, []);

  const getAccessToken = useCallback(async () => {
    // Read through getSession so an expired token is refreshed before use
    // rather than being sent and rejected by the function.
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      loading,
      passwordRecovery,
      clearPasswordRecovery,
      signOut,
      getAccessToken,
    }),
    [session, loading, passwordRecovery, clearPasswordRecovery, signOut, getAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
