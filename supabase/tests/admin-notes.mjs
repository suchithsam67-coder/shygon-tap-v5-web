import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * F2 (migration 022, DEC-2026-035 / V6-010): an administrator's internal order
 * note is not readable by the customer who placed the order.
 *
 * The database starts as the live baseline WITH existing notes on orders (as
 * production has them), then migrations 020 onward are applied. Checks:
 *   - the customer can no longer read the note, by any table read;
 *   - every existing note was moved, none lost, none left on the order row;
 *   - the admin app contract holds: admin_get_order still returns
 *     order.admin_note with the same JSON keys; admin_update_order_status keeps
 *     its semantics (a blank note keeps the existing one);
 *   - moving the notes raised no notification, event or provisioning;
 *   - the ROLLBACK block in 022 restores the live bodies and the notes.
 *
 *   node supabase/tests/admin-notes.mjs [migrations-dir]
 */

const DIR = process.argv[2] ?? MIGRATIONS_DIR;
const FILE = path.join(DIR, '022_admin_notes_off_customer_rows.sql');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const json = (v) => JSON.stringify(v);

const CUST = 'd1000000-0000-4000-8000-000000000001';
const OTHER = 'd2000000-0000-4000-8000-000000000002';
const ADMIN = 'd3000000-0000-4000-8000-000000000003';
const O1 = 'dd000000-0000-4000-8000-000000000001'; // has a note on live
const O2 = 'dd000000-0000-4000-8000-000000000002'; // blank note (whitespace)
const O3 = 'dd000000-0000-4000-8000-000000000003'; // no note
const NOTE = 'Customer was rude on the phone; refund only with manager approval.';

