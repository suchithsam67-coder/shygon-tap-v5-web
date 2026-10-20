import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import EmergencySettings from './EmergencySettings';

/**
 * The owner's emergency page against AAROH-API v0.1 §10 response shapes,
 * with the network replaced at `fetch`. What the server itself does (RLS,
 * limits, idempotency, provider states) is proven by Session A's
 * `npm run test:emergency`; this proves the page shows only what the server
 * confirmed, in words that never upgrade it, and sends each intent once.
 */

const session = vi.hoisted(() => ({ token: 'owner-session-token' as string | null }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: session.token ? { access_token: session.token } : null } }) },
  },
}));
vi.mock('../components/app/AppShell', () => ({
  AppShell: ({ title, children }: { title: string; children: ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

type Reply = { status: number; body: unknown };
let handler: (op: string, body: Record<string, unknown>) => Reply | Promise<Reply>;
const calls: Record<string, unknown>[] = [];

const settings = (over = {}) => ({
  publicAlertsEnabled: false,
  publicAlertsChangedAt: null,
  contacts: 1,
  verifiedContacts: 1,
  maxContacts: 5,
  publicTapPublished: true,
  providerConfigured: false,
  ...over,
});
const contact = (over = {}) => ({
  id: 'c1',
  name: 'Ravi',
  relationship: 'Brother',
  phone: '+91 ••••• 00001',
  channel: 'sms',
  verified: true,
  verifiedAt: '2026-10-19T08:00:00Z',
  createdAt: '2026-10-19T08:00:00Z',
  updatedAt: '2026-10-19T08:00:00Z',
  ...over,
});
const event = (status: string, recipientStatus: string, over = {}) => ({
  id: 'e1',
  initiator: 'owner',
  status,
  createdAt: '2026-10-19T09:00:00Z',
  updatedAt: '2026-10-19T09:00:00Z',
  completedAt: null,
  cancelledAt: null,
  reportedAt: null,
  deliveryReceipts: 'not_supported',
  providerConfigured: status !== 'not_sent',
  recipients: [{ id: 'r1', name: 'Ravi', phone: '••••• 0001', channel: 'sms', status: recipientStatus, attempts: 1, provider: null, acceptedAt: null, deliveredAt: null, failedAt: null, nextAttemptAt: null, lastError: null }],
  ...over,
});
const SAFETY = 'SHYGON does not contact emergency services. If someone is in danger, call 112.';

function base(op: string): Reply | null {
  if (op === 'contacts.list') return { status: 200, body: { contacts: [contact()], settings: settings() } };
  if (op === 'alerts.list') return { status: 200, body: { events: [] } };
  return null;
}

beforeEach(() => {
  session.token = 'owner-session-token';
  calls.length = 0;
  handler = (op) => base(op) ?? { status: 500, body: { error: { code: 'unexpected', message: `unexpected ${op}` } } };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/emergency');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${session.token}`);
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const reply = await handler(body.op, body);
    if (reply.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <MemoryRouter>
      <EmergencySettings />
    </MemoryRouter>,
  );
const opsCalled = (op: string) => calls.filter((c) => c.op === op);

describe('emergency contacts', () => {
  it('shows the server’s contacts, masked, and says plainly when no text-message provider is set up', async () => {
    show();
    expect(await screen.findByText('Ravi')).toBeTruthy();
    expect(screen.getByText('+91 ••••• 00001')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Text messages are not set up yet' })).toBeTruthy();
    // Nothing about contacts is kept in the browser.
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain('Ravi');
  });

  it('invalid input: the server’s refusal is shown on the field and nothing is added', async () => {
    handler = (op) =>
      op === 'contacts.save'
        ? { status: 400, body: { error: { code: 'invalid_phone', message: 'Enter a valid mobile number.' } } }
        : base(op)!;
    show();
    await screen.findByText('Ravi');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText('Enter a valid mobile number.')).toBeTruthy();
    expect(screen.getByLabelText(/^Mobile number/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText('Meera')).toBeNull();
    expect(opsCalled('contacts.list')).toHaveLength(1);
  });

  it('a saved contact appears from the server’s re-read, unverified until the server says otherwise', async () => {
    let saved = false;
    handler = (op) => {
      if (op === 'contacts.save') {
        saved = true;
        return { status: 201, body: { contact: contact({ id: 'c2', name: 'Meera', verified: false }), publicAlertsDisabled: false } };
      }
      if (op === 'contacts.list' && saved)
        return { status: 200, body: { contacts: [contact(), contact({ id: 'c2', name: 'Meera', verified: false, phone: '+91 ••••• 00002' })], settings: settings({ contacts: 2 }) } };
      return base(op)!;
    };
    show();
    await screen.findByText('Ravi');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText(/^Mobile number/), { target: { value: '+919800000002' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    const row = (await screen.findAllByText('Meera')).map((el) => el.closest('li')).find(Boolean)!;
    expect(within(row).getByText('Not verified')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Verify number' })).toBeTruthy();
    expect(opsCalled('contacts.save')[0]).toMatchObject({ name: 'Meera', phone: '+919800000002', relationship: null });
  });

  it('provider failure: asking for a verification code says nothing can be sent', async () => {
    handler = (op) =>
      op === 'contacts.verify.request'
        ? { status: 503, body: { error: { code: 'provider_not_configured', message: 'No provider.' } } }
        : op === 'contacts.list'
          ? { status: 200, body: { contacts: [contact({ verified: false })], settings: settings({ verifiedContacts: 0 }) } }
          : base(op)!;
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify number' }));
    expect(await screen.findByText(/Text messages are not set up for SHYGON yet, so nothing can be sent/)).toBeTruthy();
    expect(screen.queryByLabelText(/Code sent to/)).toBeNull();
  });
});

describe('alerting contacts', () => {
  async function openAndSend() {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Alert my emergency contacts/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/SHYGON does not contact emergency services/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send the alert' }));
  }

  it('cannot be started without a verified contact', async () => {
    handler = (op) =>
      op === 'contacts.list' ? { status: 200, body: { contacts: [], settings: settings({ contacts: 0, verifiedContacts: 0 }) } } : base(op)!;
    show();
    expect(await screen.findByRole('button', { name: /Alert my emergency contacts/ })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Only verified contacts are ever alerted/)).toBeTruthy();
  });

  it('no provider: the server says nothing was sent, and so does the page, with the safety line', async () => {
    handler = (op) =>
      op === 'alerts.create' ? { status: 201, body: { event: event('not_sent', 'not_sent'), replayed: false, safety: SAFETY } } : base(op)!;
    await openAndSend();
    const card = await screen.findByTestId('emergency-event');
    expect(within(card).getByText('Text messages are not set up. Nothing was sent.')).toBeTruthy();
    expect(within(card).getByText(/· Not sent/)).toBeTruthy();
    expect(within(card).getByText(SAFETY)).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Try sending again' })).toBeTruthy();
    expect(card.textContent).not.toMatch(/Delivered|emergency services (were|have been) (called|contacted)/);
  });

  it('a provider refusal is final: no retry button, and the page says to check the number', async () => {
    const refusedEvent = event('failed', 'failed');
    refusedEvent.recipients[0] = { ...refusedEvent.recipients[0]!, lastError: '21211' } as never;
    handler = (op) => (op === 'alerts.create' ? { status: 201, body: { event: refusedEvent, replayed: false, safety: SAFETY } } : base(op)!);
    await openAndSend();
    const card = await screen.findByTestId('emergency-event');
    expect(within(card).getByText('Could not be sent.')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Try sending again' })).toBeNull();
    expect(within(card).getByText(/is not sent again automatically. Check that contact’s number/)).toBeTruthy();
  });

  it('accepted is not delivered: "sent" reads as delivery not confirmed', async () => {
    handler = (op) =>
      op === 'alerts.create' ? { status: 201, body: { event: event('sent', 'accepted'), replayed: false, safety: SAFETY } } : base(op)!;
    await openAndSend();
    const card = await screen.findByTestId('emergency-event');
    expect(within(card).getByText('Sent to 1 contact. Delivery not confirmed.')).toBeTruthy();
    expect(within(card).getByText(/accepted by the text-message provider; delivery not confirmed/)).toBeTruthy();
    expect(within(card).getByText(/does not send delivery receipts/)).toBeTruthy();
    expect(within(card).queryByText(/^Delivered/)).toBeNull();
  });

  it('network failure, then retry: the same idempotency key is reused, so the alert cannot go out twice', async () => {
    let attempt = 0;
    handler = (op) => {
      if (op !== 'alerts.create') return base(op)!;
      attempt += 1;
      return attempt === 1 ? { status: 0, body: null } : { status: 201, body: { event: event('sending', 'sending'), replayed: false, safety: SAFETY } };
    };
    await openAndSend();
    // The confirmation closes so the failure is visible, with a retry of the same intent.
    expect(await screen.findByText(/could not reach SHYGON/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('emergency-event')).toBeTruthy();
    const keys = opsCalled('alerts.create').map((c) => c.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(String(keys[0])).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  it('a second, separate press is a new intent with a new key', async () => {
    handler = (op) =>
      op === 'alerts.create' ? { status: 201, body: { event: event('sent', 'accepted'), replayed: false, safety: SAFETY } } : base(op)!;
    await openAndSend();
    await screen.findByTestId('emergency-event');
    fireEvent.click(screen.getByRole('button', { name: /Alert my emergency contacts/ }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send the alert' }));
    await waitFor(() => expect(opsCalled('alerts.create')).toHaveLength(2));
    const [a, b] = opsCalled('alerts.create').map((c) => c.idempotencyKey);
    expect(a).not.toBe(b);
  });

  it('an alert already in progress is shown instead of starting another', async () => {
    handler = (op) =>
      op === 'alerts.create'
        ? { status: 409, body: { error: { code: 'alert_in_progress', message: 'An alert is already being sent.', eventId: 'e1' } } }
        : op === 'alerts.get'
          ? { status: 200, body: { event: event('sending', 'retry_wait') } }
          : base(op)!;
    await openAndSend();
    const card = await screen.findByTestId('emergency-event');
    expect(within(card).getByText('Sending…')).toBeTruthy();
    expect(within(card).getByText(/Will retry/)).toBeTruthy();
    expect(within(card).getByText(/cannot be recalled/)).toBeTruthy();
  });

  it('rate limited: says how long to wait, and nothing is shown as sent', async () => {
    handler = (op) =>
      op === 'alerts.create'
        ? { status: 429, body: { error: { code: 'alert_rate_limited', message: 'Too many alerts.', retryAfter: 600 } } }
        : base(op)!;
    await openAndSend();
    expect(await screen.findByText('Too many alerts. Try again in 10 min.')).toBeTruthy();
    expect(screen.queryByTestId('emergency-event')).toBeNull();
  });
});

describe('visitor alerts setting and sign-in', () => {
  it('shows the contract’s consequence wording, and sends acknowledge only after it was shown', async () => {
    handler = (op) => (op === 'settings.set' ? { status: 200, body: { settings: settings({ publicAlertsEnabled: true }) } } : base(op)!);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn visitor alerts on' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'Anyone who opens your SHYGON profile could alert your verified contacts; SHYGON cannot confirm emergencies; limited to 3 per day.',
      ),
    ).toBeTruthy();
    expect(opsCalled('settings.set')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(opsCalled('settings.set')).toEqual([{ op: 'settings.set', publicAlertsEnabled: true, acknowledge: true }]));
  });

  it('unauthorised: without a session nothing is requested and the page asks to sign in again', async () => {
    session.token = null;
    show();
    expect(await screen.findByText('Please sign in again.')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('a 401 from the server is shown, not treated as an empty list', async () => {
    handler = () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Your session has expired. Sign in again.' } } });
    show();
    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeTruthy();
    expect(screen.queryByText('No contacts yet.')).toBeNull();
  });
});
