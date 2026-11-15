import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyError, sunFrom, verifyTap } from './publicVerifyClient';

/** The Verified Tap client against AAROH-API v0.11 §10d answers, with the network replaced at `fetch`. */

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let reply: Reply;
const sent: { url: string; init: RequestInit }[] = [];

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (reply.status === 0) throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json', ...reply.headers } });
  });
});
afterEach(() => vi.unstubAllGlobals());

const CODE = 'abcdefgh234567ab';
const SUN = { e: 'A'.repeat(32), c: 'B'.repeat(16) };

describe('sunFrom', () => {
  it('takes e and c only together and only when well formed', () => {
    expect(sunFrom(`?e=${SUN.e}&c=${SUN.c}`)).toEqual(SUN);
    expect(sunFrom(`?e=${SUN.e}`)).toBeNull();
    expect(sunFrom(`?c=${SUN.c}`)).toBeNull();
    expect(sunFrom(`?e=${SUN.e.slice(1)}&c=${SUN.c}`)).toBeNull();
    expect(sunFrom(`?e=${'Z'.repeat(32)}&c=${SUN.c}`)).toBeNull();
    expect(sunFrom('')).toBeNull();
  });
});

describe('verifyTap', () => {
  it('posts tap.verify once, with no referrer and no caching; the chip values only in the body', async () => {
    reply = { status: 200, body: { slug: 'asha', verdict: 'not_verified' } };
    await verifyTap(CODE, SUN);
    expect(sent).toHaveLength(1);
    const [{ url, init }] = sent;
    expect(url).toBe('/api/verify');
    expect(init.method).toBe('POST');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(String(init.body))).toEqual({ op: 'tap.verify', code: CODE, ...SUN });
    expect(url).not.toContain(SUN.e);
  });

  it('without chip values, sends only the code', async () => {
    reply = { status: 200, body: { slug: 'asha', verdict: 'not_verified' } };
    await verifyTap(CODE, null);
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ op: 'tap.verify', code: CODE });
  });

  it('genuine keeps its edition; any other verdict drops one', async () => {
    const edition = { design: 'Obsidian', number: 37, of: 100, chapterSize: 100 };
    reply = { status: 200, body: { slug: 'asha', verdict: 'genuine', edition } };
    expect(await verifyTap(CODE, SUN)).toEqual({ slug: 'asha', verdict: 'genuine', edition, possession: null });
    reply = { status: 200, body: { slug: 'asha', verdict: 'already_checked', edition } };
    expect(await verifyTap(CODE, SUN)).toEqual({ slug: 'asha', verdict: 'already_checked', edition: null, possession: null });
  });

  it('v0.15: a card that is not active yet has no slug; only a genuine tap of it keeps the possession proof', async () => {
    const proof = `${CODE}.7.1800000000.${'a'.repeat(64)}`;
    reply = { status: 200, body: { slug: null, verdict: 'genuine', possession: proof } };
    expect(await verifyTap(CODE, SUN)).toEqual({ slug: null, verdict: 'genuine', edition: null, possession: proof });
    reply = { status: 200, body: { slug: null, verdict: 'already_checked', possession: proof } };
    expect(await verifyTap(CODE, SUN)).toEqual({ slug: null, verdict: 'already_checked', edition: null, possession: null });
    reply = { status: 200, body: { slug: null, verdict: 'not_verified' } };
    expect(await verifyTap(CODE, null)).toMatchObject({ slug: null, verdict: 'not_verified', possession: null });
    // No Lost page for a card that is not active: no verdict reads as "unavailable".
    reply = { status: 200, body: { slug: null, verdict: null } };
    expect(await verifyTap(CODE, SUN)).toMatchObject({ slug: null, verdict: 'unavailable', possession: null });
    // A proof on an active card's answer is never kept; an oversized one is dropped.
    reply = { status: 200, body: { slug: 'asha', verdict: 'genuine', possession: proof } };
    expect((await verifyTap(CODE, SUN)).possession).toBeNull();
    reply = { status: 200, body: { slug: null, verdict: 'genuine', possession: 'x'.repeat(201) } };
    expect((await verifyTap(CODE, SUN)).possession).toBeNull();
  });

  it('an incomplete edition is dropped; null stays null (Lost mode); an unknown verdict is "unavailable", never "genuine"', async () => {
    reply = { status: 200, body: { slug: 'asha', verdict: 'genuine', edition: { design: 'Obsidian', number: 101, of: 100 } } };
    expect((await verifyTap(CODE, SUN)).edition).toBeNull();
    reply = { status: 200, body: { slug: 'asha', verdict: null } };
    expect((await verifyTap(CODE, SUN)).verdict).toBeNull();
    reply = { status: 200, body: { slug: 'asha', verdict: 'authentic' } };
    expect((await verifyTap(CODE, SUN)).verdict).toBe('unavailable');
    reply = { status: 200, body: { slug: 'asha' } };
    expect((await verifyTap(CODE, SUN)).verdict).toBe('unavailable');
  });

  it('refusals keep their code and wait; a missing slug or no network is a failure, never a verdict', async () => {
    const failure = async () => verifyTap(CODE, SUN).catch((e: unknown) => e as VerifyError);
    reply = { status: 404, body: { error: { code: 'unavailable', message: 'Not available.' } } };
    expect(await failure()).toMatchObject({ status: 404, code: 'unavailable' });
    reply = { status: 429, body: { error: { code: 'rate_limited', message: 'Slow down.', retryAfter: 900 } } };
    expect(await failure()).toMatchObject({ status: 429, code: 'rate_limited', retryAfter: 900 });
    reply = { status: 429, body: { error: { code: 'rate_limited', message: 'Slow down.' } }, headers: { 'Retry-After': '120' } };
    expect(await failure()).toMatchObject({ retryAfter: 120 });
    reply = { status: 503, body: { error: { code: 'temporarily_unavailable', message: 'Later.' } } };
    expect(await failure()).toMatchObject({ status: 503, code: 'temporarily_unavailable' });
    reply = { status: 200, body: { verdict: 'genuine' } };
    expect(await failure()).toMatchObject({ code: 'invalid_answer' });
    reply = { status: 0, body: null };
    expect(await failure()).toMatchObject({ status: 0, code: 'network' });
  });
});
