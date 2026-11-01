import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';
import { DEFAULT_THEME, type PublicProfile } from '../../lib/database.types';

/**
 * The visitor modes a server switches on: the emergency relay
 * (`/api/emergency` §10.3) and Return to owner (`/api/rescue` §10a), and the
 * Lost page (v0.10 §6), which is only Return to owner's form. All are
 * off everywhere today, so on a real Tap they must stay hidden until their
 * `public.status` says otherwise; once shown, every send is one intent with
 * one key, and the page shows only the server's own outcome.
 */

const client = vi.hoisted(() => {
  const c = {
    fetchPublicProfile: vi.fn(),
    fetchPublicTapState: vi.fn(),
    recordTapEvent: vi.fn(),
    /** P-6 as the page sees it: a test may set `view`; otherwise the Business profile from P-1. */
    view: undefined as unknown,
    fetchPublicTap: (slug: string): Promise<unknown> =>
      c.view !== undefined
        ? Promise.resolve(c.view)
        : Promise.resolve(c.fetchPublicProfile(slug)).then((profile: unknown) => (profile ? { mode: 'business', profile } : null)),
  };
  return c;
});
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
    expect(screen.queryByRole('heading', { level: 2, name: 'Emergency Profile' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: 'Return to Owner' })).toBeNull();
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency Profile' })).toBeTruthy();
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

  it('network failure: the retry reuses the same key, so it cannot open a second conversation', async () => {
    let n = 0;
    routes['rescue:public.start'] = () => {
      n += 1;
      return n === 1
        ? { status: 0, body: null }
        : { status: 201, body: { finderToken: 'N'.repeat(43), replayed: false, thread: thread() } };
    };
    visit('/t/asha');
    fireEvent.click(await screen.findByRole('button', { name: /Message the owner/ }));
    fireEvent.change(await screen.findByLabelText('Your message'), { target: { value: 'Found your card.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByText(/could not reach SHYGON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the owner' }));
    expect(await screen.findByRole('heading', { name: 'Sent to the owner. Waiting for a reply.' })).toBeTruthy();
    const [first, second] = sent('/api/rescue', 'public.start');
    expect(first!.idempotencyKey).toBe(second!.idempotencyKey);
  });
});

