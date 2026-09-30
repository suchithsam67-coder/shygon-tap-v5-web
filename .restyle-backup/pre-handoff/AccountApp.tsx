import { Suspense, lazy } from 'react';
// Tokens load with the storefront only; the public Tap bundle never includes them.
import './styles/tokens.css';
import './styles/app.css';
import { Route, Routes, Navigate } from 'react-router-dom';
import LiquidGlassDefs from './components/LiquidGlassDefs';
import ScrollProgress from './components/ScrollProgress';
import { ProtectedRoute } from './components/app/ProtectedRoute';
import { AuthProvider } from './lib/auth';
import { AccountProvider } from './lib/account';
import { ToastProvider } from './components/app/Toast';

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
const Orders = lazy(() => import('./pages/Orders'));
const Notifications = lazy(() => import('./pages/Notifications'));
const AnalyticsPage = lazy(() => import('./pages/Analytics'));
const Support = lazy(() => import('./pages/Support'));
const Settings = lazy(() => import('./pages/Settings'));

/** Wraps a page so it only renders once there is a signed-in session. */
function Protected({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute>{children}</ProtectedRoute>;
}

/**
 * Shown while a route's chunk downloads. Deliberately plain: a spinner that
 * flashes for 80ms is worse than a blank moment, so this only reserves layout.
 */
function RouteFallback() {
  return <div style={{ minHeight: '100svh' }} aria-busy="true" />;
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
          <ScrollProgress />
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Navigate to="/shygontap" replace />} />
              <Route path="/shygontap" element={<ShygonTap />} />
              <Route path="/shygontap/auth" element={<Auth />} />
              <Route path="/shygontap/store" element={<Store />} />
              <Route path="/shygontap/store/:productId" element={<ProductDetail />} />

              <Route path="/shygontap/account" element={<Protected><Account /></Protected>} />
              <Route path="/shygontap/tap" element={<Protected><TapEditor /></Protected>} />
              <Route path="/shygontap/tiers" element={<Protected><Tiers /></Protected>} />
              <Route path="/shygontap/customize" element={<Protected><Customize /></Protected>} />
              <Route path="/shygontap/qr" element={<Protected><TapQr /></Protected>} />
              <Route path="/shygontap/customizations" element={<Protected><Customizations /></Protected>} />
              <Route path="/shygontap/checkout" element={<Protected><Checkout /></Protected>} />
              <Route path="/shygontap/orders" element={<Protected><Orders /></Protected>} />
              <Route path="/shygontap/notifications" element={<Protected><Notifications /></Protected>} />
              <Route path="/shygontap/analytics" element={<Protected><AnalyticsPage /></Protected>} />
              <Route path="/shygontap/support" element={<Protected><Support /></Protected>} />
              <Route path="/shygontap/settings" element={<Protected><Settings /></Protected>} />

              <Route path="*" element={<Navigate to="/shygontap" replace />} />
            </Routes>
          </Suspense>
        </ToastProvider>
      </AccountProvider>
    </AuthProvider>
  );
}
