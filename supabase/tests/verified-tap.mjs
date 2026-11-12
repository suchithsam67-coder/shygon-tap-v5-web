// Verified Tap (U1): migration 037 and /api/verify on the local stack, against
// DEC-2026-043 §7. A simulated SDM chip (DESFire EV3; AN12196 §3.4, built from
// netlify/lib/sun.mjs) produces the SUN values; the keys are random per run,
// TEST KEYS ONLY, and never leave this process.
//
// Not executable here, and therefore not claimed: a database failure part-way
// through a transaction (§7 test 14) and a restore rolling the counter back
// (§7 test 15; the external acceptance log waits for DEC-2026-043 Q2).
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/verified-tap.mjs
import crypto from 'node:crypto';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';
import { diversifyKey, sdmMac, sdmSessionMacKey } from '../../netlify/lib/sun.mjs';

const t = createHarness('Verified Tap (037, /api/verify, DEC-2026-043)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
const META_MASTER = hex(16);
const FILE_MASTER = hex(16);
const PEPPER = hex(32);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const newCode = () => Array.from(crypto.randomBytes(16), (b) => BASE32[b % 32]).join('');
const uidHmac = (uid) => crypto.createHmac('sha256', PEPPER).update(uid.toLowerCase()).digest('hex');

/** A simulated chip: PICC data = AES-128-CBC (zero IV) of C7 || UID || counter (LSB first) || padding; MAC over an empty input. */
function chip(cardId, uid, masters = { meta: META_MASTER, file: FILE_MASTER }) {
  const input = Buffer.from(cardId.replace(/-/g, ''), 'hex');
  const meta = diversifyKey(masters.meta, input);
  const file = diversifyKey(masters.file, input);
  return (counter, { macCounter = counter } = {}) => {
    const block = Buffer.concat([Buffer.from([0xc7]), Buffer.from(uid, 'hex'),
      Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]), crypto.randomBytes(5)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(meta, 'hex'), Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(block), cipher.final()]).toString('hex').toUpperCase();
    const c = sdmMac(sdmSessionMacKey(file, uid, macCounter), '').toUpperCase();
    return { e, c };
  };
}

const stack = await startStack();
process.env.STACK_SIM_CLIENT_ADDRESS = '1';
const answers = [];
const call = async (body, ip = '203.0.113.90', method = 'POST') => {
  const r = method === 'POST'
    ? await callFunction(stack, 'verify', { body, headers: { 'x-shygon-sim-client': ip } })
    : await (async () => {
      const res = await fetch(`${stack.appUrl}/api/verify`, { method, headers: { 'x-shygon-sim-client': ip } });
      return { status: res.status, body: await res.json().catch(() => null) };
    })();
  answers.push(JSON.stringify(r.body));
  return r;
};
const codeOf = (r) => r.body?.error?.code;
// jsonb does not keep key order, so objects are compared with their keys sorted.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b, label) => assertEqual(canon(a), canon(b), label);
const events = async (code) => (await stack.query(`SELECT verdict FROM public.tap_verify_events WHERE public_code = $1 ORDER BY created_at`, [code])).rows.map((r) => r.verdict);
const counterOf = async (code) => (await stack.query(`SELECT last_counter AS n FROM public.tap_device_auth WHERE public_code = $1`, [code])).rows[0]?.n ?? null;

