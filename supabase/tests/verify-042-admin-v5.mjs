import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verifies supabase/migrations/042_admin_v5_coverage.sql by EXECUTING it.
 *
 * `db:apply` proves 042 installs. That is not enough: PL/pgSQL does not check
 * column references until a function runs, which is exactly how 042's first
 * draft would have passed `db:apply` while failing at runtime on any database
 * built from the migrations (the card-activation drift, now section 0b).
 *
 * So this applies 001–042 to a real Postgres, seeds a deliberately awkward data
 * set, and calls every new function as the real `authenticated` role with
 * Supabase's default broad grants — the same conditions PostgREST creates — so
 * RLS and require_admin() are what actually stand in the way.
 *
 *   node supabase/tests/verify-042-admin-v5.mjs [repo root]
 */
const ROOT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');

const db = await PGlite.create();
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/tests/baseline.sql'), 'utf8'));
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
}
await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
`);

// --- people -----------------------------------------------------------------
const OWNER = '0000000a-0000-0000-0000-000000000001';
const VIEWER = '0000000a-0000-0000-0000-000000000002';
const CUST = '0000000a-0000-0000-0000-000000000003';
const GONE = '0000000a-0000-0000-0000-000000000004'; // an admin who was deactivated

// --- orders -----------------------------------------------------------------
const O_RETRY = '0000000b-0000-0000-0000-000000000001'; // paid, grant failed
const O_STUCK = '0000000b-0000-0000-0000-000000000002'; // paid, processing for an hour
const O_FLIGHT = '0000000b-0000-0000-0000-000000000003'; // paid, pending just now
const O_DONE = '0000000b-0000-0000-0000-000000000004'; // paid, fulfilled
const O_UNPAID = '0000000b-0000-0000-0000-000000000005'; // abandoned checkout

// --- cards ------------------------------------------------------------------
const C_ACT = '0000000c-0000-0000-0000-000000000001';
const C_EXP = '0000000c-0000-0000-0000-000000000002';
const C_OPEN = '0000000c-0000-0000-0000-000000000003';
const C_DEACT = '0000000c-0000-0000-0000-000000000004';

const TAP = '0000000d-0000-0000-0000-000000000001';
const IA = '0000000e-0000-0000-0000-000000000001';
const IB = '0000000e-0000-0000-0000-000000000002';
const TH_NOW = '0000000f-0000-0000-0000-000000000001';
const TH_PAST = '0000000f-0000-0000-0000-000000000002';
const TH_OFF = '0000000f-0000-0000-0000-000000000003';

// Seeded with ordinary triggers OFF (session_replication_role = replica), so
// timestamps land exactly as written. Otherwise touch_updated_at would reset
// updated_at to now() and "stuck for an hour" could not be constructed.
await db.exec(`
  SET session_replication_role = replica;

  INSERT INTO auth.users (id, email) VALUES
    ('${OWNER}','owner@example.com'), ('${VIEWER}','viewer@example.com'),
    ('${CUST}','cust@example.com'),   ('${GONE}','gone@example.com');

  INSERT INTO public.admin_users (user_id, role, is_active) VALUES
    ('${OWNER}','owner',true), ('${VIEWER}','viewer',true), ('${GONE}','admin',false)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, is_active = EXCLUDED.is_active;

  INSERT INTO public.orders
    (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise,
     payment_status, order_status, fulfillment_status, created_at, updated_at)
  VALUES
    ('${O_RETRY}', 'ST-R','${CUST}','${CUST}','Metal Card',899,89900,'paid','processing','retry',      now()-interval '3 hours', now()-interval '2 hours'),
    ('${O_STUCK}', 'ST-S','${CUST}','${CUST}','PVC Card',  399,39900,'paid','processing','processing', now()-interval '2 hours', now()-interval '1 hour'),
    ('${O_FLIGHT}','ST-F','${CUST}','${CUST}','PVC Card',  399,39900,'paid','placed',    'pending',    now(),                    now()),
    ('${O_DONE}',  'ST-D','${CUST}','${CUST}','PVC Card',  399,39900,'paid','delivered', 'fulfilled',  now()-interval '5 days',  now()-interval '5 days'),
    ('${O_UNPAID}','ST-U','${CUST}','${CUST}','PVC Card',  399,39900,'pending','placed', 'pending',    now()-interval '4 hours', now()-interval '4 hours');

  INSERT INTO public.order_items
    (id, order_id, sku, name, product_type, unit_price_in_paise, quantity, line_total_in_paise)
  VALUES
    ('${IA}','${O_RETRY}','card-business-standard-metal','Metal Card','card',89900,1,89900),
    ('${IB}','${O_RETRY}','plan-business','Business plan','digital_plan',0,1,0);
  -- Item A got its card stock; item B's grant never happened.
  INSERT INTO public.order_item_fulfillment_actions (order_item_id, action) VALUES ('${IA}','card_stock');

  INSERT INTO public.cards (id, user_id, order_id, sku, status,
                            activated_at, activation_expires_at, deactivated_at, activation_count)
  VALUES
    ('${C_ACT}',  '${CUST}','${O_DONE}','card-a','active',  now()-interval '3 days', NULL,                     NULL,                    1),
    ('${C_EXP}',  '${CUST}','${O_DONE}','card-b','shipped', NULL,                    now()-interval '1 day',   NULL,                    0),
    ('${C_OPEN}', '${CUST}','${O_DONE}','card-c','shipped', NULL,                    now()+interval '1 day',   NULL,                    0),
    -- Expired window but since deactivated: must NOT count as "expired".
    ('${C_DEACT}','${CUST}','${O_DONE}','card-d','suspended',NULL,                   now()-interval '5 days',  now()-interval '1 day',  0);

  INSERT INTO public.card_otp_challenges
    (user_id, card_id, action, code_hash, attempts, expires_at, consumed_at, created_at)
  VALUES
    ('${CUST}','${C_EXP}', 'activate','HASH-SECRET-1',5, now()+interval '5 min', NULL,  now()-interval '1 hour'),
    ('${CUST}','${C_EXP}', 'activate','HASH-SECRET-2',1, now()-interval '1 hour',NULL,  now()-interval '2 hours'),
    ('${CUST}','${C_ACT}', 'activate','HASH-SECRET-3',1, now()-interval '1 day', now()-interval '3 days', now()-interval '3 days'),
    ('${CUST}','${C_OPEN}','activate','HASH-SECRET-4',0, now()+interval '5 min', NULL,  now()),
    -- Locked out, but three days ago: outside the 24h lockout count.
    ('${CUST}','${C_EXP}', 'activate','HASH-SECRET-5',5, now()-interval '3 days',NULL,  now()-interval '3 days');

  INSERT INTO public.tap_profiles (id, user_id, customer_id, slug, status,
                                   last_content_edit_at, theme_palette, theme_layout)
  VALUES ('${TAP}','${CUST}','${CUST}','probe-tap','active',
          now()-interval '3 days','royal','split');

  -- 005 seeds the real festival calendar with high priorities and real 2026
  -- dates, so one of them can genuinely be in force on the day this runs.
  -- Switched off here so the result depends on the probes, not the calendar.
  UPDATE public.tap_event_themes SET active = false;

  INSERT INTO public.tap_event_themes (id, code, name, starts_on, ends_on, priority, active) VALUES
    ('${TH_NOW}', 'probe-now',  'Probe now',   current_date - 1,  current_date + 1,  1, true),
    ('${TH_PAST}','probe-past', 'Probe past',     current_date - 90, current_date - 80, 5, true),
    -- Higher priority and in its window, but switched off: must never win.
    ('${TH_OFF}', 'probe-off',  'Probe off', current_date - 1,  current_date + 1,  9, false);

  SET session_replication_role = origin;
