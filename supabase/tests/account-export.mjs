// The owner's data export (V01 T-10): migration 038 and /api/account on the
// local stack, against DEC-2026-044 (approved for the local build 2026-11-03).
//
//   A. Closure, and the export-parity gate: every table linked to an account is
//      classified (exported, excluded with a reason, or staff-only), and the
//      deletion procedure clears every exported table but the orders it keeps.
//   B. The operation: access, the owner's own data in every section, nothing of
//      anyone else and no security value, the vCard, isolation, the limit and
//      its audit, the row cap.
//   C. Deletion parity: after docs/runbooks/account-deletion.sql, the export
//      holds only the orders kept for tax law.
//
// Not claimed: two requests racing the limit (PGlite has one connection; the
// advisory lock is read from the function instead).
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/account-export.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROCEDURE = fs.readFileSync(path.join(ROOT, 'docs', 'runbooks', 'account-deletion.sql'), 'utf8');

const t = createHarness('Owner data export (038, /api/account, DEC-2026-044)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}

// Every public table linked to an account, and what the export does with it.
// A table added later fails the gate until it is classified here (DEC-2026-044 §4.6).
const EXPORTED = [
  'profiles', 'customers', 'tap_profiles', 'customer_customizations', 'tap_mode_state', 'info_pages', 'tap_mode_audit',
  'cards', 'tap_device_auth', 'orders', 'order_items', 'order_status_history', 'entitlements',
  'emergency_settings', 'emergency_contacts', 'emergency_events', 'emergency_event_recipients', 'emergency_audit',
  'rescue_settings', 'rescue_threads', 'rescue_messages', 'rescue_blocks', 'rescue_audit',
  'connect_settings', 'connections', 'consent_grants', 'connect_audit',
  'prive_demo_requests', 'prive_demo_request_events', 'notifications', 'support_tickets', 'support_messages', 'account_events',
  'account_phone_verifications', 'card_events', 'account_age_confirmations',
];
const EXCLUDED = {
  card_otp_challenges: 'security: one-time code hashes',
  emergency_contact_challenges: 'security: verification code hashes and number digests',
  emergency_delivery_attempts: 'internal: provider delivery records (each alert shows its delivery status)',
  tap_events: 'visitors: analytics about the people who opened the Tap',
  tap_verify_events: 'visitors: the Verified Tap log (daily visitor digests); linked by code, not by a foreign key',
  account_phone_challenges: 'security: phone verification code hashes and number digests (039)',
};
const STAFF_ONLY = {
  admin_users: 'staff accounts', admin_audit_log: 'staff audit', admin_notifications: 'staff inbox',
  admin_notification_reads: 'staff inbox', admin_push_tokens: 'staff devices', admin_allowed_email_domains: 'staff sign-up rule',
  order_admin_notes: 'staff notes', order_item_fulfillment_actions: 'staff fulfilment', inventory_movements: 'stock records',
  payments: 'the payment ledger (each order carries its amount, status and references)',
};
// Kept by the deletion procedure for tax law ("orders, invoices and payment records ... up to 8 years").
const KEPT_BY_DELETION = ['orders', 'order_items', 'order_status_history'];

const stack = await startStack();
process.env.SITE_URL = 'https://tap.example.test';
const responses = [];
const call = async (body, token) => {
  const r = await callFunction(stack, 'account', { token, body });
  responses.push(JSON.stringify(r.body));
  return r;
};
const codeOf = (r) => r.body?.error?.code;
const q = async (sql, params = []) => (await stack.query(sql, params)).rows;
const build = async (userId) => (await q(`SELECT public.account_export_build($1) AS x`, [userId]))[0].x;

// ---------------------------------------------------------------------------
// Fixtures: an owner with data in every section, a Connect counterpart, a staff
// member, and a second owner. Canaries are values that must never be exported.
const ben = await signUp(stack, { name: 'CANARY-BEN-NAME' });
const sam = await signUp(stack, { name: 'Sam Staff' });
const hotel = (await q(`SELECT id FROM public.prive_demo_hotels ORDER BY sort_order LIMIT 1`))[0].id;
const customization = (await q(`INSERT INTO public.customizations (code, name) VALUES ('export-test-website', 'Website link') RETURNING id`))[0].id;
const hex = (s, n) => s.repeat(n);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function canaries(n) {
  return {
    activationCode: `CANARYACT${n}`,
    cardUid: `04CANARYUID${n}`,
    uidHmac: hex('cafe', 15) + String(n).padStart(4, '0'),
    contactNumber: `+9198111009${n}9`,
    contactDigits: `98111009${n}9`,
    challengeHash: `CANARY-CODE-HASH-${n}`,
    phoneDigest: `CANARY-PHONE-DIGEST-${n}`,
    emergencyIdem: `CANARYIDEMPEMERGENCY${n}`,
    visitorDigest: `CANARY-VISITOR-DIGEST-${n}`,
    providerId: `CANARY-PROVIDER-ID-${n}`,
    lastError: `CANARY-LAST-ERROR-${n}`,
    auditDetail: `CANARY-AUDIT-DETAIL-${n}`,
    finderWords: `CANARY-FINDER-WORDS-${n}`,
    tokenHash: `CANARY-TOKEN-HASH-${n}`,
    finderDigest: `CANARY-FINDER-DIGEST-${n}`,
    rescueIdem: `CANARYIDEMPRESCUE000${n}`,
    clientKey: `CANARYCLIENTKEY0000${n}`,
    blockDigest: `CANARY-BLOCK-DIGEST-${n}`,
    benNote: `CANARY-BEN-NOTE-${n}`,
    connectIdem: `CANARYIDEMPCONNECT00${n}`,
    connectIdem2: `CANARYIDEMPCONNECT10${n}`,
    priveIdem: `CANARYIDEMPPRIVE0000${n}`,
    notifMeta: `CANARY-NOTIF-META-${n}`,
    adminNote: `CANARY-ADMIN-NOTE-${n}`,
    statusNote: `CANARY-STATUS-NOTE-${n}`,
    emailProvider: `CANARY-EMAIL-PROVIDER-${n}`,
    paymentRaw: `CANARY-PAYMENT-RAW-${n}`,
    paymentId: `CANARY-PAY-ID-${n}`,
    otpHash: `CANARY-OTP-HASH-${n}`,
    visitorHash: `CANARY-VISITOR-HASH-${n}`,
    verifyDigest: hex('beef', 15) + String(n).padStart(4, '0'),
    modesIdem: `CANARYIDEMPMODES0000${n}`,
    modesResult: `CANARY-LAST-RESULT-${n}`,
    phoneCodeDigest: hex('d1e5', 15) + String(n).padStart(4, '0'),
    phoneCodeHash: hex('c0de', 15) + String(n).padStart(4, '0'),
    benId: ben.userId,
    staffId: sam.userId,
  };
}

/** An owner with a row in every exported table (and in each excluded one). */
async function seedOwner(u, n, slug) {
  const C = canaries(n);
  const code = Array.from({ length: 16 }, (_, i) => BASE32[(n * 7 + i * 3) % 32]).join('');
  await q(`UPDATE public.profiles SET full_name = $2, phone = '+919812345678', email = $3, company = 'Rao Studio', job_title = 'Designer', show_phone = true WHERE id = $1`,
    [u.userId, `Owner ${n}`, `owner${n}.account@example.test`]);
  const tap = (await q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, headline, designation, company,
      phone, whatsapp, email, website, instagram, enabled_customizations, custom_links, status, suspended_by)
    VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, 'Asha Rao', 'Designer at Rao Studio',
      'Lead designer for brand systems, wayfinding and signage in public spaces across India', 'Rao, Design; Studio',
      '+919812345678', '+919800000001', $3, 'https://asha.example.test', 'https://instagram.com/asha.example',
      '{phone}', '[{"label":"Portfolio","url":"https://example.test/p"}]'::jsonb, 'active', $4) RETURNING id`,
  [u.userId, slug, `owner${n}.private@example.test`, C.staffId]))[0].id;
  await q(`INSERT INTO public.customer_customizations (customer_id, tap_profile_id, customization_id, status)
    VALUES ((SELECT id FROM public.customers WHERE user_id = $1), $2, $3, 'active')`, [u.userId, tap, customization]);
  await q(`INSERT INTO public.tap_mode_state (tap_profile_id, user_id, active_mode, version, last_idempotency_key, last_result)
    VALUES ($1, $2, 'business', 2, $3, jsonb_build_object('x', $4::text))`, [tap, u.userId, C.modesIdem, C.modesResult]);
  await q(`INSERT INTO public.info_pages (owner_user_id, title, short_description, category, detailed_information)
    VALUES ($1, 'Room 12 printer', 'How to print from room 12.', 'equipment', 'Press the green button.')`, [u.userId]);
  await q(`INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, fields, actor) VALUES ($1, $2, 'info_save', '{title}', 'owner')`, [u.userId, tap]);
  const card = (await q(`INSERT INTO public.cards (user_id, customer_id, tap_profile_id, card_id, activation_code, card_uid, sku, card_slot, status,
      edition_design, edition_serial, edition_count, edition_chapter_size, nickname)
    VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $3, $4, $5, 'aaroh-test', 1, 'active', 'Obsidian', $6, 100, 100, 'Daily card')
    RETURNING id`, [u.userId, tap, `SHY-EXP-${n}`, C.activationCode, C.cardUid, 70 + n]))[0].id;
  await q(`SELECT public.verify_register_device($1, $2, 1, $3)`, [card, code, C.uidHmac]);
  await q(`UPDATE public.tap_device_auth SET last_counter = 4242, last_verified_at = now() WHERE public_code = $1`, [code]);
  await q(`INSERT INTO public.card_events (card_id, from_status, to_status, actor, reason) VALUES ($1, 'shipped', 'active', 'owner', 'tap to activate')`, [card]);
  await q(`INSERT INTO public.tap_verify_events (public_code, verdict, visitor_digest) VALUES ($1, 'genuine', $2)`, [code, C.verifyDigest]);
  const order = (await q(`INSERT INTO public.orders (order_id, user_id, customer_id, product_name, amount, amount_in_paise, payment_status,
      order_status, fulfillment_status, order_type, admin_note, email_provider_id, shipping_name, shipping_address, razorpay_payment_id)
    VALUES ($1, $2, $2, 'AAROH card', 999, 99900, 'paid', 'delivered', 'fulfilled',
      'card', $3, $4, 'Asha Rao', '12 Lake Road', 'pay_owner_visible') RETURNING id`, [`ST-EXPORT${n}-0001`, u.userId, C.adminNote, C.emailProvider]))[0].id;
  await q(`INSERT INTO public.order_items (order_id, sku, name, unit_price_in_paise, line_total_in_paise, quantity)
    VALUES ($1, 'aaroh-card', 'AAROH card', 99900, 99900, 1)`, [order]);
  await q(`INSERT INTO public.order_status_history (order_id, status, note) VALUES ($1, 'delivered', $2)`, [order, C.statusNote]);
  await q(`INSERT INTO public.payments (order_id, provider_order_id, provider_payment_id, amount_in_paise, raw_payload)
    VALUES ($1, 'CANARY-PAY-ORDER', $2, 99900, jsonb_build_object('x', $3::text))`, [order, C.paymentId, C.paymentRaw]);
  await q(`INSERT INTO public.entitlements (user_id, type, key) VALUES ($1, 'customization', 'website')`, [u.userId]);
  await q(`INSERT INTO public.emergency_settings (user_id, public_alerts_enabled) VALUES ($1, false)`, [u.userId]);
  const contact = (await q(`INSERT INTO public.emergency_contacts (user_id, name, relationship, phone_e164, verified_at)
    VALUES ($1, 'Mum', 'mother', $2, now()) RETURNING id`, [u.userId, C.contactNumber]))[0].id;
  await q(`INSERT INTO public.emergency_contact_challenges (user_id, contact_id, phone_digest, code_hash, expires_at)
    VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`, [u.userId, contact, C.phoneDigest, C.challengeHash]);
  const event = (await q(`INSERT INTO public.emergency_events (user_id, initiator, idempotency_key, visitor_digest, status, recipient_count)
    VALUES ($1, 'owner', $2, $3, 'delivered', 1) RETURNING id`, [u.userId, C.emergencyIdem, C.visitorDigest]))[0].id;
  await q(`INSERT INTO public.emergency_event_recipients (event_id, contact_id, contact_name, phone_last4, status, provider_message_id, last_error, delivered_at)
    VALUES ($1, $2, 'Mum', right($3, 4), 'delivered', $4, $5, now())`, [event, contact, C.contactNumber, C.providerId, C.lastError]);
  await q(`INSERT INTO public.emergency_audit (user_id, event_id, actor, action, detail) VALUES ($1, $2, 'owner', 'alert.created', jsonb_build_object('x', $3::text))`,
    [u.userId, event, C.auditDetail]);
  await q(`INSERT INTO public.rescue_settings (user_id, enabled, public_hint) VALUES ($1, true, 'Please call the front desk')`, [u.userId]);
  const thread = (await q(`INSERT INTO public.rescue_threads (owner_user_id, tap_profile_id, finder_token_hash, finder_digest, idempotency_key, status)
    VALUES ($1, $2, $3, $4, $5, 'owner_replied') RETURNING id`, [u.userId, tap, C.tokenHash, C.finderDigest, C.rescueIdem]))[0].id;
  await q(`INSERT INTO public.rescue_messages (thread_id, sender, body, client_key, created_at) VALUES ($1, 'finder', $2, $3, now() - interval '1 minute')`,
    [thread, `${C.finderWords} call me on +919800011122`, C.clientKey]);
  await q(`INSERT INTO public.rescue_messages (thread_id, sender, body) VALUES ($1, 'owner', 'Thanks, I will collect it')`, [thread]);
  await q(`INSERT INTO public.rescue_blocks (owner_user_id, finder_digest, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [u.userId, C.blockDigest]);
  await q(`INSERT INTO public.rescue_audit (user_id, thread_id, actor, action, detail) VALUES ($1, $2, 'finder', 'thread.opened', jsonb_build_object('x', $3::text))`,
    [u.userId, thread, C.auditDetail]);
  await q(`INSERT INTO public.connect_settings (user_id, enabled) VALUES ($1, true)`, [u.userId]);
  const mine = (await q(`INSERT INTO public.connections (requester_user_id, target_user_id, idempotency_key, status, note)
    VALUES ($1, $2, $3, 'accepted', 'Met at the expo') RETURNING id`, [u.userId, ben.userId, C.connectIdem]))[0].id;
  await q(`INSERT INTO public.connections (requester_user_id, target_user_id, idempotency_key, status, note)
    VALUES ($2, $1, $3, 'declined', $4)`, [u.userId, ben.userId, C.connectIdem2, C.benNote]);
  await q(`INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id) VALUES ($1, $2, '{phone}', $3)`, [u.userId, ben.userId, mine]);
  await q(`INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id) VALUES ($2, $1, '{email}', $3)`, [u.userId, ben.userId, mine]);
  await q(`INSERT INTO public.connect_audit (user_id, connection_id, action, detail) VALUES ($1, $2, 'request.sent', jsonb_build_object('x', $3::text))`,
    [u.userId, mine, C.auditDetail]);
  const request = (await q(`INSERT INTO public.prive_demo_requests (user_id, hotel_id, service, idempotency_key)
    VALUES ($1, $2, 'late_checkout', $3) RETURNING id`, [u.userId, hotel, C.priveIdem]))[0].id;
  await q(`INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES ($1, 'received', 'guest')`, [request]);
  await q(`INSERT INTO public.notifications (user_id, category, title, body, metadata)
    VALUES ($1, 'rescue', 'Someone found your card', 'Open your inbox.', jsonb_build_object('x', $2::text))`, [u.userId, C.notifMeta]);
  const ticket = (await q(`INSERT INTO public.support_tickets (user_id, subject, category, reference)
    VALUES ($1, 'Card not scanning', 'order', $2) RETURNING id`, [u.userId, `ST-EXP${n}AAAA`]))[0].id;
  await q(`INSERT INTO public.support_messages (ticket_id, author_id, author_role, body, created_at) VALUES ($1, $2, 'customer', 'My card is not scanning', now() - interval '1 minute')`, [ticket, u.userId]);
  await q(`INSERT INTO public.support_messages (ticket_id, author_id, author_role, body) VALUES ($1, $2, 'admin', 'We have received your request')`, [ticket, sam.userId]);
  await q(`INSERT INTO public.account_events (user_id, event_type, subject_type, detail) VALUES ($1, 'tap_published', 'tap', '{"note":"own"}'::jsonb)`, [u.userId]);
  await q(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at) VALUES ($1, $2, 'activate', $3, now() + interval '5 minutes')`,
    [u.userId, card, C.otpHash]);
  await q(`INSERT INTO public.tap_events (tap_profile_id, event_type, visitor_hash) VALUES ($1, 'view', $2)`, [tap, C.visitorHash]);
  await q(`INSERT INTO public.account_phone_verifications (user_id, phone_e164) VALUES ($1, '+919812345678')`, [u.userId]);
  await q(`INSERT INTO public.account_phone_challenges (id, user_id, phone_digest, phone_last4, code_hash, expires_at)
    VALUES (gen_random_uuid(), $1, $2, '5678', $3, now() + interval '10 minutes')`, [u.userId, C.phoneCodeDigest, C.phoneCodeHash]);
  return { C, code, slug, n };
}

const asha = await signUp(stack, { name: 'Asha Export' });
const A = await seedOwner(asha, 1, 'asha-export');
const cara = await signUp(stack, { name: 'CANARY-CARA-NAME' });
await q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, phone, enabled_customizations, status)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'cara-export', 'cara-export', 'Cara Paused', '+919811122233', '{phone}', 'paused')`, [cara.userId]);
await q(`INSERT INTO public.info_pages (owner_user_id, title) VALUES ($1, 'CANARY-CARA-INFO')`, [cara.userId]);

