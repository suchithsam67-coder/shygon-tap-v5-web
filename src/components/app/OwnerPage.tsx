import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { INFO_RELEASED, PREVIEW_PAGES, RELEASED, type ServerFeature } from '../showroom/modes';

/**
 * The owner page of a server-backed feature (Emergency Profile, Return to
 * Owner, SHYGON Connect, and Info mode). Until the feature is released, a
 * production build sends its address to "Your AAROH experience" (owner, Q-C
 * 2026-10-23); test and preview builds keep it (`PREVIEW_PAGES`). Sign-in is
 * still checked by the route's own guard.
 */
export function OwnerPage({ feature, children }: { feature: ServerFeature | 'info'; children: ReactNode }) {
  const released = feature === 'info' ? INFO_RELEASED : RELEASED[feature];
  if (released || PREVIEW_PAGES) return <>{children}</>;
  return <Navigate to="/shygontap/experience" replace />;
}
