import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgeConfirmation } from './AgeConfirmation';
import { forgetAgeConfirmations } from '../../lib/ageConfirmation';
import { LEGAL } from '../../data/legal';

/**
 * The one-time 18+ prompt against AAROH-API v0.17 §4c: the network is replaced
 * at `fetch`, one answer per operation, and every request is kept.
 */

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
}));
const auth = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  passwordRecovery: false,
  signOut: vi.fn(async () => undefined),
}));
vi.mock('../../lib/auth-context', () => ({ useAuth: () => auth }));

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]>;
const sent: Record<string, unknown>[] = [];

const failure = (status: number, code: string): Reply => ({ status, body: { error: { code, message: 'server words' } } });

beforeEach(() => {
  forgetAgeConfirmations();
  sent.length = 0;
  auth.user = { id: 'u-1' };
  auth.passwordRecovery = false;
  auth.signOut.mockClear();
  replies = {
    'age.status': [{ status: 200, body: { confirmed: false, confirmedAt: null, source: null } }],
    'age.confirm': [{ status: 200, body: { confirmed: true, confirmedAt: '2026-11-14T06:00:00Z' } }],
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/account');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push(body);
    const queue = replies[String(body.op)]!;
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const statusCalls = () => sent.filter((b) => b.op === 'age.status').length;

describe('the one-time 18+ prompt', () => {
  it('an account with no confirmation is asked once; Confirm waits for the box; the server gets adult: true and the policies version', async () => {
    render(<AgeConfirmation />);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm your age' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'I am 18 or older.' }));

    fireEvent.click(screen.getByRole('checkbox', { name: 'I am 18 or older.' }));
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(sent.find((b) => b.op === 'age.confirm')).toEqual({ op: 'age.confirm', adult: true, policiesVersion: LEGAL.lastUpdated });

    // The next signed-in page in this tab does not ask the server again.
    cleanup();
    render(<AgeConfirmation />);
    await new Promise((r) => setTimeout(r, 20));
    expect(statusCalls()).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a confirmed account sees nothing, and is not asked again in this tab', async () => {
    replies['age.status'] = [{ status: 200, body: { confirmed: true, confirmedAt: '2026-11-14T06:00:00Z', source: 'signup' } }];
    render(<AgeConfirmation />);
    await waitFor(() => expect(statusCalls()).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<AgeConfirmation />);
    await new Promise((r) => setTimeout(r, 20));
    expect(statusCalls()).toBe(1);
  });

  it('already confirmed (another tab): closes, with no error', async () => {
    replies['age.confirm'] = [failure(409, 'already_confirmed')];
    render(<AgeConfirmation />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I am 18 or older.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a failed save keeps the prompt and says so in our words', async () => {
    replies['age.confirm'] = [failure(500, 'internal')];
    render(<AgeConfirmation />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'I am 18 or older.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect((await screen.findByRole('alert')).textContent).toBe('We could not save your confirmation. Please try again.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('the owner can always sign out instead; under-18s are told how to close the account', async () => {
    render(<AgeConfirmation />);
    await screen.findByRole('dialog');
    expect(screen.getByRole('link', { name: LEGAL.email }).getAttribute('href')).toBe(`mailto:${LEGAL.email}`);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('a failed status read shows nothing (the server keeps the record either way)', async () => {
    replies['age.status'] = [failure(500, 'internal')];
    render(<AgeConfirmation />);
    await waitFor(() => expect(statusCalls()).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a password-reset visit is left alone', async () => {
    auth.passwordRecovery = true;
    render(<AgeConfirmation />);
    await new Promise((r) => setTimeout(r, 20));
    expect(statusCalls()).toBe(0);
  });
});