`);

// --- harness ----------------------------------------------------------------
async function as(role, uid, fn) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
const val = async (sql, params) => (await db.query(sql, params)).rows[0]?.v;

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (error) {
    console.log(`  FAIL  ${name}\n        ${error.message}`);
    fail++;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function refused(fn) {
  try {
    await fn();
  } catch (error) {
    // 42501 from require_admin, or Postgres's own "permission denied for function".
    if (error.code === '42501' || /permission denied|administrator access|does not permit/i.test(error.message)) {
      return error.message.split('\n')[0];
    }
    throw new Error(`refused for the wrong reason: ${error.message}`);
  }
  throw new Error('expected a refusal, but the call succeeded');
}

const NEW_FUNCTIONS = [
  ['admin_attention()', `SELECT public.admin_attention() v`, []],
  ['admin_list_orders_v5', `SELECT public.admin_list_orders_v5() v`, []],
  ['admin_order_item_actions', `SELECT public.admin_order_item_actions($1) v`, [O_RETRY]],
  ['admin_tap_state', `SELECT public.admin_tap_state($1) v`, [TAP]],
  ['admin_card_activation_attempts', `SELECT public.admin_card_activation_attempts($1) v`, [C_EXP]],
  ['admin_list_event_themes', `SELECT public.admin_list_event_themes() v`, []],
  ['admin_set_event_theme_active', `SELECT public.admin_set_event_theme_active($1, true) v`, [TH_PAST]],
  ['admin_card_editions', `SELECT public.admin_card_editions() v`, []],
];

// ============================================================================
console.log('\n=== authorization ===');

for (const [name, sql, params] of NEW_FUNCTIONS) {
  await check(`anon cannot execute ${name}`, () => as('anon', null, () => refused(() => db.query(sql, params))));
}

await check('a signed-in CUSTOMER is refused (not an admin)', () =>
  as('authenticated', CUST, () => refused(() => db.query(`SELECT public.admin_attention()`))));

await check('a DEACTIVATED admin is refused', () =>
  as('authenticated', GONE, () => refused(() => db.query(`SELECT public.admin_attention()`))));

await check('a VIEWER cannot toggle an event theme (needs tap.moderate)', async () => {
  const before = await val(`SELECT active v FROM public.tap_event_themes WHERE id = $1`, [TH_OFF]);
  const msg = await as('authenticated', VIEWER, () =>
    refused(() => db.query(`SELECT public.admin_set_event_theme_active($1, true)`, [TH_OFF])));
  const after = await val(`SELECT active v FROM public.tap_event_themes WHERE id = $1`, [TH_OFF]);
  assert(before === after, 'the theme changed even though the call was refused');
  return msg;
});

await check('a VIEWER can read every read-only function', async () => {
  for (const [name, sql, params] of NEW_FUNCTIONS.filter(([n]) => n !== 'admin_set_event_theme_active')) {
    await as('authenticated', VIEWER, () => db.query(sql, params)).catch((e) => {
      throw new Error(`${name}: ${e.message}`);
    });
  }
  return '7 functions';
});

// ============================================================================
console.log('\n=== admin_attention: the grant-failure headline ===');
const attention = await as('authenticated', OWNER, () => val(`SELECT public.admin_attention() v`));

await check('counts the paid order whose grant FAILED', () => {
  assert(attention.grants.retry === 1, `retry = ${attention.grants.retry}, want 1`);
});
await check('counts a paid order stalled for an hour as stuck', () => {
  assert(attention.grants.stuck === 1, `stuck = ${attention.grants.stuck}, want 1`);
});
await check('a paid order pending for seconds is in flight, not stuck', () => {
  assert(attention.grants.in_flight === 1, `in_flight = ${attention.grants.in_flight}, want 1`);
});
await check('an abandoned (unpaid) checkout is never a grant problem', () => {
  const total = attention.grants.retry + attention.grants.stuck + attention.grants.in_flight;
  assert(total === 3, `retry+stuck+in_flight = ${total}; the unpaid order leaked in`);
});
await check('oldest failing grant points at the longest-waiting customer', async () => {
  const want = await val(`SELECT updated_at v FROM public.orders WHERE id = $1`, [O_RETRY]);
  assert(new Date(attention.grants.oldest_failing_since).getTime() === new Date(want).getTime(),
    `got ${attention.grants.oldest_failing_since}, want the retry order's ${want}`);
});
await check('activation: expired window counted, a deactivated card is not', () => {
  assert(attention.activation.window_expired === 1, `window_expired = ${attention.activation.window_expired}, want 1`);
  assert(attention.activation.window_open === 1, `window_open = ${attention.activation.window_open}, want 1`);
});
await check('OTP lockouts count the last 24h only', () => {
  assert(attention.otp_lockouts_24h === 1, `otp_lockouts_24h = ${attention.otp_lockouts_24h}, want 1 (the 3-day-old one excluded)`);
});
await check('Taps are counted by their 004 status', () => {
  assert(attention.taps_by_status.active === 1, `taps_by_status = ${JSON.stringify(attention.taps_by_status)}`);
});
await check('the event theme in force ignores a higher-priority theme that is OFF', () => {
  assert(attention.event_theme_now?.code === 'probe-now', `event_theme_now = ${JSON.stringify(attention.event_theme_now)}`);
});

