import { supabase } from '../lib/supabase';
import { createTicket } from './support';

/**
 * A customer's own data: a copy to download, and a way to ask for deletion
 * (V6-072; Privacy Policy "your rights").
 *
 * The export reads only what row-level security already lets the signed-in
 * customer read, so it can never include another person's data: the same
 * policies that guard the dashboard guard this. Visitors' analytics events are
 * not included; they are about the people who opened the Tap, not the owner.
 * Nor are the payment ledger rows, which only admins can read: each order
 * already carries its amount, payment status and Razorpay references.
 *
 * Deletion is a request, not a button that deletes. Removing an account is
 * irreversible and some records may have to be kept by law, so a person
 * handles it (docs/runbooks/RUNBOOK-account-deletion.md). The request is a
 * support ticket in the "privacy" category, so the customer can follow it in
 * Support.
 */

async function rows(table: string, column: string, value: string | string[]) {
  const query = supabase.from(table).select('*');
  const { data, error } = await (Array.isArray(value) ? query.in(column, value) : query.eq(column, value));
  if (error) throw error;
  return data ?? [];
}

export interface DataExport {
  format: 'shygon-account-export/1';
  exportedAt: string;
  account: { id: string; email: string | null };
  [section: string]: unknown;
}

export async function exportMyData(user: { id: string; email?: string | null }): Promise<DataExport> {
  const [profile, taps, orders, entitlements, cards, notifications, tickets, accountEvents] = await Promise.all([
    rows('profiles', 'id', user.id),
    rows('tap_profiles', 'user_id', user.id),
    rows('orders', 'user_id', user.id),
    rows('entitlements', 'user_id', user.id),
    rows('cards', 'user_id', user.id),
    rows('notifications', 'user_id', user.id),
    rows('support_tickets', 'user_id', user.id),
    rows('account_events', 'user_id', user.id),
  ]);
  const orderIds = orders.map((order) => (order as { id: string }).id);
  const ticketIds = tickets.map((ticket) => (ticket as { id: string }).id);
  const [orderItems, supportMessages] = await Promise.all([
    orderIds.length ? rows('order_items', 'order_id', orderIds) : [],
    ticketIds.length ? rows('support_messages', 'ticket_id', ticketIds) : [],
  ]);
  return {
    format: 'shygon-account-export/1',
    exportedAt: new Date().toISOString(),
    account: { id: user.id, email: user.email ?? null },
    profile: profile[0] ?? null,
    tap: taps[0] ?? null,
    orders,
    orderItems,
    entitlements,
    cards,
    notifications,
    supportTickets: tickets,
    supportMessages,
    accountEvents,
  };
}

/** Saves `data` as a JSON file through the browser's download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const DELETION_SUBJECT = 'Account deletion request';

/**
 * Opens (or finds the already open) deletion request. Returns its reference,
 * e.g. "ST-1A2B3C4D", for the customer to quote.
 */
export async function requestAccountDeletion(userId: string): Promise<string> {
  const { data: existing, error } = await supabase
    .from('support_tickets')
    .select('reference, status')
    .eq('user_id', userId)
    .eq('category', 'privacy')
    .eq('subject', DELETION_SUBJECT)
    .in('status', ['open', 'awaiting_customer']);
  if (error) throw error;
  if (existing && existing.length > 0) return (existing[0] as { reference: string }).reference;

  const ticket = await createTicket({
    userId,
    subject: DELETION_SUBJECT,
    category: 'privacy',
    message:
      'Please delete my SHYGON account and the personal data you hold about me. ' +
      'Please confirm what you delete and anything you must keep by law.',
  });
  return ticket.reference;
}
