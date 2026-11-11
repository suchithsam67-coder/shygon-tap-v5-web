import { supabase } from '../lib/supabase';

/**
 * The owner's account operations, `POST /api/account` (AAROH-API v0.12 §4a;
 * DEC-2026-044). Today: the data export.
 *
 * The server builds the export, so it holds everything the account owns,
 * the closed AAROH tables included (modes, Emergency, Return to Owner, Connect,
 * Verified Tap), and leaves out by rule other people's data and security
 * values (activation codes, the chip's serial number, hashes). It says what it
 * left out and why in `excluded`, which the page shows. The account comes from
 * the session token alone.
 */

export interface AccountExport {
  format: 'shygon-account-export/2';
  exportedAt: string;
  accountId: string;
  /** Lists that hit the 2,000-row cap; the newest rows were kept. Usually empty. */
  truncated: string[];
  /** What is left out, and why, in plain words. */
  excluded: { what: string; why: string }[];
  [section: string]: unknown;
}

export class AccountError extends Error {
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
  if (!token) throw new AccountError('Please sign in again.', 401, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch('/api/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new AccountError(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.', 0, 'network');
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string; retryAfter?: number } };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new AccountError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    );
  }
  return result;
}

/** A copy of the account's data, and its Business profile as a vCard (null without a Tap). Five per 24 hours. */
export const exportMyAccount = () => call<{ export: AccountExport; vcard: string | null }>({ op: 'owner.export' });
