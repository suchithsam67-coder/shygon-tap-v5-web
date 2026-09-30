import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verifies supabase/proposed/011_admin_notes_off_customer_rows.sql.
 *
 * Applies 001–010, writes an admin note through the ORIGINAL 003 RPC (so there
 * is real pre-existing data to migrate), then applies 011 and checks that the
 * leak is closed, the admin app's contract is unchanged, and nothing else moved.
 * Runs as the real `authenticated` role with Supabase's default grants.
 */
const ROOT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const PROPOSED = path.join(ROOT, 'supabase', 'proposed', '011_admin_notes_off_customer_rows.sql');

const db = await PGlite.create();
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/tests/baseline.sql'), 'utf8'));
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
}
await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
`);

const CUST = '11111111-1111-1111-1111-111111111111';
const ADMIN = '33333333-3333-3333-3333-333333333333';
const O1 = 'aaaaaaaa-0000-0000-0000-000000000001'; // gets a note before 011
const O2 = 'aaaaaaaa-0000-0000-0000-000000000002'; // never has a note
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES ('${CUST}','c@example.com'), ('${ADMIN}','a@example.com');
  INSERT INTO public.admin_users (user_id, role, is_active) VALUES ('${ADMIN}', 'admin', true)
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin', is_active = true;
  INSERT INTO public.orders (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise, payment_status, order_status)
  VALUES ('${O1}','ST-1','${CUST}','${CUST}','Metal Card',899,89900,'pending','placed'),
         ('${O2}','ST-2','${CUST}','${CUST}','PVC Card',699,69900,'pending','placed');
  INSERT INTO public.cards (user_id, order_id, sku, status) VALUES ('${CUST}','${O1}','card-x','pending');
`);
await db.exec(`UPDATE public.orders SET payment_status = 'paid' WHERE id IN ('${O1}','${O2}')`);

async function as(role, uid, fn) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role}`);
  try { return await fn(); } finally {
    await db.exec('RESET ROLE');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}
const one = async (sql, p) => (await db.query(sql, p)).rows[0];

let pass = 0, fail = 0;
async function check(name, fn) {
  try { const d = await fn(); console.log(`  PASS  ${name}${d ? `  — ${d}` : ''}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

// --- Before 011: a real note, written the way production writes it ----------
await as('authenticated', ADMIN, () =>
  db.query(`SELECT public.admin_update_order_status($1, 'processing', NULL, NULL, 'OLD INTERNAL NOTE')`, [O1]));

const before = {
  leak: (await as('authenticated', CUST, () => one(`SELECT admin_note FROM public.orders WHERE id = $1`, [O1]))).admin_note,
  keys: Object.keys((await as('authenticated', ADMIN, () => one(`SELECT public.admin_get_order($1) v`, [O1]))).v.order).sort(),
  notifications: Number((await one(`SELECT count(*) n FROM public.notifications`)).n),
  taps: Number((await one(`SELECT count(*) n FROM public.tap_profiles`)).n),
  o2Updated: (await one(`SELECT updated_at FROM public.orders WHERE id = $1`, [O2])).updated_at,
};

console.log('\n=== baseline, before 011 ===');
await check('the leak exists before 011 (control)', async () => {
  assert(before.leak === 'OLD INTERNAL NOTE', `expected the leak to reproduce, got ${JSON.stringify(before.leak)}`);
  return 'customer reads "OLD INTERNAL NOTE"';
});

// --- Apply 011 ----------------------------------------------------------------
await db.exec(fs.readFileSync(PROPOSED, 'utf8'));

// Measured immediately, before any post-011 RPC call legitimately notifies.
const afterMigration = {
  notifications: Number((await one(`SELECT count(*) n FROM public.notifications`)).n),
  taps: Number((await one(`SELECT count(*) n FROM public.tap_profiles`)).n),
};

console.log('\n=== after 011: the leak ===');
await check('customer can no longer read the existing note on their order', () =>
  as('authenticated', CUST, async () => {
    const r = await one(`SELECT admin_note FROM public.orders WHERE id = $1`, [O1]);
    assert(r.admin_note === null, `still readable: ${JSON.stringify(r.admin_note)}`);
    return 'orders.admin_note is null';
  }));

await check('customer cannot read order_admin_notes at all', () =>
  as('authenticated', CUST, async () => {
    try {
      const r = await db.query(`SELECT * FROM public.order_admin_notes`);
      assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
      return '0 rows';
    } catch (e) {
      assert(/permission denied/i.test(e.message), `unexpected error: ${e.message}`);
      return 'permission denied';
    }
  }));

await check('anon cannot read order_admin_notes', () =>
  as('anon', null, async () => {
    try { const r = await db.query(`SELECT * FROM public.order_admin_notes`); assert(r.rows.length === 0, 'LEAK'); return '0 rows'; }
    catch (e) { assert(/permission denied/i.test(e.message), e.message); return 'permission denied'; }
  }));

