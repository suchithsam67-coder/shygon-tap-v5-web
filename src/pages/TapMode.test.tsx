import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import TapMode from './TapMode';

/** The owner's mode page against AAROH-API v0.8 §6 response shapes (Lost: v0.10), with the network replaced at `fetch`. */

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'owner-token' } } }) } },
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
let handler: (op: string, body: Record<string, unknown>) => Reply;
const calls: Record<string, unknown>[] = [];

const info = {
  title: 'Meeting room 3',
  shortDescription: 'Seats eight. Book at reception.',
  category: 'place',
  detailedInformation: null,
  updatedAt: '2026-10-24T09:00:00Z',
  version: 2,
};
type LostEntry = { available: boolean; reason: string; missing?: string[] };
const state = (
  over: Partial<{ activeMode: string; version: number; reason: string; available: boolean; missing: string[]; lost: LostEntry }> = {},
) => ({
  activeMode: over.activeMode ?? 'business',
  version: over.version ?? 3,
  changedAt: null,
  modes: [
    { mode: 'business', available: true, reason: (over.activeMode ?? 'business') === 'business' ? 'active' : 'ready' },
    { mode: 'info', available: over.available ?? true, reason: over.reason ?? 'ready', ...(over.missing ? { missing: over.missing } : {}) },
    // v0.10: a third entry. Without it (a backend before v0.10) the page shows no Lost.
    ...(over.lost ? [{ mode: 'lost', ...over.lost }] : []),
  ],
});
const base = (op: string): Reply =>
  op === 'owner.state'
    ? { status: 200, body: state() }
    : op === 'owner.info.get'
      ? { status: 200, body: { info, publicationStatus: 'ready' } }
      : { status: 500, body: { error: { code: 'internal', message: `unexpected ${op}` } } };