describe('a Tap in Lost mode (AAROH-API v0.10 §6)', () => {
  const token = 'L'.repeat(43);
  beforeEach(() => {
    client.view = { mode: 'lost' };
    client.fetchPublicProfile.mockClear();
    client.recordTapEvent.mockClear();
    routes['rescue:public.status'] = () => ({ status: 200, body: { available: true, hint: 'Please leave it at reception' } });
  });
  afterEach(() => {
    client.view = undefined;
  });

  const thread = (over = {}) => ({
    status: 'open',
    canWrite: true,
    expiresAt: '2026-11-14T00:00:00Z',
    messages: [{ from: 'finder', body: 'Found your card at the café.', at: '2026-10-31T10:00:00Z' }],
    ...over,
  });
  const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';

  it('shows only "Found this card?" and the message form: no owner detail, no other mode, not indexed, no visitor event', async () => {
    visit('/t/asha?src=nfc&mode=emergency');
    expect(await screen.findByRole('heading', { level: 1, name: 'Found this card?' })).toBeTruthy();
    expect(screen.getByText('This card is in Lost mode. This page only lets you send a private message to its owner.')).toBeTruthy();
    expect(screen.getByText('The owner’s note: “Please leave it at reception”')).toBeTruthy();
    expect(screen.getByLabelText('Your message').getAttribute('placeholder')).toBe('Write a message (1–500 characters)');
    expect(screen.getByText('0 / 500')).toBeTruthy();
    expect(screen.getByText('The owner sees only what you write here. Do not include personal or sensitive details.')).toBeTruthy();
    expect(screen.getByText('Links are removed automatically from messages.')).toBeTruthy();
    // The one control is the form's own button; the one link is SHYGON's privacy page.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Send message']);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/shygontap/privacy-policy']);
    expect(document.body.textContent).not.toContain('Asha Rao');
    expect(document.title).toBe('Found this card? | SHYGON Tap');
    expect(robots()).toContain('noindex');
    // Return to Owner's status once; nothing of emergency, Connect, P-1 or the visitor counts.
    await waitFor(() => expect(sent('/api/rescue', 'public.status')).toEqual([{ op: 'public.status', slug: 'asha' }]));
    expect(calls.map((c) => c.url)).toEqual(['/api/rescue']);
    expect(client.fetchPublicProfile).not.toHaveBeenCalled();
    expect(client.recordTapEvent).not.toHaveBeenCalled();
  });

  it('sends one message with one key, says so in the Lost words, and keeps the link out of the address', async () => {
    let replied = false;
    routes['rescue:public.start'] = () => ({ status: 201, body: { finderToken: token, replayed: false, thread: thread() } });
    routes['rescue:finder.view'] = () => ({
      status: 200,
      body: {
        thread: thread({
          status: replied ? 'owner_replied' : 'open',
          messages: [
            { from: 'finder', body: 'Found your card at the café.', at: '2026-10-31T10:00:00Z' },
            ...(replied ? [{ from: 'owner', body: 'Thank you!', at: '2026-10-31T10:05:00Z' }] : []),
          ],
        }),
      },
    });
    visit('/t/asha');
    fireEvent.change(await screen.findByLabelText('Your message'), { target: { value: 'Found your card at the café.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('heading', { name: 'Your message has been sent.' })).toBeTruthy();
    expect(
      screen.getByText(
        'Save this private link to return and check for replies. Your access ends 14 days after the last activity. Anyone with the link can read this conversation.',
      ),
    ).toBeTruthy();
    expect(window.location.href).not.toContain(token);
    expect(window.sessionStorage.getItem('shygon.rescue.asha')).toBe(token);
    const [start] = sent('/api/rescue', 'public.start');
    expect(start).toMatchObject({ slug: 'asha', message: 'Found your card at the café.' });
    expect(String(start!.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    replied = true;
    fireEvent.click(screen.getByRole('button', { name: 'Check for a reply' }));
    expect(await screen.findByRole('heading', { name: 'There is a reply.' })).toBeTruthy();
    expect(screen.getByText('Thank you!')).toBeTruthy();
    // Never a delivery or read receipt the server did not give (GPT-6 "never use").
    expect(document.body.textContent).not.toMatch(/delivered|has read|was read|seen by/i);
  });

  it('refusals in the Lost words: too many, unavailable, and a message left empty once links were removed', async () => {
    const replies = [
      { status: 429, body: { error: { code: 'rate_limited', message: 'Limited.', retryAfter: 600 } } },
      { status: 404, body: { error: { code: 'unavailable', message: 'Not available.' } } },
      { status: 400, body: { error: { code: 'invalid_message', message: 'Invalid.' } } },
    ];
    routes['rescue:public.start'] = () => replies.shift()!;
    visit('/t/asha');
    const box = await screen.findByLabelText('Your message');
    const attempt = async (text: string) => {
      fireEvent.change(box, { target: { value: 'https://example.test' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
      expect(await screen.findByText(text)).toBeTruthy();
    };
    await attempt('You have sent too many messages. Please try again later.');
    await attempt('This service is not available right now. Please try again later.');
    await attempt('Enter a message before sending.');
    expect(screen.queryByRole('heading', { name: 'Your message has been sent.' })).toBeNull();
    // Each refusal ended that intent: three different keys.
    expect(new Set(sent('/api/rescue', 'public.start').map((b) => b.idempotencyKey)).size).toBe(3);
  });

  it('three messages without a reply: no form, and the page says why', async () => {
    window.sessionStorage.setItem('shygon.rescue.asha', token);
    routes['rescue:finder.view'] = () => ({ status: 200, body: { thread: thread({ canWrite: false }) } });
    visit('/t/asha');
    expect(
      await screen.findByText('You have sent 3 messages without a reply. You cannot send another right now. Check this link for a reply.'),
    ).toBeTruthy();
    expect(screen.queryByLabelText(/Your message|Write again/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });

  it('a saved link: expired, gone or blocked, or closed, each in its own words', async () => {
    window.sessionStorage.setItem('shygon.rescue.asha', token);
    routes['rescue:finder.view'] = () => ({ status: 410, body: { error: { code: 'thread_expired', message: 'Expired.' } } });
    visit('/t/asha');
    expect(await screen.findByText('Your access to this conversation has expired. This link can no longer be used.')).toBeTruthy();
    expect(window.sessionStorage.getItem('shygon.rescue.asha')).toBeNull();
    expect(screen.getByLabelText('Your message')).toBeTruthy();
    cleanup();

    window.sessionStorage.setItem('shygon.rescue.asha', token);
    routes['rescue:finder.view'] = () => ({ status: 404, body: { error: { code: 'thread_not_found', message: 'Not found.' } } });
    visit('/t/asha');
    expect(await screen.findByText('This conversation is not available.')).toBeTruthy();
    cleanup();

    window.sessionStorage.setItem('shygon.rescue.asha', token);
    routes['rescue:finder.view'] = () => ({ status: 200, body: { thread: thread({ status: 'closed', canWrite: false }) } });
    visit('/t/asha');
    // The finder cannot tell whether the owner closed it or it went quiet, so the page does not say.
    expect(await screen.findByRole('heading', { name: 'This conversation is closed.' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/30 days/);
  });

  it('Return to Owner cannot take a message: the neutral "Tap not found"; no answer: a retry, never "not found"', async () => {
    routes['rescue:public.status'] = () => ({ status: 200, body: { available: false, hint: null } });
    visit('/t/asha');
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    expect(screen.queryByText('Found this card?')).toBeNull();
    expect(document.title).toBe('Tap unavailable | SHYGON Tap');
    expect(client.fetchPublicTapState).not.toHaveBeenCalled();
    cleanup();

    routes['rescue:public.status'] = () => ({ status: 500, body: {} });
    visit('/t/asha');
    expect(await screen.findByText("We couldn't load this Tap")).toBeTruthy();
    expect(screen.queryByText('Tap not found')).toBeNull();
    routes['rescue:public.status'] = () => ({ status: 200, body: { available: true, hint: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Found this card?' })).toBeTruthy();
  });
});