/** Every canary of `C`, as text that must not occur anywhere in `text`. */
const leaks = (C, text) => Object.entries(C).filter(([, v]) => v && text.includes(String(v))).map(([k]) => k);

// ---------------------------------------------------------------------------
t.section('A. Closure and the export-parity gate');

await t.check('server only: no client role can execute either function; no new table', async () => {
  const r = (await q(`SELECT
      has_function_privilege('anon', 'public.account_export_build(uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.account_export_build(uuid)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.account_export_request(uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.account_export_request(uuid)', 'EXECUTE') AS client,
      has_function_privilege('service_role', 'public.account_export_request(uuid)', 'EXECUTE') AS service,
      (SELECT p.provolatile FROM pg_proc p WHERE p.oid = 'public.account_export_build(uuid)'::regprocedure) AS volatility,
      (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.account_export_request(uuid)'::regprocedure) AS definer`))[0];
  assertEqual(r, { client: false, service: true, volatility: 's', definer: true }, 'grants');
  const src = (await q(`SELECT prosrc FROM pg_proc WHERE oid = 'public.account_export_request(uuid)'::regprocedure`))[0].prosrc;
  assert(/pg_advisory_xact_lock\(hashtext\('account_export:' \|\| p_user::text\)\)/.test(src), 'one export at a time per account');
  const build = (await q(`SELECT prosrc FROM pg_proc WHERE oid = 'public.account_export_build(uuid)'::regprocedure`))[0].prosrc;
  assert(!/to_jsonb\(\s*[a-z]+\s*\)|\.\*|SELECT \*/.test(build), 'the builder never copies a whole row');
  return 'service_role only; STABLE builder (one snapshot); no whole-row copies';
});

