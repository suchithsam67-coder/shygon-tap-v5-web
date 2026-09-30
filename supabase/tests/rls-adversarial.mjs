import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Adversarial RLS suite.
 *
 * The project's own verify.mjs runs as the PGlite superuser, which BYPASSES row
 * level security — so it proves triggers, not RLS. This suite does what a real
 * PostgREST request does: SET ROLE authenticated, with the broad table GRANTs
 * Supabase hands anon/authenticated by default. Anything that still succeeds
 * here is something a customer could actually do with nothing but the
 * publishable key and a signed-in session.
 */

// Project root: first argument, or two levels up from this file (the same
// default as verify-011-admin-notes.mjs). It used to crash with no argument.
const ROOT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const db = await PGlite.create();

await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'baseline.sql'), 'utf8'));
for (const f of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8'));
}

// What Supabase itself grants. Without this, a refusal would be a plain
// permission error and would prove nothing about RLS.
await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
`);

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const ADMIN = '33333333-3333-3333-3333-333333333333';

await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${ALICE}', 'alice@example.com'),
    ('${BOB}',   'bob@example.com'),
    ('${ADMIN}', 'admin@example.com');

  -- A trigger on auth.users already creates the profile row; fill in the name.
  INSERT INTO public.profiles (id, email, full_name) VALUES
    ('${ALICE}', 'alice@example.com', 'Alice'),
    ('${BOB}',   'bob@example.com',   'Bob')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.orders (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise, payment_status, order_status)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'ST-ALICE', '${ALICE}', '${ALICE}', 'Metal Card', 2999, 299900, 'pending', 'placed'),
         ('bbbbbbbb-0000-0000-0000-000000000001', 'ST-BOB',   '${BOB}',   '${BOB}',   'Metal Card', 2999, 299900, 'paid',    'placed');

  INSERT INTO public.entitlements (user_id, type, key) VALUES ('${BOB}', 'digital_plan', 'goat');

  INSERT INTO public.cards (user_id, order_id, sku) VALUES ('${BOB}', 'bbbbbbbb-0000-0000-0000-000000000001', 'card-x');

  INSERT INTO public.notifications (user_id, category, title) VALUES ('${BOB}', 'order', 'Bob secret notification');

  INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, published, status)
  VALUES ('${BOB}', '${BOB}', 'bob-slug', 'bob-slug', 'Bob', true, 'active');

  INSERT INTO public.admin_users (user_id) VALUES ('${ADMIN}');
`);

let pass = 0, fail = 0;
const findings = [];

async function asRole(role, uid, fn) {
  // is_local = false: PGlite runs each statement in its own transaction, so a
  // transaction-scoped setting would be gone by the next query and auth.uid()
  // would read NULL — which makes every RLS check "pass" for the wrong reason.
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    findings.push(`${name}: ${e.message}`);
    fail++;
  }
}

const assert = (c, m) => { if (!c) throw new Error(m); };

/** A write RLS should stop: either it errors, or it touches zero rows. */
async function blockedWrite(sql, params) {
  try {
    const r = await db.query(sql, params);
    if ((r.affectedRows ?? 0) > 0) {
      throw new Error(`NOT BLOCKED — statement affected ${r.affectedRows} row(s)`);
    }
    return 'blocked (0 rows affected)';
  } catch (e) {
    if (/NOT BLOCKED/.test(e.message)) throw e;
    if (/row-level security|permission denied/i.test(e.message)) return 'blocked by RLS';
    // A trigger refusing it is defence in depth, not a weaker answer — the
    // write still did not happen.
    return `blocked by a trigger (${e.message.slice(0, 60)})`;
  }
}

console.log('\n=== cross-customer reads (Alice looking at Bob) ===');

for (const [label, sql] of [
  ["another customer's profile", `SELECT * FROM public.profiles WHERE id = '${BOB}'`],
  ["another customer's orders", `SELECT * FROM public.orders WHERE user_id = '${BOB}'`],
  ["another customer's entitlements", `SELECT * FROM public.entitlements WHERE user_id = '${BOB}'`],
  ["another customer's cards", `SELECT * FROM public.cards WHERE user_id = '${BOB}'`],
  ["another customer's notifications", `SELECT * FROM public.notifications WHERE user_id = '${BOB}'`],
  ["another customer's tap_profile row", `SELECT * FROM public.tap_profiles WHERE user_id = '${BOB}'`],
  ["another customer's payments", `SELECT * FROM public.payments`],
]) {
  await check(`Alice cannot read ${label}`, () =>
    asRole('authenticated', ALICE, async () => {
      const r = await db.query(sql);
      assert(r.rows.length === 0, `LEAK — returned ${r.rows.length} row(s)`);
      return '0 rows';
    }));
}

