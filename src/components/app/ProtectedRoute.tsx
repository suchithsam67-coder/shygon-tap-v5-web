import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth-context';
import BrandLoader from '../BrandLoader';

/**
 * Guards the signed-in surfaces.
 *
 * Rendering nothing while the session is still being read is deliberate: every
 * page used to run its own `getUser()` in an effect and redirect on the null it
 * saw before the promise settled, which bounced signed-in customers to the
 * login screen on a hard refresh.
 *
 * This is a UX guard, not a security boundary. The data itself is protected by
 * RLS — a customer who forced their way past this route would still see
 * nothing but their own rows.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <BrandLoader label="Loading your account…" />;
  }

  if (!user) {
    // Remember where they were headed so sign-in can return them there.
    return <Navigate to="/shygontap/auth" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
