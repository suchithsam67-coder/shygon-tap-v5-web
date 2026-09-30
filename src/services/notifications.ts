import { supabase } from '../lib/supabase';
import type { NotificationRow } from '../lib/database.types';

/**
 * Notifications are written by database triggers on `orders` (placed, paid,
 * shipped, delivered) and by Tap provisioning. The browser can only read its
 * own and mark them read — a trigger rejects any attempt to edit the title,
 * body, link, category or owner.
 */

const COLUMNS = 'id, user_id, category, title, body, link, metadata, read_at, created_at';

export async function fetchNotifications(
  userId: string,
  limit = 50,
): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as unknown as NotificationRow[];
}

export async function countUnread(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw error;
  return count ?? 0;
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);

  if (error) throw error;
}

export async function markAllRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('read_at', null);

  if (error) throw error;
}
