#!/usr/bin/env node
// P2 on a preview deployment: SHYGON Connect through /api/connect, on the
// non-production database (B-10_release-readiness.md §11.2;
// preview-infrastructure-plan.md §5; api-contract.md §10b).
//
//   P2_BASE_URL=https://<preview-host> \
//   P2_OWNER_TOKEN=<session access token of the test Tap's owner> \
//   P2_VISITOR_TOKEN=<session access token of a second test account> \
//   P2_TAP_SLUG=<the test Tap> \
//   P2_PHASE=off|on \
//   P2_HOST_LABEL=netlify|vercel \
//   P2_DECLINE_TOKEN=<a third test account>  P2_BLOCK_TOKEN=<a fourth> \   (phase on)
//   node scripts/release/preview-p2-connect.mjs
//
// Every token must belong to an *@example.test test account. The script cannot
// see an address behind a session token, so it prints that as a reminder and
// verifies nothing about it.
//
// Decline and block: with P2_DECLINE_TOKEN and P2_BLOCK_TOKEN, phase on runs
// both for real (each account requests, the owner declines or blocks, the
// requester sees "declined" with nothing shared, its grant is revoked, and a
// new request is refused). Those two accounts cannot request this Tap again
// (30-day cool-down; the block stays), so use fresh ones each run. Hosted
// evidence needs them: on a non-loopback host phase on without them is
// INCONCLUSIVE. On the local stack, without them, decline and block are only
// probed with a connection id that cannot exist (not switch-locked).
//
// P2_PHASE=off (CONNECT_PUBLIC unset on the host): public.status is false,
// requests.create / requests.accept / connections.share answer 404
// unavailable (and add no ledger row), while decline, block, remove and the
// lists still work, and settings report publicAllowed false.
// P2_PHASE=on: the §11.2 journey - owner settings, request, accept, the
// sharing scope, a refused widening, decline, block, remove - then a printed
// checklist of what the operator must confirm in the NON-PRODUCTION database.
// The script never connects to a database itself.
//
// One JSON evidence object is printed: host label, origin, phase, timestamp,
// every check with its outcome, the checklist and the verdict. No token, no
// shared value, no note text and no address is ever printed.
//
// Exit codes: 0 PASS, 1 FAIL, 2 INCONCLUSIVE, 3 refused (production host,
// non-https host or bad input; refused before any request).
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Refused outright, before any request: this check belongs on a preview.
const PRODUCTION_HOSTS = ['www.shygontech.com', 'shygontech.com'];

const LOCAL_HOSTS = ['localhost', '127.0.0.1'];
// A well-formed connection id that cannot exist: used to prove that decline,
// block and remove are not locked by the host switch while they answer
// connection_not_found instead of unavailable.
const NO_CONNECTION = 'e0000000-0000-4000-8000-000000000000';
const REMINDER =
  'Reminder: every P2_*_TOKEN must belong to an *@example.test test account; this script cannot verify that.';

class Inconclusive extends Error {}

const isProductionHost = (hostname) => {
  const host = String(hostname).toLowerCase();
  return PRODUCTION_HOSTS.some((production) => host === production || host.endsWith(`.${production}`));
};

/** The URL, validated before anything is sent: https (or loopback), never production. */
function previewUrl(base) {
  if (!base || typeof base !== 'string') throw new Error('Set P2_BASE_URL (see the header).');
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('P2_BASE_URL is not a URL.');
  }
  const loopback = LOCAL_HOSTS.includes(url.hostname);
  if (url.protocol !== 'https:' && !loopback) {
    throw new Error('Refusing: P2_BASE_URL must be https:// (http is only allowed for localhost or 127.0.0.1).');
  }
  if (isProductionHost(url.hostname)) throw new Error(`Refusing to run against a production host (${url.hostname}): P2 runs on a preview deployment only.`);
  if (url.username || url.password || url.search || url.hash) throw new Error('Refusing: P2_BASE_URL must be a plain origin, without credentials, a query or a fragment.');
  return url;
}

