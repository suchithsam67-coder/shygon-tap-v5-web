import { supabase } from '../lib/supabase';

/**
 * Emergency contacts and alerts: the owner's side of `POST /api/emergency`
 * (AAROH-API v0.1 §10, Session A, `v6/aaroh-backend`).
 *
 * The browser has no table or RPC access to any emergency data; everything
 * goes through this one server function, which checks the session on every
 * call. Phone numbers only ever arrive masked. Nothing here is cached in
 * storage, put in a URL or sent to analytics (contract §1 rule 4).
 *
 * Status words are shown exactly as the server returns them (§10.4): `sent`
 * means accepted by the text-message provider, never delivered; `delivered`
 * comes only from a provider receipt; `not_sent` means nothing left SHYGON.
 */

export interface EmergencyContact {
  id: string;
  name: string;
  relationship: string | null;
  /** Masked by the server, e.g. "+91 ••••• 00001". The full number never reaches the browser. */
  phone: string;
  channel: 'sms';
  verified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmergencySettings {
  publicAlertsEnabled: boolean;
  publicAlertsChangedAt: string | null;
  contacts: number;
  verifiedContacts: number;
  maxContacts: number;
  publicTapPublished: boolean;
  providerConfigured: boolean;
}

export type EventStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'partial' | 'failed' | 'not_sent' | 'cancelled';

export type RecipientStatus =
  | 'queued'
  | 'sending'
  | 'retry_wait'
  | 'accepted'
  | 'delivered'
  | 'undelivered'
  | 'failed'
  | 'not_sent'
  | 'cancelled';

export interface EventRecipient {
  id: string;
  name: string;
  phone: string;
  channel: 'sms';
  status: RecipientStatus;
  attempts: number;
  provider: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
}

export interface EmergencyEvent {
  id: string;
  initiator: 'owner' | 'public';
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  reportedAt: string | null;
  deliveryReceipts: 'supported' | 'not_supported';
  providerConfigured: boolean;
  recipients: EventRecipient[];
}

export interface EventSummary {
  id: string;
  initiator: 'owner' | 'public';
  status: EventStatus;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  reportedAt: string | null;
  counts: { total: number; delivered: number; accepted: number; pending: number; failed: number; notSent: number; cancelled: number };
}

/** A refusal from /api/emergency: `message` is written for customers; branch on `code`. */
export class EmergencyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: { retryAfter?: number; attemptsLeft?: number; eventId?: string } = {},
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new EmergencyError('Please sign in again.', 401, 'unauthenticated');

  let response: Response;
  try {
    response = await fetch('/api/emergency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new EmergencyError(
      navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.',
      0,
      'network',
    );
  }
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; retryAfter?: number; attemptsLeft?: number; eventId?: string };
  };
  if (!response.ok) {
    const error = result.error ?? {};
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new EmergencyError(error.message ?? 'Something went wrong. Please try again.', response.status, error.code ?? 'unknown', {
      retryAfter: error.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
      attemptsLeft: error.attemptsLeft,
      eventId: error.eventId,
    });
  }
  return result;
}

/** One key per user intent (one press of "Alert my contacts"); reused only to retry that same intent. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const listContacts = () => call<{ contacts: EmergencyContact[]; settings: EmergencySettings }>({ op: 'contacts.list' });

export const saveContact = (input: { contactId?: string; name: string; relationship: string | null; phone: string }) =>
  call<{ contact: EmergencyContact; publicAlertsDisabled: boolean }>({ op: 'contacts.save', ...input });

export const removeContact = (contactId: string) =>
  call<{ removed: true; publicAlertsDisabled: boolean }>({ op: 'contacts.remove', contactId });

export const requestVerification = (contactId: string) =>
  call<{ contactId: string; phone: string; expiresAt: string; resendAfter: number }>({ op: 'contacts.verify.request', contactId });

export const confirmVerification = (contactId: string, code: string) =>
  call<{ contact: EmergencyContact }>({ op: 'contacts.verify.confirm', contactId, code });

export const setPublicAlerts = (publicAlertsEnabled: boolean) =>
  call<{ settings: EmergencySettings }>({ op: 'settings.set', publicAlertsEnabled, acknowledge: true });

export const createAlert = (idempotencyKey: string) =>
  call<{ event: EmergencyEvent; replayed: boolean; safety: string }>({ op: 'alerts.create', idempotencyKey });

export const getAlert = (eventId: string) => call<{ event: EmergencyEvent }>({ op: 'alerts.get', eventId });

export const listAlerts = (limit = 20) => call<{ events: EventSummary[] }>({ op: 'alerts.list', limit });

export const retryAlert = (eventId: string) =>
  call<{ event: EmergencyEvent; requeued: number; dispatched: number }>({ op: 'alerts.retry', eventId });

export const cancelAlert = (eventId: string) => call<{ event: EmergencyEvent & { stopped: number } }>({ op: 'alerts.cancel', eventId });

export const reportAlert = (eventId: string, reason?: string) =>
  call<{ reported: true; publicAlertsDisabled: boolean }>({ op: 'alerts.report', eventId, reason });

/** The contract's copy for each overall status (§10.4 "Show as"). */
export function eventHeadline(status: EventStatus, recipients: number): string {
  const contacts = `${recipients} ${recipients === 1 ? 'contact' : 'contacts'}`;
  switch (status) {
    case 'queued':
    case 'sending':
      return 'Sending…';
    case 'sent':
      return `Sent to ${contacts}. Delivery not confirmed.`;
    case 'delivered':
      return `Delivered to ${contacts}.`;
    case 'partial':
      return 'Some messages could not be sent. See each contact below.';
    case 'failed':
      return 'Could not be sent.';
    case 'not_sent':
      return 'Text messages are not set up. Nothing was sent.';
    case 'cancelled':
      return 'Stopped.';
    default:
      return 'Status unknown. It is not shown as sent.';
  }
}

/** Per contact, in words that never upgrade what the provider said. */
export const RECIPIENT_LABEL: Record<RecipientStatus, string> = {
  queued: 'Waiting to send',
  sending: 'Sending',
  retry_wait: 'Will retry',
  accepted: 'Sent (accepted by the text-message provider; delivery not confirmed)',
  delivered: 'Delivered (confirmed by a delivery receipt)',
  undelivered: 'Not delivered (the provider’s receipt says so)',
  failed: 'Failed',
  not_sent: 'Not sent',
  cancelled: 'Stopped before sending',
};

/** Alerts still moving, which the page keeps re-reading. */
export function inFlight(status: EventStatus): boolean {
  return status === 'queued' || status === 'sending';
}
