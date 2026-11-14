import { supabase } from '../lib/supabase';

/**
 * The owner's account operations, `POST /api/account`: the data export
 * (AAROH-API v0.12 §4a; DEC-2026-044) and the account phone's verification
 * (v0.13 §4b; DEC-2026-045). Card codes go only to a verified phone, and a
 * number that replaces a verified one waits 24 hours (`usableFrom`).
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

/** The account phone as the server sees it. `phone` is masked ("+91 ••••• 45678") or null. */
export interface PhoneStatus {
  phone: string | null;
  /** False when the number on the account is not a mobile number we can text. */
  phoneValid: boolean;
  verified: boolean;
  verifiedAt: string | null;
  /** When a number that replaced a verified one may confirm card changes; null or past means now. */
  usableFrom: string | null;
}

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfter?: number,
    /** With `wrong_code`: tries left on this code. */
    readonly attemptsLeft?: number,
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
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: { code?: string; message?: string; retryAfter?: number; attemptsLeft?: number };
  };
  if (!response.ok) {
    const retryHeader = Number(response.headers.get('Retry-After'));
    throw new AccountError(
      result.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      result.error?.code ?? 'unknown',
      result.error?.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
      result.error?.attemptsLeft,
    );
  }
  return result;
}

/** A copy of the account's data, and its Business profile as a vCard (null without a Tap). Five per 24 hours. */
export const exportMyAccount = () => call<{ export: AccountExport; vcard: string | null }>({ op: 'owner.export' });

export const getPhoneStatus = () => call<PhoneStatus>({ op: 'phone.status' });
/** Texts a 6-digit code to the phone now on the account (never a number sent from here). */
export const startPhoneVerification = () =>
  call<{ phoneMasked: string; expiresAt: string; resendAfter: number }>({ op: 'phone.verify.start' });
export const confirmPhoneVerification = (code: string) =>
  call<{ verified: true; verifiedAt: string; usableFrom: string | null }>({ op: 'phone.verify.confirm', code });

/**
 * The 18+ confirmation (v0.17 §4c; DEC-2026-048). The database records it at
 * sign-up from the sign-up data; an account without one (made before the gate)
 * confirms once, here. `adult` is always the JSON value true: the server
 * refuses anything else.
 */
export interface AgeStatus {
  confirmed: boolean;
  confirmedAt: string | null;
  source: 'signup' | 'reconfirm' | null;
}
export const getAgeStatus = () => call<AgeStatus>({ op: 'age.status' });
export const confirmAge = (policiesVersion: string) =>
  call<{ confirmed: true; confirmedAt: string }>({ op: 'age.confirm', adult: true, policiesVersion });

/** True while a replaced number is still waiting before it may confirm card changes. */
export const stillWaiting = (status: Pick<PhoneStatus, 'usableFrom'>, now = Date.now()) =>
  Boolean(status.usableFrom && Date.parse(status.usableFrom) > now);