await t.check('every table linked to an account is classified: exported, excluded with a reason, or staff-only', async () => {
  const fks = await q(`SELECT cr.relname AS child, pn.nspname AS parent_schema, pr.relname AS parent
    FROM pg_constraint c
    JOIN pg_class cr ON cr.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cr.relnamespace
    JOIN pg_class pr ON pr.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pr.relnamespace
    WHERE c.contype = 'f' AND cn.nspname = 'public'`);
  const tables = new Set((await q(`SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public'`)).map((r) => r.t));
  const linked = new Set((await q(`SELECT DISTINCT table_name AS t FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'uuid'
      AND column_name IN ('user_id', 'owner_user_id', 'requester_user_id', 'target_user_id', 'grantor_user_id', 'grantee_user_id', 'author_id')`))
    .map((r) => r.t).filter((x) => tables.has(x)));
  for (const f of fks) if (f.parent_schema === 'auth' && f.parent === 'users') linked.add(f.child);
  for (let grew = true; grew;) {
    grew = false;
    for (const f of fks) if (f.parent_schema === 'public' && linked.has(f.parent) && !linked.has(f.child)) { linked.add(f.child); grew = true; }
  }
  const classified = new Set([...EXPORTED, ...Object.keys(EXCLUDED), ...Object.keys(STAFF_ONLY)]);
  const unclassified = [...linked].filter((x) => !classified.has(x)).sort();
  const stale = [...classified].filter((x) => !tables.has(x)).sort();
  const twice = EXPORTED.filter((x) => EXCLUDED[x] || STAFF_ONLY[x]);
  assertEqual({ unclassified, stale, twice }, { unclassified: [], stale: [], twice: [] }, 'classification');
  return `${linked.size} linked tables: ${EXPORTED.length} exported, ${Object.keys(EXCLUDED).length} excluded, ${Object.keys(STAFF_ONLY).length} staff-only`;
});