console.log('\n=== after 011: the admin app contract ===');
await check('existing note was carried over, not lost', async () => {
  const r = await one(`SELECT note FROM public.order_admin_notes WHERE order_id = $1`, [O1]);
  assert(r?.note === 'OLD INTERNAL NOTE', `got ${JSON.stringify(r)}`);
  return 'moved to order_admin_notes';
});

await check('admin_get_order still returns order.admin_note', () =>
  as('authenticated', ADMIN, async () => {
    const v = (await one(`SELECT public.admin_get_order($1) v`, [O1])).v;
    assert(v.order.admin_note === 'OLD INTERNAL NOTE', `got ${JSON.stringify(v.order.admin_note)}`);
    return '"OLD INTERNAL NOTE"';
  }));

await check('admin_get_order.order has exactly the same keys as before 011', () =>
  as('authenticated', ADMIN, async () => {
    const keys = Object.keys((await one(`SELECT public.admin_get_order($1) v`, [O1])).v.order).sort();
    const added = keys.filter((k) => !before.keys.includes(k));
    const removed = before.keys.filter((k) => !keys.includes(k));
    assert(!added.length && !removed.length, `added ${added} removed ${removed}`);
    return `${keys.length} keys, identical`;
  }));

await check('an order with no note returns admin_note: null (as before)', () =>
  as('authenticated', ADMIN, async () => {
    const v = (await one(`SELECT public.admin_get_order($1) v`, [O2])).v;
    assert('admin_note' in v.order && v.order.admin_note === null, JSON.stringify(v.order.admin_note));
    return 'null';
  }));

await check('a blank note keeps the existing one (003 semantics preserved)', () =>
  as('authenticated', ADMIN, async () => {
    await db.query(`SELECT public.admin_update_order_status($1, 'packed', NULL, NULL, '   ')`, [O1]);
    const v = (await one(`SELECT public.admin_get_order($1) v`, [O1])).v;
    assert(v.order.admin_note === 'OLD INTERNAL NOTE', `note changed to ${JSON.stringify(v.order.admin_note)}`);
    assert(v.order.order_status === 'packed', `status ${v.order.order_status}`);
    return 'still "OLD INTERNAL NOTE", status packed';
  }));

await check('shipping with a new note updates it, and the rest of the RPC behaves as before', () =>
  as('authenticated', ADMIN, async () => {
    await db.query(`SELECT public.admin_update_order_status($1, 'shipped', 'AWB1', 'Delhivery', 'NEW NOTE')`, [O1]);
    const v = (await one(`SELECT public.admin_get_order($1) v`, [O1])).v;
    assert(v.order.admin_note === 'NEW NOTE', `note ${v.order.admin_note}`);
    assert(v.order.tracking_number === 'AWB1' && v.order.shipping_carrier === 'Delhivery', 'tracking/carrier not set');
    assert(v.order.shipped_at, 'shipped_at not stamped');
    assert(v.cards.every((c) => c.status === 'shipped'), `cards ${JSON.stringify(v.cards.map((c) => c.status))}`);
    return 'note, tracking, carrier, shipped_at, card status all correct';
  }));

await check('the new note is not readable by the customer either', () =>
  as('authenticated', CUST, async () => {
    const r = await one(`SELECT admin_note, order_status, tracking_number FROM public.orders WHERE id = $1`, [O1]);
    assert(r.admin_note === null, `LEAK — ${r.admin_note}`);
    assert(r.order_status === 'shipped' && r.tracking_number === 'AWB1', 'customer lost sight of the status');
    return 'note hidden; status + tracking still visible';
  }));

await check('a customer still cannot call the admin RPC', () =>
  as('authenticated', CUST, async () => {
    try { await db.query(`SELECT public.admin_update_order_status($1, 'delivered', 'X', NULL, 'hack')`, [O1]); }
    catch (e) { return `refused: ${e.message.slice(0, 50)}`; }
    throw new Error('customer was allowed to run the admin RPC');
  }));

console.log('\n=== after 011: nothing else moved ===');
await check('the migration raised no notifications', async () => {
  assert(afterMigration.notifications === before.notifications,
    `notifications ${before.notifications} -> ${afterMigration.notifications}`);
  return `${before.notifications} before, ${afterMigration.notifications} straight after`;
});
await check('no Tap profiles were provisioned by the migration', async () => {
  assert(afterMigration.taps === before.taps, `tap_profiles ${before.taps} -> ${afterMigration.taps}`);
  return `${before.taps} before, ${afterMigration.taps} straight after`;
});
await check('an order that never had a note was not touched (updated_at unchanged)', async () => {
  const r = await one(`SELECT updated_at FROM public.orders WHERE id = $1`, [O2]);
  assert(String(r.updated_at) === String(before.o2Updated), `${before.o2Updated} -> ${r.updated_at}`);
  return 'unchanged';
});

await check('011 is safe to re-run', async () => {
  await db.exec(fs.readFileSync(PROPOSED, 'utf8'));
  const r = await one(`SELECT note FROM public.order_admin_notes WHERE order_id = $1`, [O1]);
  assert(r.note === 'NEW NOTE', `note after re-run: ${r.note}`);
  return 'note intact after second run';
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
