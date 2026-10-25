// Modes and Info (migration 034, /api/modes, get_public_tap_mode; DEC-2026-041).
//
// Part A: the database is closed to every client role, the catalogue ships
// with Info off, and the audit is append-only. Part B: the real server function
// and the public reader on the local stack: switching, validation, versions,
// idempotency, the "unavailable" fallbacks, cross-account refusals, and privacy
// canaries on every public output and error body.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/modes.mjs
import { createMigratedDb } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

const t = createHarness('Modes and Info (034)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}
const TABLES = ['tap_mode_catalog', 'info_pages', 'tap_mode_state', 'tap_mode_audit'];

// ---------------------------------------------------------------------------
t.section('A. Database');

const db = await createMigratedDb();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);

await t.check('every mode table: RLS on, no policy, no privilege for anon or authenticated', async () => {
  for (const table of TABLES) {
    const r = (await db.query(`SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
      FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [table])).rows[0];
    assert(r.rls && r.policies === 0 && !r.anon && !r.auth, `${table}: ${JSON.stringify(r)}`);
  }
  return `${TABLES.length} tables closed`;
});

await t.check('only get_public_tap_mode is open to visitors; every modes_* function is server-only', async () => {
  const rows = (await db.query(`SELECT p.proname AS name,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS server
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND (p.proname LIKE 'modes\\_%' OR p.proname = 'get_public_tap_mode') ORDER BY 1`)).rows;
  const open = rows.filter((r) => r.name !== 'get_public_tap_mode' && (r.anon || r.auth || !r.server)).map((r) => r.name);
  assertEqual(open, [], 'server-only functions reachable by a client role');
  const reader = rows.find((r) => r.name === 'get_public_tap_mode');
  assertEqual([reader.anon, reader.auth, reader.server], [true, true, true], 'public reader');
  return `${rows.length - 1} server-only functions, 1 public reader`;
});

await t.check('the catalogue ships with Business on and Info OFF (switching it on is a per-environment owner decision)', async () => {
  const rows = (await db.query(`SELECT mode, enabled FROM public.tap_mode_catalog ORDER BY mode`)).rows;
  assertEqual(rows.map((r) => [r.mode, r.enabled]), [['business', true], ['info', false]], 'catalogue');
  return 'Info off by default';
});

await t.check('the mode audit is append-only, even for the server role', async () => {
  const r = (await db.query(`SELECT has_table_privilege('service_role', 'public.tap_mode_audit', 'UPDATE') AS u,
    has_table_privilege('service_role', 'public.tap_mode_audit', 'DELETE') AS d`)).rows[0];
  assertEqual([r.u, r.d], [false, false], 'update/delete');
  return 'insert only';
});
await db.close();

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack');

const stack = await startStack();
const bodies = [];
const call = async (body, token) => {
  const r = await callFunction(stack, 'modes', { token, body });
  bodies.push(JSON.stringify(r.body));
  return r;
};
const codeOf = (r) => r.body?.error?.code;
// jsonb does not keep key order, so objects are compared with their keys sorted.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b, label) => assertEqual(canon(a), canon(b), label);
const key = () => crypto.randomUUID().replace(/-/g, '');
const publicReads = [];
const rpc = async (fn, slug) => {
  const res = await fetch(`${stack.gatewayUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: stack.keys.anonKey, Authorization: `Bearer ${stack.keys.anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_slug: slug }),
  });
  const text = await res.text();
  publicReads.push(text);
  return text ? JSON.parse(text) : null;
};
const pub = (slug) => rpc('get_public_tap_mode', slug);
const legacy = (slug) => rpc('get_public_profile', slug);

// Canaries: values that must never reach a public output, an error body or a log.
// (The draft text is checked separately: it is private only until its owner
// makes Info live, which is exactly what publishing means.)
const C = {
  accountPhone: '+919811177001', accountEmail: 'canary.account@example.test',
  hiddenWhatsapp: '+919811177002', rejected: 'CANARY-REJECTED-VALUE',
};
const DRAFT = 'CANARY-DRAFT-TEXT';
const asha = await signUp(stack, { name: 'Asha Modes' });
const ben = await signUp(stack, { name: 'Ben NoTap' });
const cara = await signUp(stack, { name: 'Cara Other' });
await stack.query(`UPDATE public.profiles SET phone = $2, email = $3 WHERE id = $1`, [asha.userId, C.accountPhone, C.accountEmail]);
await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, headline, status, whatsapp)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'asha-modes', 'asha-modes', 'Asha Rao', 'Designer', 'active', $2)`,
[asha.userId, C.hiddenWhatsapp]);
await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'cara-modes', 'cara-modes', 'Cara', 'active')`, [cara.userId]);
const SLUG = 'asha-modes';
const setInfo = (on) => stack.query(`UPDATE public.tap_mode_catalog SET enabled = $1 WHERE mode = 'info'`, [on]);
const lastEdit = async () => (await stack.query(`SELECT last_content_edit_at AS t FROM public.tap_profiles WHERE user_id = $1`, [asha.userId])).rows[0].t;

let businessView;
await t.check('a Tap without mode state is Business: the reader returns exactly the get_public_profile payload', async () => {
  const p = await pub(SLUG);
  businessView = await legacy(SLUG);
  assert(businessView && businessView.displayName === 'Asha Rao', 'business payload present');
  same(p, { mode: 'business', profile: businessView }, 'reader');
  assertEqual(await pub('nobody-here'), null, 'unknown Tap');
  return 'unchanged for every existing Tap';
});

await t.check('no sign-in, no access: every owner operation is 401, whatever the body claims', async () => {
  for (const op of ['owner.state', 'owner.activate', 'owner.info.get', 'owner.info.save', 'owner.info.clear', 'owner.preview']) {
    const r = await call({ op, role: 'owner', userId: asha.userId, mode: 'info', expectedVersion: 0, idempotencyKey: key(), fields: {} });
    assertEqual([r.status, codeOf(r)], [401, 'unauthenticated'], op);
  }
  assertEqual(codeOf(await call({ op: 'owner.state' }, 'not-a-real-token')), 'unauthenticated', 'forged token');
  return 'role from the verified token only';
});

await t.check('Info is not available while SHYGON has it off in the catalogue', async () => {
  const s = await call({ op: 'owner.state' }, asha.token);
  assertEqual([s.status, s.body.activeMode, s.body.version], [200, 'business', 0], 'state');
  same(s.body.modes.find((m) => m.mode === 'info'), { mode: 'info', available: false, reason: 'not_available' }, 'info');
  const a = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 0, idempotencyKey: key() }, asha.token);
  assertEqual([a.status, codeOf(a)], [409, 'mode_unavailable'], 'activate');
  return 'switched off by default';
});
await setInfo(true);

await t.check('with Info on: needs setup until title and short description exist', async () => {
  const s = await call({ op: 'owner.state' }, asha.token);
  same(s.body.modes.find((m) => m.mode === 'info'), { mode: 'info', available: false, reason: 'needs_setup', missing: ['title', 'shortDescription'] }, 'info');
  const a = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 0, idempotencyKey: key() }, asha.token);
  assertEqual([a.status, codeOf(a), a.body.error.missing], [409, 'needs_setup', ['title', 'shortDescription']], 'activate');
  return 'missing fields named';
});

await t.check('validation: plain text within limits, allowed categories, known fields only; no submitted value echoed', async () => {
  const bad = [
    [{ title: 'x'.repeat(121) }, 'title', 'too_long'],
    [{ title: `<script>${C.rejected}</script>` }, 'title', 'markup'],
    [{ shortDescription: `line one\n${C.rejected}` }, 'shortDescription', 'control_characters'],
    [{ category: 'castle' }, 'category', 'not_allowed'],
    [{ image: 'https://example.test/a.png' }, 'image', 'unknown'],
    [{ title: 42 }, 'title', 'not_text'],
    [{ detailedInformation: 'y'.repeat(2001) }, 'detailedInformation', 'too_long'],
  ];
  for (const [fields, field, reason] of bad) {
    const r = await call({ op: 'owner.info.save', fields, expectedVersion: 0 }, asha.token);
    assertEqual([r.status, codeOf(r), r.body.error.field, r.body.error.reason], [422, 'invalid_field', field, reason], `${field} ${reason}`);
    assert(!JSON.stringify(r.body).includes(C.rejected), 'an error echoed a submitted value');
  }
  return `${bad.length} refusals`;
});

await t.check('saving: versions guard stale writes; a draft is not public; Business keeps its edit window', async () => {
  const before = await lastEdit();
  const s1 = await call({ op: 'owner.info.save', fields: { title: 'Room 204 projector' }, expectedVersion: 0 }, asha.token);
  assertEqual([s1.status, s1.body.publicationStatus, s1.body.info.version], [200, 'draft', 1], 'first save');
  const stale = await call({ op: 'owner.info.save', fields: { title: 'Again' }, expectedVersion: 0 }, asha.token);
  assertEqual([stale.status, codeOf(stale), stale.body.error.current], [409, 'stale_version', { version: 1 }], 'stale');
  const s2 = await call({ op: 'owner.info.save', expectedVersion: 1, fields: {
    shortDescription: 'How to use the projector in room 204.', category: 'equipment',
    detailedInformation: `1. Press the wall switch.\n2. Wait 30 seconds.\n${DRAFT}` } }, asha.token);
  assertEqual([s2.status, s2.body.publicationStatus, s2.body.info.version], [200, 'ready', 2], 'complete');
  const whileDraft = await pub(SLUG);
  same(whileDraft, { mode: 'business', profile: businessView }, 'still Business publicly');
  assert(!JSON.stringify(whileDraft).includes(DRAFT) && !JSON.stringify(await legacy(SLUG)).includes(DRAFT), 'the unpublished draft reached a public read');
  assertEqual(String(await lastEdit()), String(before), 'tap_profiles.last_content_edit_at unchanged');
  return 'draft → ready, nothing public yet';
});

let firstKey;
let activated;
await t.check('activate Info: version, idempotent replay, one audit row; the reader shows only the allowlisted fields', async () => {
  const stale = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 5, idempotencyKey: key() }, asha.token);
  same([stale.status, codeOf(stale), stale.body.error.current], [409, 'stale_version', { activeMode: 'business', version: 0 }], 'stale');
  firstKey = key();
  activated = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 0, idempotencyKey: firstKey }, asha.token);
  assertEqual([activated.status, activated.body.activeMode, activated.body.previousMode, activated.body.version, activated.body.replayed],
    [200, 'info', 'business', 1, false], 'activated');
  const again = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 0, idempotencyKey: firstKey }, asha.token);
  assertEqual([again.status, again.body.version, again.body.replayed], [200, 1, true], 'replay');
  const audits = (await stack.query(`SELECT count(*)::int AS n FROM public.tap_mode_audit WHERE user_id = $1 AND action = 'activate'`, [asha.userId])).rows[0].n;
  assertEqual(audits, 1, 'audit rows');
  const p = await pub(SLUG);
  assertEqual(Object.keys(p).sort(), ['info', 'mode'], 'shape');
  assertEqual(p.mode, 'info', 'mode');
  assertEqual(Object.keys(p.info).sort(), ['category', 'detailedInformation', 'shortDescription', 'title', 'updatedAt'], 'allowlist');
  assertEqual([p.info.title, p.info.category], ['Room 204 projector', 'equipment'], 'content');
  return 'Live only after the server answered';
});

await t.check('BQ-1 (035): while Info is live the legacy reader returns null; older clients take their existing unavailable path', async () => {
  const pv = await call({ op: 'owner.preview', mode: 'info' }, asha.token);
  same(pv.body.view, (await pub(SLUG)).info, 'info preview');
  const pb = await call({ op: 'owner.preview', mode: 'business' }, asha.token);
  assertEqual(pb.body.view, null, 'business preview while Info is live (035)');
  assertEqual(await legacy(SLUG), null, 'get_public_profile while Info is live');
  assertEqual(await rpc('get_public_tap_state', SLUG), 'active', 'P-2 still active: an older client shows its "Tap not found" page');
  same(await legacy('cara-modes'), (await pub('cara-modes')).profile, 'a Tap on Business is unaffected');
  return 'Business never public through the old reader while Info is shown';
});

await t.check('while Info is live it cannot become incomplete or be cleared', async () => {
  const clear = await call({ op: 'owner.info.clear' }, asha.token);
  assertEqual([clear.status, codeOf(clear)], [409, 'mode_active'], 'clear');
  const blank = await call({ op: 'owner.info.save', fields: { title: null }, expectedVersion: 2 }, asha.token);
  assertEqual([blank.status, codeOf(blank)], [409, 'mode_active'], 'blank title');
  return 'switch to Business first';
});

await t.check('other accounts: no Tap is 404; another owner changes only their own Tap', async () => {
  for (const op of ['owner.state', 'owner.info.get', 'owner.info.clear']) {
    const r = await call({ op }, ben.token);
    assertEqual([r.status, codeOf(r)], [404, 'no_tap'], `${op} without a Tap`);
  }
  const c = await call({ op: 'owner.activate', mode: 'info', expectedVersion: 0, idempotencyKey: key() }, cara.token);
  assertEqual([c.status, codeOf(c)], [409, 'needs_setup'], "Cara's own Tap");
  assertEqual((await pub(SLUG)).mode, 'info', "Asha's Tap untouched");
  assertEqual((await pub('cara-modes')).mode, 'business', "Cara's Tap still Business");
  return 'scoped by the verified user';
});

await t.check('fallbacks: Info off, invalid, missing, paused or suspended gives "unavailable" (null), never Business', async () => {
  await setInfo(false);
  assertEqual(await pub(SLUG), null, 'F-1 switched off by SHYGON');
  assertEqual(await legacy(SLUG), null, 'F-1: and not Business through the legacy reader either (BQ-2)');
  await setInfo(true);
  await stack.query(`UPDATE public.info_pages SET detailed_information = '<b>broken' WHERE owner_user_id = $1`, [asha.userId]);
  assertEqual(await pub(SLUG), null, 'F-3 invalid at read time');
  await stack.query(`UPDATE public.info_pages SET detailed_information = 'Press the wall switch.' WHERE owner_user_id = $1`, [asha.userId]);
  assertEqual((await pub(SLUG)).mode, 'info', 'restored');
  const saved = (await stack.query(`SELECT * FROM public.info_pages WHERE owner_user_id = $1`, [asha.userId])).rows[0];
  await stack.query(`DELETE FROM public.info_pages WHERE owner_user_id = $1`, [asha.userId]);
  assertEqual(await pub(SLUG), null, 'F-2 missing record');
  await stack.query(`INSERT INTO public.info_pages (id, owner_user_id, title, short_description, category, detailed_information, version)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [saved.id, saved.owner_user_id, saved.title, saved.short_description, saved.category, saved.detailed_information, saved.version]);
  await stack.query(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [asha.userId]);
  assertEqual(await pub(SLUG), null, 'F-5 paused');
  await stack.query(`UPDATE public.tap_profiles SET status = 'active', suspended_at = now() WHERE user_id = $1`, [asha.userId]);
  assertEqual(await pub(SLUG), null, 'F-5 suspended');
  const sus = await call({ op: 'owner.activate', mode: 'business', expectedVersion: 1, idempotencyKey: key() }, asha.token);
  assertEqual([sus.status, codeOf(sus)], [409, 'tap_suspended'], 'no switching while suspended');
  await stack.query(`UPDATE public.tap_profiles SET suspended_at = NULL WHERE user_id = $1`, [asha.userId]);
  assertEqual((await pub(SLUG)).mode, 'info', 'back');
  return 'neutral unavailable in every case';
});

await t.check('switching back to Business restores the identical Business payload; clearing then works', async () => {
  const b = await call({ op: 'owner.activate', mode: 'business', expectedVersion: 1, idempotencyKey: key() }, asha.token);
  assertEqual([b.status, b.body.activeMode, b.body.version], [200, 'business', 2], 'business');
  same(await pub(SLUG), { mode: 'business', profile: businessView }, 'identical');
  same(await legacy(SLUG), businessView, 'legacy reader serves Business again, byte-identical');
  const clear = await call({ op: 'owner.info.clear' }, asha.token);
  assertEqual([clear.status, clear.body.cleared], [200, true], 'cleared');
  const audit = (await stack.query(`SELECT action, fields FROM public.tap_mode_audit WHERE user_id = $1 ORDER BY created_at`, [asha.userId])).rows;
  assertEqual(audit.map((a) => a.action), ['info_save', 'info_save', 'activate', 'activate', 'info_clear'], 'audit trail');
  assert(audit.every((a) => !JSON.stringify(a).includes('projector')), 'the audit holds field names, never values');
  return 'reversible';
});

await t.check('canaries: no account detail, switched-off field, draft or rejected value in any public output, error or log', async () => {
  const leaks = [];
  const scan = (label, text) => {
    for (const [name, value] of Object.entries(C)) if (text.includes(value)) leaks.push(`${name} in ${label}`);
  };
  publicReads.forEach((text, i) => scan(`public read #${i}`, text));
  bodies.filter((b) => b.includes('"error"')).forEach((b, i) => scan(`error body #${i}`, b));
  logLines.forEach((line, i) => scan(`log line #${i}`, line));
  scan('public read while Business', JSON.stringify(await pub(SLUG)));
  assertEqual(leaks, [], 'leaks');
  return `${publicReads.length} public reads, ${bodies.length} responses, ${logLines.length} log lines`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
