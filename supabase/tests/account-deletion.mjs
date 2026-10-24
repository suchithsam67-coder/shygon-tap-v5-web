import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, createMigratedDb, newMigrations, ROOT } from './lib/live-db.mjs';

/**
 * Account deletion (V6-072; migration 026; docs/runbooks/RUNBOOK-account-deletion.md).
 *
 * On the live baseline + 020 onward:
 *   - the runbook's SQL (docs/runbooks/account-deletion.sql), run exactly as
 *     written with its two placeholders filled in, deletes the account's data
 *     the Privacy Policy says is deleted, and keeps its orders and payments;
 *   - it refuses, changing nothing, when a placeholder is left in, the request
 *     is not on record, the account is an administrator or an order is still
 *     being fulfilled;
 *   - no other account is touched;
 *   - after 026, deleting the sign-in of an account that has orders fails and
 *     keeps them; an account without orders deletes as before;
 *   - on the live baseline as it is (020-025), the same delete takes the orders
 *     and payments with it: the defect 026 closes.
 *
 *   node supabase/tests/account-deletion.mjs
 */

const PROCEDURE = fs.readFileSync(path.join(ROOT, 'docs', 'runbooks', 'account-deletion.sql'), 'utf8');

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

const ME = 'a1000000-0000-4000-8000-000000000001';
const OTHER = 'a2000000-0000-4000-8000-000000000002';
const ADMIN = 'a3000000-0000-4000-8000-000000000003';
const NO_ORDERS = 'a4000000-0000-4000-8000-000000000004';
const REQUEST = 'ST-DEL00001';

