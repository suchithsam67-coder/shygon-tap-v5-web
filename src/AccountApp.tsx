import { Suspense, lazy, useMemo } from 'react';
// Tokens load with the storefront only; the public Tap bundle never includes them.
import './styles/tokens.css';
import './styles/app.css';
// Last, so its body:has(.storefront) rules sit on top of the shared ones.
import './styles/customer-experience.css';
// Light theme, then motion and the new components, on top of everything above.
import './styles/theme-light.css';
import './styles/motion.css';
import './styles/enhance.css';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import LiquidGlassDefs from './components/LiquidGlassDefs';
import ScrollProgress from './components/ScrollProgress';
import { ProtectedRoute } from './components/app/ProtectedRoute';
import { AuthProvider } from './lib/auth';
import { AccountProvider } from './lib/account';
import { ToastProvider } from './components/app/Toast';
import BrandLoader from './components/BrandLoader';
import LiveNotifications from './components/app/LiveNotifications';
import PrivacyNotice from './components/PrivacyNotice';
import ScrollReveal from './components/ScrollReveal';
import { privateMeta } from './seo/meta';
import { usePageMeta } from './seo/usePageMeta';

/**
 * Everything except the public Tap: the storefront, checkout and the signed-in
 * account area, together with the three providers they need.
 *
 * This module exists to keep the Supabase SDK, the session providers and the
 * marketing chrome out of the public Tap's path. The Tap is the one page a
 * stranger opens seconds after touching a card, and it needs none of this — see
 * `lib/publicTapClient.ts`.
 */

const ShygonTap = lazy(() => import('./pages/ShygonTap'));
const Auth = lazy(() => import('./pages/Auth'));
const Store = lazy(() => import('./pages/shygontap/Store'));
const ProductDetail = lazy(() => import('./pages/shygontap/ProductDetail'));

const Account = lazy(() => import('./pages/Account'));
const TapEditor = lazy(() => import('./pages/TapEditor'));
const Tiers = lazy(() => import('./pages/Tiers'));
const Customize = lazy(() => import('./pages/Customize'));
const TapQr = lazy(() => import('./pages/TapQr'));
const Customizations = lazy(() => import('./pages/Customizations'));
const Checkout = lazy(() => import('./pages/Checkout'));
const CardDetails = lazy(() => import('./pages/CardDetails'));
const Orders = lazy(() => import('./pages/Orders'));
const Notifications = lazy(() => import('./pages/Notifications'));
const AnalyticsPage = lazy(() => import('./pages/Analytics'));
const Support = lazy(() => import('./pages/Support'));
const Settings = lazy(() => import('./pages/Settings'));
const Cards = lazy(() => import('./pages/Cards'));
const Billing = lazy(() => import('./pages/Billing'));
const NotFound = lazy(() => import('./pages/NotFound'));
const PrivacyPolicy = lazy(() => import('./pages/legal/PrivacyPolicy'));
const Terms = lazy(() => import('./pages/legal/Terms'));
const CookiePolicy = lazy(() => import('./pages/legal/CookiePolicy'));
const RefundPolicy = lazy(() => import('./pages/legal/RefundPolicy'));
const ShippingPolicy = lazy(() => import('./pages/legal/ShippingPolicy'));

/**
 * Wraps a page so it only renders once there is a signed-in session, and gives
 * it its tab title. Set here rather than in each page so the title is right
 * from the first frame, while the session is still loading. The signed-in
 * pages are private, so they are also kept out of search results.
 */
function Protected({ title, children }: { title: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  usePageMeta(useMemo(() => privateMeta(title, pathname), [title, pathname]));
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

/**
 * Shown while a route's chunk downloads. Deliberately plain: a spinner that
 * flashes for 80ms is worse than a blank moment, so this only reserves layout.
 */
function RouteFallback() {
  return <BrandLoader />;
}

export default function AccountApp() {
  return (
    <AuthProvider>
      <AccountProvider>
        <ToastProvider>
          {/* Marker that activates the design system: tokens.css scopes every
              rule to body:has(.storefront). :has() matches the DOM, so the
              marker can be hidden and takes no part in layout. The public Tap
              never mounts AccountApp, so the marker is never there for it. */}
          <div className="storefront" hidden />
          <LiquidGlassDefs />
          <LiveNotifications />
          <PrivacyNotice />
          <ScrollReveal />
          <ScrollProgress />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/shygontap" replace />} />
              <Route path="/shygontap" element={<ShygonTap />} />
              <Route path="/shygontap/auth" element={<Auth />} />
              <Route path="/shygontap/store" element={<Store />} />
              <Route path="/shygontap/store/:productId" element={<ProductDetail />} />

              <Route path="/shygontap/privacy-policy" element={<PrivacyPolicy />} />
              <Route path="/shygontap/terms" element={<Terms />} />
              <Route path="/shygontap/cookie-policy" element={<CookiePolicy />} />
              <Route path="/shygontap/refund-policy" element={<RefundPolicy />} />
              <Route path="/shygontap/shipping-policy" element={<ShippingPolicy />} />

              <Route path="/shygontap/account" element={<Protected title="Your account"><Account /></Protected>} />
              <Route path="/shygontap/tap" element={<Protected title="Tap profile"><TapEditor /></Protected>} />
              <Route path="/shygontap/tiers" element={<Protected title="Digital experience"><Tiers /></Protected>} />
              <Route path="/shygontap/customize" element={<Protected title="Customize your Tap"><Customize /></Protected>} />
              <Route path="/shygontap/qr" element={<Protected title="QR code"><TapQr /></Protected>} />
              <Route path="/shygontap/cards" element={<Protected title="Your cards"><Cards /></Protected>} />
              <Route path="/shygontap/billing" element={<Protected title="Billing"><Billing /></Protected>} />
              <Route path="/shygontap/customizations" element={<Protected title="Add-ons"><Customizations /></Protected>} />
              <Route path="/shygontap/card-details" element={<Protected title="Card details"><CardDetails /></Protected>} />
              <Route path="/shygontap/checkout" element={<Protected title="Checkout"><Checkout /></Protected>} />
              <Route path="/shygontap/orders" element={<Protected title="Your orders"><Orders /></Protected>} />
              <Route path="/shygontap/notifications" element={<Protected title="Notifications"><Notifications /></Protected>} />
              <Route path="/shygontap/analytics" element={<Protected title="Analytics"><AnalyticsPage /></Protected>} />
              <Route path="/shygontap/support" element={<Protected title="Support"><Support /></Protected>} />
              <Route path="/shygontap/settings" element={<Protected title="Settings"><Settings /></Protected>} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AccountProvider>
    </AuthProvider>
  );
}
