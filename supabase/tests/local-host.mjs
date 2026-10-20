// The local stack's web host reports the visitor's address the way Netlify
// does: from the connection, never from a header the browser sends (B-9,
// V6-124). Local development only: nothing here touches netlify/, api/ or a
// migration.
//
// Part A: the header rule itself (functionHeaders). Part B: over HTTP on the
// stack, through the real Return-to-Owner function, whose per-finder limit
// (3 new threads an hour) shows which address the function received.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/local-host.mjs
import { ADDRESS_HEADERS, SIM_CLIENT_HEADER, functionHeaders } from '../local/app-host.mjs';
import { startStack } from '../local/stack.mjs';
import { assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

const t = createHarness('Local host: the visitor address (B-9)');
const ADDRESS = 'x-nf-client-connection-ip';
const forged = {
  'x-nf-client-connection-ip': '8.8.8.8',
  'x-vercel-forwarded-for': '8.8.4.4',
  'x-real-ip': '1.1.1.1',
  'x-forwarded-for': '9.9.9.9, 127.0.0.1',
};
const seen = (incoming, remote, options) => {
  const r = functionHeaders(incoming, remote, options);
  return r.error ? { error: r.error } : { address: r.headers.get(ADDRESS), names: [...r.headers.keys()].sort() };
};

// ---------------------------------------------------------------------------
t.section('A. The header rule');

await t.check('every address header the browser sends is dropped; the socket address is set', async () => {
  const r = seen({ ...forged, authorization: 'Bearer x', 'content-type': 'application/json' }, '127.0.0.1');
  assertEqual(r.address, '127.0.0.1', 'address');
  assertEqual(r.names, ['authorization', 'content-type', ADDRESS], 'only the browser headers that are not addresses survive');
  for (const name of ADDRESS_HEADERS.filter((n) => n !== ADDRESS)) assertEqual(r.names.includes(name), false, name);
  return `${ADDRESS_HEADERS.length} address headers dropped`;
});

await t.check('IPv4-mapped loopback is reported as 127.0.0.1; IPv6 loopback as ::1', async () => {
  assertEqual(seen({}, '::ffff:127.0.0.1').address, '127.0.0.1', 'mapped');
  assertEqual(seen({}, '::1').address, '::1', 'v6');
  return 'as a host reports them';
});

await t.check('the simulator is off by default: its header is dropped and ignored', async () => {
  const r = seen({ [SIM_CLIENT_HEADER]: '192.0.2.10' }, '127.0.0.1');
  assertEqual([r.address, r.names.includes(SIM_CLIENT_HEADER)], ['127.0.0.1', false], 'flag off');
  return 'STACK_SIM_CLIENT_ADDRESS unset';
});

await t.check('with the flag, a loopback caller may name a documentation address, or none', async () => {
  const on = { simClientAddress: true };
  for (const value of ['192.0.2.10', '198.51.100.0', '203.0.113.255']) assertEqual(seen({ [SIM_CLIENT_HEADER]: value }, '127.0.0.1', on).address, value, value);
  assertEqual(seen({ [SIM_CLIENT_HEADER]: 'none' }, '::1', on).address, null, 'none: no address header at all');
  assertEqual(seen({ [SIM_CLIENT_HEADER]: '198.51.100.7', ...forged }, '127.0.0.1', on).address, '198.51.100.7', 'forged headers still dropped');
  assertEqual(seen({}, '127.0.0.1', on).address, '127.0.0.1', 'no simulator header: the socket');
  return 'RFC 5737 only';
});

await t.check('with the flag, anything but a documentation address is refused; a non-loopback caller is ignored', async () => {
  const on = { simClientAddress: true };
  for (const value of ['8.8.8.8', '203.0.113.256', '198.51.100.7, 1.2.3.4', '2001:db8::1', '', ' 192.0.2.300 ']) {
    const r = seen({ [SIM_CLIENT_HEADER]: value }, '127.0.0.1', on);
    assertEqual(Boolean(r.error), true, `refused: ${JSON.stringify(value)}`);
  }
  assertEqual(seen({ [SIM_CLIENT_HEADER]: '192.0.2.10' }, '10.0.0.5', on).address, '10.0.0.5', 'non-loopback caller');
  return 'a real address can never be simulated';
});

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack (the real /api/rescue)');

const stack = await startStack();
delete process.env.STACK_SIM_CLIENT_ADDRESS;
process.env.RESCUE_RELAY = 'on';
const key = () => crypto.randomUUID();
const codeOf = (r) => r.body?.error?.code;
const start = (slug, headers = {}) =>
  callFunction(stack, 'rescue', { body: { op: 'public.start', slug, idempotencyKey: key(), message: 'Found your card' }, headers });

async function ownerWithRelay(name, slug) {
  const owner = await signUp(stack, { name });
  await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
    VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, $3, 'active')`, [owner.userId, slug, name]);
  const set = await callFunction(stack, 'rescue', { token: owner.token, body: { op: 'settings.set', enabled: true } });
  assertEqual([set.status, set.body.settings.enabled, set.body.settings.relayAllowed], [200, true, true], `${name} relay on`);
  return slug;
}
const first = await ownerWithRelay('Asha Host', 'asha-host');
const second = await ownerWithRelay('Ben Host', 'ben-host');

await t.check('a plain browser request works: the host supplies the address (the B-9 defect)', async () => {
  const r = await start(first);
  assertEqual(r.status, 201, JSON.stringify(r.body));
  return 'before B-9 this answered 404 unavailable';
});

await t.check('forged address headers are ignored: every request is the same finder, limited after 3 an hour', async () => {
  const results = [];
  for (const value of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
    const r = await start(first, { 'x-nf-client-connection-ip': value, 'x-vercel-forwarded-for': value, 'x-real-ip': value, 'x-forwarded-for': value });
    results.push(r.status === 201 ? 201 : codeOf(r));
  }
  assertEqual(results, [201, 201, 'rate_limited'], 'one finder, whatever the headers say');
  return '3 per finder per hour (031)';
});

await t.check('without the flag, the simulator header is ignored too', async () => {
  assertEqual(codeOf(await start(second, { [SIM_CLIENT_HEADER]: '192.0.2.10' })), 'rate_limited', 'still the socket finder');
  return 'off by default';
});

await t.check('with the flag: a documentation address is a different finder; none fails closed; a real address is refused', async () => {
  process.env.STACK_SIM_CLIENT_ADDRESS = '1';
  try {
    const distinct = await start(second, { [SIM_CLIENT_HEADER]: '192.0.2.10' });
    assertEqual(distinct.status, 201, JSON.stringify(distinct.body));
    assertEqual(codeOf(await start(second, { [SIM_CLIENT_HEADER]: 'none' })), 'unavailable', 'no address from the host');
    const real = await start(second, { [SIM_CLIENT_HEADER]: '8.8.8.8' });
    assertEqual([real.status, /RFC 5737/.test(real.body?.error ?? '')], [400, true], 'refused by the host');
    assertEqual(codeOf(await start(second, { 'x-nf-client-connection-ip': '192.0.2.99' })), 'rate_limited', 'a forged header is still dropped');
  } finally {
    delete process.env.STACK_SIM_CLIENT_ADDRESS;
  }
  return 'loopback and RFC 5737 only';
});

delete process.env.RESCUE_RELAY;
await stack.close();
process.exit(t.finish() ? 0 : 1);
