import { supabase } from '../lib/supabase';
import type { SupportMessageRow, SupportTicketRow } from '../lib/database.types';

/**
 * Support tickets. A customer may open a ticket, reply to it and close it.
 * Reopening, reassigning and the `support` author role are all refused by RLS,
 * so the ticket state a customer can reach is deliberately narrow.
 */

const TICKET_COLUMNS =
  'id, user_id, reference, subject, category, status, order_id, created_at, updated_at';
const MESSAGE_COLUMNS = 'id, ticket_id, author_id, author_role, body, created_at';

export const SUPPORT_CATEGORIES = [
  { value: 'order', label: 'Order or delivery' },
  { value: 'card', label: 'NFC card' },
  { value: 'tap', label: 'Tap profile' },
  { value: 'payment', label: 'Payment or billing' },
  { value: 'other', label: 'Something else' },
] as const;

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  awaiting_customer: 'Awaiting your reply',
  resolved: 'Resolved',
  closed: 'Closed',
};

export async function fetchTickets(userId: string): Promise<SupportTicketRow[]> {
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as SupportTicketRow[];
}

export async function fetchMessages(ticketId: string): Promise<SupportMessageRow[]> {
  const { data, error } = await supabase
    .from('support_messages')
    .select(MESSAGE_COLUMNS)
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as SupportMessageRow[];
}

export async function createTicket(input: {
  userId: string;
  subject: string;
  category: string;
  orderId?: string | null;
  message: string;
}): Promise<SupportTicketRow> {
  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert({
      user_id: input.userId,
      subject: input.subject.trim(),
      category: input.category,
      order_id: input.orderId ?? null,
      status: 'open',
    })
    .select(TICKET_COLUMNS)
    .single();

  if (error) throw error;

  // The opening message is part of the ticket; if it fails the ticket would be
  // an empty shell, so the failure is surfaced rather than swallowed.
  const { error: messageError } = await supabase.from('support_messages').insert({
    ticket_id: (ticket as unknown as SupportTicketRow).id,
    author_id: input.userId,
    author_role: 'customer',
    body: input.message.trim(),
  });

  if (messageError) throw messageError;

  return ticket as unknown as SupportTicketRow;
}

export async function replyToTicket(input: {
  ticketId: string;
  userId: string;
  body: string;
}): Promise<SupportMessageRow> {
  const { data, error } = await supabase
    .from('support_messages')
    .insert({
      ticket_id: input.ticketId,
      author_id: input.userId,
      author_role: 'customer',
      body: input.body.trim(),
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as SupportMessageRow;
}

export async function closeTicket(ticketId: string): Promise<void> {
  const { error } = await supabase
    .from('support_tickets')
    .update({ status: 'closed' })
    .eq('id', ticketId);

  if (error) throw error;
}
