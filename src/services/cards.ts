import { supabase } from '../lib/supabase';
import type { CardRow } from '../lib/database.types';

/**
 * The customer's physical NFC cards, and OTP-confirmed activation and
 * deactivation (netlify/functions/card-otp.mjs, migration 015).
 *
 * Reading is a plain RLS-scoped query: a customer only ever sees their own
 * cards. Changing a card never happens from the browser — it goes through the
 * server function, which checks a one-time password sent to the account's
 * mobile number first.
 */

// Every column: the limited-edition fields (migration 017) come along once that
// migration is applied, without breaking this page on a database without them.
const COLUMNS = '*';

export async function fetchMyCards(userId: string): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from('cards')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as CardRow[];
}

export type CardAction = 'activate' | 'deactivate';

export interface OtpChallenge {
  challengeId: string;
  expiresAt: string;
  /** Masked, e.g. "+91 ••••• 06633". */
  phone: string;
  resendAfter: number;
  /** Local development only (OTP_DEV_MODE); never set in production. */
  devCode?: string;
  devNote?: string;
}

export class CardOtpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: { needsPhone?: boolean; retryAfter?: number; attemptsLeft?: number } = {},
  ) {
    super(message);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CardOtpError('Please sign in again.', 401);

  let response: Response;
  try {
    response = await fetch('/api/card-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CardOtpError(
      navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach the server. Try again.',
      0,
    );
  }
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    needsPhone?: boolean;
    retryAfter?: number;
    attemptsLeft?: number;
  };
  if (!response.ok) {
    throw new CardOtpError(result.error ?? 'Something went wrong. Please try again.', response.status, {
      needsPhone: result.needsPhone,
      retryAfter: result.retryAfter,
      attemptsLeft: result.attemptsLeft,
    });
  }
  return result;
}

export function requestCardOtp(cardId: string, action: CardAction): Promise<OtpChallenge> {
  return call<OtpChallenge>({ step: 'request', cardId, action });
}

export function verifyCardOtp(challengeId: string, code: string): Promise<{ card: Partial<CardRow>; action: CardAction }> {
  return call({ step: 'verify', challengeId, code });
}
