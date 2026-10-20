import { supabase } from '../lib/supabase';

/**
 * The owner's side of the Return-to-Owner relay, `POST /api/rescue`
 * (AAROH-API v0.2 §10a): the opt-in, the inbox and the replies.
 *
 * The owner sees only what finders write; links are removed on both sides by
 * the server. Nothing here is cached in the browser.
 */

export interface RescueSettings {
  enabled: boolean;
  publicHint: string | null;
  changedAt: string | null;
  publicTapPublished: boolean;
  openThreads: number;
  unread: number;
  /** Whether SHYGON runs the relay at all here (the host switch). */
  relayAllowed: boolean;
}

export type ThreadStatus = 'open' | 'owner_replied' | 'closed' | 'blocked' | 'spam';

export interface ThreadSummary {
  id: string;
  status: ThreadStatus;
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  reportedAt: string | null;
  unread: boolean | number;
  messages: number;
  preview: string;
}

export interface OwnerThread {
  id: string;
  status: ThreadStatus;
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  reportedAt: string | null;
  finderCanWrite: boolean;
  messages: { id: string; from: 'finder' | 'owner' | 'system'; body: string; at: string }[];
}

export class RescueOwnerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new RescueOwnerError('Please sign in again.', 401, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch('/api/rescue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new RescueOwnerError(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.', 0, 'network');
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new RescueOwnerError(result.error?.message ?? 'Something went wrong. Please try again.', response.status, result.error?.code ?? 'unknown');
  }
  return result;
}

export const getRescueSettings = () => call<{ settings: RescueSettings }>({ op: 'settings.get' });
export const setRescueSettings = (enabled: boolean, publicHint: string | null) =>
  call<{ settings: RescueSettings }>({ op: 'settings.set', enabled, publicHint });
export const listThreads = (limit = 50) => call<{ threads: ThreadSummary[] }>({ op: 'threads.list', limit });
export const getThread = (threadId: string) => call<{ thread: OwnerThread }>({ op: 'threads.get', threadId });
export const replyToThread = (threadId: string, clientKey: string, message: string) =>
  call<{ thread: OwnerThread; replayed: boolean }>({ op: 'threads.reply', threadId, clientKey, message });
export const closeThread = (threadId: string) => call<{ thread: OwnerThread }>({ op: 'threads.close', threadId });
export const blockThread = (threadId: string) => call<{ thread: OwnerThread }>({ op: 'threads.block', threadId });
export const reportThread = (threadId: string, reason?: string) => call<{ thread: OwnerThread }>({ op: 'threads.report', threadId, reason });

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  open: 'Waiting for your reply',
  owner_replied: 'You replied',
  closed: 'Closed',
  blocked: 'Blocked',
  spam: 'Reported',
};
