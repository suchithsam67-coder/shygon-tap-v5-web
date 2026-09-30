import { useState } from 'react';
import { ArrowLeft, LifeBuoy, Loader2, Send } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useToast } from '../components/app/toast-context';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import { CONTACT_EMAIL } from '../lib/site';
import {
  closeTicket,
  createTicket,
  fetchMessages,
  fetchTickets,
  replyToTicket,
  SUPPORT_CATEGORIES,
  TICKET_STATUS_LABELS,
} from '../services/support';
import type { SupportMessageRow, SupportTicketRow } from '../lib/database.types';
import { useAsync } from '../hooks/useAsync';

/**
 * Support tickets. Every action here maps to a real database write — a
 * customer can open a ticket, reply, and close it; RLS refuses everything
 * else (reopening a closed ticket, replying as `support`, editing another
 * ticket), so there is nothing on this page a customer can click that fails
 * silently.
 */
export default function Support() {
  const { user } = useAuth();
  const toast = useToast();


  const [openTicket, setOpenTicket] = useState<SupportTicketRow | null>(null);
  const [messages, setMessages] = useState<SupportMessageRow[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [message, setMessage] = useState('');
  const [reply, setReply] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, loading, error, reload: load, setData } = useAsync(
    async () => {
      if (!user) return { tickets: [] as SupportTicketRow[], setupRequired: false };
      try {
        return { tickets: await fetchTickets(user.id), setupRequired: false };
      } catch (err) {
        if (isMissingSchema(err)) return { tickets: [] as SupportTicketRow[], setupRequired: true };
        throw err;
      }
    },
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );

  const tickets = data?.tickets ?? [];
  const setupRequired = data?.setupRequired ?? false;

  /** Optimistic list edit — the row is already updated on the server. */
  const setTickets = (next: (current: SupportTicketRow[]) => SupportTicketRow[]) =>
    setData((current) => (current ? { ...current, tickets: next(current.tickets) } : current));

  async function openThread(ticket: SupportTicketRow) {
    setOpenTicket(ticket);
    setMessagesLoading(true);
    try {
      setMessages(await fetchMessages(ticket.id));
    } catch (err) {
      toast.error('Could not load messages', describeError(err));
    } finally {
      setMessagesLoading(false);
    }
  }

  async function submitNewTicket() {
    if (!user || !subject.trim() || !message.trim()) return;
    setSubmitting(true);
    try {
      const ticket = await createTicket({
        userId: user.id,
        subject: subject.trim(),
        category,
        message: message.trim(),
      });
      setTickets((current) => [ticket, ...current]);
      setSubject('');
      setMessage('');
      setComposing(false);
      toast.success('Ticket opened', `Reference ${ticket.reference}`);
      await openThread(ticket);
    } catch (err) {
      toast.error('Could not open ticket', describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReply() {
    if (!user || !openTicket || !reply.trim()) return;
    const body = reply.trim();
    setReply('');
    try {
      const sent = await replyToTicket({ ticketId: openTicket.id, userId: user.id, body });
      setMessages((current) => [...current, sent]);
    } catch (err) {
      toast.error('Message not sent', describeError(err));
      setReply(body);
    }
  }

  async function close() {
    if (!openTicket) return;
    try {
      await closeTicket(openTicket.id);
      setTickets((current) =>
        current.map((t) => (t.id === openTicket.id ? { ...t, status: 'closed' } : t)),
      );
      setOpenTicket((current) => (current ? { ...current, status: 'closed' } : current));
      toast.success('Ticket closed');
    } catch (err) {
      toast.error('Could not close ticket', describeError(err));
    }
  }

  if (openTicket) {
    return (
      <AppShell
        eyebrow={openTicket.reference}
        title={openTicket.subject}
        description={undefined}
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpenTicket(null)}>
              <ArrowLeft size={14} /> All tickets
            </button>
            {openTicket.status !== 'closed' && (
              <button className="btn btn-ghost btn-sm" onClick={() => void close()}>
                Close ticket
              </button>
            )}
          </>
        }
      >
        <section className="panel">
          <div className="panel-head">
            <span className={`pill ${openTicket.status === 'closed' ? '' : 'pill-blue'}`}>
              {TICKET_STATUS_LABELS[openTicket.status] ?? openTicket.status}
            </span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            {messagesLoading ? (
              <SkeletonRows rows={2} />
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: msg.author_role === 'customer' ? 'flex-end' : 'flex-start',
                    maxWidth: '78%',
                    marginLeft: msg.author_role === 'customer' ? 'auto' : 0,
                    padding: '10px 14px',
                    borderRadius: 15,
                    background: msg.author_role === 'customer' ? 'var(--blue)' : '#f1f5fa',
                    color: msg.author_role === 'customer' ? '#fff' : 'var(--ink)',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {msg.body}
                </div>
              ))
            )}
          </div>

          {openTicket.status !== 'closed' && (
            <div className="panel-body" style={{ borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
              <input
                className="input"
                value={reply}
                placeholder="Type a message…"
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && reply.trim()) void submitReply();
                }}
              />
              <button className="btn btn-blue" onClick={() => void submitReply()} disabled={!reply.trim()}>
                <Send size={15} />
              </button>
            </div>
          )}
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="We're here to help"
      title="Support"
      description="Questions about your card, digital experience, delivery or an upgrade."
      actions={
        !composing ? (
          <button className="btn btn-blue" onClick={() => setComposing(true)}>
            New ticket
          </button>
        ) : undefined
      }
    >
      {composing && (
        <section className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <h2>New support ticket</h2>
          </div>
          <div className="panel-body">
            <label className="field">
              <span>Subject</span>
              <input
                className="input"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's this about?"
                maxLength={160}
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Message</span>
              <textarea
                className="textarea"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue…"
              />
            </label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-blue"
                onClick={() => void submitNewTicket()}
                disabled={submitting || !subject.trim() || !message.trim()}
              >
                {submitting ? <Loader2 size={15} className="spin" /> : null}
                {submitting ? 'Sending…' : 'Submit ticket'}
              </button>
              <button className="btn btn-ghost" onClick={() => setComposing(false)}>
                Cancel
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        {loading ? (
          <SkeletonRows rows={3} />
        ) : setupRequired ? (
          <ErrorState
            title="Support is not set up yet"
            message={`The support ticket tables have not been migrated on this environment. Email ${CONTACT_EMAIL} in the meantime.`}
          />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : tickets.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy size={22} />}
            title="No tickets yet"
            description="Open one whenever you need help — we'll reply here."
          />
        ) : (
          <div className="panel-body-flush">
            {tickets.map((ticket, i) => (
              <button
                key={ticket.id}
                type="button"
                className="panel-row reveal"
                style={{
                  width: '100%',
                  textAlign: 'left',
                  border: 0,
                  borderTop: i === 0 ? undefined : '1px solid #eef1f5',
                  background: 'transparent',
                  cursor: 'pointer',
                  ['--i' as string]: i,
                }}
                onClick={() => void openThread(ticket)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 13.5 }}>{ticket.subject}</strong>
                  <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12 }}>
                    {ticket.reference} · {new Date(ticket.created_at).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <span className={`pill ${ticket.status === 'closed' ? '' : 'pill-blue'}`}>
                  {TICKET_STATUS_LABELS[ticket.status] ?? ticket.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