/** Everything an account owns, by table: what the procedure must remove or keep. */
const OWNED = {
  tap_profiles: (id) => `SELECT count(*)::int AS n FROM public.tap_profiles WHERE user_id = '${id}'`,
  tap_events: (id) => `SELECT count(*)::int AS n FROM public.tap_events e JOIN public.tap_profiles t ON t.id = e.tap_profile_id WHERE t.user_id = '${id}'`,
  profiles: (id) => `SELECT count(*)::int AS n FROM public.profiles WHERE id = '${id}'`,
  customers: (id) => `SELECT count(*)::int AS n FROM public.customers WHERE user_id = '${id}'`,
  entitlements: (id) => `SELECT count(*)::int AS n FROM public.entitlements WHERE user_id = '${id}'`,
  notifications: (id) => `SELECT count(*)::int AS n FROM public.notifications WHERE user_id = '${id}'`,
  card_otp_challenges: (id) => `SELECT count(*)::int AS n FROM public.card_otp_challenges WHERE user_id = '${id}'`,
  account_events: (id) => `SELECT count(*)::int AS n FROM public.account_events WHERE user_id = '${id}'`,
  support_tickets: (id) => `SELECT count(*)::int AS n FROM public.support_tickets WHERE user_id = '${id}'`,
  support_messages: (id) => `SELECT count(*)::int AS n FROM public.support_messages m JOIN public.support_tickets t ON t.id = m.ticket_id WHERE t.user_id = '${id}'`,
  cards: (id) => `SELECT count(*)::int AS n FROM public.cards WHERE user_id = '${id}'`,
  orders: (id) => `SELECT count(*)::int AS n FROM public.orders WHERE user_id = '${id}'`,
  order_items: (id) => `SELECT count(*)::int AS n FROM public.order_items i JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = '${id}'`,
  payments: (id) => `SELECT count(*)::int AS n FROM public.payments p JOIN public.orders o ON o.id = p.order_id WHERE o.user_id = '${id}'`,
  // Migration 029 (counted only where it exists).
  emergency_settings: (id) => `SELECT count(*)::int AS n FROM public.emergency_settings WHERE user_id = '${id}'`,
  emergency_contacts: (id) => `SELECT count(*)::int AS n FROM public.emergency_contacts WHERE user_id = '${id}'`,
  emergency_contact_challenges: (id) => `SELECT count(*)::int AS n FROM public.emergency_contact_challenges WHERE user_id = '${id}'`,
  emergency_events: (id) => `SELECT count(*)::int AS n FROM public.emergency_events WHERE user_id = '${id}'`,
  emergency_event_recipients: (id) => `SELECT count(*)::int AS n FROM public.emergency_event_recipients r JOIN public.emergency_events e ON e.id = r.event_id WHERE e.user_id = '${id}'`,
  emergency_delivery_attempts: (id) => `SELECT count(*)::int AS n FROM public.emergency_delivery_attempts a JOIN public.emergency_event_recipients r ON r.id = a.recipient_id JOIN public.emergency_events e ON e.id = r.event_id WHERE e.user_id = '${id}'`,
  emergency_audit: (id) => `SELECT count(*)::int AS n FROM public.emergency_audit WHERE user_id = '${id}'`,
  // Migration 031 (counted only where it exists).
  rescue_settings: (id) => `SELECT count(*)::int AS n FROM public.rescue_settings WHERE user_id = '${id}'`,
  rescue_threads: (id) => `SELECT count(*)::int AS n FROM public.rescue_threads WHERE owner_user_id = '${id}'`,
  rescue_messages: (id) => `SELECT count(*)::int AS n FROM public.rescue_messages m JOIN public.rescue_threads t ON t.id = m.thread_id WHERE t.owner_user_id = '${id}'`,
  rescue_blocks: (id) => `SELECT count(*)::int AS n FROM public.rescue_blocks WHERE owner_user_id = '${id}'`,
  rescue_audit: (id) => `SELECT count(*)::int AS n FROM public.rescue_audit WHERE user_id = '${id}'`,
  // Migration 032 (counted only where it exists).
  connect_settings: (id) => `SELECT count(*)::int AS n FROM public.connect_settings WHERE user_id = '${id}'`,
  connections: (id) => `SELECT count(*)::int AS n FROM public.connections WHERE requester_user_id = '${id}' OR target_user_id = '${id}'`,
  consent_grants: (id) => `SELECT count(*)::int AS n FROM public.consent_grants WHERE grantor_user_id = '${id}' OR grantee_user_id = '${id}'`,
  connect_audit: (id) => `SELECT count(*)::int AS n FROM public.connect_audit WHERE user_id = '${id}'`,
  // Migration 033 (counted only where it exists).
  prive_demo_requests: (id) => `SELECT count(*)::int AS n FROM public.prive_demo_requests WHERE user_id = '${id}'`,
  prive_demo_request_events: (id) => `SELECT count(*)::int AS n FROM public.prive_demo_request_events e JOIN public.prive_demo_requests r ON r.id = e.request_id WHERE r.user_id = '${id}'`,
  // Migration 034 (counted only where it exists).
  info_pages: (id) => `SELECT count(*)::int AS n FROM public.info_pages WHERE owner_user_id = '${id}'`,
  tap_mode_state: (id) => `SELECT count(*)::int AS n FROM public.tap_mode_state WHERE user_id = '${id}'`,
  tap_mode_audit: (id) => `SELECT count(*)::int AS n FROM public.tap_mode_audit WHERE user_id = '${id}'`,
};
const KEPT = ['orders', 'order_items', 'payments'];
const has034 = async (db) => (await db.query(`SELECT to_regclass('public.info_pages') IS NOT NULL AS x`)).rows[0].x;
const has033 = async (db) => (await db.query(`SELECT to_regclass('public.prive_demo_requests') IS NOT NULL AS x`)).rows[0].x;
const has032 = async (db) => (await db.query(`SELECT to_regclass('public.connections') IS NOT NULL AS x`)).rows[0].x;
const has031 = async (db) => (await db.query(`SELECT to_regclass('public.rescue_threads') IS NOT NULL AS x`)).rows[0].x;
const has029 = async (db) => (await db.query(`SELECT to_regclass('public.emergency_contacts') IS NOT NULL AS x`)).rows[0].x;

async function owned(db, id) {
  const out = {};
  for (const [table, sql] of Object.entries(OWNED)) {
    if (table.startsWith('emergency_') && !(await has029(db))) continue;
    if (table.startsWith('rescue_') && !(await has031(db))) continue;
    if (['connect_settings', 'connections', 'consent_grants', 'connect_audit'].includes(table) && !(await has032(db))) continue;
    if (table.startsWith('prive_') && !(await has033(db))) continue;
    if (['info_pages', 'tap_mode_state', 'tap_mode_audit'].includes(table) && !(await has034(db))) continue;
    out[table] = (await db.query(sql(id))).rows[0].n;
  }
  return out;
}