await t.check('the deletion procedure clears every exported table, except the orders it keeps for tax law', async () => {
  const missing = EXPORTED.filter((x) => !KEPT_BY_DELETION.includes(x) && !new RegExp(`public\\.${x}\\b`).test(PROCEDURE));
  // Rows that go with their parent (ON DELETE CASCADE) are named in the procedure's comments, not its statements.
  const cascade = { tap_mode_audit: true, customer_customizations: 'customisations', tap_device_auth: 'cards', order_items: true,
    emergency_event_recipients: 'recipients', rescue_messages: 'messages', consent_grants: 'consent grants',
    prive_demo_request_events: 'steps', support_messages: 'messages',
    // A card's history stays with the card, which the procedure unlinks and keeps as a hardware record.
    card_events: 'cards',
    // The 18+ record (044) goes with its account (ON DELETE CASCADE from auth.users).
    account_age_confirmations: 'the account' };
  const unexplained = missing.filter((x) => !cascade[x]);
  assertEqual(unexplained, [], 'exported tables the procedure does not mention');
  return 'checked against the data again in section C';
});

// ---------------------------------------------------------------------------
t.section('B. The operation: POST /api/account { op: "owner.export" }');

await t.check('no sign-in, a malformed body, an unknown or inherited op, a GET: refused before anything is read', async () => {
  const before = (await q(`SELECT count(*)::int AS n FROM public.account_events WHERE event_type = 'data_export'`))[0].n;
  const anon = await call({ op: 'owner.export', userId: asha.userId });
  assertEqual([anon.status, codeOf(anon)], [401, 'unauthenticated'], 'no token');
  assertEqual(codeOf(await call({ op: 'owner.export' }, 'not-a-real-token')), 'unauthenticated', 'forged token');
  assertEqual(codeOf(await call('{not json', asha.token)), 'invalid_request', 'not JSON');
  assertEqual(codeOf(await call([], asha.token)), 'invalid_request', 'an array');
  for (const op of ['owner.delete', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const r = await call({ op }, asha.token);
    assertEqual([r.status, codeOf(r)], [400, 'unknown_op'], op);
  }
  const get = await fetch(`${stack.appUrl}/api/account`, { headers: { authorization: `Bearer ${asha.token}` } });
  assertEqual(get.status, 405, 'GET');
  const after = (await q(`SELECT count(*)::int AS n FROM public.account_events WHERE event_type = 'data_export'`))[0].n;
  assertEqual(after, before, 'no export recorded');
  return 'the account comes only from the verified token';
});

const first = await call({ op: 'owner.export' }, asha.token);
const x = first.body?.export;
const vcard = first.body?.vcard;

await t.check('the owner gets their own data in every exported section', async () => {
  assertEqual([first.status, Object.keys(first.body).sort()], [200, ['export', 'vcard']], 'answer');
  assertEqual([x.format, x.accountId], ['shygon-account-export/2', asha.userId], 'header');
  const thread = x.returnToOwner.threads[0];
  const PRESENT = {
    profiles: x.account.profile?.fullName === 'Owner 1' && x.account.profile.show.phone === true,
    customers: typeof x.account.customer?.customerId === 'string' && x.account.customer.customerId.length > 0,
    tap_profiles: x.taps[0]?.slug === 'asha-export' && x.taps[0].email === 'owner1.private@example.test' && x.taps[0].customLinks[0].label === 'Portfolio',
    customer_customizations: x.customizations[0]?.code === 'export-test-website',
    tap_mode_state: x.modes.states[0]?.version === 2,
    info_pages: x.modes.info?.title === 'Room 12 printer',
    tap_mode_audit: x.modes.audit[0]?.action === 'info_save',
    cards: x.cards[0]?.cardId === 'SHY-EXP-1' && x.cards[0].edition.number === 71 && x.cards[0].nickname === 'Daily card',
    tap_device_auth: x.cards[0]?.verifiedTap?.code === A.code && x.cards[0].verifiedTap.keyEpoch === 1,
    orders: x.orders[0]?.orderId === 'ST-EXPORT1-0001' && x.orders[0].shipping.address === '12 Lake Road' && x.orders[0].razorpayPaymentId === 'pay_owner_visible',
    order_items: x.orders[0]?.items[0]?.sku === 'aaroh-card',
    order_status_history: x.orders[0]?.statusHistory[0]?.status === 'delivered',
    entitlements: x.entitlements[0]?.key === 'website',
    emergency_settings: x.emergency.settings?.publicAlertsEnabled === false,
    emergency_contacts: x.emergency.contacts[0]?.name === 'Mum' && x.emergency.contacts[0].last4 === A.C.contactNumber.slice(-4),
    emergency_events: x.emergency.alerts[0]?.initiator === 'owner' && x.emergency.alerts[0].status === 'delivered',
    emergency_event_recipients: x.emergency.alerts[0]?.recipients[0]?.contactName === 'Mum',
    emergency_audit: x.emergency.audit[0]?.action === 'alert.created',
    rescue_settings: x.returnToOwner.settings?.publicHint === 'Please call the front desk',
    rescue_threads: thread?.status === 'owner_replied',
    rescue_messages: thread?.finderMessages === 1 && thread.messages.length === 1 && thread.messages[0].body === 'Thanks, I will collect it',
    rescue_blocks: x.returnToOwner.activeBlocks === 1,
    rescue_audit: x.returnToOwner.audit[0]?.action === 'thread.opened',
    connect_settings: x.connect.settings?.enabled === true,
    connections: x.connect.connections.length === 2
      && x.connect.connections.some((c) => c.role === 'requested' && c.note === 'Met at the expo')
      && x.connect.connections.some((c) => c.role === 'received' && c.note === null),
    consent_grants: x.connect.consentGiven[0]?.scope[0] === 'phone' && x.connect.consentReceived[0]?.scope[0] === 'email',
    connect_audit: x.connect.audit[0]?.action === 'request.sent',
    prive_demo_requests: x.prive[0]?.service === 'late_checkout' && x.prive[0].demo === true && typeof x.prive[0].hotel === 'string',
    prive_demo_request_events: x.prive[0]?.steps[0]?.actor === 'guest',
    notifications: x.notifications[0]?.title === 'Someone found your card',
    support_tickets: x.support[0]?.reference === 'ST-EXP1AAAA',
    support_messages: x.support[0]?.messages.map((m) => [m.from, m.body]).join('|') === 'customer,My card is not scanning|admin,We have received your request',
    account_events: x.accountEvents.some((e) => e.eventType === 'tap_published'),
    account_phone_verifications: x.phoneVerification?.last4 === '5678' && typeof x.phoneVerification.verifiedAt === 'string',
    card_events: x.cards[0]?.history?.[0]?.reason === 'tap to activate' && x.cards[0].history[0].to === 'active',
    account_age_confirmations: typeof x.ageConfirmation?.confirmed === 'boolean' && x.ageConfirmation.source === 'signup',
  };
  assertEqual(Object.keys(PRESENT).sort(), [...EXPORTED].sort(), 'every exported table has a round-trip check');
  const missing = Object.entries(PRESENT).filter(([, ok]) => !ok).map(([k]) => k);
  assertEqual(missing, [], 'sections without the owner\'s value');
  assertEqual(x.truncated, [], 'nothing capped');
  assert(Array.isArray(x.excluded) && x.excluded.length === 7 && x.excluded.every((e) => e.what && e.why), 'the excluded list explains itself');
  return `${EXPORTED.length} tables round-trip`;
});

await t.check('nothing of anyone else and no security value: finders, the Connect counterpart, contacts\' numbers, visitors, staff, codes and keys', async () => {
  const text = JSON.stringify(first.body);
  assertEqual(leaks(A.C, text), [], 'canaries in the answer');
  const KEYS = ['activationCode', 'cardUid', 'uidHmac', 'lastCounter', 'idempotencyKey', 'lastIdempotencyKey', 'lastResult', 'finderTokenHash',
    'finderDigest', 'visitorDigest', 'visitorHash', 'codeHash', 'phoneDigest', 'phoneE164', 'providerMessageId', 'lastError', 'clientKey',
    'adminNote', 'suspendedBy', 'authorId', 'requesterUserId', 'targetUserId', 'grantorUserId', 'granteeUserId', 'metadata', 'rawPayload'];
  const found = KEYS.filter((k) => text.includes(`"${k}"`));
  assertEqual(found, [], 'security or third-party keys');
  return 'the canary scan covers the export and the vCard';
});

await t.check('the vCard has the public fields only, escaped and folded; none without a Tap', async () => {
  assert(typeof vcard === 'string' && vcard.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n') && vcard.endsWith('END:VCARD\r\n'), 'envelope');
  const unfolded = vcard.replace(/\r\n /g, '');
  assert(unfolded.includes('FN:Asha Rao\r\n'), 'name');
  assert(unfolded.includes('ORG:Rao\\, Design\\; Studio\r\n'), `escaping: ${unfolded}`);
  assert(unfolded.includes('TEL;TYPE=CELL:+919812345678\r\n'), 'the shown phone');
  assert(unfolded.includes('URL:https://tap.example.test/t/asha-export\r\n'), 'the Tap address');
  for (const hidden of ['owner1.private@example.test', '+919800000001', 'asha.example.test', 'instagram.com']) {
    assert(!vcard.includes(hidden), `a private field is in the vCard: ${hidden}`);
  }
  const long = vcard.split('\r\n').filter((l) => Buffer.byteLength(l, 'utf8') > 75);
  assertEqual(long, [], 'lines over 75 octets');
  assert(vcard.includes('\r\n '), 'the long title is folded');
  const benExport = await call({ op: 'owner.export' }, ben.token);
  assertEqual([benExport.status, benExport.body.vcard, benExport.body.export.taps], [200, null, []], 'no Tap, no vCard');
  const caraExport = await call({ op: 'owner.export' }, cara.token);
  assert(caraExport.body.vcard.includes('FN:Cara Paused') && !caraExport.body.vcard.includes('URL:'), 'a paused Tap gets no address line');
  return 'privacy switches respected; the Tap link only while it is live';
});

await t.check('accounts are isolated: each export holds its own account only', async () => {
  const caraText = responses.find((r) => r.includes('Cara Paused'));
  assertEqual(leaks({ ...A.C, ashaSlug: 'asha-export', ashaInfo: 'Room 12 printer', ashaOrder: 'ST-EXPORT1-0001', ashaId: asha.userId }, caraText), [], 'Asha in Cara\'s export');
  assertEqual(leaks({ caraName: 'CANARY-CARA-NAME', caraInfo: 'CANARY-CARA-INFO', caraId: cara.userId }, JSON.stringify(first.body)), [], 'Cara in Asha\'s export');
  const benText = responses.find((r) => r.includes(`"accountId":"${ben.userId}"`));
  assert(benText && !benText.includes('Met at the expo') && !benText.includes(asha.userId), 'Asha\'s note or id in Ben\'s export');
  return 'by the verified account, never by a body field';
});

await t.check('5 exports per 24 hours: the sixth is 429 with retryAfter; each export is one account_events row with no content', async () => {
  for (let i = 2; i <= 5; i++) {
    const r = await call({ op: 'owner.export' }, asha.token);
    assertEqual(r.status, 200, `export ${i}`);
  }
  const sixth = await call({ op: 'owner.export' }, asha.token);
  assertEqual([sixth.status, codeOf(sixth), Object.keys(sixth.body.error).sort()], [429, 'rate_limited', ['code', 'message', 'retryAfter']], 'sixth');
  assert(sixth.body.error.retryAfter > 86000 && sixth.body.error.retryAfter <= 86400, `retryAfter ${sixth.body.error.retryAfter}`);
  const rows = await q(`SELECT subject_type, detail FROM public.account_events WHERE user_id = $1 AND event_type = 'data_export'`, [asha.userId]);
  assertEqual(rows.length, 5, 'audit rows');
  assert(rows.every((r) => r.subject_type === 'account' && Object.keys(r.detail).sort().join() === 'counts,format'), 'detail shape');
  assertEqual(rows[0].detail.counts.cards, 1, 'counts');
  const detail = JSON.stringify(rows.map((r) => r.detail));
  assert(!/Asha|Room 12|Mum|asha-export|@example/.test(detail), `content in the audit: ${detail}`);
  const other = await call({ op: 'owner.export' }, cara.token);
  assertEqual(other.status, 200, 'another account is unaffected');
  return 'the limit is per account and survives across requests';
});

await t.check('lists are capped at 2,000 rows, newest first, and the cap is named in `truncated`', async () => {
  const emma = await signUp(stack, { name: 'Emma Many' });
  await q(`INSERT INTO public.notifications (user_id, title, created_at)
    SELECT $1, 'Note ' || g, now() - (g || ' seconds')::interval FROM generate_series(1, 2001) g`, [emma.userId]);
  const e = await build(emma.userId);
  assertEqual([e.notifications.length, e.truncated, e.notifications[0].title, e.notifications[1999].title], [2000, ['notifications'], 'Note 1', 'Note 2000'], 'cap');
  return 'the oldest row is the one left out';
});

// ---------------------------------------------------------------------------
t.section('C. Deletion parity');

await t.check('after the deletion procedure, the export holds only the orders kept for tax law', async () => {
  const dora = await signUp(stack, { name: 'Dora Deleted' });
  const D = await seedOwner(dora, 2, 'dora-export');
  await q(`INSERT INTO public.support_tickets (user_id, subject, category, reference) VALUES ($1, 'Account deletion request', 'privacy', 'ST-EXPDEL02')`, [dora.userId]);
  const before = await build(dora.userId);
  assert(before.taps.length === 1 && before.cards.length === 1 && before.connect.connections.length === 2, 'seeded');
  await stack.query(PROCEDURE.replace("'<ACCOUNT ID>'", `'${dora.userId}'`).replace("'<REQUEST REFERENCE>'", "'ST-EXPDEL02'"));
  const after = await build(dora.userId);
  const lists = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (Array.isArray(v) ? [[prefix + k, v.length]]
    : v && typeof v === 'object' ? lists(v, `${prefix}${k}.`) : []));
  const left = lists(after).filter(([k, n]) => n > 0 && !['orders', 'excluded'].includes(k));
  assertEqual(left, [], 'lists still holding rows');
  assertEqual([after.account.profile, after.account.customer, after.modes.info, after.emergency.settings, after.returnToOwner.settings,
    after.returnToOwner.activeBlocks, after.connect.settings, after.phoneVerification], [null, null, null, null, null, 0, null, null], 'single records');
  assertEqual([after.orders.length, after.orders[0].orderId, after.orders[0].items.length], [1, 'ST-EXPORT2-0001', 1], 'the order is kept');
  assertEqual(leaks(D.C, JSON.stringify(after)), [], 'canaries after deletion');
  return 'export and deletion agree table by table';
});

await t.check('logs: one line per export with no content; no canary in any log line', async () => {
  const lines = logLines.join('\n');
  assertEqual(leaks({ ...A.C, ashaInfo: 'Room 12 printer', ashaHint: 'Please call the front desk', ashaPhone: '+919812345678' }, lines), [], 'canaries in logs');
  const exported = logLines.filter((l) => l.includes('"account.exported"'));
  assert(exported.length >= 7, `exported lines: ${exported.length}`);
  assert(logLines.some((l) => l.includes('"account.export-refused"') && l.includes('"rate_limited"')), 'the refusal is logged by code');
  return `${exported.length} export lines, ${logLines.length} log lines scanned`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
