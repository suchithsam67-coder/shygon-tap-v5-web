import { supabase } from '../lib/supabase';

/**
 * SHYGON Connect and the consent ledger, `POST /api/connect`
 * (AAROH-API v0.7.1 §10b; choices approved in DEC-2026-039).
 *
 * Connect is public only where SHYGON's host switch is on (amendment A-1).
 * While it is off, nobody can ask, and accepting or sharing more is refused
 * (404 `unavailable`); declining, blocking, removing and the lists always work,
 * so consent can always be withdrawn. `settings.publicAllowed` says which.
 *
 * Two signed-in accounts connect. Each side chooses what it shares from its
 * own account (phone, email, company, job title). The other side reads those
 * values live, only while that grant is active, and every value is
 * self-reported: nothing verifies it. Revoking stops future reads at once,
 * but anything already copied cannot be un-shared, and the UI says so.
 * A requester never sees "blocked": the server reports it as "declined".
 */

export type ShareField = 'phone' | 'email' | 'company' | 'job_title';

export const FIELD_LABEL: Record<ShareField, string> = {
  phone: 'Mobile number',
  email: 'Email',
  company: 'Company',
  job_title: 'Job title',
};

export const ALL_FIELDS: readonly ShareField[] = ['phone', 'email', 'company', 'job_title'];

export type ConnectionStatus = 'requested' | 'accepted' | 'declined' | 'blocked' | 'expired' | 'removed';

export interface Connection {
  id: string;
  direction: 'outgoing' | 'incoming';
  status: ConnectionStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  endedAt: string | null;
  other: { name: string; tapSlug: string | null };
  iShare: ShareField[];
  theyShare: Partial<Record<ShareField, { value: string; provenance: 'self_reported' }>>;
}

export interface ConnectSettings {
  enabled: boolean;
  publicTapPublished: boolean;
  pendingIncoming: number;
  connections: number;
  shareableFields: ShareField[];
  /** Whether SHYGON has switched Connect on for this host (v0.7.1); anything but true reads as off. */
  publicAllowed?: boolean;
}

export interface Consent {
  id: string;
  connectionId: string;
  direction: 'given' | 'received';
  other: { name: string } | string;
  scope: ShareField[];
  purpose: string;
  version: number;
  grantedAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
}

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ConnectError('Please sign in again.', 401, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ConnectError(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.', 0, 'network');
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; retryAfter?: number } };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new ConnectError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    );
  }
  return result;
}

export const getConnectSettings = () => call<{ settings: ConnectSettings }>({ op: 'settings.get' });
export const setConnectEnabled = (enabled: boolean) => call<{ settings: ConnectSettings }>({ op: 'settings.set', enabled });
export const createRequest = (slug: string, idempotencyKey: string, share: ShareField[], note: string | null) =>
  call<{ connection: Connection; replayed: boolean }>({ op: 'requests.create', slug, idempotencyKey, share, ...(note ? { note } : {}) });
export const acceptRequest = (connectionId: string, share: ShareField[]) =>
  call<{ connection: Connection }>({ op: 'requests.accept', connectionId, share });
export const declineRequest = (connectionId: string) => call<{ connection: Connection }>({ op: 'requests.decline', connectionId });
export const blockRequest = (connectionId: string) => call<{ connection: Connection }>({ op: 'requests.block', connectionId });
export const listConnections = () => call<{ connections: Connection[] }>({ op: 'connections.list' });
export const changeShare = (connectionId: string, share: ShareField[]) =>
  call<{ connection: Connection }>({ op: 'connections.share', connectionId, share });
export const removeConnection = (connectionId: string) =>
  call<{ removed: true; grantsRevoked: number; connection: Connection }>({ op: 'connections.remove', connectionId });
export const listConsents = () => call<{ consents: Consent[] }>({ op: 'consents.list' });

/** The required revocation wording (contract §10b, doc 04). */
export const UNSHARE_NOTE = 'Details they already copied or saved cannot be un-shared.';
export const REVOCATION_NOTE = `Removing stops them seeing your details from now on. ${UNSHARE_NOTE}`;

export const STATUS_LABEL: Record<ConnectionStatus, string> = {
  requested: 'Waiting for an answer',
  accepted: 'Connected',
  declined: 'Declined',
  // Only ever on the target's own side; a requester sees "declined" (the server maps it).
  blocked: 'Blocked',
  expired: 'Expired',
  removed: 'Removed',
};