// ============================================================================
console.log('\n=== admin_list_orders_v5: the queue an operator works ===');

await check('"needs_attention" = paid and not fulfilled, nothing else', async () => {
  const page = await as('authenticated', OWNER, () =>
    val(`SELECT public.admin_list_orders_v5(p_fulfillment_status := 'needs_attention') v`));
  const ids = page.rows.map((r) => r.id).sort();
  const want = [O_RETRY, O_STUCK, O_FLIGHT].sort();
  assert(JSON.stringify(ids) === JSON.stringify(want), `got ${ids.length}: ${ids.join(', ')}`);
  return `${page.total} orders`;
});
await check('rows carry the grant state the old list never had', async () => {
  const page = await as('authenticated', OWNER, () =>
    val(`SELECT public.admin_list_orders_v5(p_fulfillment_status := 'retry') v`));
  assert(page.total === 1, `total = ${page.total}`);
  assert(page.rows[0].fulfillment_status === 'retry', `row = ${JSON.stringify(page.rows[0])}`);
});
await check('an unknown grant filter is rejected (22023), not silently ignored', async () => {
  try {
    await as('authenticated', OWNER, () => db.query(`SELECT public.admin_list_orders_v5(p_fulfillment_status := 'bogus')`));
  } catch (e) {
    assert(e.code === '22023', `code ${e.code}: ${e.message}`);
    return 'refused';
  }
  throw new Error('accepted an unknown filter');
});