/**
 * Runs the §11.2 sequence for one phase and returns the evidence object.
 * Throws (before any request) when the host is not a preview we may touch.
 */
export async function runP2({
  base, ownerToken, visitorToken, declineToken, blockToken, slug, phase, hostLabel, fetchImpl = globalThis.fetch, log = console.log,
} = {}) {
  const url = previewUrl(base);
  if (!ownerToken || !visitorToken) throw new Error('Set P2_OWNER_TOKEN and P2_VISITOR_TOKEN (see the header).');
  if (!slug || typeof slug !== 'string') throw new Error('Set P2_TAP_SLUG (see the header).');
  if (phase !== 'off' && phase !== 'on') throw new Error('P2_PHASE must be off or on.');
  if (hostLabel && !['netlify', 'vercel'].includes(hostLabel)) throw new Error('P2_HOST_LABEL must be netlify or vercel when it is set.');
  if (Boolean(declineToken) !== Boolean(blockToken)) throw new Error('Set both P2_DECLINE_TOKEN and P2_BLOCK_TOKEN, or neither.');
  const realEndings = Boolean(declineToken && blockToken);
  if (realEndings && new Set([ownerToken, visitorToken, declineToken, blockToken]).size !== 4) {
    throw new Error('P2_OWNER_TOKEN, P2_VISITOR_TOKEN, P2_DECLINE_TOKEN and P2_BLOCK_TOKEN must be four different accounts.');
  }
  log(REMINDER);

  const evidence = {
    check: 'P2',
    hostLabel: hostLabel || 'unspecified',
    origin: url.origin,
    phase,
    declineAndBlock: phase === 'on' ? (realEndings ? 'real' : 'probe only') : 'probe only (switch lock)',
    startedAt: new Date().toISOString(),
    preflight: null,
    checks: [],
    dbChecklist: [],
    verdict: null,
    reason: null,
  };

  const call = async (body, token) => {
    const response = await fetchImpl(new URL('/api/connect', url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const code = (r) => r.body?.error?.code ?? null;
  const outcome = (r) => (r.status === 200 || r.status === 201 ? `HTTP ${r.status}` : `HTTP ${r.status} ${code(r) ?? ''}`.trim());
  const check = (id, ok, actual) => evidence.checks.push({ id, ok: Boolean(ok), actual });
  // 401 and 5xx say nothing about the switch: they stop the run as inconclusive.
  const guard = (label, r) => {
    if (r.status === 401) throw new Inconclusive(`${label}: the host refused a session token (401); sign in on the preview again and re-run`);
    if (r.status >= 500) throw new Inconclusive(`${label}: the host answered HTTP ${r.status}; nothing about the switch was measured`);
    return r;
  };
  const must200 = (label, r) => {
    if (r.status !== 200 || !r.body || typeof r.body !== 'object') {
      throw new Inconclusive(`${label}: answered ${outcome(r)} instead of HTTP 200, so the sequence cannot continue`);
    }
    return r.body;
  };
  const ledger = async (label, token) => {
    const body = must200(label, await call({ op: 'consents.list' }, token));
    if (!Array.isArray(body.consents)) throw new Inconclusive(`${label}: the response has no consent list, so nothing can be compared`);
    return body.consents;
  };
  const snapshot = (consents) => JSON.stringify(consents.map((g) => `${g.id}:${g.version}`).sort());
  const finish = () => {
    evidence.finishedAt = new Date().toISOString();
    return evidence;
  };

  try {
    // ---- preflight: the host's switch must agree with the phase we were asked to run.
    const settings = guard('settings.get', await call({ op: 'settings.get' }, ownerToken));
    if (settings.status !== 200) {
      throw new Inconclusive(`settings.get answered ${outcome(settings)} instead of HTTP 200; nothing was measured`);
    }
    const publicAllowed = settings.body?.settings?.publicAllowed === true;
    evidence.preflight = `settings.get HTTP 200 publicAllowed=${publicAllowed}`;
    if (publicAllowed !== (phase === 'on')) {
      throw new Inconclusive(
        `P2_PHASE=${phase} but the host reports CONNECT_PUBLIC ${publicAllowed ? 'on' : 'off'} (settings.publicAllowed=${publicAllowed}); wait for the redeploy to apply, then re-run`,
      );
    }
    guard('consents.list', await call({ op: 'consents.list' }, visitorToken));

    if (phase === 'off') {
      // ---- §11.2, off: the host switch locks what may start, never what may stop.
      const set = guard('settings.set', await call({ op: 'settings.set', enabled: true }, ownerToken));
      const settingsNow = set.body?.settings ?? {};
      check(
        'owner settings: enabled=true, publicAllowed=false',
        set.status === 200 && settingsNow.enabled === true && settingsNow.publicAllowed === false,
        `HTTP ${set.status} enabled=${settingsNow.enabled} publicAllowed=${settingsNow.publicAllowed}`,
      );

      const status = guard('public.status', await call({ op: 'public.status', slug }));
      check('public.status is false while the host switch is off', status.status === 200 && status.body?.available === false, `HTTP ${status.status} available=${status.body?.available}`);

      const before = await ledger('consents.list (visitor)', visitorToken);

      const create = guard('requests.create', await call({ op: 'requests.create', slug, idempotencyKey: crypto.randomUUID(), share: ['company'] }, visitorToken));
      check('requests.create is refused: 404 unavailable', create.status === 404 && code(create) === 'unavailable', outcome(create));

      const accept = guard('requests.accept', await call({ op: 'requests.accept', connectionId: NO_CONNECTION, share: ['email'] }, ownerToken));
      check('requests.accept is refused: 404 unavailable', accept.status === 404 && code(accept) === 'unavailable', outcome(accept));

      const widen = guard('connections.share', await call({ op: 'connections.share', connectionId: NO_CONNECTION, share: ['email', 'company'] }, ownerToken));
      check('widening the sharing is refused: 404 unavailable', widen.status === 404 && code(widen) === 'unavailable', outcome(widen));

      const after = await ledger('consents.list (visitor)', visitorToken);
      check('no consent grant was added by the refused calls', snapshot(before) === snapshot(after), `${before.length} ledger rows before and after`);

      const ownerList = must200('connections.list (owner)', await call({ op: 'connections.list' }, ownerToken));
      check('connections.list still works', Array.isArray(ownerList.connections), `HTTP 200 ${ownerList.connections?.length ?? '?'} connections`);
      const ownerLedger = await ledger('consents.list (owner)', ownerToken);
      check('consents.list still works', true, `HTTP 200 ${ownerLedger.length} ledger rows`);

      const decline = guard('requests.decline', await call({ op: 'requests.decline', connectionId: NO_CONNECTION }, ownerToken));
      check('requests.decline is not locked by the switch: 404 connection_not_found', decline.status === 404 && code(decline) === 'connection_not_found', outcome(decline));
      const block = guard('requests.block', await call({ op: 'requests.block', connectionId: NO_CONNECTION }, ownerToken));
      check('requests.block is not locked by the switch: 404 connection_not_found', block.status === 404 && code(block) === 'connection_not_found', outcome(block));

      // Remove either a connection an earlier run left open (a real proof that
      // withdrawal works while the switch is off) or the dummy id (a proof that
      // the operation itself is not locked).
      const leftover = (ownerList.connections ?? []).find((c) => ['requested', 'accepted'].includes(c.status));
      const remove = guard('connections.remove', await call({ op: 'connections.remove', connectionId: leftover?.id ?? NO_CONNECTION }, ownerToken));
      if (leftover) {
        check('connections.remove works while the switch is off (a leftover connection was withdrawn)', remove.status === 200 && remove.body?.removed === true, `${outcome(remove)} removed=${remove.body?.removed}`);
      } else {
        check('connections.remove is not locked by the switch: 404 connection_not_found', remove.status === 404 && code(remove) === 'connection_not_found', outcome(remove));
      }

      evidence.dbChecklist.push(
        `consent_grants: confirm that no row was added by the refused calls (the API reported ${before.length} rows before and ${after.length} after).`,
      );
    } else {
      // ---- §11.2, on: the whole journey, through the preview URL.
      // P2 closes only on hosted evidence, and that must withdraw consent for
      // real in every way the contract offers: stop before any write without it.
      if (!LOCAL_HOSTS.includes(url.hostname) && !realEndings) {
        throw new Inconclusive(
          'hosted P2 evidence runs decline and block for real: set P2_DECLINE_TOKEN and P2_BLOCK_TOKEN to two more *@example.test accounts that have not requested this Tap before, then re-run',
        );
      }
      const set = guard('settings.set', await call({ op: 'settings.set', enabled: true }, ownerToken));
      const settingsNow = set.body?.settings ?? {};
      check(
        'owner settings: enabled=true, publicAllowed=true',
        set.status === 200 && settingsNow.enabled === true && settingsNow.publicAllowed === true,
        `HTTP ${set.status} enabled=${settingsNow.enabled} publicAllowed=${settingsNow.publicAllowed}`,
      );

      const status = guard('public.status', await call({ op: 'public.status', slug }));
      if (status.status !== 200 || status.body?.available !== true) {
        throw new Inconclusive(
          `public.status answered ${outcome(status)} available=${status.body?.available}: check P2_TAP_SLUG, that the Tap is published and that the owner's Connect switch is on, then re-run`,
        );
      }

      const created = guard('requests.create', await call({ op: 'requests.create', slug, idempotencyKey: crypto.randomUUID(), share: ['company'] }, visitorToken));
      if (created.status === 409 && code(created) === 'already_connected') {
        throw new Inconclusive('an open connection already exists between the two accounts (an earlier run stopped early): withdraw it, then re-run');
      }
      if (created.status === 429 && code(created) === 'recently_declined') {
        throw new Inconclusive('the two accounts are inside the 30-day decline cool-down: use a fresh pair of test accounts');
      }
      if (created.status === 429) {
        throw new Inconclusive(`requests.create answered ${outcome(created)}: the requester limit is already used; wait an hour or use a fresh pair of test accounts`);
      }
      const connection = created.body?.connection ?? {};
      check(
        'a request is created: 201, requested, sharing exactly the chosen field',
        created.status === 201 && connection.status === 'requested' && JSON.stringify(connection.iShare) === JSON.stringify(['company']),
        `${outcome(created)} status=${connection.status} iShare=${JSON.stringify(connection.iShare)}`,
      );
      const connectionId = connection.id;
      if (typeof connectionId !== 'string') throw new Inconclusive('requests.create returned no connection id, so the journey cannot continue');

      const accepted = guard('requests.accept', await call({ op: 'requests.accept', connectionId, share: ['email'] }, ownerToken));
      check(
        'the owner accepts, sharing back the chosen field: 200, accepted',
        accepted.status === 200 && accepted.body?.connection?.status === 'accepted',
        `${outcome(accepted)} status=${accepted.body?.connection?.status}`,
      );

      const visitorList = must200('connections.list (visitor)', await call({ op: 'connections.list' }, visitorToken));
      const view = (visitorList.connections ?? []).find((c) => c.id === connectionId) ?? {};
      const shared = view.theyShare ?? {};
      const entry = shared.email ?? {};
      check(
        'the requester reads the granted field live and self-reported',
        JSON.stringify(view.iShare ?? null) === JSON.stringify(['company']) &&
          Object.keys(shared).length === 1 &&
          entry.provenance === 'self_reported' &&
          typeof entry.value === 'string' &&
          entry.value.length > 0,
        `iShare=${JSON.stringify(view.iShare)} theyShare fields=${JSON.stringify(Object.keys(shared))} provenance=${entry.provenance ?? 'none'}`,
      );

      const ownerLedger = await ledger('consents.list (owner)', ownerToken);
      const active = ownerLedger.filter((g) => g.connectionId === connectionId && g.direction === 'given' && g.revokedAt === null);
      check(
        'the consent ledger holds one active grant from the owner, scoped to the chosen field',
        active.length === 1 && JSON.stringify(active[0].scope) === JSON.stringify(['email']),
        `${active.length} active grant(s), scopes=${JSON.stringify(active.map((g) => g.scope))}`,
      );

      const beforeWiden = snapshot(ownerLedger);
      const widen = guard('connections.share', await call({ op: 'connections.share', connectionId, share: ['email', 'password'] }, ownerToken));
      const widenedLedger = await ledger('consents.list (owner)', ownerToken);
      const afterWiden = snapshot(widenedLedger);
      check('a widening beyond the shareable fields is refused: 400 invalid_share', widen.status === 400 && code(widen) === 'invalid_share', outcome(widen));
      check('no ledger row was added by the refused widening', beforeWiden === afterWiden, `${ownerLedger.length} rows before, ${widenedLedger.length} after`);

      const endings = [];
      if (realEndings) {
        // Decline and block for real, each with its own requester (§10b lifecycle).
        for (const [kind, token] of [['decline', declineToken], ['block', blockToken]]) {
          const label = `${kind} account`;
          const opened = guard(`requests.create (${label})`, await call({ op: 'requests.create', slug, idempotencyKey: crypto.randomUUID(), share: ['company'] }, token));
          if ([404, 409, 429].includes(opened.status)) {
            throw new Inconclusive(`the ${label} cannot open a request (${outcome(opened)}): an earlier run used it; use a fresh *@example.test account`);
          }
          const id = opened.body?.connection?.id;
          check(`a request from the ${label} is created: 201 requested`, opened.status === 201 && opened.body?.connection?.status === 'requested', outcome(opened));
          if (typeof id !== 'string') throw new Inconclusive(`requests.create (${label}) returned no connection id`);
          const want = kind === 'decline' ? 'declined' : 'blocked';
          const decided = guard(`requests.${kind}`, await call({ op: `requests.${kind}`, connectionId: id }, ownerToken));
          check(`the owner's ${kind} works: 200 ${want}`, decided.status === 200 && decided.body?.connection?.status === want, `${outcome(decided)} status=${decided.body?.connection?.status}`);
          const theirList = must200(`connections.list (${label})`, await call({ op: 'connections.list' }, token));
          const theirs = (theirList.connections ?? []).find((c) => c.id === id) ?? {};
          check(
            `the ${label} sees "declined" and nothing shared${kind === 'block' ? ' (a block is never revealed)' : ''}`,
            theirs.status === 'declined' && JSON.stringify(theirs.theyShare ?? {}) === '{}',
            `status=${theirs.status} theyShare fields=${JSON.stringify(Object.keys(theirs.theyShare ?? {}))}`,
          );
          const given = (await ledger(`consents.list (${label})`, token)).filter((g) => g.connectionId === id && g.direction === 'given');
          check(`the ${label}'s own grant on that request is revoked`, given.length >= 1 && given.every((g) => g.revokedAt !== null), `${given.length} grant(s), ${given.filter((g) => g.revokedAt === null).length} active`);
          const again = guard(`requests.create again (${label})`, await call({ op: 'requests.create', slug, idempotencyKey: crypto.randomUUID(), share: ['company'] }, token));
          const refusal = kind === 'decline' ? [429, 'recently_declined'] : [404, 'unavailable'];
          check(`a new request from the ${label} is refused: ${refusal.join(' ')}`, again.status === refusal[0] && code(again) === refusal[1], outcome(again));
          endings.push([want, id]);
        }
      } else {
        const decline = guard('requests.decline', await call({ op: 'requests.decline', connectionId: NO_CONNECTION }, ownerToken));
        check('requests.decline is not locked: 404 connection_not_found', decline.status === 404 && code(decline) === 'connection_not_found', outcome(decline));
        const block = guard('requests.block', await call({ op: 'requests.block', connectionId: NO_CONNECTION }, ownerToken));
        check('requests.block is not locked: 404 connection_not_found', block.status === 404 && code(block) === 'connection_not_found', outcome(block));
      }

      const removed = guard('connections.remove', await call({ op: 'connections.remove', connectionId }, ownerToken));
      check(
        'remove ends the connection and revokes its grants: 200, removed, grantsRevoked',
        removed.status === 200 && removed.body?.removed === true && Number(removed.body?.grantsRevoked) >= 1,
        `${outcome(removed)} removed=${removed.body?.removed} grantsRevoked=${removed.body?.grantsRevoked}`,
      );

      const afterList = must200('connections.list (visitor)', await call({ op: 'connections.list' }, visitorToken));
      const ended = (afterList.connections ?? []).find((c) => c.id === connectionId) ?? {};
      check('after withdrawal nothing is readable on that connection', ended.status === 'removed' && JSON.stringify(ended.theyShare ?? {}) === '{}', `status=${ended.status} theyShare fields=${JSON.stringify(Object.keys(ended.theyShare ?? {}))}`);

      const finalLedger = await ledger('consents.list (owner)', ownerToken);
      const onConnection = finalLedger.filter((g) => g.connectionId === connectionId);
      const stillActive = onConnection.filter((g) => g.revokedAt === null);
      check('every grant on the removed connection is revoked (API view)', onConnection.length >= 1 && stillActive.length === 0, `${onConnection.length} grant(s), ${stillActive.length} still active`);

      evidence.dbChecklist.push(
        `consent_grants: confirm that every grant on connection ${connectionId} is revoked (revoked_at set, revoke_reason 'removed', none active); the API reported ${onConnection.length} grant(s), ${stillActive.length} active.`,
        `consent_grants: confirm that no row was added by the refused widening call (the API reported ${ownerLedger.length} rows before and ${widenedLedger.length} after).`,
        ...endings.map(([status, id]) => `connections / consent_grants: confirm that connection ${id} is ${status} and every grant on it is revoked.`),
      );
    }

    const failed = evidence.checks.filter((c) => !c.ok);
    evidence.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
    evidence.reason =
      failed.length === 0
        ? `${evidence.checks.length} checks matched the contract for P2_PHASE=${phase}`
        : `failed: ${failed.map((c) => `${c.id} (${c.actual})`).join('; ')}`;
  } catch (error) {
    if (!(error instanceof Inconclusive)) throw error;
    evidence.verdict = 'INCONCLUSIVE';
    evidence.reason = error.message;
  }
  return finish();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const base = process.env.P2_BASE_URL;
  const ownerToken = process.env.P2_OWNER_TOKEN;
  const visitorToken = process.env.P2_VISITOR_TOKEN;
  const slug = process.env.P2_TAP_SLUG;
  const phase = process.env.P2_PHASE;
  const hostLabel = process.env.P2_HOST_LABEL;
  const declineToken = process.env.P2_DECLINE_TOKEN;
  const blockToken = process.env.P2_BLOCK_TOKEN;
  if (!base || !ownerToken || !visitorToken || !slug || !phase) {
    console.error('Set P2_BASE_URL, P2_OWNER_TOKEN, P2_VISITOR_TOKEN, P2_TAP_SLUG and P2_PHASE (off|on); for phase on also P2_DECLINE_TOKEN and P2_BLOCK_TOKEN; P2_HOST_LABEL is optional. See the header.');
    process.exit(3);
  }
  try {
    const evidence = await runP2({ base, ownerToken, visitorToken, declineToken, blockToken, slug, phase, hostLabel });
    if (evidence.dbChecklist.length > 0) {
      console.log('\nCONFIRM IN THE NON-PRODUCTION DATABASE (this script never connects to one):');
      for (const line of evidence.dbChecklist) console.log(`  [ ] ${line}`);
    }
    console.log('\nEVIDENCE (no tokens, shared values or addresses):');
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.verdict === 'PASS' ? 0 : evidence.verdict === 'FAIL' ? 1 : 2;
  } catch (error) {
    console.error(`P2 REFUSED: ${error.message}`);
    process.exitCode = 3;
  }
}
