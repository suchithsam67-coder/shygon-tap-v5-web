import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellRing,
  CreditCard,
  Package,
  Truck,
  UserRound,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import { fetchNotifications, markAllRead, markRead } from '../services/notifications';
import type { NotificationCategory, NotificationRow } from '../lib/database.types';
import { useAsync } from '../hooks/useAsync';
import {
  desktopNotificationState,
  enableDesktopNotifications,
  internalPath,
  type DesktopNotificationState,
} from '../lib/desktopNotifications';

/**
 * Real notifications only. Every row here is written by a database trigger on
 * `orders` (placed, paid, shipped, delivered) or by Tap provisioning — there is
 * nothing fabricated to make this page look populated.
 */

const ICONS: Record<string, typeof Package> = {
  order: Package,
  payment: CreditCard,
  shipping: Truck,
  delivery: Truck,
  tap: UserRound,
  account: Bell,
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function Notifications() {
  const { user } = useAuth();
  const { refreshUnread, notificationsVersion } = useAccount();
  const navigate = useNavigate();

  const { data, loading, error, reload: load, refresh: refreshList, setData } = useAsync(
    async () => {
      if (!user) return { items: [] as NotificationRow[], setupRequired: false };
      try {
        return { items: await fetchNotifications(user.id), setupRequired: false };
      } catch (err) {
        if (isMissingSchema(err)) return { items: [] as NotificationRow[], setupRequired: true };
        throw err;
      }
    },
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );

  // A notification arrived (or was read in another tab): re-read the list
  // quietly, without the skeleton.
  useEffect(() => {
    if (notificationsVersion > 0) refreshList();
  }, [notificationsVersion, refreshList]);

  const items = data?.items ?? [];
  const setupRequired = data?.setupRequired ?? false;

  /** Optimistic list edit — the row is already updated on the server. */
  const setItems = (next: (current: NotificationRow[]) => NotificationRow[]) =>
    setData((current) => (current ? { ...current, items: next(current.items) } : current));

  async function open(item: NotificationRow) {
    if (!item.read_at) {
      setItems((current) =>
        current.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      try {
        await markRead(item.id);
        void refreshUnread();
      } catch {
        /* the read receipt is a convenience; a failed write is not worth surfacing */
      }
    }
    const path = internalPath(item.link);
    if (path) navigate(path);
  }

  async function readAll() {
    if (!user) return;
    setItems((current) => current.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    try {
      await markAllRead(user.id);
      void refreshUnread();
    } catch {
      /* best effort */
    }
  }

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <AppShell
      eyebrow="Stay in the loop"
      title="Notifications"
      description="Payment, order, shipping and Tap updates land here."
      actions={
        unreadCount > 0 ? (
          <button className="btn btn-ghost btn-sm" onClick={() => void readAll()}>
            Mark all as read
          </button>
        ) : undefined
      }
    >
      <DesktopNotificationsPrompt />
      <section className="panel">
        {loading ? (
          <SkeletonRows rows={4} />
        ) : setupRequired ? (
          <ErrorState
  title="Notifications are temporarily unavailable"
  message="We're having trouble loading your notifications right now. Please try again shortly."
/>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Bell size={22} />}
            title="Nothing here yet"
            description="You'll see updates as soon as something happens on your account."
          />
        ) : (
          <div className="panel-body-flush">
            {items.map((item, i) => {
              const Icon = ICONS[item.category as NotificationCategory] ?? Bell;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="panel-row reveal"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    border: 0,
                    borderTop: i === 0 ? undefined : '1px solid var(--line)',
                    background: item.read_at ? 'transparent' : 'var(--ds-accent-soft)',
                    cursor: 'pointer',
                    ['--i' as string]: i,
                  }}
                  onClick={() => void open(item)}
                >
                  <span
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--blue-soft)',
                      color: 'var(--blue)',
                      flex: '0 0 auto',
                    }}
                  >
                    <Icon size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <strong style={{ fontSize: 13.5 }}>{item.title}</strong>
                      {!item.read_at && <span className="pill-dot" style={{ color: 'var(--blue)' }} />}
                    </div>
                    {item.body && (
                      <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>
                        {item.body}
                      </p>
                    )}
                  </div>
                  <span style={{ color: 'var(--muted)', fontSize: 12, flex: '0 0 auto' }}>
                    {timeAgo(item.created_at)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}

/**
 * Offers desktop notifications for updates that arrive while this site is
 * open in a background tab. Asked from a button: browsers ignore a permission
 * prompt that is not the result of a click.
 */
function DesktopNotificationsPrompt() {
  const [state, setState] = useState<DesktopNotificationState>(desktopNotificationState);
  if (state === 'unsupported' || state === 'granted') return null;

  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <BellRing size={20} aria-hidden="true" style={{ color: 'var(--ds-accent)', flex: '0 0 auto' }} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <strong style={{ fontSize: 14 }}>Desktop notifications</strong>
          <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
            {state === 'denied'
              ? 'Blocked in this browser. Allow notifications for this site in your browser settings to be alerted while SHYGON Tap is in a background tab.'
              : 'Get an alert on this device when your order moves or support replies, even while SHYGON Tap is in a background tab.'}
          </p>
        </div>
        {state === 'default' && (
          <button
            type="button"
            className="btn btn-blue btn-sm"
            onClick={() => void enableDesktopNotifications().then(setState)}
          >
            Turn on
          </button>
        )}
      </div>
    </section>
  );
}