/** An owner with a published Tap, an active card and a personalised chip. */
let seq = 0;
async function device({ edition = true, epoch = 1, status = 'active' } = {}) {
  seq++;
  const owner = await signUp(stack, { name: `Verify Owner ${seq}` });
  const slug = `verify-${seq}-${hex(3)}`;
  await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
    VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, 'Verify Owner', 'active')`, [owner.userId, slug]);
  const card = (await stack.query(
    `INSERT INTO public.cards (user_id, tap_profile_id, card_id, activation_code, sku, card_slot, status,
       edition_design, edition_serial, edition_count, edition_chapter_size)
     VALUES ($1, (SELECT id FROM public.tap_profiles WHERE user_id = $1), $2, $3, 'aaroh-test', 1, $4, $5, $6, $7, $8) RETURNING id`,
    // Edition numbers are unique per design (idx_cards_edition_serial): No. 36 + n of 100.
    [owner.userId, `VERIFY-${seq}-${hex(3)}`, `SHY-VER-${hex(3)}`, status,
      edition ? 'Obsidian' : null, edition ? 36 + seq : null, edition ? 100 : null, edition ? 100 : null])).rows[0].id;
  const uid = `04${hex(6)}`;
  const code = newCode();
  await stack.query(`SELECT public.verify_register_device($1, $2, $3, $4)`, [card, code, epoch, uidHmac(uid)]);
  return { owner, slug, card, code, uid, tap: chip(card, uid) };
}

process.env.VERIFY_META_MASTER_1 = META_MASTER;
process.env.VERIFY_FILE_MASTER_1 = FILE_MASTER;
process.env.VERIFY_UID_PEPPER = PEPPER;

// ---------------------------------------------------------------------------
t.section('A. The switch and the request shape');

const a = await device();

await t.check('VERIFIED_TAP off: 404 for everything, and nothing is looked up or consumed', async () => {
  delete process.env.VERIFIED_TAP;
  const r = await call({ op: 'tap.verify', code: a.code, ...a.tap(1) });
  assertEqual([r.status, codeOf(r)], [404, 'unavailable'], 'switch off');
  assertEqual([await counterOf(a.code), await events(a.code)], [null, []], 'nothing consumed');
  process.env.VERIFIED_TAP = 'on';
  return 'off by default';
});

await t.check('a plain GET consumes nothing (405); malformed requests are refused before any lookup', async () => {
  assertEqual((await call(null, undefined, 'GET')).status, 405, 'GET');
  const bad = [
    [{ op: 'constructor', code: a.code }, 'unknown_op'],
    [{ op: 'tap.verify', code: 'NOT-A-CODE' }, 'invalid_request'],
    [{ op: 'tap.verify', code: a.code, e: a.tap(2).e }, 'invalid_request'],
    [{ op: 'tap.verify', code: a.code, e: 'ab', c: 'cd' }, 'invalid_request'],
    [{ op: 'tap.verify', code: a.code, e: 'z'.repeat(32), c: 'z'.repeat(16) }, 'invalid_request'],
    [{ op: 'tap.verify', code: a.code, pad: 'x'.repeat(4000) }, 'invalid_request'],
  ];
  for (const [body, code] of bad) assertEqual(codeOf(await call(body)), code, JSON.stringify(body).slice(0, 60));
  assertEqual([await counterOf(a.code), await events(a.code)], [null, []], 'nothing consumed');
  return `${bad.length} refusals`;
});

await t.check('no SUN values (a QR or a typed link): not_verified, and nothing is consumed', async () => {
  const r = await call({ op: 'tap.verify', code: a.code });
  assertEqual([r.status, r.body], [200, { slug: a.slug, verdict: 'not_verified' }], 'answer');
  assertEqual(await events(a.code), [], 'no event');
  return 'the page works as usual';
});

// ---------------------------------------------------------------------------
t.section('B. Verdicts');

await t.check('a fresh tap is genuine with its edition; the same URL again is already_checked (a copied link)', async () => {
  const tap = a.tap(5);
  const first = await call({ op: 'tap.verify', code: a.code, ...tap });
  same([first.status, first.body], [200, { slug: a.slug, verdict: 'genuine', edition: { design: 'Obsidian', number: 37, of: 100, chapterSize: 100 } }], 'first');
  const again = await call({ op: 'tap.verify', code: a.code, ...tap });
  assertEqual(again.body, { slug: a.slug, verdict: 'already_checked' }, 'replay: calm, no edition');
  assertEqual(await counterOf(a.code), 5, 'counter');
  return 'once per counter';
});

await t.check('counter gaps are accepted; an older counter is refused', async () => {
  assertEqual((await call({ op: 'tap.verify', code: a.code, ...a.tap(20) })).body.verdict, 'genuine', 'gap 5 -> 20');
  assertEqual((await call({ op: 'tap.verify', code: a.code, ...a.tap(15) })).body.verdict, 'already_checked', 'older 15');
  assertEqual(await counterOf(a.code), 20, 'counter stays 20');
  return 'strictly greater';
});

await t.check('a flipped bit in e or c, or a changed counter with an old MAC, is not_confirmed and consumes nothing', async () => {
  const flip = (h, i) => h.slice(0, i) + ((parseInt(h[i], 16) ^ 1).toString(16).toUpperCase()) + h.slice(i + 1);
  const good = a.tap(30);
  const cases = [
    { e: flip(good.e, 7), c: good.c },
    { e: good.e, c: flip(good.c, 3) },
    a.tap(31, { macCounter: 25 }),
  ];
  for (const sun of cases) assertEqual((await call({ op: 'tap.verify', code: a.code, ...sun })).body, { slug: a.slug, verdict: 'not_confirmed' }, 'refused');
  assertEqual(await counterOf(a.code), 20, 'counter unchanged');
  return `${cases.length} forgeries`;
});

await t.check('another chip\'s keys, or the right keys with another UID, are not_confirmed', async () => {
  const b = await device();
  const otherKeys = chip(b.card, a.uid)(40); // b's keys, a's UID
  assertEqual((await call({ op: 'tap.verify', code: a.code, ...otherKeys })).body.verdict, 'not_confirmed', "b's keys on a's code");
  const cloneUid = chip(a.card, `04${hex(6)}`)(41); // a's keys, a different chip UID
  assertEqual((await call({ op: 'tap.verify', code: a.code, ...cloneUid })).body.verdict, 'not_confirmed', 'UID mismatch');
  assertEqual((await call({ op: 'tap.verify', code: b.code, ...b.tap(1) })).body.verdict, 'genuine', 'b itself verifies');
  return 'D-a: keys per device id; UID bound';
});

await t.check('key epochs: no keys for the epoch is unavailable (never genuine); with keys it verifies', async () => {
  const c = await device({ epoch: 2 });
  assertEqual((await call({ op: 'tap.verify', code: c.code, ...c.tap(1) })).body, { slug: c.slug, verdict: 'unavailable' }, 'no epoch-2 keys');
  assertEqual(await counterOf(c.code), null, 'nothing consumed');
  const meta2 = hex(16);
  const file2 = hex(16);
  process.env.VERIFY_META_MASTER_2 = meta2;
  process.env.VERIFY_FILE_MASTER_2 = file2;
  const tap2 = chip(c.card, c.uid, { meta: meta2, file: file2 });
  assertEqual((await call({ op: 'tap.verify', code: c.code, ...tap2(1) })).body.verdict, 'genuine', 'epoch 2 with its keys');
  assertEqual((await call({ op: 'tap.verify', code: a.code, ...a.tap(50) })).body.verdict, 'genuine', 'epoch 1 still verifies');
  delete process.env.VERIFY_FILE_MASTER_2;
  assertEqual((await call({ op: 'tap.verify', code: c.code, ...tap2(2) })).body.verdict, 'unavailable', 'a missing key (a key-service outage) is unavailable');
  return 'fail closed';
});

await t.check('needs_service: the counter at 0xFFFFFF, or a retired card', async () => {
  const d = await device();
  assertEqual((await call({ op: 'tap.verify', code: d.code, ...d.tap(0xffffff) })).body.verdict, 'needs_service', 'counter limit');
  await stack.query(`UPDATE public.tap_device_auth SET retired_at = now() WHERE public_code = $1`, [d.code]);
  assertEqual((await call({ op: 'tap.verify', code: d.code, ...d.tap(3) })).body.verdict, 'needs_service', 'retired');
  assertEqual(await counterOf(d.code), null, 'never accepted');
  return 'never "fake"';
});

await t.check('the edition line appears only after genuine, and only from a complete record', async () => {
  const e = await device({ edition: false });
  const r = await call({ op: 'tap.verify', code: e.code, ...e.tap(1) });
  assertEqual(r.body, { slug: e.slug, verdict: 'genuine' }, 'no edition record, no edition line');
  return 'U4 rule';
});

// ---------------------------------------------------------------------------
t.section('C. Lifecycle, concurrency, limits');

await t.check('unknown code, inactive card, suspended Tap: the neutral 404; a Tap in Lost mode: the lifecycle answer', async () => {
  assertEqual(codeOf(await call({ op: 'tap.verify', code: newCode() })), 'unavailable', 'unknown code');
  const f = await device({ status: 'suspended' });
  assertEqual(codeOf(await call({ op: 'tap.verify', code: f.code, ...f.tap(1) })), 'unavailable', 'suspended card');
  const g = await device();
  await stack.query(`UPDATE public.tap_profiles SET suspended_at = now() WHERE user_id = $1`, [g.owner.userId]);
  assertEqual(codeOf(await call({ op: 'tap.verify', code: g.code, ...g.tap(1) })), 'unavailable', 'suspended Tap');
  const h = await device();
  await stack.query(`INSERT INTO public.tap_mode_state (tap_profile_id, user_id, active_mode)
    SELECT id, user_id, 'lost' FROM public.tap_profiles WHERE user_id = $1`, [h.owner.userId]);
  assertEqual((await call({ op: 'tap.verify', code: h.code, ...h.tap(1) })).body, { slug: h.slug, verdict: null }, 'Lost');
  assertEqual([await counterOf(f.code), await counterOf(g.code), await counterOf(h.code)], [null, null, null], 'nothing consumed');
  return 'no verdict without a live card';
});

await t.check('concurrent checks are serialised: one genuine per counter; a late n after n+1 is calm', async () => {
  const k = await device();
  const same = k.tap(10);
  const twice = await Promise.all([call({ op: 'tap.verify', code: k.code, ...same }), call({ op: 'tap.verify', code: k.code, ...same })]);
  assertEqual(twice.map((r) => r.body.verdict).sort(), ['already_checked', 'genuine'], 'the same tap twice');
  const pair = await Promise.all([call({ op: 'tap.verify', code: k.code, ...k.tap(12) }), call({ op: 'tap.verify', code: k.code, ...k.tap(11) })]);
  assert(pair[0].body.verdict === 'genuine', `n+1: ${pair[0].body.verdict}`);
  assert(['genuine', 'already_checked'].includes(pair[1].body.verdict), `late n: ${pair[1].body.verdict}`);
  assertEqual(await counterOf(k.code), 12, 'counter');
  return 'atomic acceptance';
});

await t.check('no trusted visitor address: unavailable, nothing consumed', async () => {
  const r = await call({ op: 'tap.verify', code: a.code, ...a.tap(60) }, 'none');
  assertEqual(codeOf(r), 'unavailable', 'fail closed');
  assertEqual(await counterOf(a.code), 50, 'unchanged');
});

await t.check('rate limits: 20 refused checks per device per hour; 30 checks per visitor per hour', async () => {
  const m = await device();
  for (let i = 0; i < 20; i++) await call({ op: 'tap.verify', code: m.code, e: hex(16), c: hex(8) }, `198.51.100.${i + 1}`);
  const locked = await call({ op: 'tap.verify', code: m.code, ...m.tap(1) }, '198.51.100.99');
  assertEqual([locked.status, codeOf(locked), locked.body.error.retryAfter], [429, 'rate_limited', 3600], 'device limit');
  const n = await device();
  const ip = '192.0.2.77';
  for (let i = 1; i <= 30; i++) await call({ op: 'tap.verify', code: n.code, ...n.tap(i) }, ip);
  assertEqual(codeOf(await call({ op: 'tap.verify', code: n.code, ...n.tap(31) }, ip)), 'rate_limited', 'visitor limit');
  assertEqual((await call({ op: 'tap.verify', code: n.code, ...n.tap(32) }, '192.0.2.78')).body.verdict, 'genuine', 'another visitor is not blocked');
  return 'an 8-byte MAC cannot be guessed at 20 an hour';
});

// ---------------------------------------------------------------------------
t.section('D. Privacy and closure');

await t.check('canaries: no UID, UID HMAC, key, pepper, e or c in any answer or log line; answers carry only slug / verdict / edition', async () => {
  const secrets = [META_MASTER, FILE_MASTER, PEPPER, a.uid, uidHmac(a.uid), a.tap(70).e];
  const leaks = [];
  for (const [i, text] of [...answers, ...logLines].entries()) {
    for (const s of secrets) if (text.toLowerCase().includes(s.toLowerCase())) leaks.push(`#${i}`);
  }
  assertEqual(leaks, [], 'leaks');
  const shapes = new Set(answers.map((text) => Object.keys(JSON.parse(text) ?? {}).sort().join()));
  for (const shape of shapes) assert(['slug,verdict', 'edition,slug,verdict', 'error'].includes(shape), `answer keys: ${shape}`);
  const cols = (await stack.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tap_verify_events' ORDER BY 1`)).rows.map((r) => r.column_name);
  assertEqual(cols, ['created_at', 'id', 'public_code', 'verdict', 'visitor_digest'], 'the log holds no UID, address or parameter');
  return `${answers.length} answers, ${logLines.length} log lines`;
});

