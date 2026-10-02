import { Suspense, lazy } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
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

function AppFallback() {
  return <BrandLoader label="Loading SHYGON Tap…" />;
}

function AccountAppRoute() {
  return (
    <Suspense fallback={<AppFallback />}>
      <AccountApp />
    </Suspense>
  );
}

/**
 * The app's own screens under /shygontap/. Anything else there is a customer's
 * page: shygontech.com/shygontap/<name>. The database reserves these names
 * (tap_slug_reserved, migration 022), so no page can take one.
 */
const APP_SCREENS = new Set([
  'auth', 'store', 'account', 'tap', 'tiers', 'customize', 'qr', 'cards', 'customizations',
  'checkout', 'orders', 'notifications', 'analytics', 'support', 'settings', 'billing',
  'privacy-policy', 'terms', 'cookie-policy', 'refund-policy', 'shipping-policy', 'card-details',
]);

/**
 * Decided here, on the catch-all, rather than with a `/shygontap/:username`
 * route: the app's own <Routes> are nested inside this element, and nested
 * routes match relative to their parent — under `/shygontap/:username` they
 * would have seen an empty path and every /shygontap/ screen would break.
 */
function ShygonTapPath() {
  const { pathname } = useLocation();
  const page = /^\/shygontap\/([^/]+)\/?$/.exec(pathname)?.[1];
  return page && !APP_SCREENS.has(page.toLowerCase()) ? (
    <PublicTap slug={decodeURIComponent(page)} />
  ) : (
    <AccountAppRoute />
  );
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
        {/* A card's own link, written to the NFC chip of every new card. */}
        <Route path="/c/:code" element={<PublicTap />} />
        {/* Everything else, including a page's address: /shygontap/<name>. */}
        <Route path="*" element={<ShygonTapPath />} />
      </Routes>
    </div>
  );
}
