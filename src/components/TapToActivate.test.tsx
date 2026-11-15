import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TapToActivate } from './TapToActivate';

/**
 * "Tap to activate" on /d/<code> (AAROH-API v0.15 §10d, and §7 C-7 as of
 * v0.18; DEC-2026-047): the card in hand (a genuine tap's proof) and the
 * owner's own session, together. Since v0.18 the proof alone names the card. The network is replaced at `fetch`, and the session at
 * the Supabase client.
 */

const session = vi.hoisted(() => ({ current: { access_token: 'owner-token' } as { access_token: string } | null }));
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.current } }) } },
}));

const PROOF = `abcdefgh234567ab.7.1800000000.${'a'.repeat(64)}`;
const card = (id: string, status: string, registered = true, retired = false) => ({
  id, cardId: null, nickname: null, status, edition: null, activatedAt: null, deactivatedAt: null,
  verifiedTap: { registered, retired },
});

type Reply = { status: number; body: unknown };
let list: Reply;
let activate: () => Reply;
const calls: Record<string, unknown>[] = [];

beforeEach(() => {
  calls.length = 0;
  session.current = { access_token: 'owner-token' };
  list = { status: 200, body: { cards: [card('c-1', 'shipped')] } };
  activate = () => ({ status: 200, body: { card: card('c-1', 'active') } });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/cards');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push(body);
    const reply = body.op === 'owner.cards.list' ? list : activate();
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (verdict: Parameters<typeof TapToActivate>[0]['verdict'] = 'genuine', possession: string | null = PROOF) =>
  render(
    <MemoryRouter>
      <TapToActivate verdict={verdict} possession={possession} />
    </MemoryRouter>,
  );
const failure = (status: number, code: string): Reply => ({ status, body: { error: { code, message: 'server words' } } });
const activations = () => calls.filter((c) => c.op === 'owner.card.activate');

describe('tap to activate', () => {
  it('the owner, signed in, with the card in hand: one click activates it with the proof', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate this card' }));
    expect(await screen.findByRole('heading', { name: 'Card activated' })).toBeTruthy();
    expect(screen.getByText('Tap it again to open your Tap.')).toBeTruthy();
    // v0.18: the proof alone; the server finds the card from it.
    expect(activations()).toEqual([{ op: 'owner.card.activate', possession: PROOF }]);
    expect(screen.getByRole('link', { name: 'Your cards' }).getAttribute('href')).toBe('/shygontap/cards');
  });

  it('several cards waiting: still one request, the proof alone, never a card id', async () => {
    list = { status: 200, body: { cards: [card('c-1', 'pending'), card('c-active', 'active'), card('c-v5', 'shipped', false), card('c-2', 'shipped')] } };
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate this card' }));
    expect(await screen.findByRole('heading', { name: 'Card activated' })).toBeTruthy();
    expect(activations()).toEqual([{ op: 'owner.card.activate', possession: PROOF }]);
  });

  it('signed out: asks to sign in on this phone and tap again; nothing is sent', async () => {
    session.current = null;
    show();
    expect(await screen.findByText(/sign in to SHYGON on this phone, then tap the card again/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/shygontap/auth');
    expect(calls).toEqual([]);
  });

  it('signed in with another account: says so, offers nothing to click', async () => {
    list = { status: 200, body: { cards: [card('c-active', 'active'), card('c-retired', 'shipped', true, true)] } };
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('This card is not on the account you are signed in with.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(activations()).toEqual([]);
  });

  it("a tap of another account's card (card_not_found, the proof unused): not this account", async () => {
    activate = () => failure(404, 'card_not_found');
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate this card' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This card is not on the account you are signed in with.');
  });

  it('an expired tap says to tap again, in our words', async () => {
    activate = () => failure(410, 'proof_expired');
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Activate this card' }));
    expect((await screen.findByRole('alert')).textContent).toBe('That tap has expired. Tap the card again.');
  });

  it('a list that fails offers a retry', async () => {
    list = failure(500, 'internal');
    show();
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Please try again.');
    list = { status: 200, body: { cards: [card('c-1', 'shipped')] } };
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Activate this card' })).toBeTruthy();
  });

  it('a tap that is not genuine cannot activate: it says why and asks nothing of the server', async () => {
    show('already_checked', null);
    expect(screen.getByRole('heading', { name: "This card isn't active yet" })).toBeTruthy();
    expect(screen.getByText("We couldn't confirm this tap as new. Tap the card again to activate it.")).toBeTruthy();
    cleanup();
    show('not_verified', null);
    expect(screen.getByText('To activate it, sign in to SHYGON on your phone, then tap the card on the phone.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});
