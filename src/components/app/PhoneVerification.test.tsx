import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PhoneVerification } from './PhoneVerification';

/**
 * "Verify your phone" against AAROH-API v0.13 §4b: the network is replaced at
 * `fetch`, one answer per operation, and every request is kept.
 */

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
}));

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
const sent: { op: string; body: Record<string, unknown> }[] = [];

const UNVERIFIED = { phone: '+91 ••••• 43210', phoneValid: true, verified: false, verifiedAt: null, usableFrom: null };
const VERIFIED = { ...UNVERIFIED, verified: true, verifiedAt: '2026-11-12T06:00:00Z', usableFrom: '2026-11-12T06:00:00Z' };
const STARTED = { phoneMasked: '+91 ••••• 43210', expiresAt: '2026-11-12T06:10:00Z', resendAfter: 45 };
const failure = (status: number, code: string, extra: Record<string, number> = {}): Reply => ({
  status,
  body: { error: { code, message: 'server words', ...extra } },
});

beforeEach(() => {
  sent.length = 0;
  replies = {
    'phone.status': [{ status: 200, body: UNVERIFIED }],
    'phone.verify.start': [{ status: 200, body: STARTED }],
    'phone.verify.confirm': [{ status: 200, body: { verified: true, verifiedAt: VERIFIED.verifiedAt, usableFrom: VERIFIED.usableFrom } }],
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/account');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const op = String(body.op);
    sent.push({ op, body });
    const queue = replies[op]!;
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (onVerified?: () => void) =>
  render(
    <MemoryRouter>
      <PhoneVerification onVerified={onVerified} />
    </MemoryRouter>,
  );
const stateOf = () => screen.getByTestId('phone-verify').getAttribute('data-state');
const typeCode = (value: string) => fireEvent.change(screen.getByLabelText('Verification code'), { target: { value } });

describe('verify your phone', () => {
  it('sends a code to the number on the account, never one typed here, and verifies it', async () => {
    const onVerified = vi.fn();
    show(onVerified);
    expect(await screen.findByText(/is not verified yet/)).toBeTruthy();
    expect(stateOf()).toBe('unverified');

    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/Enter the 6-digit code we texted to/)).toBeTruthy();
    expect(sent.find((s) => s.op === 'phone.verify.start')!.body).toEqual({ op: 'phone.verify.start' });
    expect(screen.getByRole('button', { name: /Send a new code in \d+s/ }).hasAttribute('disabled')).toBe(true);

    typeCode('12 34 56'); // digits only; six of them submit at once
    expect(await screen.findByText(/Your number is verified/)).toBeTruthy();
    expect(sent.find((s) => s.op === 'phone.verify.confirm')!.body).toEqual({ op: 'phone.verify.confirm', code: '123456' });
    expect(stateOf()).toBe('verified');
    expect(onVerified).toHaveBeenCalledWith(expect.objectContaining({ verified: true, phone: '+91 ••••• 43210' }));
  });

  it('a wrong code keeps the code entry, says the tries left, and empties the box', async () => {
    replies['phone.verify.confirm'] = [failure(400, 'wrong_code', { attemptsLeft: 4 })];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('Verification code');
    typeCode('000000');
    expect((await screen.findByRole('alert')).textContent).toBe('That code is not right. 4 tries left.');
    expect(stateOf()).toBe('entering');
    expect((screen.getByLabelText('Verification code') as HTMLInputElement).value).toBe('');
  });

  it('an expired code goes back to sending a new one', async () => {
    replies['phone.verify.confirm'] = [failure(410, 'code_expired')];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    await screen.findByLabelText('Verification code');
    typeCode('111111');
    expect((await screen.findByRole('alert')).textContent).toContain('This code has expired. Send a new one.');
    expect(stateOf()).toBe('unverified');
  });

  it('a cooldown says how long and holds the button', async () => {
    replies['phone.verify.start'] = [failure(429, 'verify_cooldown', { retryAfter: 30 })];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Please wait 30 seconds before sending another code.');
    expect(screen.getByRole('button', { name: /Send code in \d+s/ }).hasAttribute('disabled')).toBe(true);
  });

  it('text messages not set up: says so, plainly', async () => {
    replies['phone.verify.start'] = [failure(503, 'sms_unavailable')];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    expect((await screen.findByRole('alert')).textContent).toContain('We cannot send text messages yet, so no code was sent.');
  });

  it('already verified elsewhere: reads the status again instead of showing an error', async () => {
    replies['phone.status'] = [{ status: 200, body: UNVERIFIED }, { status: 200, body: VERIFIED }];
    replies['phone.verify.start'] = [failure(409, 'already_verified')];
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Verified:', { exact: false })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sent.filter((s) => s.op === 'phone.status')).toHaveLength(2);
  });

  it('no number on the account: sends to Settings, offers no button that would fail', async () => {
    replies['phone.status'] = [{ status: 200, body: { ...UNVERIFIED, phone: null } }];
    show();
    expect(await screen.findByText(/Add your mobile number in Settings first/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/shygontap/settings');
    expect(screen.queryByRole('button', { name: 'Send code' })).toBeNull();
  });

  it('a number we cannot text: says to check it in Settings', async () => {
    replies['phone.status'] = [{ status: 200, body: { ...UNVERIFIED, phone: null, phoneValid: false } }];
    show();
    expect(await screen.findByText(/not a mobile number we can text/)).toBeTruthy();
    expect(stateOf()).toBe('needs-settings');
  });

  it('a replaced number that is still waiting says from when it can confirm card changes', async () => {
    const later = new Date(Date.now() + 20 * 3600 * 1000).toISOString();
    replies['phone.status'] = [{ status: 200, body: { ...VERIFIED, usableFrom: later } }];
    show();
    expect(await screen.findByText(/can confirm card changes from/)).toBeTruthy();
    expect(stateOf()).toBe('waiting');
  });

  it('a failed status read offers to try again', async () => {
    replies['phone.status'] = [failure(500, 'internal'), { status: 200, body: VERIFIED }];
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Verified:', { exact: false })).toBeTruthy();
  });
});