// ============================================================================
console.log('\n=== admin_order_item_actions: which part of a failed grant failed ===');

await check('shows the item that was fulfilled and the one that was not', async () => {
  const items = await as('authenticated', OWNER, () => val(`SELECT public.admin_order_item_actions($1) v`, [O_RETRY]));
  const a = items.find((i) => i.order_item_id === IA);
  const b = items.find((i) => i.order_item_id === IB);
  assert(a?.actions.length === 1 && a.actions[0].action === 'card_stock', `item A = ${JSON.stringify(a)}`);
  assert(b?.actions.length === 0, `item B should have no actions, got ${JSON.stringify(b)}`);
  return 'card stock done, plan grant missing';
});
await check('an unknown order is P0002, not an empty list', async () => {
  try {
    await as('authenticated', OWNER, () =>
      db.query(`SELECT public.admin_order_item_actions('00000000-0000-0000-0000-000000000000')`));
  } catch (e) {
    assert(e.code === 'P0002', `code ${e.code}`);
    return 'refused';
  }
  throw new Error('returned something for an order that does not exist');
});

// ============================================================================
console.log('\n=== admin_tap_state: state, never the owner\'s content ===');
const tap = await as('authenticated', OWNER, () => val(`SELECT public.admin_tap_state($1) v`, [TAP]));

