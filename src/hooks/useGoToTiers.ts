import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TIERS_PATH } from '../lib/commerce';

/**
 * Goes to the digital Tap purchase (D-10): straight there when signed in,
 * through sign-in otherwise (the auth page returns the visitor to `from`).
 */
export function useGoToTiers(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) navigate(TIERS_PATH);
        else navigate('/shygontap/auth', { state: { from: TIERS_PATH } });
      })
      .catch(() => navigate('/shygontap/auth', { state: { from: TIERS_PATH } }));
  }, [navigate]);
}
