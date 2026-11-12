import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CardRow } from '../lib/database.types';
import { OtpDialog } from './Cards';

/**
 * The card code dialog against card-otp's phone refusals (AAROH-API v0.13,
 * DEC-2026-045): a code goes only to a verified number, and a number that
 * replaced a verified one waits 24 hours. The network is replaced at `fetch`.
 */

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
  describeError: (error: unknown) => String(error),
}));

let reply: { status: number; body: unknown };
beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    expect(url).toBe('/api/card-otp');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CARD = { id: 'card-1', card_uid: 'A1B2', status: 'inactive' } as unknown as CardRow;
const open = () =>
  render(
    <MemoryRouter>
      <OtpDialog card={CARD} action="activate" onCancel={() => undefined} onDone={() => undefined} />
    </MemoryRouter>,
  );

describe('the card code dialog and the phone (v0.13)', () => {
  it('not verified: our words, a way to verify, no code box and no resend', async () => {
    reply = {
      status: 409,
      body: { error: 'Verify your mobile number first. The code is sent only to a verified number.', code: 'phone_not_verified' },
    };
    open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Codes for your card are sent only to a verified number.');
    expect(screen.getByRole('link', { name: 'Verify your phone' }).getAttribute('href')).toBe('/shygontap/phone');
    expect(screen.queryByRole('link', { name: 'Open Settings' })).toBeNull();
    expect(screen.queryByLabelText('One-time code')).toBeNull();
    expect(screen.queryByRole('button', { name: /Resend/ })).toBeNull();
  });

  it('changed recently: says from when, with no countdown and no link', async () => {
    reply = {
      status: 409,
      body: { error: 'Your mobile number was changed recently.', code: 'phone_cooling_down', retryAfter: 6 * 3600 },
    };
    open();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/For your security, it can confirm card changes from \d{1,2} \w{3}/);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /Resend in/ })).toBeNull();
  });

  it('no number at all: unchanged, the server words and Settings', async () => {
    reply = { status: 422, body: { error: 'Add your mobile number in Settings first. The code is sent to that number.', needsPhone: true } };
    open();
    expect((await screen.findByRole('alert')).textContent).toContain('Add your mobile number in Settings first.');
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('/shygontap/settings');
  });

  it('a verified number gets the code box, as before', async () => {
    reply = { status: 200, body: { challengeId: 'ch-1', expiresAt: '2026-11-12T06:10:00Z', phone: '+91 ••••• 43210', resendAfter: 45 } };
    open();
    expect(await screen.findByLabelText('One-time code')).toBeTruthy();
    expect(screen.getByText('+91 ••••• 43210')).toBeTruthy();
  });
});
