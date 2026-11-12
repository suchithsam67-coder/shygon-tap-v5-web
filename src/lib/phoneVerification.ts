import { AccountError } from '../services/account';

/**
 * The customer's words for the account phone's verification (AAROH-API v0.13
 * §4b; DEC-2026-045). Every server code maps to our own sentence here, so the
 * server's wording can change without changing the page. DRAFT for the owner's
 * gate, like every new customer string.
 */

export const VERIFY_PHONE_PATH = '/shygontap/phone';
export const SETTINGS_PATH = '/shygontap/settings';

/**
 * The number as the server will read it, for comparing only: the same rule as
 * netlify/lib/sms.mjs toE164, so "98765 43210" and "+91 98765 43210" count as
 * one number and reformatting it does not warn. The server decides; this only
 * chooses whether Settings shows its warning.
 */
export function phoneKey(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) return `+91${digits.slice(1)}`;
  return trimmed;
}

/** "13 Nov, 4:05 pm": when a replaced number may confirm card changes. */
export const whenUsable = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "40 seconds", "about 20 minutes", "about 3 hours": a calm, rounded wait. */
export function waitFor(seconds: number | undefined): string {
  const s = Math.max(1, Math.ceil(seconds ?? 60));
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const minutes = Math.ceil(s / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/** Refusals only Settings can fix: there is no number, or it is not one we can text. */
export const NEEDS_SETTINGS = new Set(['no_phone', 'invalid_phone']);
/** Refusals that end the code on screen: the customer needs a new one. */
export const NEEDS_NEW_CODE = new Set(['no_challenge', 'code_expired', 'too_many_attempts', 'phone_changed']);

export function phoneMessageOf(error: unknown): string {
  if (!(error instanceof AccountError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'no_phone':
      return 'Add your mobile number in Settings first.';
    case 'invalid_phone':
      return 'The number in Settings is not a mobile number we can text. Check it in Settings.';
    case 'already_verified':
      return 'This number is already verified.';
    case 'verify_cooldown':
      return `Please wait ${waitFor(error.retryAfter)} before sending another code.`;
    case 'verify_rate_limited':
      return `You have asked for several codes in the last hour. Try again in ${waitFor(error.retryAfter)}.`;
    case 'number_rate_limited':
      return `This number has had three codes today. Try again in ${waitFor(error.retryAfter)}.`;
    case 'sms_unavailable':
      return 'We cannot send text messages yet, so no code was sent. Please try again later.';
    case 'sms_failed':
      return 'We could not send the code. Please try again.';
    case 'invalid_code':
      return 'Enter the 6-digit code.';
    case 'wrong_code':
      return error.attemptsLeft
        ? `That code is not right. ${error.attemptsLeft} ${error.attemptsLeft === 1 ? 'try' : 'tries'} left.`
        : 'That code is not right.';
    case 'no_challenge':
      return 'Send a new code first.';
    case 'code_expired':
      return 'This code has expired. Send a new one.';
    case 'too_many_attempts':
      return 'Too many wrong tries. Send a new code.';
    case 'phone_changed':
      return 'Your number changed after the code was sent. Send a new code.';
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'network':
      return error.message;
    default:
      return 'Something went wrong. Please try again.';
  }
}

/**
 * card-otp's refusals about the phone (v0.13), in our words. Null for any other
 * refusal, which keeps the server's message.
 */
export function cardPhoneProblem(code: string | undefined, retryAfter: number | undefined, now = Date.now()) {
  if (code === 'phone_not_verified') {
    return { message: 'Verify your mobile number first. Codes for your card are sent only to a verified number.', link: 'verify' as const };
  }
  if (code === 'phone_cooling_down') {
    const from = retryAfter ? whenUsable(new Date(now + retryAfter * 1000).toISOString()) : null;
    return {
      message: from
        ? `Your mobile number changed recently. For your security, it can confirm card changes from ${from}.`
        : 'Your mobile number changed recently. For your security, it can confirm card changes 24 hours after it was verified.',
      link: null,
    };
  }
  return null;
}