/** A paying customer with a Tap, visits, a card, codes, messages and a deletion request. */
async function customer(db, id, slug, { request = null, fulfilment = 'fulfilled' } = {}) {
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${id}', '${slug}@example.test');`);
  const { rows } = await db.query(`SELECT id FROM public.customers WHERE user_id = $1`, [id]);
  assert(rows.length === 1, `sign-up made no customers row for ${slug}`);
  const cust = rows[0].id;
  await db.exec(`
    INSERT INTO public.tap_profiles (user_id, customer_id, username, slug, status, published)
      VALUES ('${id}', '${cust}', '${slug}', '${slug}', 'active', true);
    INSERT INTO public.tap_events (tap_profile_id, event_type)
      SELECT id, 'view' FROM public.tap_profiles WHERE user_id = '${id}';
    INSERT INTO public.orders (order_id, user_id, customer_id, product_name, amount, amount_in_paise,
                               payment_status, order_status, fulfillment_status, order_type, plan_id)
      VALUES ('ST-${slug.toUpperCase()}-0001', '${id}', '${id}', 'Business experience', 299, 29900,
              'paid', 'processing', '${fulfilment}', 'digitalUpgrade', 'business');
    INSERT INTO public.order_items (order_id, sku, name, product_type, unit_price_in_paise, line_total_in_paise)
      SELECT id, 'plan-business', 'Business experience', 'digital_plan', 29900, 29900 FROM public.orders WHERE user_id = '${id}';
    INSERT INTO public.payments (order_id, provider_order_id, provider_payment_id, status, amount_in_paise)
      SELECT id, 'order_${slug}', 'pay_${slug}', 'paid', 29900 FROM public.orders WHERE user_id = '${id}';
    INSERT INTO public.entitlements (user_id, type, key, source_order_id, is_active)
      SELECT '${id}', 'digital_plan', 'business', id, true FROM public.orders WHERE user_id = '${id}';
    INSERT INTO public.notifications (user_id, title) VALUES ('${id}', 'Your SHYGON Tap draft is ready');
    INSERT INTO public.cards (card_id, user_id, customer_id, tap_profile_id, status, card_status, activation_code)
      SELECT 'CARD-${slug}', '${id}', '${cust}', t.id, 'active', 'active', 'code-${slug}'
        FROM public.tap_profiles t WHERE t.user_id = '${id}';
    INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at)
      SELECT '${id}', id, 'deactivate', 'hash', now() + interval '10 minutes' FROM public.cards WHERE user_id = '${id}';
    INSERT INTO public.support_tickets (user_id, subject, category${request ? ', reference' : ''})
      VALUES ('${id}', 'Where is my invoice?', 'order'${request ? `, 'ST-Q${slug.slice(0, 7).toUpperCase()}'` : ''});
  `);
  if (await has029(db)) {
    await db.exec(`
      INSERT INTO public.emergency_settings (user_id, public_alerts_enabled) VALUES ('${id}', true);
      INSERT INTO public.emergency_contacts (user_id, name, phone_e164, verified_at) VALUES ('${id}', 'Contact', '+919800000077', now());
      INSERT INTO public.emergency_contact_challenges (user_id, contact_id, phone_digest, code_hash, expires_at)
        SELECT '${id}', id, 'digest', 'hash', now() + interval '10 minutes' FROM public.emergency_contacts WHERE user_id = '${id}';
      INSERT INTO public.emergency_events (user_id, initiator, idempotency_key, recipient_count)
        VALUES ('${id}', 'owner', 'deletion-test-key-${slug.slice(0, 6)}', 1);
      INSERT INTO public.emergency_event_recipients (event_id, contact_id, contact_name, phone_last4, phone_e164)
        SELECT e.id, c.id, c.name, '0077', c.phone_e164 FROM public.emergency_events e, public.emergency_contacts c
         WHERE e.user_id = '${id}' AND c.user_id = '${id}';
      INSERT INTO public.emergency_delivery_attempts (recipient_id, attempt_no, outcome)
        SELECT r.id, 1, 'accepted' FROM public.emergency_event_recipients r JOIN public.emergency_events e ON e.id = r.event_id
         WHERE e.user_id = '${id}';
      INSERT INTO public.emergency_audit (user_id, actor, action) VALUES ('${id}', 'owner', 'contact.added');
    `);
  }
  if (await has031(db)) {
    await db.exec(`
      INSERT INTO public.rescue_settings (user_id, enabled) VALUES ('${id}', true);
      INSERT INTO public.rescue_threads (owner_user_id, finder_token_hash, finder_digest, idempotency_key)
        VALUES ('${id}', 'token-${slug}', 'digest-${slug}', 'deletion-rescue-${slug.slice(0, 6)}');
      INSERT INTO public.rescue_messages (thread_id, sender, body)
        SELECT id, 'finder', 'I found your card' FROM public.rescue_threads WHERE owner_user_id = '${id}';
      INSERT INTO public.rescue_blocks (owner_user_id, finder_digest, expires_at) VALUES ('${id}', 'blocked-${slug}', now() + interval '1 day');
      INSERT INTO public.rescue_audit (user_id, actor, action) VALUES ('${id}', 'owner', 'settings.enabled');
    `);
  }
  if (await has032(db)) {
    // A connection to a peer of its own, so no other test account is touched.
    await db.exec(`DO $$ DECLARE p uuid := gen_random_uuid(); c uuid := gen_random_uuid(); BEGIN
      INSERT INTO auth.users (id, email) VALUES (p, 'peer-${slug}@example.test');
      INSERT INTO public.connect_settings (user_id, enabled) VALUES ('${id}', true);
      INSERT INTO public.connections (id, requester_user_id, target_user_id, status, idempotency_key)
        VALUES (c, '${id}', p, 'accepted', 'deletion-connect-${slug.slice(0, 6)}');
      INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id)
        VALUES ('${id}', p, ARRAY['email'], c), (p, '${id}', ARRAY['phone'], c);
      INSERT INTO public.connect_audit (user_id, action) VALUES ('${id}', 'request.sent');
    END $$;`);
  }
  if (await has033(db)) {
    await db.exec(`
      INSERT INTO public.prive_demo_requests (user_id, hotel_id, service, idempotency_key)
        SELECT '${id}', id, 'housekeeping', 'deletion-prive-${slug.slice(0, 6)}' FROM public.prive_demo_hotels WHERE slug = 'demo-residence';
      INSERT INTO public.prive_demo_request_events (request_id, status, actor)
        SELECT id, 'received', 'guest' FROM public.prive_demo_requests WHERE user_id = '${id}';
    `);
  }
  if (await has034(db)) {
    await db.exec(`
      INSERT INTO public.info_pages (owner_user_id, title, short_description) VALUES ('${id}', 'Deletion info', 'A page about a thing');
      INSERT INTO public.tap_mode_state (tap_profile_id, user_id) SELECT id, '${id}' FROM public.tap_profiles WHERE user_id = '${id}';
      INSERT INTO public.tap_mode_audit (user_id, action) VALUES ('${id}', 'info_save');
    `);
  }
  if (request) {
    await db.exec(`
      INSERT INTO public.support_tickets (user_id, subject, category, reference)
        VALUES ('${id}', 'Account deletion request', 'privacy', '${request}');
      INSERT INTO public.support_messages (ticket_id, author_id, body)
        SELECT id, '${id}', 'Please delete my SHYGON account.' FROM public.support_tickets WHERE reference = '${request}';
    `);
  }
}

