import { supabase } from '../lib/supabase';
import { createTicket } from './support';

/**
 * A customer's own data: a copy to download, and a way to ask for deletion
 * (V6-072; Privacy Policy "your rights").
 *
 * The copy is built by the server (`exportMyAccount` in services/account.ts,
 * AAROH-API v0.12 §4a), which can read every table the account owns. It
 * replaced the browser export that read only what row-level security showed
 * (contract O-4): that one missed the closed AAROH tables and returned whole
 * card rows, activation codes included.
 *
 * Deletion is a request, not a button that deletes. Removing an account is
 * irreversible and some records may have to be kept by law, so a person
 * handles it (docs/runbooks/RUNBOOK-account-deletion.md). The request is a
 * support ticket in the "privacy" category, so the customer can follow it in
 * Support.
 */

/** Saves `text` as a file through the browser's download. */
export function downloadFile(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
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
