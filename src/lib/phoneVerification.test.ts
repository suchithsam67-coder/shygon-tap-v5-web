import { describe, expect, it } from 'vitest';
import { AccountError } from '../services/account';
import { NEEDS_NEW_CODE, NEEDS_SETTINGS, cardPhoneProblem, phoneKey, phoneMessageOf, waitFor } from './phoneVerification';

/** The account phone's words (AAROH-API v0.13 §4b): every refusal the contract lists has our own sentence. */

const err = (status: number, code: string, extra: { retryAfter?: number; attemptsLeft?: number } = {}) =>
  new AccountError('server words', status, code, extra.retryAfter, extra.attemptsLeft);

// Every refusal §4b lists for phone.verify.start and phone.verify.confirm.
const CONTRACT_CODES = [
  'no_phone', 'already_verified', 'invalid_phone', 'verify_cooldown', 'verify_rate_limited', 'number_rate_limited',
  'sms_unavailable', 'sms_failed', 'invalid_code', 'wrong_code', 'no_challenge', 'code_expired', 'too_many_attempts',
  'phone_changed',
];

describe('phone verification wording', () => {
  it('every contract refusal has its own sentence, never the server text or the generic fallback', () => {
    const generic = phoneMessageOf(err(500, 'internal'));
    for (const code of CONTRACT_CODES) {
      const text = phoneMessageOf(err(400, code, { retryAfter: 45, attemptsLeft: 2 }));
      expect(text, code).not.toBe('server words');
      expect(text, code).not.toBe(generic);
    }
  });

  it('says how long to wait, calmly rounded', () => {
    expect(phoneMessageOf(err(429, 'verify_cooldown', { retryAfter: 40 }))).toBe('Please wait 40 seconds before sending another code.');
    expect(phoneMessageOf(err(429, 'verify_rate_limited', { retryAfter: 1200 }))).toBe(
      'You have asked for several codes in the last hour. Try again in about 20 minutes.',
    );
    expect(phoneMessageOf(err(429, 'number_rate_limited', { retryAfter: 3 * 3600 }))).toBe(
      'This number has had three codes today. Try again in about 3 hours.',
    );
    expect(waitFor(1)).toBe('1 second');
    expect(waitFor(60)).toBe('about 1 minute');
  });

  it('a wrong code says how many tries are left', () => {
    expect(phoneMessageOf(err(400, 'wrong_code', { attemptsLeft: 3 }))).toBe('That code is not right. 3 tries left.');
    expect(phoneMessageOf(err(400, 'wrong_code', { attemptsLeft: 1 }))).toBe('That code is not right. 1 try left.');
    expect(phoneMessageOf(err(400, 'wrong_code'))).toBe('That code is not right.');
  });

  it('a network failure keeps its own words; anything unknown is calm', () => {
    expect(phoneMessageOf(new AccountError('You are offline. Reconnect and try again.', 0, 'network'))).toBe(
      'You are offline. Reconnect and try again.',
    );
    expect(phoneMessageOf(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });

  it('sorts the refusals: Settings fixes a missing or bad number; four end the code on screen', () => {
    expect([...NEEDS_SETTINGS].sort()).toEqual(['invalid_phone', 'no_phone']);
    expect([...NEEDS_NEW_CODE].sort()).toEqual(['code_expired', 'no_challenge', 'phone_changed', 'too_many_attempts']);
  });
});

describe('the number as the server reads it (sms.mjs toE164)', () => {
  it('one Indian number in its usual spellings is one number', () => {
    for (const spelling of ['98765 43210', '+91 98765 43210', '919876543210', '09876543210', '+91-98765-43210']) {
      expect(phoneKey(spelling), spelling).toBe('+919876543210');
    }
  });

  it('a different number, an empty field or something unreadable stays different', () => {
    expect(phoneKey('98765 43211')).not.toBe(phoneKey('98765 43210'));
    expect(phoneKey('')).toBe('');
    expect(phoneKey(null)).toBe('');
    expect(phoneKey('12345')).toBe('12345');
  });
});

describe("card-otp's phone refusals (v0.13)", () => {
  it('not verified: our words and a way to verify', () => {
    expect(cardPhoneProblem('phone_not_verified', undefined)).toEqual({
      message: 'Verify your mobile number first. Codes for your card are sent only to a verified number.',
      link: 'verify',
    });
  });

  it('changed recently: says from when, with no link', () => {
    const now = Date.parse('2026-11-12T06:30:00Z'); // 12:00 in India
    const problem = cardPhoneProblem('phone_cooling_down', 6 * 3600, now)!;
    expect(problem.link).toBeNull();
    expect(problem.message).toMatch(/^Your mobile number changed recently\. For your security, it can confirm card changes from /);
    expect(problem.message).toContain('12 Nov');
  });

  it('changed recently without a time: the 24-hour rule in words', () => {
    expect(cardPhoneProblem('phone_cooling_down', undefined)!.message).toContain('24 hours after it was verified');
  });

  it('anything else keeps the server message', () => {
    expect(cardPhoneProblem(undefined, 45)).toBeNull();
    expect(cardPhoneProblem('rate_limited', 45)).toBeNull();
  });
});
