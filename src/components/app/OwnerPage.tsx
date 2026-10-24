import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { PREVIEW_PAGES, RELEASED, type ServerFeature } from '../showroom/modes';

/**
 * The owner page of a server-backed feature (Emergency Profile, Return to
 * Owner, SHYGON Connect). Until the feature is released, a production build
 * sends its address to "Your AAROH experience", where the feature reads
 * "Coming soon" (owner, Q-C 2026-10-23); test and preview builds keep it
 * (`PREVIEW_PAGES`). Sign-in is still checked by the route's own guard.
 */
export function OwnerPage({ feature, children }: { feature: ServerFeature; children: ReactNode }) {
  if (RELEASED[feature] || PREVIEW_PAGES) return <>{children}</>;
  return <Navigate to="/shygontap/experience" replace />;
}
