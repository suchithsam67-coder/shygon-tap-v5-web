#!/usr/bin/env node
// P1 on a preview deployment: does the host pass a visitor's copy of the
// trusted address header through? (B-9_client-address-plan.md §6;
// preview-infrastructure-plan.md §5; B-10_release-readiness.md §11.1.)
//
//   P1_BASE_URL=https://<preview-host> \
//   P1_TAP_SLUG=<a test Tap whose owner opted in to Return to Owner> \
//   P1_HOST_LABEL=netlify|vercel \
//   node scripts/release/preview-p1-address.mjs
//
// The method is exactly §6: four `public.start` requests to /api/rescue, each
// carrying a DIFFERENT forged address from the RFC 5737 documentation ranges
// in BOTH `x-nf-client-connection-ip` and `x-vercel-forwarded-for`.
//   PASS         -> 201, 201, 201, then rate_limited (one finder: the forged
//                   values were ignored, so the host replaces its own header).
//   FAIL         -> all four 201 (four finders: the host forwarded the
//                   visitor's forged header). Keep both public switches off.
//   INCONCLUSIVE-> anything else, with the reason.
// The Tap must already have the relay on (the owner's switch and RESCUE_RELAY
// on the host): `public.status` is checked first and the run stops before any
// `public.start` when it is not available.
//
// One JSON evidence object is printed: host label, origin, timestamp, the four
// status codes and outcomes, and the verdict. No finder token, no message text
// and no address (real or forged) is ever printed.
//
// Exit codes: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 refused (production host,
// non-https host or bad input; refused before any request).
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Refused outright, before any request: this check belongs on a preview.
const PRODUCTION_HOSTS = ['www.shygontech.com', 'shygontech.com'];

// Four DIFFERENT forged addresses, all inside RFC 5737 documentation ranges.
const FORGED_ADDRESSES = ['192.0.2.1', '198.51.100.1', '203.0.113.1', '192.0.2.2'];
const MESSAGE = 'Release check P1: a note for the owner.';
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

const isProductionHost = (hostname) => {
  const host = String(hostname).toLowerCase();
  return PRODUCTION_HOSTS.some((production) => host === production || host.endsWith(`.${production}`));
};

/** The URL, validated before anything is sent: https (or loopback), never production. */
function previewUrl(base) {
  if (!base || typeof base !== 'string') throw new Error('Set P1_BASE_URL (see the header).');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('P1_BASE_URL is not a URL.');
  }
  const loopback = LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('Refusing: P1_BASE_URL must be https:// (http is only allowed for localhost or 127.0.0.1).');
  }
  if (isProductionHost(url.hostname)) throw new Error(`Refusing to run against a production host (${url.hostname}): P1 runs on a preview deployment only.`);
  if (url.username || url.password || url.search || url.hash) throw new Error('Refusing: P1_BASE_URL must be a plain origin, without credentials, a query or a fragment.');
  return url;
}

const outcomeOf = (response) =>
  response.status === 201 ? 'created' : (response.body?.error?.code ?? `http_${response.status}`);

function inconclusiveReason(results) {
  const statuses = results.map((r) => r.status);
  if (statuses.every((s) => s === 404)) {
    return 'every public.start answered 404 unavailable: RESCUE_RELAY or TRUSTED_CLIENT_IP_HEADER is not set for this preview, the Tap is not published, or the owner switched the relay off';
  }
  const earlyLimit = statuses.findIndex((s, i) => s === 429 && i < 3);
  if (earlyLimit !== -1) {
    return `rate_limited at request ${earlyLimit + 1} of 4: an earlier run in this hour, or the owner daily limit, used the quota first; wait an hour or use a fresh test Tap`;
  }
  if (statuses.some((s) => s === 401 || s === 403)) {
    return 'the host refused a request as unauthorised: this preview is access-protected, or the request never reached the function';
  }
  if (statuses.some((s) => s >= 500)) {
    return 'the host answered 5xx: the function did not run, so nothing was measured';
  }
  if (statuses.some((s) => s === 400)) {
    return 'the host refused a request as invalid: check P1_TAP_SLUG and that the preview serves the current build';
  }
  return `expected 201, 201, 201 then rate_limited; got statuses ${statuses.join(', ')} with outcomes ${results.map((r) => r.outcome).join(', ')}`;
}

