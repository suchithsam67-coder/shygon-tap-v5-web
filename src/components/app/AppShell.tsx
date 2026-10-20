import type { ReactNode } from 'react';
import BrandMark from '../brand/BrandMark';
import ThemeToggle from '../ThemeToggle';
import ScrollRail from './ScrollRail';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Bell,
  CreditCard,
  Handshake,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Nfc,
  Package,
  Palette,
  QrCode,
  Settings,
  ShieldAlert,
  Sparkles,
  Undo2,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { RELEASED, type ServerFeature } from '../showroom/modes';
import { useAccount } from '../../lib/account-context';

/**
 * The signed-in chrome: brand bar, account navigation and page frame.
 *
 * On desktop the navigation is a sticky column; under 1024px it collapses into
 * a horizontally scrollable rail rather than a shrunken sidebar, so every
 * destination stays one thumb-reach away on a phone. With a mouse the rail
 * scrolls by wheel, by arrows, by dragging, or by resting near an edge
 * (see ScrollRail).
 */

const LINKS = [
  { to: '/shygontap/account', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/shygontap/experience', label: 'AAROH experience', icon: Layers },
  { to: '/shygontap/tap', label: 'Tap profile', icon: UserRound },
  { to: '/shygontap/tiers', label: 'Digital experience', icon: Sparkles },
  { to: '/shygontap/customize', label: 'Customize', icon: Palette },
  { to: '/shygontap/qr', label: 'QR code', icon: QrCode },
  { to: '/shygontap/cards', label: 'Cards', icon: Nfc },
  { to: '/shygontap/emergency', label: 'Emergency Profile', icon: ShieldAlert, feature: 'emergency' },
  { to: '/shygontap/return-to-owner', label: 'Return to Owner', icon: Undo2, feature: 'return' },
  { to: '/shygontap/connections', label: 'SHYGON Connect', icon: Handshake, feature: 'connect' },
  { to: '/shygontap/customizations', label: 'Add-ons', icon: CreditCard },
  { to: '/shygontap/orders', label: 'Orders', icon: Package },
  { to: '/shygontap/analytics', label: 'Analytics', icon: TrendingUp },
  { to: '/shygontap/notifications', label: 'Notifications', icon: Bell },
  { to: '/shygontap/support', label: 'Support', icon: LifeBuoy },
  { to: '/shygontap/settings', label: 'Settings', icon: Settings },
] as const;

function initials(name: string | null | undefined, fallback: string): string {
  const source = name?.trim() || fallback;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function AppShell({
  title,
  eyebrow,
  description,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { profile, unreadCount } = useAccount();

  const displayName = profile?.full_name ?? user?.email?.split('@')[0] ?? 'Customer';

  return (
    <div className="app">
      <header className="app-topbar">
        <div className="app-topbar-inner">
          <button
            type="button"
            className="brand"
            onClick={() => navigate('/shygontap')}
            aria-label="SHYGON Tap home"
          >
            <span className="brand-mark brand-mark-logo" aria-hidden="true">
              <BrandMark />
            </span>
            <span className="brand-copy">
              <strong>
                SHYGON <em>TAP</em>
              </strong>
            </span>
          </button>

          <div className="app-topbar-actions">
            <ThemeToggle />
            <button
              type="button"
              className="icon-btn"
              onClick={() => navigate('/shygontap/notifications')}
              aria-label={
                unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
              }
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="icon-btn-dot" aria-hidden="true">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate('/shygontap')}
            >
              Store
            </button>

            <button
              type="button"
              className="icon-btn"
              onClick={async () => {
                await signOut();
                navigate('/shygontap');
              }}
              aria-label="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <nav className="app-nav" aria-label="Account">
          <div className="app-nav-identity">
            {profile?.profile_image_url ? (
              <img className="app-avatar" src={profile.profile_image_url} alt="" />
            ) : (
              <div className="app-avatar" aria-hidden="true">
                {initials(profile?.full_name, user?.email ?? 'S')}
              </div>
            )}
            <div>
              <strong>{displayName}</strong>
              <span>{user?.email}</span>
            </div>
          </div>

          <ScrollRail className="app-nav-list" label="account menu">
            {/* A feature that is not released yet has no menu entry (it reads "Coming soon"). */}
            {LINKS.filter((link) => !('feature' in link) || RELEASED[link.feature as ServerFeature]).map(({ to, label, icon: Icon, ...rest }) => (
              <NavLink
                key={to}
                to={to}
                end={'end' in rest ? rest.end : undefined}
                className="app-nav-link"
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </ScrollRail>
        </nav>

        <main className="app-main page-enter">
          <div className="app-page-head">
            {eyebrow && <p className="eyebrow" style={{ margin: 0 }}>{eyebrow}</p>}
            <h1>{title}</h1>
            {description && <p>{description}</p>}
            {actions && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                {actions}
              </div>
            )}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
