import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../App';
import { DEFAULT_THEME, type PublicProfile } from '../lib/database.types';

/**
 * A verified tap, /d/<code>?e=…&c=… (AAROH-API v0.11 §10d): one check after
 * load, the chip's values out of the address at once, the verdict line above
 * the Tap's own page, and never a positive word on doubt or failure. The Tap
 * reader is replaced at its boundary; /api/verify and /api/rescue at `fetch`.
 */

const client = vi.hoisted(() => {
  const c = {
    fetchPublicProfile: vi.fn(),
    fetchPublicTapState: vi.fn(),
    recordTapEvent: vi.fn(),
    view: undefined as unknown,
    fetchPublicTap: (slug: string): Promise<unknown> =>
      c.view !== undefined
        ? Promise.resolve(c.view)
        : Promise.resolve(c.fetchPublicProfile(slug)).then((profile: unknown) => (profile ? { mode: 'business', profile } : null)),
  };
  return c;
});
vi.mock('../lib/publicTapClient', () => client);

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

/**
 * A new card code and chip read for each test: the page keeps one check per
 * read for its lifetime (a remount must not ask twice), so tests never share one.
 */
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const randomFrom = (alphabet: string, n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
let CODE = '';
let E = '';
let C = '';
const EDITION = { design: 'Obsidian', number: 37, of: 100, chapterSize: 100 };

type Reply = { status: number; body: unknown };
let verify: (body: Record<string, unknown>) => Reply;
const calls: { url: string; body: Record<string, unknown> }[] = [];
let where = '';

/** Records the router's address after each render, so a test can read what the address bar shows. */
function Where() {
  const location = useLocation();
  useEffect(() => {
    where = location.pathname + location.search + location.hash;
  }, [location]);
  return null;
}

const fresh = () => {
  CODE = randomFrom(BASE32, 16);
  E = randomFrom('0123456789ABCDEF', 32);
  C = randomFrom('0123456789ABCDEF', 16);
};

beforeEach(() => {
  fresh();
  client.view = undefined;
  client.fetchPublicProfile.mockReset().mockResolvedValue(profile);
  client.fetchPublicTapState.mockReset().mockResolvedValue('active');
  client.recordTapEvent.mockReset().mockResolvedValue(undefined);
  calls.length = 0;
  verify = () => ({ status: 200, body: { slug: 'asha', verdict: 'not_verified' } });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ url, body });
    const reply =
      url === '/api/verify'
        ? verify(body)
        : url === '/api/rescue' && body.op === 'public.status'
          ? { status: 200, body: { available: true, hint: null } }
          : { status: 200, body: { available: false } };
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
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Where />
      </MemoryRouter>
    </StrictMode>,
  );
const verifies = () => calls.filter((c) => c.url === '/api/verify').map((c) => c.body);
const genuine = () => ({ status: 200, body: { slug: 'asha', verdict: 'genuine', edition: EDITION } });

