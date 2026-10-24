import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import type { PublicProfile } from '../lib/database.types';
import { DEFAULT_THEME } from '../lib/database.types';

/**
 * The public Tap page in each state a visitor can meet (V6 Stage 3; V6-083):
 * active, paused, unavailable (draft, suspended, archived, missing, invalid),
 * a failed load, offline. The data layer is replaced at its boundary
 * (src/lib/publicTapClient.ts); what the server returns for each state is
 * proven against the real schema in supabase/tests/public-tap.mjs.
 *
 * Since the AAROH showroom (2026-10-19) the visitor lands on the showroom,
 * whose heading is the owner's name; its cards carry the same contact links
 * the profile card does (src/components/showroom/PublicExperience.test.tsx).
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
vi.mock('../lib/publicTapClient', () => client);

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    slug: 'asha',
    experience: 'essential',
    displayName: 'Asha Rao',
    headline: 'Architect, Bengaluru',
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
    theme: DEFAULT_THEME,
    activeEvent: null,
    ...overrides,
  };
}

function visit(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '';

/** Lets the effects that run after a paint finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

/**
 * The Tap records analytics in an effect after it paints, so the calls are
 * awaited, then checked again once everything pending has run: exactly these
 * events, and nothing after them.
 */
async function expectEvents(expected: [string, string][]) {
  await waitFor(() => expect(client.recordTapEvent.mock.calls).toEqual(expected));
  await settle();
  expect(client.recordTapEvent.mock.calls).toEqual(expected);
}

beforeEach(() => {
  client.view = undefined;
  client.fetchPublicProfile.mockReset();
  client.fetchPublicTapState.mockReset();
  client.recordTapEvent.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('an active Tap', () => {
  it('renders the profile and records exactly one view', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/t/asha');
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
    expect(client.fetchPublicProfile).toHaveBeenCalledWith('asha');
    await expectEvents([['asha', 'view']]);
    expect(robots()).toContain('index');
    expect(robots()).not.toContain('noindex');
  });

  it('records the NFC tap or QR scan that brought the visitor', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/t/asha?src=nfc');
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    await expectEvents([['asha', 'view'], ['asha', 'nfc']]);
    cleanup();
    client.recordTapEvent.mockClear();
    visit('/t/asha?src=qr');
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    await expectEvents([['asha', 'view'], ['asha', 'qr']]);
  });

  it('still answers at the legacy /tap/ address printed on early cards', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile());
    visit('/tap/asha');
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
  });

  it('shows only the contacts the server returned (a hidden phone or email is absent)', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ phone: null, email: null }));
    const { container } = visit('/t/asha');
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('links the contacts the owner chose to show', async () => {
    client.fetchPublicProfile.mockResolvedValue(profile({ phone: '+919800000000', email: 'asha@example.test' }));
    const { container } = visit('/t/asha');
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(container.querySelector('a[href="tel:+919800000000"]')).not.toBeNull();
    expect(container.querySelector('a[href="mailto:asha@example.test"]')).not.toBeNull();
  });
});