await check('Alice CAN read her own order (RLS is not just blanket-deny)', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT order_id FROM public.orders`);
    assert(r.rows.length === 1 && r.rows[0].order_id === 'ST-ALICE', `expected only ST-ALICE, got ${JSON.stringify(r.rows)}`);
    return 'sees exactly her own';
  }));

console.log('\n=== privilege escalation (customer granting themselves things) ===');

await check('cannot self-grant a paid experience (entitlements INSERT)', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.entitlements (user_id, type, key) VALUES ('${ALICE}', 'digital_plan', 'goat')`)));

await check('cannot self-grant the Customization Pass', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.entitlements (user_id, type, key) VALUES ('${ALICE}', 'lifetime', 'lifetime')`)));

await check('cannot self-grant a paid customization add-on', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.entitlements (user_id, type, key) VALUES ('${ALICE}', 'customization', 'whatsapp')`)));

await check('cannot reactivate a revoked entitlement', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.entitlements SET is_active = true WHERE user_id = '${ALICE}'`)));

await check('cannot make themselves an admin', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.admin_users (user_id) VALUES ('${ALICE}')`)));

console.log('\n=== payment / order tampering ===');

await check('cannot mark their own order paid', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.orders SET payment_status = 'paid' WHERE user_id = '${ALICE}'`)));

await check('cannot change their own order status', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.orders SET order_status = 'delivered' WHERE user_id = '${ALICE}'`)));

await check('cannot change an order amount', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.orders SET amount_in_paise = 1 WHERE user_id = '${ALICE}'`)));

await check('cannot insert a fabricated PAID order', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.orders (order_id, user_id, product_name, amount, amount_in_paise, payment_status)
                  VALUES ('ST-FAKE', '${ALICE}', 'Free stuff', 0, 0, 'paid')`)));

// The trigger above stops 'paid' specifically. The stronger question is whether
// a customer can create an orders row at all — if they can, they own a row the
// webhook might later fulfil.
await check('cannot insert ANY order row (even pending)', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.orders (order_id, user_id, product_name, amount, amount_in_paise, payment_status)
                  VALUES ('ST-FAKE2', '${ALICE}', 'Free stuff', 0, 0, 'pending')`)));

await check('cannot attach a razorpay_order_id to hijack a webhook', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.orders SET razorpay_order_id = 'order_hijack' WHERE user_id = '${ALICE}'`)));

await check("cannot rewrite another customer's shipping address", () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.orders SET shipping_address = 'redirected' WHERE user_id = '${BOB}'`)));

await check("cannot read another customer's order_items", () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT * FROM public.order_items`);
    assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
    return '0 rows';
  }));

await check("cannot take over another customer's Tap slug", () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.tap_profiles SET user_id = '${ALICE}' WHERE slug = 'bob-slug'`)));

await check("cannot read the raw webhook ledger", () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT * FROM public.webhook_events`);
    assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
    return '0 rows';
  }));

await check('cannot insert a payment row claiming success', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.payments (order_id, provider, provider_payment_id, status, amount_in_paise)
                  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'razorpay', 'pay_fake', 'paid', 299900)`)));

await check('cannot poison the webhook idempotency ledger', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.webhook_events (provider, event_id, event_type) VALUES ('razorpay', 'evt_block', 'payment.captured')`)));

console.log('\n=== catalogue / inventory tampering ===');

await check('cannot change product pricing', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.products SET price_in_paise = 1`)));

await check('cannot change product stock', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.products SET stock = 99999`)));

await check('cannot insert a product', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.products (name, sku, price_in_paise, product_type) VALUES ('Free card', 'card-free', 0, 'card')`)));

await check('cannot delete a product', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`DELETE FROM public.products`)));

await check('cannot write inventory movements', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`INSERT INTO public.inventory_movements (sku, delta, reason) VALUES ('card-x', 1000, 'hack')`)));

console.log('\n=== admin surface ===');

await check('customer cannot read the admin roster', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT * FROM public.admin_users`);
    assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
    return '0 rows';
  }));

await check('customer cannot read the admin audit log', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT * FROM public.admin_audit_log`);
    assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
    return '0 rows';
  }));

await check('customer cannot read admin notifications', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT * FROM public.admin_notifications`);
    assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
    return '0 rows';
  }));

