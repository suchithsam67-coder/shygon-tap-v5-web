import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import Connections from './Connections';
import ConnectRequest from './ConnectRequest';
import { DEFAULT_THEME } from '../lib/database.types';

/** SHYGON Connect pages against AAROH-API v0.4 §10b response shapes, with the network replaced at `fetch`. */

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'me' } } }) } },
}));
vi.mock('../components/app/AppShell', () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock('../lib/publicTapClient', () => ({
  fetchPublicProfile: async (slug: string) =>
    slug === 'asha' ? { slug, displayName: 'Asha Rao', experience: 'business', customLinks: [], theme: DEFAULT_THEME, activeEvent: null } : null,
}));

type Reply = { status: number; body: unknown };
let handler: (op: string, body: Record<string, unknown>) => Reply;
const calls: Record<string, unknown>[] = [];

const settings = { enabled: true, publicTapPublished: true, pendingIncoming: 1, connections: 1, shareableFields: ['phone', 'email', 'company', 'job_title'] };
const conn = (over = {}) => ({
  id: 'k1',
  direction: 'incoming',
  status: 'requested',
  note: 'We met at the expo',
  createdAt: '2026-10-19T10:00:00Z',
  decidedAt: null,
  endedAt: null,
  other: { name: 'Ravi Kumar', tapSlug: 'ravi' },
  iShare: [],
  theyShare: { email: { value: 'ravi@example.test', provenance: 'self_reported' } },
  ...over,
});
const base = (op: string): Reply =>
  op === 'settings.get'
    ? { status: 200, body: { settings } }
    : op === 'connections.list'
      ? { status: 200, body: { connections: [conn(), conn({ id: 'k2', status: 'accepted', direction: 'outgoing', other: { name: 'Meera', tapSlug: null }, iShare: ['email'], theyShare: { phone: { value: '+91 98000 00002', provenance: 'self_reported' } } })] } }
      : op === 'consents.list'
        ? { status: 200, body: { consents: [] } }
        : { status: 500, body: { error: { code: 'unexpected', message: `unexpected ${op}` } } };

beforeEach(() => {
  calls.length = 0;
  handler = (op) => base(op);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/connect');
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const reply = handler(body.op, body);
    if (reply.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ask = (slug = 'asha') =>
  render(
    <MemoryRouter initialEntries={[`/shygontap/connect/${slug}`]}>
      <Routes>
        <Route path="/shygontap/connect/:slug" element={<ConnectRequest />} />
      </Routes>
    </MemoryRouter>,
  );
const inbox = () =>
  render(
    <MemoryRouter>
      <Connections />
    </MemoryRouter>,
  );

describe('asking to connect', () => {
  it('sends exactly the chosen fields, once, and says what the owner can see', async () => {
    handler = (op, body) =>
      op === 'requests.create'
        ? { status: 201, body: { connection: conn({ direction: 'outgoing', other: { name: 'Asha Rao', tapSlug: 'asha' }, iShare: body.share, theyShare: {} }), replayed: false } }
        : base(op);
    ask();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect with Asha Rao' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Email'));
    fireEvent.click(screen.getByLabelText('Company'));
    expect(screen.getByText(/cannot be un-shared/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeTruthy();
    expect(screen.getByText(/they can see only what you chose: Email, Company/)).toBeTruthy();
    const [req] = calls.filter((c) => c.op === 'requests.create');
    expect(req).toMatchObject({ slug: 'asha', share: ['email', 'company'] });
    expect(String(req!.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('a network failure keeps the same key for the retry; a refusal is explained in plain words', async () => {
    let n = 0;
    handler = (op) => {
      if (op !== 'requests.create') return base(op);
      n += 1;
      return n === 1
        ? { status: 0, body: null }
        : { status: 429, body: { error: { code: 'recently_declined', message: 'Declined recently.', retryAfter: 86400 * 20 } } };
    };
    ask();
    await screen.findByRole('heading', { level: 1, name: 'Connect with Asha Rao' });
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText(/could not reach SHYGON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Send request/ }));
    expect(await screen.findByText('Asha Rao declined a recent request. You can ask again after 20 days.')).toBeTruthy();
    const keys = calls.filter((c) => c.op === 'requests.create').map((c) => c.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(screen.queryByRole('heading', { name: 'Request sent' })).toBeNull();
  });

  it('a Tap that is not published cannot be asked', async () => {
    ask('nobody');
    expect(await screen.findByText('This Tap is not available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send request/ })).toBeNull();
  });
});

describe('the connections page', () => {
  it('marks every shared value self-reported, and accepts sharing exactly what was ticked', async () => {
    handler = (op) => (op === 'requests.accept' ? { status: 200, body: { connection: conn({ status: 'accepted' }) } } : base(op));
    inbox();
    expect(await screen.findByText('ravi@example.test')).toBeTruthy();
    expect(screen.getAllByText('Self-reported').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('“We met at the expo”')).toBeTruthy();
    const request = screen.getByText('Ravi Kumar').closest('div')!.parentElement as HTMLElement;
    fireEvent.click(within(request).getByLabelText('Mobile number'));
    fireEvent.click(within(request).getByRole('button', { name: 'Accept and share' }));
    await waitFor(() => expect(calls.filter((c) => c.op === 'requests.accept')).toEqual([{ op: 'requests.accept', connectionId: 'k1', share: ['phone'] }]));
  });

  it('removing says already-copied details cannot be un-shared, and asks first', async () => {
    handler = (op) => (op === 'connections.remove' ? { status: 200, body: { removed: true, grantsRevoked: 2, connection: conn({ status: 'removed' }) } } : base(op));
    inbox();
    await screen.findByText('Meera');
    const card = screen.getByText('Meera').closest('div')!.parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Details they already copied or saved cannot be un-shared/)).toBeTruthy();
    expect(calls.filter((c) => c.op === 'connections.remove')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.filter((c) => c.op === 'connections.remove')).toEqual([{ op: 'connections.remove', connectionId: 'k2' }]));
  });

  it('blocking asks first and tells the owner the requester will see "declined"', async () => {
    handler = (op) => (op === 'requests.block' ? { status: 200, body: { connection: conn({ status: 'blocked' }) } } : base(op));
    inbox();
    await screen.findByText('Ravi Kumar');
    fireEvent.click(screen.getByRole('button', { name: 'Block' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/will see your answer as declined/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Block' }));
    await waitFor(() => expect(calls.filter((c) => c.op === 'requests.block')).toHaveLength(1));
  });

  it('unauthorised: a refused session is shown, not an empty list', async () => {
    handler = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Your session has expired. Sign in again.' } } });
    inbox();
    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeTruthy();
    expect(screen.queryByText('No connections yet.')).toBeNull();
  });

  it('expired: a request nobody answered in 30 days is listed as expired, with nothing shared', async () => {
    handler = (op) =>
      op === 'connections.list'
        ? { status: 200, body: { connections: [conn({ id: 'k9', status: 'expired', endedAt: '2026-10-19T10:00:00Z', theyShare: {} })] } }
        : base(op);
    inbox();
    fireEvent.click(await screen.findByText(/Ended \(1\)/));
    expect(screen.getByText(/Ravi Kumar · Expired/)).toBeTruthy();
    expect(screen.queryByText('ravi@example.test')).toBeNull();
  });
});
