import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CardRow } from '../lib/database.types';
import Cards, { OtpDialog } from './Cards';

/**
 * The card code dialog against card-otp's phone refusals (AAROH-API v0.13,
 * DEC-2026-045): a code goes only to a verified number, and a number that
 * replaced a verified one waits 24 hours. And the card page against v0.15
 * (DEC-2026-047): a card with a chip is activated only by tapping it, and any
 * card can be reported stolen. The network is replaced at `fetch`.
 */

const rows = vi.hoisted(() => ({ list: [] as Record<string, unknown>[] }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: rows.list, error: null }) }) }) }),
  },
  describeError: (error: unknown) => String(error),
}));
vi.mock('../components/app/AppShell', () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('../lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u-1' } }) }));
vi.mock('../lib/account-context', () => ({ useAccount: () => ({ profile: { phone: null } }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../components/app/toast-context', () => ({ useToast: () => toast }));

let reply: { status: number; body: unknown };
/** /api/cards answers by op; every request kept. */
let cardsReply: (op: string) => { status: number; body: unknown };
const cardsCalls: Record<string, unknown>[] = [];
beforeEach(() => {
  cardsCalls.length = 0;
  toast.success.mockClear();
  toast.error.mockClear();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    let answer: { status: number; body: unknown };
    if (url === '/api/cards') {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      cardsCalls.push(body);
      answer = cardsReply(String(body.op));
    } else {
      expect(url).toBe('/api/card-otp');
      answer = reply;
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
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

// ---------------------------------------------------------------- v0.15
const V5 = { id: 'c-v5', card_uid: 'V5CARD', status: 'active', activation_expires_at: '2026-11-28T00:00:00Z', created_at: '2026-11-01T00:00:00Z' };
const CHIP = { id: 'c-chip', card_uid: 'CHIPCARD', status: 'shipped', created_at: '2026-11-02T00:00:00Z' };
const server = (id: string, status: string, registered: boolean) => ({
  id, cardId: null, nickname: null, status, edition: null, activatedAt: null, deactivatedAt: null,
  verifiedTap: { registered, retired: false },
});
const listOk = (op: string) =>
  op === 'owner.cards.list'
    ? { status: 200, body: { cards: [server('c-v5', 'active', false), server('c-chip', 'shipped', true)] } }
    : op === 'owner.card.retire'
      ? { status: 200, body: { card: server('c-chip', 'retired', true) } }
      : { status: 500, body: { error: { code: 'internal', message: 'unexpected' } } };

const showPage = () =>
  render(
    <MemoryRouter>
      <Cards />
    </MemoryRouter>,
  );
const rowOf = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement;

describe('the card page and v0.15 (DEC-2026-047)', () => {
  beforeEach(() => {
    rows.list = [V5, CHIP];
    cardsReply = listOk;
  });

  it('a card with a chip gets no code buttons, and says to tap it; a card without one keeps them; both can be reported stolen', async () => {
    showPage();
    const v5 = await rowOf('Card V5CARD');
    expect(within(v5).getByRole('button', { name: 'Renew activation' })).toBeTruthy();
    expect(within(v5).getByRole('button', { name: 'Deactivate' })).toBeTruthy();
    expect(within(v5).getByRole('button', { name: 'Report stolen' })).toBeTruthy();
    expect(within(v5).queryByText('Secure chip')).toBeNull();

    const chip = await rowOf('Card CHIPCARD');
    expect(within(chip).getByText('Secure chip')).toBeTruthy();
    expect(within(chip).getByText('To activate it, sign in to SHYGON on your phone, then tap the card on the phone.')).toBeTruthy();
    expect(within(chip).queryByRole('button', { name: /Activate|Renew activation|Deactivate/ })).toBeNull();
    expect(within(chip).getByRole('button', { name: 'Report stolen' })).toBeTruthy();
    expect(cardsCalls).toEqual([{ op: 'owner.cards.list' }]);
  });

  it('report stolen asks first and says what it does; only then is the card switched off', async () => {
    showPage();
    fireEvent.click(within(await rowOf('Card CHIPCARD')).getByRole('button', { name: 'Report stolen' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Report this card stolen?' });
    expect(dialog.textContent).toContain('tapping it will open nothing');
    expect(cardsCalls.filter((c) => c.op === 'owner.card.retire')).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch it off for good' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Card switched off', 'Tapping it now opens nothing.'));
    expect(cardsCalls).toContainEqual({ op: 'owner.card.retire', cardId: 'c-chip', confirm: true });
    // The list is read again, so the card shows as it now is.
    await waitFor(() => expect(cardsCalls.filter((c) => c.op === 'owner.cards.list')).toHaveLength(2));
  });

  it('a card without a chip: the warning says plainly that it keeps opening the Tap (F3)', async () => {
    showPage();
    fireEvent.click(within(await rowOf('Card V5CARD')).getByRole('button', { name: 'Report stolen' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Report this card stolen?' });
    expect(dialog.textContent).toContain('This card has no secure chip, so tapping it will still open your Tap');
    expect(dialog.textContent).toContain('pause it in Settings');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(cardsCalls.filter((c) => c.op === 'owner.card.retire')).toHaveLength(0);
  });

  it('a refused switch-off says so in our words and keeps the card as it was', async () => {
    cardsReply = (op) => (op === 'owner.card.retire' ? { status: 500, body: { error: { code: 'internal', message: 'server words' } } } : listOk(op));
    showPage();
    fireEvent.click(within(await rowOf('Card CHIPCARD')).getByRole('button', { name: 'Report stolen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch it off for good' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not switch the card off', 'Something went wrong. Please try again.'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it("without the server's list there are no card buttons at all, only a retry", async () => {
    cardsReply = () => ({ status: 500, body: { error: { code: 'internal', message: 'server words' } } });
    showPage();
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Activate|Renew activation|Deactivate|Report stolen/ })).toBeNull();
  });

  it('a reported card says what happened; the footnote never claims a card without a chip stops opening the Tap', async () => {
    rows.list = [{ ...CHIP, status: 'retired', deactivated_at: '2026-11-14T10:00:00Z' }, { ...V5, status: 'retired', deactivated_at: '2026-11-14T10:00:00Z' }];
    cardsReply = (op) =>
      op === 'owner.cards.list'
        ? { status: 200, body: { cards: [server('c-v5', 'retired', false), server('c-chip', 'retired', true)] } }
        : listOk(op);
    showPage();
    const chip = await rowOf('Card CHIPCARD');
    expect(within(chip).getByText('Switched off')).toBeTruthy();
    expect(within(chip).getByText(/^Reported stolen on .*\. It opens nothing\. Contact SHYGON support for a replacement\.$/)).toBeTruthy();
    expect(within(chip).queryByRole('button')).toBeNull();
    const v5 = await rowOf('Card V5CARD');
    expect(within(v5).getByText(/It has no secure chip, so tapping it still opens your Tap\.$/)).toBeTruthy();
    const footnote = screen.getByTestId('cards-footnote').textContent ?? '';
    expect(footnote).not.toMatch(/stop opening your Tap/);
    expect(footnote).toContain('A card with a secure chip then opens nothing.');
    expect(footnote).toContain("A card without one keeps opening your Tap's address");
  });
});
