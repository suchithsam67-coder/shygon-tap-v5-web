import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DataExport } from './DataExport';

/** "Download your data" against AAROH-API v0.12 §4a, with the network replaced at `fetch` and the file save captured. */

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
}));
const saved = vi.hoisted(() => [] as { name: string; text: string; type: string }[]);
vi.mock('../../services/privacy', () => ({
  downloadFile: (name: string, text: string, type: string) => saved.push({ name, text, type }),
}));

type Reply = { status: number; body: unknown };
let reply: Reply;
const sent: { url: string; init: RequestInit }[] = [];

const EXPORT = {
  format: 'shygon-account-export/2',
  exportedAt: '2026-11-10T10:00:00Z',
  accountId: 'u-1',
  account: { profile: { full_name: 'Asha Rao' } },
  truncated: [],
  excluded: [
    { what: 'Messages written by people who found your card', why: "They are the finder's own words." },
    { what: 'Codes, keys and security values', why: 'Card activation codes protect your card.' },
  ],
};
const VCARD = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Asha Rao\r\nEND:VCARD\r\n';

beforeEach(() => {
  saved.length = 0;
  sent.length = 0;
  reply = { status: 200, body: { export: EXPORT, vcard: VCARD } };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (reply.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const click = () => {
  render(<DataExport />);
  fireEvent.click(screen.getByRole('button', { name: 'Download your data' }));
};

describe('download your data', () => {
  it('asks the server once, with the session; saves the JSON at once and says what is left out, in its words', async () => {
    click();
    expect(await screen.findByText('Your data is downloading: a JSON file with everything your account holds.')).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/account');
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ op: 'owner.export' });
    expect((sent[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer owner-token');
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toMatch(/^shygon-account-\d{4}-\d{2}-\d{2}\.json$/);
    expect(saved[0]!.type).toBe('application/json');
    expect(JSON.parse(saved[0]!.text)).toEqual(EXPORT);
    expect(screen.getByText('What the file leaves out, and why')).toBeTruthy();
    expect(screen.getByText('Messages written by people who found your card.')).toBeTruthy();
    expect(screen.getByText('Card activation codes protect your card.')).toBeTruthy();
  });

  it('the contact card is its own click (browsers hold back a second automatic download)', async () => {
    click();
    fireEvent.click(await screen.findByRole('button', { name: 'Save your Business profile as a contact card (.vcf)' }));
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatchObject({ text: VCARD, type: 'text/vcard' });
    expect(saved[1]!.name).toMatch(/^shygon-tap-\d{4}-\d{2}-\d{2}\.vcf$/);
  });

  it('no Tap, no card: the JSON only; a cut list is named', async () => {
    reply = { status: 200, body: { export: { ...EXPORT, truncated: ['notifications'] }, vcard: null } };
    click();
    expect(await screen.findByText('Some long lists were cut to their newest 2,000 entries: notifications.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /contact card/ })).toBeNull();
    expect(saved).toHaveLength(1);
  });

  it('the daily limit is told calmly, with the wait; nothing is saved', async () => {
    reply = { status: 429, body: { error: { code: 'rate_limited', message: 'Later.', retryAfter: 3 * 3600 } } };
    click();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'You have downloaded your data several times today. You can download it again in about 3 hours.',
    );
    expect(saved).toHaveLength(0);
    cleanup();
    reply = { status: 429, body: { error: { code: 'rate_limited', message: 'Later.', retryAfter: 600 } } };
    click();
    expect((await screen.findByRole('alert')).textContent).toMatch(/about 10 minutes\.$/);
  });

  it('a lapsed session and no connection say so; a server failure never shows its own text', async () => {
    reply = { status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in.' } } };
    click();
    expect((await screen.findByRole('alert')).textContent).toBe('Your session has expired. Sign in again.');
    cleanup();
    reply = { status: 0, body: null };
    click();
    expect((await screen.findByRole('alert')).textContent).toBe('We could not reach SHYGON. Try again.');
    cleanup();
    reply = { status: 500, body: { error: { code: 'internal', message: 'stack trace here' } } };
    click();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('We could not prepare your data. Please try again.'));
    expect(saved).toHaveLength(0);
  });
});
