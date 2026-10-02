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
  /** How the code was sent: SMS to the account's mobile, or email when SMS is not set up. */
  channel?: 'sms' | 'email';
  /** Masked phone or email, e.g. "+91 ••••• 06633" or "a•••••@gmail.com". */
  destination?: string;
  /** Masked, e.g. "+91 ••••• 06633". Same as `destination`; kept for older servers. */
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

/**
 * Names a card ("Front desk", "Priya's card"). Cosmetic, so it needs only the
 * signed-in owner (customer_set_card_nickname, migration 022). Empty clears it.
 */
export async function setCardNickname(cardId: string, nickname: string): Promise<CardRow> {
  const { data, error } = await supabase.rpc('customer_set_card_nickname', {
    p_card_id: cardId,
    p_nickname: nickname,
  });
  if (error) throw notYetLive(error);
  return data as CardRow;
}

/**
 * Reports a card lost: it is switched off at once and its link stops opening
 * the page. It can only switch a card off, never on, so it does not need a
 * one-time code — getting a lost card switched off fast is the point.
 */
export async function reportCardLost(cardId: string): Promise<CardRow> {
  const { data, error } = await supabase.rpc('customer_report_card_lost', { p_card_id: cardId });
  if (error) throw notYetLive(error);
  return data as CardRow;
}

/** A database without migration 022 has no such function: say so in plain words. */
function notYetLive(error: { code?: string; message?: string }): Error | typeof error {
  return error.code === 'PGRST202' || error.code === '42883'
    ? new Error('This option is being switched on for your account. Please try again later.')
    : error;
}

/** A card's status in the words the customer sees. */
export function cardStatusOf(card: CardRow): { label: string; tone: 'ok' | 'off' | 'idle' } {
  if (card.status === 'replaced') return { label: 'Replaced', tone: 'idle' };
  if (card.lost_at) return { label: 'Reported lost', tone: 'off' };
  if (card.status === 'active') {
    if (card.activation_expires_at && new Date(card.activation_expires_at).getTime() <= Date.now()) {
      return { label: 'Activation expired', tone: 'off' };
    }
    return { label: 'Active', tone: 'ok' };
  }
  if (card.status === 'suspended') return { label: 'Deactivated', tone: 'off' };
  if (card.status === 'shipped') return { label: 'On its way', tone: 'idle' };
  return { label: 'Not activated', tone: 'idle' };
}
