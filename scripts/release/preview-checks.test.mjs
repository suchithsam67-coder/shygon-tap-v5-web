// The hosted release-check runners, P1 and P2, against the LOCAL stack only
// (scripts/release/preview-p1-address.mjs and preview-p2-connect.mjs). Nothing
// here leaves loopback: under the network guard only 127.0.0.1 answers.
//
// P1 runs the real /api/rescue on the stack. The stack plays Netlify's edge
// (B-9 Part A): it drops the forged address headers and takes the address from
// the socket, with the STACK_SIM_CLIENT_ADDRESS simulator available, so a
// forged header can never name a second finder. The negative control uses a
// loopback stand-in host that DOES honour both forged headers: P1 must then
// report FAIL, because that is the defect §6 exists to catch.
//
// Host switches are turned on and off through the stack's /__sim/switches
// hook. The stack runs on STACK_APP_PORT (default 4373) and
// STACK_GATEWAY_PORT (default 54521), so it never collides with another
// session's stack.
//
//   node --import ./scripts/ci/deny-network.mjs scripts/release/preview-checks.test.mjs
import http from 'node:http';
import { startStack } from '../../supabase/local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../../supabase/local/testkit.mjs';
import { runP1 } from './preview-p1-address.mjs';
import { runP2 } from './preview-p2-connect.mjs';

const APP_PORT = Number(process.env.STACK_APP_PORT ?? 4373);
const GATEWAY_PORT = Number(process.env.STACK_GATEWAY_PORT ?? 54521);
const t = createHarness(`Preview check runners (P1 and P2; stack on ${APP_PORT}/${GATEWAY_PORT})`);
const noop = () => {};

const stack = await startStack({ appPort: APP_PORT, gatewayPort: GATEWAY_PORT });

