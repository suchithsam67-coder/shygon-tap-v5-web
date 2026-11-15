import { supabase } from '../lib/supabase';
import type { CardRow } from '../lib/database.types';

/**
 * The customer's physical NFC cards, and OTP-confirmed activation and
 * deactivation (netlify/functions/card-otp.mjs, migration 015).
 *
 * Reading is a plain RLS-scoped query: a customer only ever sees their own
 * cards. Changing a card never happens from the browser — it goes through the
 * server function, which checks a one-time password sent to the account's
 * mobile number first. Since v0.13 that number must be verified, and a number
 * that replaced a verified one waits 24 hours (409 phone_not_verified /
 * phone_cooling_down).
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

/** A card's lifecycle state in the customer's words (the server's `cards.status`). */
export function cardStatusOf(card: Pick<CardRow, 'status'>): { label: string; tone: 'ok' | 'off' | 'idle' } {
  if (card.status === 'active') return { label: 'Active', tone: 'ok' };
  if (card.status === 'suspended') return { label: 'Deactivated', tone: 'off' };
  if (card.status === 'replaced') return { label: 'Replaced', tone: 'idle' };
  // Reported stolen (v0.15 C-8): terminal for the owner.
  if (card.status === 'retired') return { label: 'Switched off', tone: 'off' };
  return { label: 'Not activated', tone: 'idle' };
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
    /**
     * `code` (v0.13): 'phone_not_verified', or 'phone_cooling_down' with
     * `retryAfter` in seconds until the replaced number may confirm card changes.
     */
    readonly details: { code?: string; needsPhone?: boolean; retryAfter?: number; attemptsLeft?: number } = {},
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
    code?: string;
    needsPhone?: boolean;
    retryAfter?: number;
    attemptsLeft?: number;
  };
  if (!response.ok) {
    throw new CardOtpError(result.error ?? 'Something went wrong. Please try again.', response.status, {
      code: typeof result.code === 'string' ? result.code : undefined,
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
 * `POST /api/cards` (AAROH-API v0.15 §7 C-6 to C-8; DEC-2026-047): the owner's
 * cards as the server sees them, never with the activation code or the chip's
 * UID; "tap to activate" for an AAROH card; and "report stolen".
 *
 * An AAROH card (`verifiedTap.registered`) becomes active only by a tap: a
 * genuine Verified Tap hands the /d/<code> page a `possession` proof, and the
 * owner's own session spends it. Any other path (card-otp included) leaves the
 * card unchanged, so the card page offers none for such a card.
 */
export interface OwnerCard {
  id: string;
  cardId: string | null;
  nickname: string | null;
  status: string | null;
  edition: { design: string; number: number; of: number; chapterSize: number | null } | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  verifiedTap: { registered: boolean; retired: boolean };
}

export class CardsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

async function cards<T>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new CardsError('Please sign in again.', 401, 'unauthenticated');
  let response: Response;
  try {
    response = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new CardsError(navigator.onLine === false ? 'You are offline. Reconnect and try again.' : 'We could not reach SHYGON. Try again.', 0, 'network');
  }
  const result = (await response.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new CardsError(result.error?.message ?? 'Something went wrong. Please try again.', response.status, result.error?.code ?? 'unknown');
  }
  return result;
}

export const listOwnerCards = () => cards<{ cards: OwnerCard[] }>({ op: 'owner.cards.list' });
/**
 * Tap to activate (C-7): `possession` comes from a genuine tap of the card, within 10 minutes; single use.
 * Since v0.18 the server finds the card from the proof, so the page sends the proof alone.
 */
export const activateCardByTap = (possession: string) => cards<{ card: OwnerCard }>({ op: 'owner.card.activate', possession });
/** Report stolen (C-8): terminal for the owner; only SHYGON support can undo it. */
export const reportCardStolen = (cardId: string) => cards<{ card: OwnerCard }>({ op: 'owner.card.retire', cardId, confirm: true });

/** An AAROH card that is the owner's and can still be paired: chip registered, not retired, pending or shipped. */
export const pairable = (card: OwnerCard) =>
  card.verifiedTap.registered && !card.verifiedTap.retired && (card.status === 'pending' || card.status === 'shipped');