beforeEach(() => {
  calls.length = 0;
  handler = (op) => base(op);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/modes');
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

const show = () =>
  render(
    <MemoryRouter>
      <TapMode />
    </MemoryRouter>,
  );
const sent = (op: string) => calls.filter((c) => c.op === op);

describe('what your Tap shows', () => {
  it('switches only on the server’s 200, with the version seen and a key; "Live" is never shown', async () => {
    let switched = false;
    handler = (op) => {
      if (op === 'owner.activate') {
        switched = true;
        return { status: 200, body: { activeMode: 'info', previousMode: 'business', version: 4, changedAt: '2026-10-24T10:00:00Z', replayed: false } };
      }
      if (op === 'owner.state') return { status: 200, body: switched ? state({ activeMode: 'info', version: 4, reason: 'active' }) : state() };
      if (op === 'owner.info.get') return { status: 200, body: { info, publicationStatus: switched ? 'live' : 'ready' } };
      return base(op);
    };
    show();
    expect((await screen.findByTestId('tm-active')).textContent).toBe('Your Tap shows your Business profile.');
    expect(screen.getByTestId('tm-info-status').textContent).toBe('Ready to show');
    fireEvent.click(screen.getByRole('button', { name: 'Show the Info page instead' }));
    expect(await screen.findByText('Done. Your Tap now shows your Info page.')).toBeTruthy();
    expect(screen.getByTestId('tm-active').textContent).toBe('Your Tap shows your Info page.');
    expect(screen.getByTestId('tm-publication').textContent).toBe('Showing on your Tap');
    const [activate] = sent('owner.activate');
    expect(activate).toMatchObject({ mode: 'info', expectedVersion: 3 });
    expect(String(activate!.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(document.body.textContent).not.toMatch(/\bLive\b/);
    expect(screen.getByRole('button', { name: 'Show my Business profile instead' })).toBeTruthy();
  });

  it('a Tap’s first switch ever: the server sends previousMode null, and the switch is still confirmed (finding #8)', async () => {
    let switched = false;
    handler = (op) => {
      if (op === 'owner.activate') {
        switched = true;
        return { status: 200, body: { activeMode: 'info', previousMode: null, version: 1, changedAt: '2026-10-25T10:00:00Z', replayed: false } };
      }
      if (op === 'owner.state') return { status: 200, body: switched ? state({ activeMode: 'info', version: 1, reason: 'active' }) : state({ version: 0 }) };
      return base(op);
    };
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Show the Info page instead' }));
    expect(await screen.findByText('Done. Your Tap now shows your Info page.')).toBeTruthy();
    expect(sent('owner.activate')[0]).toMatchObject({ mode: 'info', expectedVersion: 0 });
  });

  it('Info switched off by SHYGON: says so, and offers no switch', async () => {
    handler = (op) => (op === 'owner.state' ? { status: 200, body: state({ available: false, reason: 'not_available' }) } : base(op));
    show();
    expect((await screen.findByTestId('tm-info-status')).textContent).toBe('Unavailable: SHYGON has not switched Info pages on yet');
    expect(screen.getByRole('button', { name: 'Show the Info page instead' })).toHaveProperty('disabled', true);
  });

  it('Info not set up: names what is missing, and offers no switch', async () => {
    handler = (op) =>
      op === 'owner.state'
        ? { status: 200, body: state({ available: false, reason: 'needs_setup', missing: ['title', 'shortDescription'] }) }
        : op === 'owner.info.get'
          ? { status: 200, body: { info: null, publicationStatus: 'draft' } }
          : base(op);
    show();
    expect((await screen.findByTestId('tm-info-status')).textContent).toBe('Setup required: add title and short description');
    expect(screen.getByRole('button', { name: 'Show the Info page instead' })).toHaveProperty('disabled', true);
    expect(screen.getByTestId('tm-publication').textContent).toBe('Draft');
  });

  it('network failure: the retry reuses the same key; a stale version is refused and re-read, never shown as done', async () => {
    let n = 0;
    handler = (op) => {
      if (op !== 'owner.activate') return base(op);
      n += 1;
      return n === 1
        ? { status: 0, body: null }
        : { status: 409, body: { error: { code: 'stale_version', message: 'This changed somewhere else.', current: { version: 5 } } } };
    };
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Show the Info page instead' }));
    expect(await screen.findByText(/could not reach SHYGON/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the Info page instead' }));
    expect(await screen.findByText(/Your Tap changed somewhere else, so nothing was switched/)).toBeTruthy();
    const [first, second] = sent('owner.activate');
    expect(first!.idempotencyKey).toBe(second!.idempotencyKey);
    expect(screen.queryByText(/^Done\./)).toBeNull();
    // Re-read after the refusal: state was asked again.
    await waitFor(() => expect(sent('owner.state').length).toBeGreaterThanOrEqual(2));
  });
});

describe('Lost mode (AAROH-API v0.10)', () => {
  const READY: LostEntry = { available: true, reason: 'ready' };
  const withLost = (lost: LostEntry, over: Parameters<typeof state>[0] = {}) => (op: string) =>
    op === 'owner.state' ? { status: 200, body: state({ ...over, lost }) } : base(op);

  it('a backend without Lost (before v0.10): no Lost entry at all', async () => {
    show();
    await screen.findByTestId('tm-active');
    expect(screen.queryByTestId('tm-lost')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to Lost mode' })).toBeNull();
  });

  it('needs Return to Owner first: says so, links to its page, and offers no switch', async () => {
    handler = withLost({ available: false, reason: 'needs_setup', missing: ['returnToOwner'] });
    show();
    const lost = await screen.findByTestId('tm-lost');
    expect(within(lost).getByText('Let someone who finds your card message you privately.')).toBeTruthy();
    expect(screen.getByTestId('tm-lost-status').textContent).toBe('To use Lost mode, turn on Return to Owner first.');
    expect(within(lost).getByRole('link', { name: 'Open Return to Owner' }).getAttribute('href')).toBe('/shygontap/return-to-owner');
    expect(within(lost).getByRole('button', { name: 'Switch to Lost mode' })).toHaveProperty('disabled', true);
    // Nothing turns the opt-in on from here: the page sends no Return to Owner call of its own.
    expect(calls.map((c) => c.op).sort()).toEqual(['owner.info.get', 'owner.state']);
  });

  it('switched off by SHYGON, or the relay is off: says so, and offers no switch', async () => {
    handler = withLost({ available: false, reason: 'not_available' });
    show();
    expect((await screen.findByTestId('tm-lost-status')).textContent).toBe('Lost mode is not available right now. SHYGON has switched it off.');
    expect(screen.getByRole('button', { name: 'Switch to Lost mode' })).toHaveProperty('disabled', true);
  });

  it('switching to Lost asks first; confirmed, it sends mode lost with the version and a key, then shows the server’s state', async () => {
    let switched = false;
    handler = (op) => {
      if (op === 'owner.activate') {
        switched = true;
        return { status: 200, body: { activeMode: 'lost', previousMode: 'business', version: 4, changedAt: '2026-10-31T10:00:00Z', replayed: false } };
      }
      if (op === 'owner.state')
        return { status: 200, body: switched ? state({ activeMode: 'lost', version: 4, lost: { available: true, reason: 'active' } }) : state({ lost: READY }) };
      return base(op);
    };
    show();
    expect((await screen.findByTestId('tm-lost-status')).textContent).toBe('Ready to show');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Lost mode' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Switch this card to Lost mode?')).toBeTruthy();
    expect(
      within(dialog).getByText(
        'Taps will show only a page where a finder can message you privately. Your profile stays hidden until you switch back.',
      ),
    ).toBeTruthy();
    expect(sent('owner.activate')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, switch to Lost' }));
    expect(await screen.findByText('Your card is now in Lost mode. Taps show only the private message page.')).toBeTruthy();
    expect(screen.getByTestId('tm-active').textContent).toBe('Lost mode is on. Taps show only the private message page.');
    expect(screen.getByTestId('tm-lost-status').textContent).toBe('Showing on your Tap');
    expect(screen.getByText('Messages from finders arrive on your Return to Owner page.')).toBeTruthy();
    const [activate] = sent('owner.activate');
    expect(activate).toMatchObject({ mode: 'lost', expectedVersion: 3 });
    expect(String(activate!.idempotencyKey)).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(document.body.textContent).not.toMatch(/\bLive\b/);
  });

  it('from Lost back to Business asks first; "Cancel" sends nothing', async () => {
    handler = withLost({ available: true, reason: 'active' }, { activeMode: 'lost' });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Show my Business profile instead' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Switch back to Business?')).toBeTruthy();
    expect(within(dialog).getByText("Your card's Business profile will show when someone taps it.")).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Switch to Business' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(sent('owner.activate')).toHaveLength(0);
  });

  it('switched off since the page loaded: the refusal is in Lost words, the state is read again, and an Info draft is kept', async () => {
    let off = false;
    handler = (op) => {
      if (op === 'owner.activate') {
        off = true;
        return { status: 409, body: { error: { code: 'mode_unavailable', message: 'That mode is not available yet.' } } };
      }
      if (op === 'owner.state') return { status: 200, body: state({ lost: off ? { available: false, reason: 'not_available' } : READY }) };
      return base(op);
    };
    show();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Lost mode' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, switch to Lost' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Lost mode is not available right now. SHYGON has switched it off.');
    await waitFor(() =>
      expect(screen.getByTestId('tm-lost-status').textContent).toBe('Lost mode is not available right now. SHYGON has switched it off.'),
    );
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Unsaved title');
    expect(screen.queryByText(/now in Lost mode/)).toBeNull();
  });

  it('Return to Owner turned off since the page loaded: "turn on Return to Owner first", never shown as switched', async () => {
    handler = (op) =>
      op === 'owner.activate'
        ? { status: 409, body: { error: { code: 'needs_setup', message: 'Finish setting up this mode first.', missing: ['returnToOwner'] } } }
        : withLost(READY)(op);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Lost mode' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Yes, switch to Lost' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'To use Lost mode, turn on Return to Owner first.');
    expect(screen.getByTestId('tm-active').textContent).toBe('Your Tap shows your Business profile.');
  });
});

describe('your Info page', () => {
  it('stored detailed information the server cannot show (v0.9.2): named as needing attention, not as missing', async () => {
    handler = (op) =>
      op === 'owner.state'
        ? { status: 200, body: state({ available: false, reason: 'needs_setup', missing: ['detailedInformation'] }) }
        : base(op);
    show();
    expect((await screen.findByTestId('tm-info-status')).textContent).toBe('Setup required: check detailed information');
    const details = screen.getByLabelText('Detailed information (optional)');
    expect(details.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('This text cannot be shown. Change it or clear it, then save.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/add detailed information/i);
  });

  it('the first save sends version 0 and the fields; a refused field is marked and keeps what was typed', async () => {
    handler = (op) =>
      op === 'owner.info.get'
        ? { status: 200, body: { info: null, publicationStatus: 'draft' } }
        : op === 'owner.info.save'
          ? { status: 422, body: { error: { code: 'invalid_field', message: 'One of the fields is not valid.', field: 'title', reason: 'markup' } } }
          : base(op);
    show();
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Room <3>' } });
    fireEvent.change(screen.getByLabelText('Short description'), { target: { value: 'Seats eight.' } });
    fireEvent.change(screen.getByLabelText('Category (optional)'), { target: { value: 'place' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Plain text only: remove < and > and any code.')).toBeTruthy();
    expect(sent('owner.info.save')).toEqual([
      {
        op: 'owner.info.save',
        expectedVersion: 0,
        fields: { title: 'Room <3>', shortDescription: 'Seats eight.', category: 'place', detailedInformation: null },
      },
    ]);
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Room <3>');
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('a save sends the version last seen, and says "Saved." only after the 200', async () => {
    handler = (op, body) =>
      op === 'owner.info.save'
        ? { status: 200, body: { info: { ...info, ...(body.fields as object), version: 3 }, publicationStatus: 'ready' } }
        : base(op);
    show();
    fireEvent.change(await screen.findByLabelText('Detailed information (optional)'), { target: { value: 'Screen: HDMI.\nWi-Fi: ask.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(sent('owner.info.save')[0]).toMatchObject({ expectedVersion: 2, fields: { detailedInformation: 'Screen: HDMI.\nWi-Fi: ask.' } });
  });

  it('the preview is the visitors’ page; while Info is off, it says visitors see "Tap not found"', async () => {
    handler = (op) =>
      op === 'owner.preview'
        ? { status: 200, body: { mode: 'info', view: { title: info.title, shortDescription: info.shortDescription, category: 'place', detailedInformation: null, updatedAt: info.updatedAt } } }
        : op === 'owner.state'
          ? { status: 200, body: state({ available: false, reason: 'not_available' }) }
          : base(op);
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Preview what visitors see/ }));
    const preview = await screen.findByTestId('tm-preview');
    expect(within(preview).getByRole('heading', { level: 2, name: 'Meeting room 3' })).toBeTruthy();
    expect(screen.getByText(/Until SHYGON switches Info pages on, visitors see "Tap not found" instead/)).toBeTruthy();
    expect(within(preview).queryByRole('button')).toBeNull();
  });

  it('deleting asks first; deleting the page your Tap is showing is refused in plain words', async () => {
    handler = (op) =>
      op === 'owner.info.clear'
        ? { status: 409, body: { error: { code: 'mode_active', message: 'Info is live. Switch your Tap to Business first.' } } }
        : base(op);
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the Info page' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(sent('owner.info.clear')).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Your Tap is showing this Info page. Switch it to your Business profile first.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bis live\b/i);
  });

  it('unauthorised: a refused session is shown, not an empty page', async () => {
    handler = () => ({ status: 401, body: { error: { code: 'unauthenticated', message: 'Please sign in to manage your Tap.' } } });
    show();
    expect(await screen.findByText('Your session has expired. Sign in again.')).toBeTruthy();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });
});