async function seededBaseline() {
  const db = await createLiveDb();
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${CUST}', 'cust@example.test'), ('${OTHER}', 'other@example.test'),
                                              ('${ADMIN}', 'admin@example.test');
    INSERT INTO public.admin_users (user_id, role, is_active) VALUES ('${ADMIN}', 'admin', true);
    INSERT INTO public.orders (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise,
                               payment_status, order_status, admin_note)
    VALUES ('${O1}', 'ST-N1', '${CUST}', '${CUST}', 'Business experience', 999, 99900, 'paid', 'processing', '  ${NOTE}  '),
           ('${O2}', 'ST-N2', '${CUST}', '${CUST}', 'Business experience', 999, 99900, 'paid', 'processing', '   '),
           ('${O3}', 'ST-N3', '${OTHER}', '${OTHER}', 'Business experience', 999, 99900, 'paid', 'processing', NULL);
  `);
  return db;
}

async function as(db, role, uid, fn) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role};`);
  try { return await fn(); } finally {
    await db.exec('RESET ROLE;');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
async function attempt(fn) { try { return { res: await fn(), err: null }; } catch (err) { return { res: null, err }; } }

const sideEffects = async (db) => (await db.query(`
  SELECT (SELECT count(*)::int FROM public.notifications) AS notifications,
         (SELECT count(*)::int FROM public.account_events) AS account_events,
         (SELECT count(*)::int FROM public.admin_notifications) AS admin_notifications,
         (SELECT count(*)::int FROM public.order_status_history) AS status_history,
         (SELECT count(*)::int FROM public.tap_profiles) AS taps`)).rows[0];

// --- build -------------------------------------------------------------------

const db = await seededBaseline();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated;`);

const leakBefore = await as(db, 'authenticated', CUST, async () =>
  (await db.query(`SELECT admin_note FROM public.orders WHERE id = $1`, [O1])).rows[0]?.admin_note);
const adminViewBefore = await as(db, 'authenticated', ADMIN, async () =>
  (await db.query(`SELECT public.admin_get_order($1) AS o`, [O1])).rows[0].o);
const effectsBefore = await sideEffects(db);
const updatedBefore = (await db.query(`SELECT id, updated_at::text AS updated_at FROM public.orders ORDER BY id`)).rows;

const migrations = newMigrations(DIR);
for (const { name, sql } of migrations) {
  await db.exec(sql);
  if (name.startsWith('022_')) break; // judge 022 on its own first
}

console.log('\n=== F2: the internal note is off the customer row (migration 022) ===');

await check('negative control: on the baseline the customer read the note', () => {
  assert(leakBefore?.trim() === NOTE, `baseline did not leak (${json(leakBefore)}); fixture is wrong`);
  return 'leaked before 022 (as expected on live)';
});

await check('the customer can no longer read the note on their order', () =>
  as(db, 'authenticated', CUST, async () => {
    const r = (await db.query(`SELECT order_id, admin_note FROM public.orders WHERE user_id = $1 ORDER BY order_id`, [CUST])).rows;
    assert(r.length === 2, `customer saw ${r.length} orders`);
    assert(r.every((x) => x.admin_note === null), `note still visible: ${json(r)}`);
    return 'orders visible, admin_note null';
  }));

await check('the customer cannot read order_admin_notes at all', () =>
  as(db, 'authenticated', CUST, async () => {
    const r = await attempt(() => db.query(`SELECT * FROM public.order_admin_notes`));
    assert(r.err?.code === '42501' || r.res.rows.length === 0, `read ${r.res?.rows.length} row(s)`);
    return r.err ? `refused (${r.err.code})` : '0 rows';
  }));

await check('anonymous callers cannot read order_admin_notes either', () =>
  as(db, 'anon', null, async () => {
    const r = await attempt(() => db.query(`SELECT * FROM public.order_admin_notes`));
    assert(r.err?.code === '42501' || r.res.rows.length === 0, `read ${r.res?.rows.length} row(s)`);
    return r.err ? `refused (${r.err.code})` : '0 rows';
  }));

await check('every non-blank note moved (trimmed), none lost, none left on orders', async () => {
  const notes = (await db.query(`SELECT order_id, note, updated_by FROM public.order_admin_notes ORDER BY order_id`)).rows;
  assert(json(notes) === json([{ order_id: O1, note: NOTE, updated_by: null }]), json(notes));
  const left = (await db.query(`SELECT count(*)::int AS n FROM public.orders WHERE admin_note IS NOT NULL`)).rows[0].n;
  assert(left === 0, `${left} order(s) still carry a note`);
  return '1 note moved; the whitespace-only note was dropped as before (it was never shown)';
});

await check('moving the notes raised no notification, event, status history or Tap', async () => {
  const after = await sideEffects(db);
  assert(json(after) === json(effectsBefore), `${json(effectsBefore)} -> ${json(after)}`);
  const updated = (await db.query(`SELECT id, updated_at::text AS updated_at FROM public.orders ORDER BY id`)).rows;
  const touched = updated.filter((r, i) => r.updated_at !== updatedBefore[i].updated_at).map((r) => r.id);
  assert(json(touched.sort()) === json([O1, O2].sort()), `updated_at moved on ${json(touched)}`);
  return 'counts unchanged; updated_at moved only on the two orders that had a note value';
});

await check('admin_get_order: same JSON keys as before, admin_note from the new table', () =>
  as(db, 'authenticated', ADMIN, async () => {
    const o = (await db.query(`SELECT public.admin_get_order($1) AS o`, [O1])).rows[0].o;
    assert(json(Object.keys(o).sort()) === json(Object.keys(adminViewBefore).sort()), 'top-level keys changed');
    assert(json(Object.keys(o.order).sort()) === json(Object.keys(adminViewBefore.order).sort()), 'order keys changed');
    assert(o.order.admin_note === NOTE, `admin_note was ${json(o.order.admin_note)}`);
    const none = (await db.query(`SELECT public.admin_get_order($1) AS o`, [O3])).rows[0].o;
    assert('admin_note' in none.order && none.order.admin_note === null, 'an order without a note lost the key');
    return 'shape identical; note shown to the admin';
  }));

await check('admin_update_order_status writes the note to the new table, never to orders', async () => {
  // The admin calls the RPC through the API role; the result is read back as
  // the server, because the admin's own API role cannot read the table either.
  const noteOf = async () => (await db.query(`SELECT note, updated_by FROM public.order_admin_notes WHERE order_id = $1`, [O3])).rows[0];
  await as(db, 'authenticated', ADMIN, () =>
    db.query(`SELECT public.admin_update_order_status($1, 'packed', NULL, NULL, '  New internal note  ')`, [O3]));
  const n = await noteOf();
  assert(n?.note === 'New internal note' && n.updated_by === ADMIN, json(n));
  await as(db, 'authenticated', ADMIN, () =>
    db.query(`SELECT public.admin_update_order_status($1, 'packed', NULL, NULL, '   ')`, [O3]));
  assert((await noteOf()).note === 'New internal note', 'a blank note replaced the existing one');
  const onOrder = (await db.query(`SELECT admin_note FROM public.orders WHERE id = $1`, [O3])).rows[0].admin_note;
  assert(onOrder === null, 'the note landed on the order row');
  const direct = await as(db, 'authenticated', ADMIN, () => attempt(() => db.query(`SELECT * FROM public.order_admin_notes`)));
  assert(direct.err?.code === '42501', 'an admin API session could read the table directly');
  return 'stored trimmed with the admin id; blank keeps it; order row null; table reachable only through the RPCs';
});

await check("the other customer still cannot see the new note on their order", () =>
  as(db, 'authenticated', OTHER, async () => {
    const r = (await db.query(`SELECT admin_note FROM public.orders WHERE id = $1`, [O3])).rows[0];
    assert(r && r.admin_note === null, json(r));
    return 'null';
  }));

await check('a non-admin still cannot call admin_get_order (control)', () =>
  as(db, 'authenticated', CUST, async () => {
    const r = await attempt(() => db.query(`SELECT public.admin_get_order($1)`, [O1]));
    assert(r.err?.code === '42501', `got ${r.err ? r.err.code : 'success'}`);
    return 'refused 42501';
  }));

await check('the remaining migrations apply on top, and 022 re-runs cleanly (idempotent)', async () => {
  const later = migrations.filter((m) => m.name > '022_');
  for (const { sql } of later) await db.exec(sql);
  await db.exec(fs.readFileSync(FILE, 'utf8'));
  const notes = (await db.query(`SELECT count(*)::int AS n FROM public.order_admin_notes`)).rows[0].n;
  assert(notes === 2, `${notes} notes after re-run`);
  return `${later.length} later migration(s) applied; re-run kept 2 notes`;
});

console.log('\n=== rollback (022 header) ===');

await check('the ROLLBACK block restores the live bodies and puts every note back', async () => {
  const text = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
  const block = text.split('-- ROLLBACK (begin)\n')[1]?.split('-- ROLLBACK (end)')[0];
  assert(block, 'no ROLLBACK (begin) … (end) block in 022');
  const sql = block.split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');

  const rb = await seededBaseline();
  const live = await createLiveDb();
  for (const { name, sql: m } of newMigrations(DIR)) { if (name <= '022_~') await rb.exec(m); }
  await rb.exec(sql);
  const bodies = (d) => d.query(`SELECT p.oid::regprocedure::text AS f, md5(p.prosrc) AS h FROM pg_proc p
    WHERE p.proname IN ('admin_get_order', 'admin_update_order_status') ORDER BY 1`);
  assert(json((await bodies(rb)).rows) === json((await bodies(live)).rows), 'function bodies differ from the baseline');
  const back = (await rb.query(`SELECT id, admin_note FROM public.orders WHERE admin_note IS NOT NULL ORDER BY id`)).rows;
  assert(json(back) === json([{ id: O1, admin_note: NOTE }]), json(back));
  assert((await rb.query(`SELECT to_regclass('public.order_admin_notes') AS t`)).rows[0].t === null, 'table not dropped');
  await rb.close();
  await live.close();
  return 'bodies equal live; the note is back on its order; table dropped';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
await db.close();
process.exit(fail === 0 ? 0 : 1);
