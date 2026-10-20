import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import PublicTap from './pages/PublicTap';
import BrandLoader from './components/BrandLoader';

/**
 * The top-level split, and the reason for it.
 *
 * Everything used to ship as one 938 kB chunk, so a visitor who tapped an NFC
 * card downloaded the storefront, the checkout, the whole account area and the
 * Supabase SDK before their profile could paint — on a stranger's phone, on
 * mobile data. The public Tap is the most performance-sensitive surface in the
 * product and needs almost none of it.
 *
 * So the public Tap is the ONLY thing in the entry bundle. It reads its data
 * through `lib/publicTapClient.ts` (plain fetch against the same SECURITY
 * DEFINER functions) rather than the SDK, and it needs no session, so the auth
 * providers do not mount for it either.
 *
 * Everything else — storefront, checkout, account, and the providers they
 * require — lives behind one dynamic import.
 */
const AccountApp = lazy(() => import('./AccountApp'));
/** The AAROH demo showroom: public, no session, its own chunk (FE-D7). */
const AarohExperienceDemo = lazy(() => import('./pages/AarohExperienceDemo'));

function AppFallback() {
  return <BrandLoader label="Loading SHYGON Tap…" />;
}

export default function App() {
  return (
    <div className="relative min-h-screen bg-bg-primary text-text-primary">
      <ScrollToTop />
      <Routes>
        {/*
          The address printed on the card and encoded in the QR. `/tap/` is kept
          so links shared before the change keep resolving.
        */}
        <Route path="/t/:username" element={<PublicTap />} />
        <Route path="/tap/:username" element={<PublicTap />} />
        <Route
          path="/aaroh/experience"
          element={
            <Suspense fallback={<AppFallback />}>
              <AarohExperienceDemo />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<AppFallback />}>
              <AccountApp />
            </Suspense>
          }
        />
      </Routes>
    </div>
  );
}