await t.check('closed: no client role can read the tables or execute the functions', async () => {
  const r = (await stack.query(`SELECT
      has_table_privilege('anon', 'public.tap_device_auth', 'SELECT') OR has_table_privilege('authenticated', 'public.tap_device_auth', 'SELECT') AS dev,
      has_table_privilege('anon', 'public.tap_verify_events', 'SELECT') OR has_table_privilege('authenticated', 'public.tap_verify_events', 'SELECT') AS ev,
      has_function_privilege('anon', 'public.verify_device_lookup(text, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.verify_tap_result(text, boolean, text, integer, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.verify_register_device(uuid, text, integer, text)', 'EXECUTE') AS fn,
      has_table_privilege('service_role', 'public.tap_verify_events', 'UPDATE') AS ev_update`)).rows[0];
  assertEqual(r, { dev: false, ev: false, fn: false, ev_update: false }, 'closure');
  return 'server only; the log is append-only';
});

await t.check('a code is never reused, and a card holds one chip', async () => {
  const p = await device();
  const reuse = await stack.query(`SELECT public.verify_register_device($1, $2, 1, $3)`, [p.card, p.code, uidHmac(p.uid)]).then(() => 'accepted', (e) => e.message);
  assert(/verify:code_used|verify:card_registered/.test(reuse), reuse);
  await stack.query(`DELETE FROM public.cards WHERE id = $1`, [p.card]);
  const q = await device();
  const again = await stack.query(`SELECT public.verify_register_device($1, $2, 1, $3)`, [q.card, p.code, uidHmac(q.uid)]).then(() => 'accepted', (e) => e.message);
  assert(/verify:code_used|verify:card_registered/.test(again), `after the card was deleted: ${again}`);
  return 'the code row outlives its card';
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
