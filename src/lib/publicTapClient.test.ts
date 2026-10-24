import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The public Tap's reader (AAROH-API v0.8 §6): P-6 first, P-1 only when P-6
 * does not exist yet, and never the Business profile for an Info page that
 * the server did not hand out.
 */

type Reply = { status: number; body?: unknown };
let replies: Record<string, Reply>;
const called: string[] = [];

beforeEach(() => {
  called.length = 0;
  vi.stubEnv('VITE_SUPABASE_URL', 'http://gateway.test');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal('fetch', async (url: string) => {
    const fn = String(url).split('/rpc/')[1]!;
    called.push(fn);
    const reply = replies[fn] ?? { status: 500, body: {} };
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), { status: reply.status });
  });
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const reader = async () => (await import('./publicTapClient')).fetchPublicTap;
const business = { slug: 'asha', experience: 'business', displayName: 'Asha Rao', customLinks: [], theme: {}, activeEvent: null };
const info = {
  title: 'Meeting room 3',
  shortDescription: 'Seats eight. Book at reception.',
  category: 'place',
  detailedInformation: 'Screen: HDMI and USB-C.\nWi-Fi: ask reception.',
  updatedAt: '2026-10-24T09:00:00Z',
};

describe('fetchPublicTap', () => {
  it('Business: the P-1 payload inside P-6, normalised as before', async () => {
    replies = { get_public_tap_mode: { status: 200, body: { mode: 'business', profile: business } } };
    const view = await (await reader())('asha');
    expect(view?.mode).toBe('business');
    expect(view?.mode === 'business' && view.profile.displayName).toBe('Asha Rao');
    expect(view?.mode === 'business' && view.profile.theme.animation).toBeTruthy();
    expect(called).toEqual(['get_public_tap_mode']);
  });

  it('Info: exactly the five published fields; anything else in the payload is dropped', async () => {
    replies = {
      get_public_tap_mode: {
        status: 200,
        body: { mode: 'info', info: { ...info, displayName: 'Asha Rao', email: 'canary@example.test', user_id: 'u-canary' }, profile: business },
      },
    };
    const view = await (await reader())('asha');
    expect(view).toEqual({ mode: 'info', info });
    expect(JSON.stringify(view)).not.toMatch(/Asha Rao|canary/);
    expect(called).toEqual(['get_public_tap_mode']);
  });

  it('null, an unknown mode or an incomplete Info page is "nothing to show", never the Business profile', async () => {
    for (const body of [null, { mode: 'events' }, { mode: 'info', info: { title: 'Room 3' } }, { mode: 'info' }, 'business']) {
      replies = { get_public_tap_mode: { status: 200, body }, get_public_profile: { status: 200, body: business } };
      called.length = 0;
      expect(await (await reader())('asha')).toBeNull();
      expect(called).toEqual(['get_public_tap_mode']);
    }
  });

  it('an unknown category is shown without one rather than as text the server did not allow', async () => {
    replies = { get_public_tap_mode: { status: 200, body: { mode: 'info', info: { ...info, category: 'secret' } } } };
    const view = await (await reader())('asha');
    expect(view?.mode === 'info' && view.info.category).toBeNull();
  });

  it('a backend before v0.8 (P-6 missing, 404) falls back to P-1, which has no Info', async () => {
    replies = { get_public_tap_mode: { status: 404, body: { code: 'PGRST202' } }, get_public_profile: { status: 200, body: business } };
    const view = await (await reader())('asha');
    expect(view?.mode).toBe('business');
    expect(called).toEqual(['get_public_tap_mode', 'get_public_profile']);
  });

  it('any other failure is a failure: no fallback, so the page offers a retry', async () => {
    replies = { get_public_tap_mode: { status: 503 }, get_public_profile: { status: 200, body: business } };
    await expect((await reader())('asha')).rejects.toThrow(/get_public_tap_mode failed: 503/);
    expect(called).toEqual(['get_public_tap_mode']);
  });
});
