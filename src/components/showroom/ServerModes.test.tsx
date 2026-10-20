import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { DEFAULT_THEME, type PublicProfile } from '../../lib/database.types';

/**
 * The visitor modes a server switches on: the emergency relay
 * (`/api/emergency` §10.3) and Return to owner (`/api/rescue` §10a). Both are
 * off everywhere today, so on a real Tap they must stay hidden until their
 * `public.status` says otherwise; once shown, every send is one intent with
 * one key, and the page shows only the server's own outcome.
 */

const client = vi.hoisted(() => ({
  fetchPublicProfile: vi.fn(),
  fetchPublicTapState: vi.fn(),
  recordTapEvent: vi.fn(),
}));
vi.mock('../../lib/publicTapClient', () => client);

const profile: PublicProfile = {
  slug: 'asha',
  experience: 'business',
  displayName: 'Asha Rao',
  headline: null,
  designation: null,
  company: null,
  bio: null,
  avatarUrl: null,
  location: null,
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  instagram: null,
  linkedin: null,
  youtube: null,
  customLinks: [],
  theme: { ...DEFAULT_THEME, animation: 'none' },
  activeEvent: null,
};

type Reply = { status: number; body: unknown };
let routes: Record<string, (body: Record<string, unknown>) => Reply>;
const calls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  client.fetchPublicProfile.mockResolvedValue(profile);
  client.recordTapEvent.mockResolvedValue(undefined);
  calls.length = 0;
  routes = {
    'emergency:public.status': () => ({ status: 200, body: { available: false } }),
    'rescue:public.status': () => ({ status: 200, body: { available: false, hint: null } }),
  };
  window.sessionStorage.clear();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const key = `${url.replace('/api/', '')}:${body.op}`;
    const reply = routes[key]?.(body) ?? { status: 404, body: { error: { code: 'unavailable', message: 'Not available.' } } };
    if (reply.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const visit = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
const sent = (url: string, op: string) => calls.filter((c) => c.url === url && c.body.op === op).map((c) => c.body);

describe('switched off (today, everywhere)', () => {
  it('asks each server once, after the profile, and shows neither mode', async () => {
    visit('/t/asha');
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
    await waitFor(() => expect(sent('/api/emergency', 'public.status')).toEqual([{ op: 'public.status', slug: 'asha' }]));
    expect(sent('/api/rescue', 'public.status')).toEqual([{ op: 'public.status', slug: 'asha' }]);
    expect(sent('/api/connect', 'public.status')).toEqual([{ op: 'public.status', slug: 'asha' }]);
    expect(screen.queryByRole('heading', { level: 2, name: 'Emergency' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Return to owner' })).toBeNull();
  });

  it('a server that cannot be reached reads as "not available", and the profile still shows', async () => {
    routes['emergency:public.status'] = () => ({ status: 0, body: null });
    routes['rescue:public.status'] = () => ({ status: 500, body: {} });
    visit('/t/asha?mode=emergency');
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
    // One status call each: emergency, Return to owner, Connect.
    await waitFor(() => expect(calls.map((c) => c.url).sort()).toEqual(['/api/connect', '/api/emergency', '/api/rescue']));
    expect(screen.queryByText(/alert/i)).toBeNull();
  });
});

describe('the emergency relay, when the server says it is available', () => {
  beforeEach(() => {
    routes['emergency:public.status'] = () => ({ status: 200, body: { available: true } });
  });

  async function open() {
    visit('/t/asha');
    fireEvent.click(await screen.findByRole('button', { name: /Alert their contacts/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency' })).toBeTruthy();
  }

  it('asks for intent first, sends once, and shows the server’s outcome and safety line; never a contact', async () => {
    routes['emergency:public.alert'] = () => ({
      status: 202,
      body: { outcome: 'not_sent', safety: 'SHYGON cannot confirm emergencies. If someone is in danger, call 112.' },
    });
    await open();
    expect(screen.getByRole('link', { name: /Call 112/ }).getAttribute('href')).toBe('tel:112');
    const send = screen.getByRole('button', { name: 'Send the alert' });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText(/I understand this alerts Asha Rao’s emergency contacts/));
    fireEvent.click(send);
    expect(await screen.findByRole('heading', { name: 'Nothing was sent' })).toBeTruthy();
    expect(screen.getByTestId('alert-safety').textContent).toContain('call 112');
    // One press, one request, and no way to press again.
    expect(sent('/api/emergency', 'public.alert')).toHaveLength(1);
    expect(sent('/api/emergency', 'public.alert')[0]).toMatchObject({ slug: 'asha', confirm: true });
    expect(screen.queryByRole('button', { name: 'Send the alert' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/emergency services (were|have been)|police (were|have been)/i);
  });

  it('"sent" is accepted by the provider, never "delivered"', async () => {
    routes['emergency:public.alert'] = () => ({ status: 202, body: { outcome: 'sent', safety: 'Safety line.' } });
    await open();
    fireEvent.click(screen.getByLabelText(/I understand/));
    fireEvent.click(screen.getByRole('button', { name: 'Send the alert' }));
    expect(await screen.findByRole('heading', { name: 'Alert handed to the text-message provider' })).toBeTruthy();
    expect(screen.getByText(/cannot confirm it has been delivered/)).toBeTruthy();
    expect(screen.queryByText(/^Delivered/)).toBeNull();
  });

  it('network failure: "Try again" reuses the same key; a rate limit says how long to wait', async () => {
    let n = 0;
    routes['emergency:public.alert'] = () => {
      n += 1;
      return n === 1 ? { status: 0, body: null } : { status: 429, body: { error: { code: 'alert_rate_limited', message: 'Limited.', retryAfter: 900 } } };
    };
    await open();
    fireEvent.click(screen.getByLabelText(/I understand/));
    fireEvent.click(screen.getByRole('button', { name: 'Send the alert' }));
    expect(await screen.findByText(/could not reach SHYGON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Try again in about 15 minutes, or call 112/)).toBeTruthy();
    const [first, second] = sent('/api/emergency', 'public.alert');
    expect(first!.idempotencyKey).toBe(second!.idempotencyKey);
  });
});

describe('Return to owner, when the server says it is available', () => {
  beforeEach(() => {
    routes['rescue:public.status'] = () => ({ status: 200, body: { available: true, hint: 'A reward is offered' } });
  });

  const thread = (over = {}) => ({
    status: 'open',
    canWrite: true,
    expiresAt: '2026-11-02T00:00:00Z',
    messages: [{ from: 'finder', body: 'Found your card near the station.', at: '2026-10-19T10:00:00Z' }],
    ...over,
  });

  it('starts a protected conversation: the token stays out of the address, and the finder sees no owner detail', async () => {
    const token = 'T'.repeat(43);
    routes['rescue:public.start'] = () => ({ status: 201, body: { finderToken: token, replayed: false, thread: thread() } });
    visit('/t/asha');
    fireEvent.click(await screen.findByRole('button', { name: /Message the owner/ }));
    expect(await screen.findByText('The owner’s note: “A reward is offered”')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Found your card near the station.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByRole('heading', { name: 'Sent to the owner. Waiting for a reply.' })).toBeTruthy();
    expect(window.location.href).not.toContain(token);
    expect(window.sessionStorage.getItem('shygon.rescue.asha')).toBe(token);
    const [start] = sent('/api/rescue', 'public.start');
    expect(start).toMatchObject({ slug: 'asha', message: 'Found your card near the station.' });
    expect(String(start!.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('three messages without a reply: the server says wait, and the page says so', async () => {
    window.sessionStorage.setItem('shygon.rescue.asha', 'K'.repeat(43));
    routes['rescue:finder.view'] = () => ({ status: 200, body: { thread: thread() } });
    routes['rescue:finder.post'] = () => ({ status: 409, body: { error: { code: 'awaiting_owner', message: 'Waiting.' } } });
    visit('/t/asha?mode=return');
    expect(await screen.findByText('Found your card near the station.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Write again'), { target: { value: 'Still here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByText('Wait for the owner to reply before writing again.')).toBeTruthy();
    // Not shown as sent: the message is still in the box.
    expect((screen.getByLabelText('Write again') as HTMLTextAreaElement).value).toBe('Still here.');
  });

  it('an expired conversation is forgotten and a new one can be started', async () => {
    window.sessionStorage.setItem('shygon.rescue.asha', 'X'.repeat(43));
    routes['rescue:finder.view'] = () => ({ status: 410, body: { error: { code: 'thread_expired', message: 'Expired.' } } });
    visit('/t/asha?mode=return');
    expect(await screen.findByText(/That earlier conversation is no longer available/)).toBeTruthy();
    expect(window.sessionStorage.getItem('shygon.rescue.asha')).toBeNull();
    expect(screen.getByLabelText('Your message')).toBeTruthy();
  });
});