const run = (db, target, request) =>
  db.exec(PROCEDURE.replace("'<ACCOUNT ID>'", `'${target}'`).replace("'<REQUEST REFERENCE>'", `'${request}'`));

async function refuses(db, sql, pattern, label) {
  const before = json(await owned(db, ME));
  let error = null;
  try {
    await db.exec(sql);
  } catch (e) {
    error = e;
  }
  assert(error, `${label}: the procedure ran`);
  assert(pattern.test(error.message), `${label}: refused for the wrong reason: ${error.message}`);
  assert(json(await owned(db, ME)) === before, `${label}: something changed although it refused`);
}

console.log('\n=== account deletion (V6-072, migration 026, the runbook procedure) ===');

const db = await createMigratedDb();
await customer(db, ME, 'deleteme', { request: REQUEST });
await customer(db, OTHER, 'keepme');
await customer(db, ADMIN, 'anadmin', { request: 'ST-DEL00002' });
await db.exec(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ('${ADMIN}', 'admin', true);`);

await check('the set-up holds a full account for every table the procedure touches', async () => {
  const mine = await owned(db, ME);
  const empty = Object.entries(mine).filter(([, n]) => n === 0).map(([t]) => t);
  assert(empty.length === 0, `no rows in: ${empty.join(', ')}`);
  return json(mine);
});

await check('refuses, changing nothing, while a placeholder is still in it', async () => {
  await refuses(db, PROCEDURE, /invalid input syntax for type uuid/, 'unreplaced');
});

await check('refuses without the request on record, for an administrator, and while an order is being fulfilled', async () => {
  const filled = (target, request) =>
    PROCEDURE.replace("'<ACCOUNT ID>'", `'${target}'`).replace("'<REQUEST REFERENCE>'", `'${request}'`);
  await refuses(db, filled(ME, 'ST-NOTREAL1'), /no privacy request ST-NOTREAL1/, 'unknown reference');
  await refuses(db, filled(ME, 'ST-QDELETEM'), /no privacy request/, 'a reference that is not a privacy request');
  await refuses(db, filled('a9000000-0000-4000-8000-000000000009', REQUEST), /no account/, 'no such account');
  await refuses(db, filled(ADMIN, 'ST-DEL00002'), /is an administrator/, 'administrator');
  await db.exec(`UPDATE public.orders SET fulfillment_status = 'processing' WHERE user_id = '${ME}'`);
  await refuses(db, filled(ME, REQUEST), /orders still being fulfilled: ST-DELETEME-0001/, 'fulfilment in progress');
  await db.exec(`UPDATE public.orders SET fulfillment_status = 'fulfilled' WHERE user_id = '${ME}'`);
});

const otherBefore = await owned(db, OTHER);

await check('deletes the account, profile and Tap data, visits, codes and conversations; keeps orders and payments', async () => {
  const before = await owned(db, ME);
  await run(db, ME, REQUEST);
  const after = await owned(db, ME);
  for (const [table, n] of Object.entries(after)) {
    if (KEPT.includes(table)) assert(n === before[table], `${table}: ${before[table]} kept → ${n}`);
    else assert(n === 0, `${table}: ${n} left`);
  }
  return `kept ${KEPT.map((t) => `${t} ${after[t]}`).join(', ')}`;
});

await check('the card stays as a hardware record, unlinked and retired, so it opens nothing', async () => {
  const { rows } = await db.query(`SELECT user_id, customer_id, tap_profile_id, status, card_status, deactivated_at IS NOT NULL AS off
    FROM public.cards WHERE card_id = 'CARD-deleteme'`);
  assert(json(rows) === json([{ user_id: null, customer_id: null, tap_profile_id: null, status: 'suspended', card_status: 'retired', off: true }]), json(rows));
});

await check('no other account is touched', async () => {
  const after = await owned(db, OTHER);
  assert(json(after) === json(otherBefore), `${json(otherBefore)} → ${json(after)}`);
  const admin = await owned(db, ADMIN);
  assert(admin.tap_profiles === 1 && admin.support_tickets === 2, `administrator: ${json(admin)}`);
});

await check('026: deleting the sign-in of an account with orders fails and keeps every order and payment', async () => {
  let error = null;
  try {
    await db.exec(`DELETE FROM auth.users WHERE id = '${ME}'`);
  } catch (e) {
    error = e;
  }
  assert(error && /orders_user_id_fkey/.test(error.message), `the delete went through: ${error?.message}`);
  const after = await owned(db, ME);
  assert(after.orders === 1 && after.payments === 1 && after.order_items === 1, json(after));
});

await check('026: an account with no orders still deletes, and takes its account data with it', async () => {
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${NO_ORDERS}', 'no.orders@example.test');
                 INSERT INTO public.notifications (user_id, title) VALUES ('${NO_ORDERS}', 'Welcome');`);
  await db.exec(`DELETE FROM auth.users WHERE id = '${NO_ORDERS}'`);
  const left = await owned(db, NO_ORDERS);
  assert(Object.values(left).every((n) => n === 0), json(left));
});
await db.close();

await check('on the live baseline as it is (020-025), the same delete takes the orders and payments with it', async () => {
  const live = await createLiveDb();
  for (const { name, sql } of newMigrations().filter(({ name }) => name < '026')) {
    await live.exec(sql).catch((e) => { throw new Error(`${name}: ${e.message}`); });
  }
  await customer(live, ME, 'deleteme', { request: REQUEST });
  await live.exec(`DELETE FROM auth.users WHERE id = '${ME}'`);
  const after = await owned(live, ME);
  await live.close();
  assert(after.orders === 0 && after.payments === 0, `expected the cascade, got ${json(after)}`);
  return 'orders 1 → 0, payments 1 → 0: the defect 026 fixes';
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