await check('is_admin() is false for a plain customer', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT public.is_admin() AS v`);
    assert(r.rows[0].v === false, `is_admin() returned ${r.rows[0].v}`);
    return 'false';
  }));

await check('is_admin() is true for a real admin (control)', () =>
  asRole('authenticated', ADMIN, async () => {
    const r = await db.query(`SELECT public.is_admin() AS v`);
    assert(r.rows[0].v === true, `is_admin() returned ${r.rows[0].v}`);
    return 'true';
  }));

await check('admin CAN see every order (control)', () =>
  asRole('authenticated', ADMIN, async () => {
    const r = await db.query(`SELECT order_id FROM public.orders ORDER BY order_id`);
    assert(r.rows.length === 2, `admin saw ${r.rows.length} order(s), expected 2`);
    return 'sees both';
  }));

console.log('\n=== admin role separation (a low-privilege admin is not an owner) ===');

const VIEWER = '44444444-4444-4444-4444-444444444444';
const SUPPORT = '55555555-5555-5555-5555-555555555555';
await db.exec(`
  INSERT INTO auth.users (id, email) VALUES
    ('${VIEWER}', 'viewer@example.com'), ('${SUPPORT}', 'support@example.com');
  INSERT INTO public.admin_users (user_id, role, is_active)
  VALUES ('${VIEWER}', 'viewer', true), ('${SUPPORT}', 'support', true)
  ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;
`);

await check('a viewer admin has read, but NOT entitlements.grant', () =>
  asRole('authenticated', VIEWER, async () => {
    const r = await db.query(`SELECT public.admin_has('orders.read') AS can_read,
                                     public.admin_has('entitlements.grant') AS can_grant,
                                     public.admin_has('orders.refund') AS can_refund,
                                     public.admin_has('admins.manage') AS can_manage`);
    const v = r.rows[0];
    assert(v.can_read === true, 'viewer cannot even read');
    assert(v.can_grant === false, 'ESCALATION — viewer can grant entitlements');
    assert(v.can_refund === false, 'ESCALATION — viewer can refund');
    assert(v.can_manage === false, 'ESCALATION — viewer can manage admins');
    return 'read yes; grant/refund/manage no';
  }));

await check('a support admin cannot manage products or admins', () =>
  asRole('authenticated', SUPPORT, async () => {
    const r = await db.query(`SELECT public.admin_has('support.respond') AS s,
                                     public.admin_has('products.manage') AS p,
                                     public.admin_has('admins.manage') AS a`);
    const v = r.rows[0];
    assert(v.s === true, 'support cannot respond to support');
    assert(v.p === false, 'ESCALATION — support can manage products');
    assert(v.a === false, 'ESCALATION — support can manage admins');
    return 'support yes; products/admins no';
  }));

await check('a deactivated admin loses every permission', () =>
  asRole('authenticated', VIEWER, async () => {
    await db.exec(`RESET ROLE`);
    await db.exec(`UPDATE public.admin_users SET is_active = false WHERE user_id = '${VIEWER}'`);
    await db.exec(`SET ROLE authenticated`);
    const r = await db.query(`SELECT public.is_admin() AS a, public.admin_has('orders.read') AS b`);
    assert(r.rows[0].a === false && r.rows[0].b === false,
      `deactivated admin still privileged: ${JSON.stringify(r.rows[0])}`);
    return 'is_admin() false, admin_has() false';
  }));

await check('a plain customer cannot call admin_has() into a true', () =>
  asRole('authenticated', ALICE, async () => {
    const r = await db.query(`SELECT public.admin_has('orders.refund') AS v`);
    assert(r.rows[0].v === false, `ESCALATION — customer got ${r.rows[0].v}`);
    return 'false';
  }));

await check('a customer cannot promote themselves by UPDATE on admin_users', () =>
  asRole('authenticated', ALICE, () =>
    blockedWrite(`UPDATE public.admin_users SET role = 'owner' WHERE user_id = '${ADMIN}'`)));

console.log('\n=== anonymous visitor ===');

for (const [label, tbl] of [['orders', 'orders'], ['profiles', 'profiles'], ['entitlements', 'entitlements'], ['tap_profiles', 'tap_profiles'], ['notifications', 'notifications']]) {
  await check(`anon cannot read ${label}`, () =>
    asRole('anon', null, async () => {
      const r = await db.query(`SELECT * FROM public.${tbl}`);
      assert(r.rows.length === 0, `LEAK — ${r.rows.length} row(s)`);
      return '0 rows';
    }));
}

await check("anon can still resolve a published Tap through the RPC (control)", () =>
  asRole('anon', null, async () => {
    const r = await db.query(`SELECT public.get_public_tap_state('bob-slug') AS v`);
    assert(r.rows[0].v != null, 'RPC returned nothing');
    return JSON.stringify(r.rows[0].v).slice(0, 60);
  }));

await db.exec(`UPDATE public.tap_profiles SET published = false, status = 'draft' WHERE slug = 'bob-slug'`);

await check("anon cannot resolve an unpublished Tap's private data", () =>
  asRole('anon', null, async () => {
    const r = await db.query(`SELECT public.get_public_tap('bob-slug') AS v`);
    const txt = JSON.stringify(r.rows[0]?.v ?? null);
    assert(!/Bob/.test(txt), `LEAK — draft Tap content exposed: ${txt.slice(0, 160)}`);
    return 'withheld';
  }));

console.log(`\n${pass} passed, ${fail} failed`);
if (findings.length) {
  console.log('\n!!! SECURITY FINDINGS !!!');
  for (const f of findings) console.log('  - ' + f);
}
process.exit(fail > 0 ? 1 : 0);