describe('a verified tap', () => {
  it('genuine: one check with the chip values, then the verdict and the edition above the Tap; e and c leave the address', async () => {
    verify = genuine;
    visit(`/d/${CODE}?e=${E}&c=${C}&src=nfc`);
    expect(await screen.findByText("Verified tap. This card's secure tap was accepted.")).toBeTruthy();
    expect(screen.getByText('No. 037 of 100')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
    expect(verifies()).toEqual([{ op: 'tap.verify', code: CODE, e: E, c: C }]);
    // Development's double mount did not check twice, and the address keeps everything but e and c.
    expect(where).toBe(`/d/${CODE}?src=nfc`);
    expect(document.body.innerHTML).not.toContain(E);
    expect(client.fetchPublicProfile).toHaveBeenCalledWith('asha');
  });

  it('each other verdict in its own words, never "fake"; the edition only with genuine', async () => {
    const words: Record<string, string> = {
      already_checked: "We couldn't confirm this tap as new. Please tap the card again.",
      not_confirmed: "We couldn't verify this tap. Please tap the card again or contact SHYGON support.",
      needs_service: 'This card needs service. Please contact SHYGON.',
      unavailable: "Verification is temporarily unavailable. This tap hasn't been marked as verified.",
    };
    for (const [verdict, text] of Object.entries(words)) {
      fresh();
      verify = () => ({ status: 200, body: { slug: 'asha', verdict, edition: EDITION } });
      visit(`/d/${CODE}?e=${E}&c=${C}`);
      expect((await screen.findByTestId('vt-verdict')).textContent).toBe(text);
      expect(screen.queryByText(/No\. 037/)).toBeNull();
      expect(document.body.textContent).not.toMatch(/fake|counterfeit|verified tap\./i);
      cleanup();
    }
  });

  it('a QR or a typed link (no chip values): the Tap as usual, and nothing about authenticity', async () => {
    visit(`/d/${CODE}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Asha Rao' })).toBeTruthy();
    expect(verifies()).toEqual([{ op: 'tap.verify', code: CODE }]);
    expect(screen.queryByTestId('vt-verdict')).toBeNull();
  });

  it('a damaged link (e without c, or the wrong length) is sent as a plain link, not as a failed check', async () => {
    visit(`/d/${CODE}?e=${E}`);
    await screen.findByRole('heading', { level: 1, name: 'Asha Rao' });
    expect(verifies()).toEqual([{ op: 'tap.verify', code: CODE }]);
    expect(where).toBe(`/d/${CODE}`);
  });

  it('Lost mode (verdict null): the Lost page and no verdict', async () => {
    verify = () => ({ status: 200, body: { slug: 'asha', verdict: null } });
    client.view = { mode: 'lost' };
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Found this card?' })).toBeTruthy();
    expect(screen.queryByTestId('vt-verdict')).toBeNull();
    expect(document.body.textContent).not.toContain('Asha Rao');
  });
});

describe('a check that gets no verdict', () => {
  it('unknown card, switch off or not live (404), and a malformed code: the neutral "Tap not found", never the Tap', async () => {
    verify = () => ({ status: 404, body: { error: { code: 'unavailable', message: 'Not available.' } } });
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    expect(client.fetchPublicProfile).not.toHaveBeenCalled();
    cleanup();

    visit('/d/NOT-A-REAL-CODE');
    expect(await screen.findByText('Tap not found')).toBeTruthy();
    expect(verifies()).toHaveLength(1);
  });

  it('too many checks: says how long to wait, and offers no retry', async () => {
    verify = () => ({ status: 429, body: { error: { code: 'rate_limited', message: 'Slow down.', retryAfter: 900 } } });
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    expect(await screen.findByText(/Try again in about 15 minutes\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('the server failed (503): "temporarily unavailable", and "Try again" checks again', async () => {
    let n = 0;
    verify = () => (++n === 1 ? { status: 503, body: { error: { code: 'temporarily_unavailable', message: 'Later.' } } } : genuine());
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    expect(await screen.findByRole('heading', { name: 'Verification is temporarily unavailable' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Verified tap\./);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText("Verified tap. This card's secure tap was accepted.")).toBeTruthy();
    await waitFor(() => expect(verifies()).toHaveLength(2));
    expect(verifies()[1]).toEqual({ op: 'tap.verify', code: CODE, e: E, c: C });
  });

  it('no connection: says so and offers a retry, never "not found"', async () => {
    verify = () => ({ status: 0, body: null });
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    expect(await screen.findByRole('heading', { name: "We couldn't check this card" })).toBeTruthy();
    expect(screen.queryByText('Tap not found')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('when the check runs', () => {
  it('not while the page is hidden or prerendered: only once it is on screen', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    verify = genuine;
    visit(`/d/${CODE}?e=${E}&c=${C}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(verifies()).toHaveLength(0);
    // The address is cleaned at once anyway.
    expect(where).toBe(`/d/${CODE}`);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(await screen.findByText("Verified tap. This card's secure tap was accepted.")).toBeTruthy();
    expect(verifies()).toHaveLength(1);
    visibility.mockRestore();
  });
});