/** The stack's browser control: the host switches, exactly as an E2E would flip them. */
async function setSwitch(name, on) {
  const response = await fetch(`${stack.appUrl}/__sim/switches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [name]: on }),
  });
  const body = await response.json().catch(() => null);
  assertEqual([response.status, body?.[name]], [200, on], `${name} switch`);
}

/** A published Tap whose owner opted in (the P1 prerequisite). */
async function relayOwner(slug, name) {
  const owner = await signUp(stack, { name });
  await stack.query(
    `INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
     VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, $3, 'active')`,
    [owner.userId, slug, name],
  );
  const set = await callFunction(stack, 'rescue', { token: owner.token, body: { op: 'settings.set', enabled: true } });
  assertEqual([set.status, set.body?.settings?.enabled, set.body?.settings?.relayAllowed], [200, true, true], `${slug}: relay on`);
  return owner;
}

// ---------------------------------------------------------------------------
t.section('A. P1: the four forged addresses (B-9 §6)');

await setSwitch('RESCUE_RELAY', true);
const ownerA = await relayOwner('p1-preview-check', 'P1 Owner');
const p1Logs = [];
process.env.STACK_SIM_CLIENT_ADDRESS = '1';
const p1 = await runP1({ base: stack.appUrl, slug: 'p1-preview-check', hostLabel: 'netlify', log: (line) => p1Logs.push(String(line)) });
delete process.env.STACK_SIM_CLIENT_ADDRESS;

await t.check('the local stack replaces the forged headers: 201, 201, 201, rate_limited -> PASS', async () => {
  assertEqual(p1.verdict, 'PASS', p1.reason);
  assertEqual(p1.requests.map((r) => r.status), [201, 201, 201, 429], 'statuses');
  assertEqual(p1.requests[3].outcome, 'rate_limited', 'fourth outcome');
  assertEqual([p1.hostLabel, p1.origin], ['netlify', stack.appUrl], 'evidence header');
  assert(p1.requests.every((r) => r.n >= 1 && r.n <= 4), 'four numbered requests');
  return `${p1.requests.map((r) => `${r.status} ${r.outcome}`).join(', ')}`;
});

await t.check('the P1 evidence carries no token, message text or address', async () => {
  const text = JSON.stringify(p1);
  for (const forbidden of [ownerA.token, 'Release check P1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.0.2.2', 'finderToken']) {
    assert(!text.includes(forbidden), `evidence contains ${forbidden}`);
  }
  assert(p1Logs.some((line) => line.startsWith('P1 PASS')), 'the verdict was logged');
  return `${text.length} bytes of evidence`;
});

// The negative control: a loopback stand-in host that trusts the visitor's
// forged headers, four different finders, all four 201. P1 must report FAIL.
const standIn = { starts: 0, bothHeaders: 0, perAddress: new Map() };
const stub = http.createServer((request, response) => {
  let raw = '';
  request.on('data', (chunk) => { raw += chunk; });
  request.on('end', () => {
    const send = (status, payload) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    };
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      return send(400, { error: { code: 'invalid_request' } });
    }
    if (body.op === 'public.status') return send(200, { available: true, hint: null });
    if (body.op !== 'public.start') return send(400, { error: { code: 'unknown_op' } });
    standIn.starts += 1;
    const forged = request.headers['x-nf-client-connection-ip'];
    const alsoForged = request.headers['x-vercel-forwarded-for'];
    if (!forged || !alsoForged || forged !== alsoForged) {
      // P1 must send the same forged value in BOTH headers (§6 step 2).
      return send(500, { error: { code: 'stand-in-wants-both-headers' } });
    }
    standIn.bothHeaders += 1;
    const address = String(forged).split(',')[0];
    const seen = (standIn.perAddress.get(address) ?? 0) + 1;
    standIn.perAddress.set(address, seen);
    if (seen > 3) return send(429, { error: { code: 'rate_limited', retryAfter: 60 } });
    return send(201, { finderToken: 'never-printed', replayed: false, thread: { status: 'open' } });
  });
});
await new Promise((resolve, reject) => {
  stub.once('error', reject);
  stub.listen(0, '127.0.0.1', resolve);
});
const stubBase = `http://127.0.0.1:${stub.address().port}`;

await t.check('negative control: a host that trusts the forged header makes P1 report FAIL', async () => {
  const evidence = await runP1({ base: stubBase, slug: 'p1-stand-in', hostLabel: 'vercel', log: noop });
  assertEqual(evidence.verdict, 'FAIL', evidence.reason);
  assertEqual(evidence.requests.map((r) => r.status), [201, 201, 201, 201], 'four different finders');
  assertEqual([standIn.starts, standIn.bothHeaders, standIn.perAddress.size], [4, 4, 4], 'four starts, both headers, four addresses');
  return evidence.reason;
});

await t.check('P1 refuses a production host before any request', async () => {
  let calls = 0;
  const countingFetch = (...args) => { calls += 1; return globalThis.fetch(...args); };
  for (const base of ['https://www.shygontech.com', 'https://shygontech.com']) {
    let message = '';
    try {
      await runP1({ base, slug: 'anything', fetchImpl: countingFetch, log: noop });
    } catch (error) {
      message = String(error.message);
    }
    assert(/production host/.test(message), `${base}: ${message || 'no refusal'}`);
  }
  assertEqual(calls, 0, 'requests sent to production');
  return 'two production origins refused, 0 requests';
});

await t.check('P1 refuses plain http for a non-loopback host', async () => {
  let calls = 0;
  const countingFetch = (...args) => { calls += 1; return globalThis.fetch(...args); };
  let message = '';
  try {
    await runP1({ base: 'http://preview.example.test', slug: 'anything', fetchImpl: countingFetch, log: noop });
  } catch (error) {
    message = String(error.message);
  }
  assert(/https/.test(message), `no refusal: ${message}`);
  assertEqual(calls, 0, 'requests sent over plain http');
  return 'refused before any request';
});

await t.check('P1 is INCONCLUSIVE, and sends no public.start, when the relay is unavailable', async () => {
  await setSwitch('RESCUE_RELAY', false);
  try {
    const evidence = await runP1({ base: stack.appUrl, slug: 'p1-preview-check', hostLabel: 'netlify', log: noop });
    assertEqual(evidence.verdict, 'INCONCLUSIVE', evidence.reason);
    assertEqual(evidence.requests.length, 0, 'public.start calls while unavailable');
    assertEqual(evidence.preflight.available, false, 'preflight');
    return evidence.reason;
  } finally {
    await setSwitch('RESCUE_RELAY', true);
  }
});

// ---------------------------------------------------------------------------
t.section('B. P2: Connect through /api/connect (B-10 §11.2)');

const owner = await signUp(stack, { name: 'P2 Owner' });
await stack.query(
  `INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
   VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'p2-owner-check', 'p2-owner-check', 'P2 Owner', 'active')`,
  [owner.userId],
);
// The granted field must be readable: values are set here and never printed.
await stack.query(`UPDATE public.profiles SET email = $2, company = $3, phone = $4 WHERE id = $1`, [
  owner.userId, 'p2.owner@example.test', 'Preview Check Co', '+919800000000',
]);
const visitor = await signUp(stack, { name: 'P2 Visitor' });
// Phase on declines and blocks for real, each with a requester of its own.
const decliner = await signUp(stack, { name: 'P2 Decliner' });
const blocked = await signUp(stack, { name: 'P2 Blocked' });

const runP2quiet = (phase, log = noop, extra = {}) =>
  runP2({ base: stack.appUrl, ownerToken: owner.token, visitorToken: visitor.token, slug: 'p2-owner-check', phase, hostLabel: 'vercel', log, ...extra });
const realEndings = { declineToken: decliner.token, blockToken: blocked.token };
let p2OffEvidence = null;
let p2OnEvidence = null;

await t.check('phase off: the switch locks what starts, never what stops, and adds no ledger row', async () => {
  await setSwitch('CONNECT_PUBLIC', false);
  const lines = [];
  const evidence = await runP2quiet('off', (line) => lines.push(String(line)));
  p2OffEvidence = evidence;
  assertEqual(evidence.verdict, 'PASS', evidence.reason);
  assertEqual(evidence.checks.filter((c) => !c.ok).map((c) => c.id), [], 'failed checks');
  assertEqual(evidence.dbChecklist.length, 1, 'database checklist lines');
  assert(lines.some((line) => line.includes('@example.test')), 'the test-account reminder was printed');
  return `${evidence.checks.length} checks, ${evidence.dbChecklist.length} checklist line`;
});

await t.check('phase on: the §11.2 journey - settings, request, accept, scope, refused widening, real decline, real block, remove', async () => {
  await setSwitch('CONNECT_PUBLIC', true);
  const evidence = await runP2quiet('on', noop, realEndings);
  p2OnEvidence = evidence;
  assertEqual(evidence.verdict, 'PASS', evidence.reason);
  assertEqual(evidence.checks.filter((c) => !c.ok).map((c) => c.id), [], 'failed checks');
  assertEqual(evidence.declineAndBlock, 'real', 'decline and block ran for real');
  for (const kind of ['decline', 'block']) {
    assert(evidence.checks.some((c) => c.id.startsWith(`a new request from the ${kind} account is refused`)), `${kind}: re-request checked`);
  }
  assertEqual(evidence.dbChecklist.length, 4, 'database checklist lines');
  assert(evidence.dbChecklist.every((line) => line.includes('consent_grants')), 'the checklist names the table to inspect');
  return `${evidence.checks.length} checks, ${evidence.dbChecklist.length} checklist lines`;
});

await t.check('hosted phase on without the decline and block accounts is INCONCLUSIVE before any write', async () => {
  const ops = [];
  // A stand-in for a hosted preview: nothing leaves the process.
  const fakeFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    ops.push(body.op);
    const answer = body.op === 'settings.get' ? { settings: { enabled: true, publicAllowed: true } } : { consents: [] };
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const evidence = await runP2({
    base: 'https://preview.example.test', ownerToken: 'x', visitorToken: 'y', slug: 'p2-owner-check', phase: 'on', fetchImpl: fakeFetch, log: noop,
  });
  assertEqual(evidence.verdict, 'INCONCLUSIVE', evidence.reason);
  assert(/P2_DECLINE_TOKEN/.test(evidence.reason), evidence.reason);
  assertEqual(ops, ['settings.get', 'consents.list'], 'only the read-only preflight ran');
  return evidence.reason.slice(0, 70);
});

await t.check('phase off withdraws a connection an earlier run left open', async () => {
  const pending = await callFunction(stack, 'connect', {
    token: visitor.token,
    body: { op: 'requests.create', slug: 'p2-owner-check', idempotencyKey: crypto.randomUUID(), share: ['company'] },
  });
  assertEqual(pending.status, 201, `a leftover connection: ${JSON.stringify(pending.body)}`);
  await setSwitch('CONNECT_PUBLIC', false);
  const evidence = await runP2quiet('off');
  assertEqual(evidence.verdict, 'PASS', evidence.reason);
  const removed = evidence.checks.find((c) => c.id.startsWith('connections.remove works while the switch is off'));
  assert(removed?.ok, 'the leftover connection was withdrawn while the switch was off');
  return removed.actual;
});

await t.check('P2 is INCONCLUSIVE when P2_PHASE disagrees with the host switch', async () => {
  await setSwitch('CONNECT_PUBLIC', false);
  const whileOff = await runP2quiet('on');
  assertEqual(whileOff.verdict, 'INCONCLUSIVE', whileOff.reason);
  assert(/CONNECT_PUBLIC off/.test(whileOff.reason), whileOff.reason);
  await setSwitch('CONNECT_PUBLIC', true);
  const whileOn = await runP2quiet('off');
  assertEqual(whileOn.verdict, 'INCONCLUSIVE', whileOn.reason);
  assert(/CONNECT_PUBLIC on/.test(whileOn.reason), whileOn.reason);
  assertEqual(whileOff.checks.length + whileOn.checks.length, 0, 'checks run against a host in the wrong phase');
  return 'both disagreements inconclusive, no checks run';
});

await t.check('P2 refuses a production host and a bad phase before any request', async () => {
  let calls = 0;
  const countingFetch = (...args) => { calls += 1; return globalThis.fetch(...args); };
  const refuse = async (overrides) => {
    let message = '';
    try {
      await runP2({
        base: stack.appUrl, ownerToken: 'x', visitorToken: 'y', slug: 'p2-owner-check', phase: 'off',
        fetchImpl: countingFetch, log: noop, ...overrides,
      });
    } catch (error) {
      message = String(error.message);
    }
    return message;
  };
  const production = await refuse({ base: 'https://www.shygontech.com' });
  assert(/production host/.test(production), production || 'no refusal');
  const badPhase = await refuse({ phase: 'yes' });
  assert(/P2_PHASE/.test(badPhase), badPhase || 'no refusal');
  assertEqual(calls, 0, 'requests sent before the refusal');
  return 'production host and bad phase refused, 0 requests';
});

await t.check('the P2 evidence carries no token, shared value or address', async () => {
  assert(p2OffEvidence && p2OnEvidence, 'both phases ran first');
  const text = JSON.stringify([p2OffEvidence, p2OnEvidence]);
  for (const forbidden of [owner.token, visitor.token, decliner.token, blocked.token, 'p2.owner@example.test', 'Preview Check Co', '+919800000000', 'Release check']) {
    assert(!text.includes(forbidden), `evidence contains ${forbidden}`);
  }
  return `${text.length} bytes of evidence over both phases`;
});

// ---------------------------------------------------------------------------
stub.closeAllConnections?.();
await new Promise((resolve) => stub.close(resolve));
await stack.close();
process.exit(t.finish() ? 0 : 1);