await check('returns exactly the state keys — no personal content', () => {
  const keys = Object.keys(tap).sort();
  const want = ['edit_interval_days', 'edit_window_started_at', 'id', 'last_content_edit_at',
                'next_edit_at', 'status', 'suspended_at', 'theme'].sort();
  assert(JSON.stringify(keys) === JSON.stringify(want), `keys = ${keys.join(', ')}`);
  for (const forbidden of ['custom_links', 'youtube', 'company', 'designation']) {
    assert(!JSON.stringify(tap).includes(`"${forbidden}"`), `${forbidden} leaked`);
  }
});
await check('next edit = last edit + the 004 interval (14 days)', () => {
  assert(tap.edit_interval_days === 14, `interval = ${tap.edit_interval_days}`);
  const gap = (new Date(tap.next_edit_at) - new Date(tap.last_content_edit_at)) / 864e5;
  assert(gap === 14, `next_edit_at is ${gap} days after the last edit`);
});
await check('status and theme come through', () => {
  assert(tap.status === 'active', `status = ${tap.status}`);
  assert(tap.theme.palette === 'royal' && tap.theme.layout === 'split', `theme = ${JSON.stringify(tap.theme)}`);
});

// ============================================================================
console.log('\n=== admin_card_activation_attempts: what happened, never the code ===');
const attempts = await as('authenticated', OWNER, () =>
  val(`SELECT public.admin_card_activation_attempts($1) v`, [C_EXP]));

await check('code_hash is never returned', () => {
  const text = JSON.stringify(attempts);
  assert(!text.includes('code_hash'), 'the key code_hash appears');
  assert(!text.includes('HASH-SECRET'), 'a code hash VALUE appears');
  return `${attempts.length} attempts, no hash`;
});
await check('outcomes classify locked-out and expired correctly', () => {
  const outcomes = attempts.map((a) => a.outcome).sort();
  assert(JSON.stringify(outcomes) === JSON.stringify(['expired', 'locked_out', 'locked_out']),
    `outcomes = ${outcomes.join(', ')}`);
});
await check('a consumed challenge reads as succeeded', async () => {
  const rows = await as('authenticated', OWNER, () =>
    val(`SELECT public.admin_card_activation_attempts($1) v`, [C_ACT]));
  assert(rows.length === 1 && rows[0].outcome === 'succeeded', JSON.stringify(rows));
});

// ============================================================================
console.log('\n=== event themes: reading and the audited toggle ===');

