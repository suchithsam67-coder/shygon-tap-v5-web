import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth-context';
import { useAccount } from '../../lib/account-context';
import { useToast } from './toast-context';
import { showDesktopNotification } from '../../lib/desktopNotifications';
import type { NotificationRow } from '../../lib/database.types';

/**
 * Live notifications for the signed-in customer, on every page.
 *
 * Rows in `notifications` are written by the database (order placed, paid,
 * shipped, delivered; support replies and upgrades granted from the admin
 * app). This listens for new ones over Realtime and, for each:
 *   - shows a toast,
 *   - updates the bell's unread count,
 *   - raises a desktop notification if the tab is in the background and the
 *     customer allowed it (Notifications page).
 *
 * Realtime applies the table's RLS policy, so a customer only ever receives
 * their own rows; the user_id filter narrows what is sent, it is not what
 * protects it. Renders nothing.
 */
export default function LiveNotifications() {
  const { user } = useAuth();
  const { refreshUnread } = useAccount();
  const toast = useToast();
  const navigate = useNavigate();

  // Latest callbacks without resubscribing on every render.
  const handlers = useRef({ refreshUnread, toast, navigate });
  useEffect(() => {
    handlers.current = { refreshUnread, toast, navigate };
  });

  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`customer-notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Partial<NotificationRow>;
          if (!row.id || !row.title) return;
          const { toast: t, refreshUnread: recount, navigate: go } = handlers.current;
          t.info(row.title, row.body ?? undefined);
          void recount();
          showDesktopNotification(
            { id: row.id, title: row.title, body: row.body, link: row.link },
            (path) => go(path),
          );
        },
      )
      // Read in another tab or on another device: keep this tab's badge honest.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => void handlers.current.refreshUnread(),
      )
      .subscribe();

    // A socket held across a long background stint can come back stale.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void handlers.current.refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