/**
 * Runs the §6 method against a preview and returns the evidence object.
 * Throws (before any request) when the host is not a preview we may touch.
 */
export async function runP1({ base, slug, hostLabel, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const url = previewUrl(base);
  if (!slug || typeof slug !== 'string') throw new Error('Set P1_TAP_SLUG (see the header).');
  if (hostLabel && !['netlify', 'vercel'].includes(hostLabel)) throw new Error('P1_HOST_LABEL must be netlify or vercel when it is set.');

  const evidence = {
    check: 'P1',
    hostLabel: hostLabel || 'unspecified',
    origin: url.origin,
    startedAt: new Date().toISOString(),
    preflight: null,
    requests: [],
    verdict: null,
    reason: null,
  };

  const post = async (body, headers = {}) => {
    const response = await fetchImpl(new URL('/api/rescue', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  try {
    // §6 step 1 (the Tap's relay): stop here rather than burn four threads.
    const status = await post({ op: 'public.status', slug });
    evidence.preflight = { status: status.status, available: status.body?.available === true };
    if (status.status !== 200 || status.body?.available !== true) {
      evidence.verdict = 'INCONCLUSIVE';
      evidence.reason =
        status.status === 200
          ? 'the Tap reports the relay unavailable: turn RESCUE_RELAY on for this preview, publish the Tap and switch Return-to-Owner on for the test owner, then re-run'
          : `public.status answered ${status.status}: the preview did not answer as the contract describes, so nothing was measured`;
      evidence.finishedAt = new Date().toISOString();
      return evidence;
    }

    // §6 step 2: four public.start calls, each with its own forged address in
    // both platform headers. The addresses are never recorded or printed.
    for (let i = 0; i < FORGED_ADDRESSES.length; i++) {
      const forged = FORGED_ADDRESSES[i];
      const response = await post(
        { op: 'public.start', slug, idempotencyKey: crypto.randomUUID(), message: MESSAGE },
        { 'x-nf-client-connection-ip': forged, 'x-vercel-forwarded-for': forged },
      );
      evidence.requests.push({ n: i + 1, status: response.status, outcome: outcomeOf(response) });
    }
  } catch (error) {
    evidence.verdict = 'INCONCLUSIVE';
    evidence.reason = `the request to the host failed: ${String(error?.message ?? error)}`;
    evidence.finishedAt = new Date().toISOString();
    return evidence;
  }

  const statuses = evidence.requests.map((r) => r.status);
  const outcomes = evidence.requests.map((r) => r.outcome);
  const threeCreated = statuses.length === 4 && statuses.slice(0, 3).every((s) => s === 201) && statuses[3] === 429;
  if (threeCreated && outcomes[3] === 'rate_limited') {
    evidence.verdict = 'PASS';
    evidence.reason = 'three created, then rate_limited: one finder, so the forged address headers were ignored';
  } else if (statuses.every((s) => s === 201)) {
    evidence.verdict = 'FAIL';
    evidence.reason =
      'all four forged addresses were accepted as four different finders: this host forwarded a visitor\'s copy of the trusted header (B-9 §6). Keep both public switches off and report it';
  } else {
    evidence.verdict = 'INCONCLUSIVE';
    evidence.reason = inconclusiveReason(evidence.requests);
  }
  evidence.finishedAt = new Date().toISOString();
  log(`P1 ${evidence.verdict}: ${evidence.reason}`);
  return evidence;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.env.P1_BASE_URL;
  const slug = process.env.P1_TAP_SLUG;
  const hostLabel = process.env.P1_HOST_LABEL;
  if (!base || !slug) {
    console.error('Set P1_BASE_URL and P1_TAP_SLUG; P1_HOST_LABEL is optional (netlify or vercel). See the header.');
    process.exit(3);
  }
  try {
    const evidence = await runP1({ base, slug, hostLabel });
    console.log('\nEVIDENCE (no tokens, message text or addresses):');
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.verdict === 'PASS' ? 0 : evidence.verdict === 'FAIL' ? 1 : 2;
  } catch (error) {
    console.error(`P1 REFUSED: ${error.message}`);
    process.exitCode = 3;
  }
}