await check('the list marks which themes are in their window', async () => {
  const themes = await as('authenticated', VIEWER, () => val(`SELECT public.admin_list_event_themes() v`));
  const by = Object.fromEntries(themes.map((t) => [t.code, t]));
  assert(by['probe-now'].in_window === true && by['probe-past'].in_window === false, JSON.stringify(by));
});
await check('an owner toggle changes the theme and writes ONE audit row', async () => {
  const auditsBefore = Number(await val(`SELECT count(*) v FROM public.admin_audit_log WHERE entity_id = $1`, [TH_PAST]));
  await as('authenticated', OWNER, () => db.query(`SELECT public.admin_set_event_theme_active($1, false)`, [TH_PAST]));
  const active = await val(`SELECT active v FROM public.tap_event_themes WHERE id = $1`, [TH_PAST]);
  const auditsAfter = Number(await val(`SELECT count(*) v FROM public.admin_audit_log WHERE entity_id = $1`, [TH_PAST]));
  assert(active === false, 'the theme is still on');
  assert(auditsAfter - auditsBefore === 1, `${auditsAfter - auditsBefore} audit rows`);
  const actor = await val(`SELECT admin_id v FROM public.admin_audit_log WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [TH_PAST]);
  assert(actor === OWNER, `audited as ${actor}`);
  return 'audited, attributed to the owner';
});
await check('re-saving the same value is not audited again', async () => {
  const before = Number(await val(`SELECT count(*) v FROM public.admin_audit_log WHERE entity_id = $1`, [TH_PAST]));
  await as('authenticated', OWNER, () => db.query(`SELECT public.admin_set_event_theme_active($1, false)`, [TH_PAST]));
  const after = Number(await val(`SELECT count(*) v FROM public.admin_audit_log WHERE entity_id = $1`, [TH_PAST]));
  assert(after === before, `${after - before} extra audit rows for a no-op`);
});

// ============================================================================
console.log('\n=== admin_card_editions: chapter arithmetic matches 017 ===');

await check('chapter and numbers-left are computed correctly', async () => {
  const design = await val(`SELECT design v FROM public.card_editions ORDER BY design LIMIT 1`);
  assert(design, 'migration 017 seeded no edition to test against');
  const cases = [[0, 1, 100], [1, 1, 99], [99, 1, 1], [100, 2, 100], [137, 2, 63], [200, 3, 100]];
  for (const [issued, chapter, left] of cases) {
    await db.query(`UPDATE public.card_editions SET issued = $1, chapter_size = 100 WHERE design = $2`, [issued, design]);
    const rows = await as('authenticated', OWNER, () => val(`SELECT public.admin_card_editions() v`));
    const row = rows.find((r) => r.design === design);
    assert(row.current_chapter === chapter && row.left_in_chapter === left,
      `issued ${issued}: chapter ${row.current_chapter}, left ${row.left_in_chapter}; want ${chapter}, ${left}`);
  }
  return `${cases.length} boundaries incl. 99→100→101`;
});

// ============================================================================
console.log('\n=== 0b: the live/migration drift is closed ===');

await check('the five activation columns exist with live\'s exact types', async () => {
  const cols = Object.fromEntries((await db.query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cards'
      AND column_name IN ('activated_at','activation_expires_at','deactivated_at',
                          'activation_count','last_activation_at')`)).rows.map((r) => [r.column_name, r]));
  for (const c of ['activated_at', 'activation_expires_at', 'deactivated_at', 'last_activation_at']) {
    assert(cols[c]?.data_type === 'timestamp with time zone', `${c}: ${JSON.stringify(cols[c])}`);
  }
  const n = cols.activation_count;
  assert(n?.data_type === 'integer' && n.is_nullable === 'NO' && String(n.column_default) === '0',
    `activation_count: ${JSON.stringify(n)}`);
});
await check('activation_code was NOT propagated', async () => {
  const exists = await val(`SELECT count(*)::int v FROM information_schema.columns
                            WHERE table_schema='public' AND table_name='cards' AND column_name='activation_code'`);
  assert(exists === 0, 'activation_code was created');
});

// ============================================================================
console.log('\n=== the frozen admin contract is untouched ===');

await check('admin_list_orders still exists with its original signature', async () => {
  const sig = await val(`SELECT to_regprocedure('public.admin_list_orders(text,text,text,integer,integer)')::text v`);
  assert(sig, 'admin_list_orders(text,text,text,integer,integer) is gone');
});
await check('admin_list_orders row shape is unchanged (no new keys)', async () => {
  const page = await as('authenticated', OWNER, () => val(`SELECT public.admin_list_orders() v`));
  const keys = Object.keys(page.rows[0]).sort();
  assert(!keys.includes('fulfillment_status'), 'a 042 key leaked into the frozen shape');
  return `${keys.length} keys, as before`;
});
await check('admin_get_order still answers', async () => {
  const detail = await as('authenticated', OWNER, () => val(`SELECT public.admin_get_order($1) v`, [O_RETRY]));
  assert(detail.order.id === O_RETRY, 'wrong order');
});

// ============================================================================
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