describe('a Tap the public cannot see', () => {
  it('paused by its owner: "temporarily unavailable", not indexed, no analytics', async () => {
    client.fetchPublicProfile.mockResolvedValue(null);
    client.fetchPublicTapState.mockResolvedValue('paused');
    visit('/t/asha');
    expect(await screen.findByText('Temporarily unavailable')).toBeTruthy();
    expect(robots()).toContain('noindex');
    await settle();
    expect(client.recordTapEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['a draft', 'draft-tap'],
    ['a suspended Tap', 'suspended-tap'],
    ['an archived Tap', 'archived-tap'],
    ['a missing Tap', 'no-such-tap'],
    ['an invalid address', "%27%3B%20DROP%20TABLE%20x"],
  ])('%s reads as "Tap not found", says nothing about why, and is not indexed', async (_label, slug) => {
    client.fetchPublicProfile.mockResolvedValue(null);
    client.fetchPublicTapState.mockResolvedValue('unavailable');
    visit(`/t/${slug}`);
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    expect(screen.queryByText(/draft|suspend|archiv/i)).toBeNull();
    expect(robots()).toContain('noindex');
    await settle();
    expect(client.recordTapEvent).not.toHaveBeenCalled();
  });

  it('a state lookup that fails still reads as not found, never as an error', async () => {
    client.fetchPublicProfile.mockResolvedValue(null);
    client.fetchPublicTapState.mockRejectedValue(new Error('rpc get_public_tap_state failed: 500'));
    visit('/t/asha');
    expect(await screen.findByText('Tap not found')).toBeTruthy();
  });
});

describe('a Tap that could not be loaded', () => {
  it('a server or network failure says so and offers a retry that works', async () => {
    client.fetchPublicProfile.mockRejectedValueOnce(new Error('rpc get_public_profile failed: 503')).mockResolvedValue(profile());
    visit('/t/asha');
    expect(await screen.findByText("We couldn't load this Tap")).toBeTruthy();
    expect(screen.queryByText('Tap not found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
  });

  it('offline: says the device has no connection rather than that the Tap is gone', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    client.fetchPublicProfile.mockRejectedValue(new TypeError('Failed to fetch'));
    visit('/t/asha');
    expect(await screen.findByText("You're offline")).toBeTruthy();
  });
});

describe('a Tap in Info mode (AAROH-API v0.8, DEC-2026-041)', () => {
  // Canaries: what the owner's Business profile holds. None may reach an Info page.
  const CANARY = {
    name: 'Asha Canary Rao',
    email: 'canary@example.test',
    phone: '+919811111111',
    company: 'Canary Studio',
    avatar: 'https://cdn.example.test/canary-avatar.jpg',
  };
  const info = {
    title: 'Meeting room 3',
    shortDescription: 'Seats eight. Book at reception.',
    category: 'place',
    detailedInformation: 'Screen: HDMI and USB-C.\nWi-Fi: ask reception.',
    updatedAt: '2026-10-24T09:00:00Z',
  };
  beforeEach(() => {
    // P-1 would still answer with the Business profile (BQ-1); the page must not ask it.
    client.fetchPublicProfile.mockResolvedValue(
      profile({ displayName: CANARY.name, email: CANARY.email, phone: CANARY.phone, company: CANARY.company, avatarUrl: CANARY.avatar }),
    );
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('shows the five fields as plain text, with no Business data and no capability buttons', async () => {
    client.view = { mode: 'info', info };
    visit('/t/asha?src=nfc');
    expect(await screen.findByRole('heading', { level: 1, name: 'Meeting room 3' })).toBeTruthy();
    expect(screen.getByText('Seats eight. Book at reception.')).toBeTruthy();
    expect(screen.getByText('Place')).toBeTruthy();
    expect(screen.getByText(/Screen: HDMI and USB-C\.\s+Wi-Fi: ask reception\./)).toBeTruthy();
    // No capability on a page about a thing (PQ-3), and no way into anyone's account.
    for (const name of [/Message the owner/, /Alert their contacts/, /Ask to connect/, /owner/i, /Call/, /WhatsApp/, /Email/]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    expect(client.fetchPublicProfile).not.toHaveBeenCalled();
  });

  it('privacy canaries: nothing of the Business profile in the page, its title, description, share tags or browser storage', async () => {
    client.view = { mode: 'info', info };
    visit('/t/asha');
    await screen.findByRole('heading', { level: 1, name: 'Meeting room 3' });
    await settle();
    const head = document.head.innerHTML;
    const storage = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    for (const canary of Object.values(CANARY)) {
      expect(document.body.innerHTML).not.toContain(canary);
      expect(head).not.toContain(canary);
      expect(document.title).not.toContain(canary);
      expect(storage).not.toContain(canary);
    }
    expect(document.title).toBe('Meeting room 3 | SHYGON Tap');
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('Seats eight. Book at reception.');
    // The share image is SHYGON's own default, never the owner's photo (checked with the canaries above).
    // Nor does the Info page itself go into storage.
    expect(storage).not.toContain('Meeting room 3');
  });

  it('records no visitor event, not even for an NFC tap (PQ-2)', async () => {
    client.view = { mode: 'info', info };
    visit('/t/asha?src=nfc');
    await screen.findByRole('heading', { level: 1, name: 'Meeting room 3' });
    await settle();
    expect(client.recordTapEvent).not.toHaveBeenCalled();
  });

  it('text that looks like markup stays text: nothing is turned into an element or a link', async () => {
    client.view = {
      mode: 'info',
      info: { ...info, title: '<img src=x onerror=alert(1)>', detailedInformation: 'Visit https://example.test <b>now</b>' },
    };
    visit('/t/asha');
    expect(await screen.findByRole('heading', { level: 1, name: '<img src=x onerror=alert(1)>' })).toBeTruthy();
    expect(document.querySelector('main img, main b')).toBeNull();
    expect(screen.queryByRole('link', { name: /example\.test/ })).toBeNull();
  });

  it('Info switched off, missing or invalid (P-6 null): the neutral "Tap not found", never the Business profile (BQ-2)', async () => {
    client.view = null;
    client.fetchPublicTapState.mockResolvedValue('active');
    visit('/t/asha');
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    expect(robots()).toContain('noindex');
    expect(client.fetchPublicProfile).not.toHaveBeenCalled();
    expect(document.body.innerHTML).not.toContain(CANARY.name);
  });
});
