import { createMigratedDb, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * RLS matrix (SHYGON V6 Stage 2; backlog V6-077).
 *
 * Every table in `public` is probed as every kind of caller, and the rows each
 * caller can read, update, delete or insert are compared, row by row, with the
 * EXPECTED access model below:
 *
 *   actors   anon · customer A · customer B · viewer admin · support admin ·
 *            admin · service_role
 *   probes   SELECT (exact row set) · UPDATE and DELETE (rows affected, inside a
 *            rolled-back transaction) · INSERT of a copy of the caller's own
 *            row and of someone else's row (rolled back)
 *
 * A caller reaching MORE than the model allows is reported as UNEXPECTED ACCESS
 * (a P0). A caller reaching LESS is a regression and fails too. The model is the
 * security contract: change it only with a recorded decision.
 *
 * Database: the live schema baseline plus migrations 020 onward. Supabase gives
 * service_role BYPASSRLS and the API roles their default grants; the stand-in
 * is given the same here. INSERT outcome: refused with 42501 (privilege, RLS or
 * a guard trigger) or any other refusal = denied; success, 23505 or 23503 (both
 * raised only after row level security passed) = allowed.
 *
 *   node supabase/tests/rls-matrix.mjs [migrations-dir]
 */

const DIR = process.argv[2] ?? MIGRATIONS_DIR;
const db = await createMigratedDb(DIR);
await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  ALTER ROLE service_role BYPASSRLS;
`);

// --- actors ------------------------------------------------------------------
const id = (n) => `e${n}000000-0000-4000-8000-00000000000${n}`;
const A = id(1), B = id(2), V = id(3), S = id(4), AD = id(5);
const ACTORS = [
  { key: 'anon', role: 'anon', uid: null, cls: 'anon' },
  { key: 'A', role: 'authenticated', uid: A, cls: 'cust', other: B },
  { key: 'B', role: 'authenticated', uid: B, cls: 'cust', other: A },
  { key: 'viewer', role: 'authenticated', uid: V, cls: 'viewer', other: A },
  { key: 'support', role: 'authenticated', uid: S, cls: 'support', other: A },
  { key: 'admin', role: 'authenticated', uid: AD, cls: 'admin', other: A },
  { key: 'service', role: 'service_role', uid: null, cls: 'service' },
];

// --- fixture: at least one row in every table, owned by A and by B where owned
await db.exec(`
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    ('${A}', 'a@example.test', '{"full_name":"Customer A"}'), ('${B}', 'b@example.test', '{"full_name":"Customer B"}'),
    ('${V}', 'viewer@example.test', '{}'), ('${S}', 'support@example.test', '{}'), ('${AD}', 'admin@example.test', '{}');
  INSERT INTO public.admin_users (user_id, role, is_active) VALUES ('${V}', 'viewer', true), ('${S}', 'support', true), ('${AD}', 'admin', true);
  INSERT INTO public.products (name, sku, active) VALUES ('Matrix active', 'mx-active', true), ('Matrix retired', 'mx-retired', false);
  INSERT INTO public.customizations (id, code, name) VALUES ('ca000000-0000-4000-8000-000000000001', 'mx-cz', 'Matrix add-on');
  INSERT INTO public.card_editions (design, name) VALUES ('mx-design', 'Matrix edition');
  INSERT INTO public.ui_plans (code, name) VALUES ('mx-ui', 'Matrix UI');
  INSERT INTO public.tap_event_themes (code, name, starts_on, ends_on, active) VALUES ('mx-theme', 'Matrix', '2020-01-01', '2020-01-02', false);
  INSERT INTO public.webhook_events (event_id, event_type) VALUES ('evt_mx', 'payment.captured');
  INSERT INTO public.inventory_movements (sku, delta, reason) VALUES ('mx-sku', 1, 'matrix');
  INSERT INTO public.admin_allowed_email_domains (domain) VALUES ('matrix.example');
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type) VALUES ('${AD}', 'matrix.test', 'order');
  INSERT INTO public.admin_notifications (id, category, title, admin_id) VALUES
    ('aa000000-0000-4000-8000-000000000001', 'order', 'Broadcast', NULL),
    ('aa000000-0000-4000-8000-000000000002', 'order', 'For admin', '${AD}'),
    ('aa000000-0000-4000-8000-000000000003', 'order', 'For viewer', '${V}');
  INSERT INTO public.admin_notification_reads (notification_id, admin_id) VALUES
    ('aa000000-0000-4000-8000-000000000001', '${V}'), ('aa000000-0000-4000-8000-000000000001', '${AD}');
  INSERT INTO public.admin_push_tokens (admin_id, expo_token) VALUES ('${V}', 'tok-viewer'), ('${AD}', 'tok-admin');
  INSERT INTO public.tap_visitor_salts (day, salt) VALUES (current_date, 'matrix-salt');
`);
for (const [u, n] of [[A, 1], [B, 2]]) {
  const o = `0${n}000000-0000-4000-8000-0000000000a${n}`;
  await db.exec(`
    INSERT INTO public.orders (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise, payment_status, order_status)
    VALUES ('${o}', 'MX-${n}', '${u}', '${u}', 'Matrix order', 999, 99900, 'paid', 'placed');
    INSERT INTO public.order_items (id, order_id, sku, name, unit_price_in_paise, line_total_in_paise)
    VALUES ('0${n}000000-0000-4000-8000-0000000000b${n}', '${o}', 'mx-sku', 'Matrix item', 99900, 99900);
    INSERT INTO public.order_item_fulfillment_actions (order_item_id, action) VALUES ('0${n}000000-0000-4000-8000-0000000000b${n}', 'mx');
    INSERT INTO public.payments (order_id, provider_order_id, provider_payment_id, amount_in_paise, status)
    VALUES ('${o}', 'order_mx${n}', 'pay_mx${n}', 99900, 'paid');
    INSERT INTO public.order_admin_notes (order_id, note) VALUES ('${o}', 'Internal note ${n}');
    INSERT INTO public.entitlements (user_id, type, key) VALUES ('${u}', 'digital_plan', 'business');
    INSERT INTO public.notifications (user_id, category, title) VALUES ('${u}', 'order', 'Matrix note ${n}');
    INSERT INTO public.tap_profiles (id, user_id, customer_id, slug, username, display_name, status)
    VALUES ('0${n}000000-0000-4000-8000-0000000000c${n}', '${u}', (SELECT id FROM public.customers WHERE user_id = '${u}'),
            'mx-${n}', 'mx-${n}', 'Matrix ${n}', 'active');
    INSERT INTO public.tap_events (tap_profile_id, event_type) VALUES ('0${n}000000-0000-4000-8000-0000000000c${n}', 'view');
    INSERT INTO public.support_tickets (id, user_id, subject) VALUES ('0${n}000000-0000-4000-8000-0000000000d${n}', '${u}', 'Matrix help ${n}');
    INSERT INTO public.support_messages (ticket_id, author_id, author_role, body)
    VALUES ('0${n}000000-0000-4000-8000-0000000000d${n}', '${u}', 'customer', 'Hello ${n}');
    INSERT INTO public.cards (id, user_id, order_id, sku, card_id, activation_code)
    VALUES ('0${n}000000-0000-4000-8000-0000000000e${n}', '${u}', '${o}', 'card-mx', 'MX-CARD-${n}', 'SHY-MX0${n}-TEST');
    INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at)
    VALUES ('${u}', '0${n}000000-0000-4000-8000-0000000000e${n}', 'activate', 'x', now() + interval '1 hour');
    INSERT INTO public.customer_customizations (customer_id, tap_profile_id, customization_id)
    VALUES ((SELECT id FROM public.customers WHERE user_id = '${u}'), '0${n}000000-0000-4000-8000-0000000000c${n}',
            'ca000000-0000-4000-8000-000000000001');
  `);
  // The emergency module (029): one row in each table, owned by this customer.
  await db.exec(`
    INSERT INTO public.emergency_settings (user_id, public_alerts_enabled) VALUES ('${u}', true);
    INSERT INTO public.emergency_contacts (id, user_id, name, phone_e164, verified_at)
    VALUES ('0${n}000000-0000-4000-8000-0000000000f${n}', '${u}', 'Matrix contact ${n}', '+9198000000${n}${n}', now());
    INSERT INTO public.emergency_contact_challenges (user_id, contact_id, phone_digest, code_hash, expires_at)
    VALUES ('${u}', '0${n}000000-0000-4000-8000-0000000000f${n}', 'digest', 'hash', now() + interval '10 minutes');
    INSERT INTO public.emergency_events (id, user_id, initiator, idempotency_key, recipient_count)
    VALUES ('1${n}000000-0000-4000-8000-0000000000a${n}'::uuid, '${u}', 'owner', 'matrix-key-000000${n}', 1);
    INSERT INTO public.emergency_event_recipients (id, event_id, contact_id, contact_name, phone_last4, phone_e164)
    VALUES ('1${n}000000-0000-4000-8000-0000000000b${n}'::uuid, '1${n}000000-0000-4000-8000-0000000000a${n}', '0${n}000000-0000-4000-8000-0000000000f${n}',
            'Matrix contact ${n}', '00${n}${n}', '+9198000000${n}${n}');
    INSERT INTO public.emergency_delivery_attempts (recipient_id, attempt_no, outcome)
    VALUES ('1${n}000000-0000-4000-8000-0000000000b${n}', 1, 'accepted');
    INSERT INTO public.emergency_audit (user_id, event_id, actor, action)
    VALUES ('${u}', '1${n}000000-0000-4000-8000-0000000000a${n}', 'owner', 'matrix.test');
    INSERT INTO public.rescue_settings (user_id, enabled) VALUES ('${u}', true);
    INSERT INTO public.rescue_threads (id, owner_user_id, finder_token_hash, finder_digest, idempotency_key)
    VALUES ('1${n}000000-0000-4000-8000-0000000000c${n}', '${u}', 'matrix-token-${n}', 'matrix-digest-${n}', 'matrix-rescue-key-${n}');
    INSERT INTO public.rescue_messages (thread_id, sender, body)
    VALUES ('1${n}000000-0000-4000-8000-0000000000c${n}', 'finder', 'Matrix finder message ${n}');
    INSERT INTO public.rescue_blocks (owner_user_id, finder_digest, expires_at) VALUES ('${u}', 'blocked-${n}', now() + interval '1 day');
    INSERT INTO public.rescue_audit (user_id, actor, action) VALUES ('${u}', 'owner', 'matrix.test');
    INSERT INTO public.connect_settings (user_id, enabled) VALUES ('${u}', true);
    INSERT INTO public.connect_audit (user_id, action) VALUES ('${u}', 'matrix.test');
    INSERT INTO public.prive_demo_requests (id, user_id, hotel_id, service, idempotency_key)
    VALUES ('1${n}000000-0000-4000-8000-0000000000d${n}', '${u}', (SELECT id FROM public.prive_demo_hotels WHERE slug = 'demo-residence'), 'housekeeping', 'matrix-prive-key-000${n}');
    INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES ('1${n}000000-0000-4000-8000-0000000000d${n}', 'received', 'guest');
  `);
}

// --- the expected access model -----------------------------------------------
await db.exec(`
  INSERT INTO public.connections (id, requester_user_id, target_user_id, status, idempotency_key)
  VALUES ('1c000000-0000-4000-8000-0000000000c1', '${A}', '${B}', 'accepted', 'matrix-connect-key-1');
  INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id)
  VALUES ('${A}', '${B}', ARRAY['email'], '1c000000-0000-4000-8000-0000000000c1'),
         ('${B}', '${A}', ARRAY['phone'], '1c000000-0000-4000-8000-0000000000c1');
`);

const NONE = 'false';
const ALL = 'true';
const OWN = (c) => `${c} = auth.uid()`;
const VIA_ORDER = `order_id IN (SELECT id FROM public.orders WHERE user_id = auth.uid())`;
const VIA_TAP = `tap_profile_id IN (SELECT id FROM public.tap_profiles WHERE user_id = auth.uid())`;
const VIA_TICKET = `ticket_id IN (SELECT id FROM public.support_tickets WHERE user_id = auth.uid())`;
const VIA_CUSTOMER = `customer_id IN (SELECT id FROM public.customers WHERE user_id = auth.uid())`;
const VIA_ITEM = `order_item_id IN (SELECT i.id FROM public.order_items i JOIN public.orders o ON o.id = i.order_id WHERE o.user_id = auth.uid())`;
// select(anon, customer, viewer = customer, support = viewer, admin = support)
const sel = (anon, cust, viewer = cust, support = viewer, admin = support) => ({ anon, cust, viewer, support, admin });

// owner: which rows count as the caller's own. update/delete: rows an
// authenticated caller may change (anon: never). insert: 'own' = a copy of the
// caller's own row passes RLS; otherwise every insert is refused.
const MODEL = {
  account_events: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id')) },
  admin_allowed_email_domains: { owner: NONE, select: sel(NONE, NONE) }, // admins use RPCs
  admin_audit_log: { owner: OWN('admin_id'), select: sel(NONE, NONE, NONE, NONE, ALL) }, // audit.read: admin only
  admin_notification_reads: {
    owner: OWN('admin_id'), select: sel(NONE, OWN('admin_id')),
    update: OWN('admin_id'), delete: OWN('admin_id'), insert: 'own',
  },
  admin_notifications: { owner: OWN('admin_id'), select: sel(NONE, NONE, `admin_id IS NULL OR admin_id = auth.uid()`) },
  admin_push_tokens: { owner: OWN('admin_id'), select: sel(NONE, OWN('admin_id')) },
  admin_users: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL) },
  card_editions: { owner: NONE, select: sel(ALL, ALL) }, // public catalogue
  card_otp_challenges: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  cards: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL) },
  customer_customizations: { owner: VIA_CUSTOMER, select: sel(NONE, NONE) },
  customers: { owner: OWN('user_id'), select: sel(NONE, NONE) }, // DEC-2026-029 B2: never to a client
  customizations: { owner: NONE, select: sel(NONE, NONE) },
  entitlements: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL) },
  inventory_movements: { owner: NONE, select: sel(NONE, NONE) },
  notifications: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL), update: OWN('user_id') },
  order_admin_notes: { owner: VIA_ORDER, select: sel(NONE, NONE) }, // F2 (022): admin RPCs only
  order_item_fulfillment_actions: { owner: VIA_ITEM, select: sel(NONE, NONE) },
  order_items: { owner: VIA_ORDER, select: sel(NONE, VIA_ORDER, ALL) },
  order_status_history: { owner: VIA_ORDER, select: sel(NONE, VIA_ORDER) }, // admins read it through RPCs
  orders: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL) },
  payments: { owner: VIA_ORDER, select: sel(NONE, VIA_ORDER, ALL) },
  products: { owner: NONE, select: sel('active IS NOT FALSE', 'active IS NOT FALSE', ALL) },
  profiles: { owner: OWN('id'), select: sel(NONE, OWN('id'), ALL), update: OWN('id'), insert: 'own' },
  support_messages: { owner: VIA_TICKET, select: sel(NONE, VIA_TICKET, ALL), insert: 'own' },
  support_tickets: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL), insert: 'own' },
  tap_event_themes: { owner: NONE, select: sel(NONE, NONE) },
  tap_events: { owner: VIA_TAP, select: sel(NONE, VIA_TAP, ALL) },
  // D-6 / O-14 (023): no insert, not even of the caller's own Tap.
  tap_profiles: { owner: OWN('user_id'), select: sel(NONE, OWN('user_id'), ALL), update: OWN('user_id') },
  tap_visitor_salts: { owner: NONE, select: sel(NONE, NONE) }, // V6-073 (025): record_tap_event only
  // The emergency module (029, DEC-2026-038 Q1, approved 2026-10-19): no API client reaches
  // any of it, not even the owner or an administrator; only the server
  // function (service_role) through the definer functions.
  emergency_settings: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  emergency_contacts: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  emergency_contact_challenges: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  emergency_events: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  emergency_event_recipients: { owner: `event_id IN (SELECT id FROM public.emergency_events WHERE user_id = auth.uid())`, select: sel(NONE, NONE) },
  emergency_delivery_attempts: {
    owner: `recipient_id IN (SELECT r.id FROM public.emergency_event_recipients r JOIN public.emergency_events e ON e.id = r.event_id WHERE e.user_id = auth.uid())`,
    select: sel(NONE, NONE),
  },
  emergency_audit: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  // The Return-to-Owner relay (031, DEC-2026-038 Q12, approved 2026-10-19): closed the same way.
  rescue_settings: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  rescue_threads: { owner: OWN('owner_user_id'), select: sel(NONE, NONE) },
  rescue_messages: { owner: `thread_id IN (SELECT id FROM public.rescue_threads WHERE owner_user_id = auth.uid())`, select: sel(NONE, NONE) },
  rescue_blocks: { owner: OWN('owner_user_id'), select: sel(NONE, NONE) },
  rescue_audit: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  // Connect and the consent ledger (032, DEC-2026-039, approved 2026-10-20): closed the same way.
  connect_settings: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  connections: { owner: OWN('requester_user_id'), select: sel(NONE, NONE) },
  consent_grants: { owner: OWN('grantor_user_id'), select: sel(NONE, NONE) },
  connect_audit: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  // Privé, demo only (033, DEC-2026-040 PROPOSED): closed the same way; even the
  // sample catalogue is read through the server function only.
  prive_demo_hotels: { owner: NONE, select: sel(NONE, NONE) },
  prive_demo_requests: { owner: OWN('user_id'), select: sel(NONE, NONE) },
  prive_demo_request_events: { owner: `request_id IN (SELECT id FROM public.prive_demo_requests WHERE user_id = auth.uid())`, select: sel(NONE, NONE) },
  ui_plans: { owner: NONE, select: sel(NONE, NONE) },
  webhook_events: { owner: NONE, select: sel(NONE, NONE) },
};

const tables = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).rows.map((r) => r.relname);

// --- helpers -----------------------------------------------------------------
let pass = 0;
let fail = 0;
const failures = [];
const ROLLBACK = new Error('rollback');

async function asSuper(uid, sql, params) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  try { return await db.query(sql, params); } finally {
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Runs `sql` as the actor inside a transaction that is always rolled back. */
async function asActor(actor, sql, params) {
  let out = null;
  try {
    await db.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [actor.uid ?? '']);
      await tx.exec(`SET LOCAL ROLE ${actor.role}`);
      out = { rows: (await tx.query(sql, params)), err: null };
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) out = { rows: null, err: e };
  }
  return out;
}

const ctids = async (rows) => rows.map((r) => r.k).sort();
const modelFor = (t) => MODEL[t];
const pred = (spec, actor) => (actor.cls === 'service' ? ALL : actor.cls === 'anon' ? NONE : spec ?? NONE);
const selPred = (m, actor) => (actor.cls === 'service' ? ALL : m.select[actor.cls]);

function record(ok, label, detail) {
  if (ok) { pass++; return true; }
  fail++;
  failures.push(`${label}: ${detail}`);
  return false;
}

const columnsOf = async (t) => (await db.query(`SELECT a.attname FROM pg_attribute a
  WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attgenerated = '' AND a.attidentity = '' ORDER BY a.attnum`, [t])).rows.map((r) => r.attname);

// --- run ---------------------------------------------------------------------
console.log('\n=== RLS matrix: every table × every caller (live baseline + 020 onward) ===');

const unmodelled = tables.filter((t) => !MODEL[t]);
record(unmodelled.length === 0, 'model coverage', `tables with no expected-access entry: ${unmodelled.join(', ')}`);
const empty = [];
for (const t of tables) {
  const n = (await db.query(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n;
  if (n === 0) empty.push(t);
}
record(empty.length === 0, 'fixture coverage', `tables with no row to probe: ${empty.join(', ')}`);

for (const t of tables.filter((x) => MODEL[x])) {
  const m = modelFor(t);
  const cols = await columnsOf(t);
  const firstCol = cols[0];
  const tally = { select: [0, 0], update: [0, 0], delete: [0, 0], insert: [0, 0] };
  const mark = (op, ok) => { tally[op][1]++; if (ok) tally[op][0]++; };

  for (const actor of ACTORS) {
    // SELECT: the exact row set.
    const expected = await ctids((await asSuper(actor.uid, `SELECT ctid::text AS k FROM public.${t} WHERE (${selPred(m, actor)})`)).rows);
    const got = await asActor(actor, `SELECT ctid::text AS k FROM public.${t}`);
    const seen = got.err ? [] : await ctids(got.rows.rows);
    const extra = seen.filter((k) => !expected.includes(k));
    const missing = expected.filter((k) => !seen.includes(k));
    mark('select', record(extra.length === 0 && missing.length === 0, `${t} SELECT as ${actor.key}`,
      extra.length ? `UNEXPECTED ACCESS (P0): ${extra.length} extra row(s)` : `missing ${missing.length} row(s)${got.err ? ` (${got.err.code} ${got.err.message.slice(0, 60)})` : ''}`));

    if (actor.cls === 'service') continue; // the server bypasses RLS by design

    // UPDATE and DELETE: rows affected, rolled back.
    for (const op of ['update', 'delete']) {
      const want = (await asSuper(actor.uid, `SELECT count(*)::int AS n FROM public.${t} WHERE (${pred(m[op], actor)})`)).rows[0].n;
      const sql = op === 'update' ? `UPDATE public.${t} SET ${firstCol} = ${firstCol}` : `DELETE FROM public.${t}`;
      const r = await asActor(actor, sql);
      const n = r.err ? 0 : (r.rows.affectedRows ?? 0);
      mark(op, record(n === want, `${t} ${op.toUpperCase()} as ${actor.key}`,
        n > want ? `UNEXPECTED ACCESS (P0): ${n} row(s), expected ${want}` : `${n} row(s), expected ${want}${r.err ? ` (${r.err.code} ${r.err.message.slice(0, 60)})` : ''}`));
    }

    // INSERT: a copy of the caller's own row, and of someone else's.
    const insertSql = `INSERT INTO public.${t} (${cols.join(', ')})
      SELECT ${cols.join(', ')} FROM jsonb_populate_record(NULL::public.${t}, $1::jsonb)`;
    const outcome = async (row) => {
      const r = await asActor(actor, insertSql, [JSON.stringify(row)]);
      if (!r.err || ['23505', '23503'].includes(r.err.code)) return { allowed: true, code: r.err?.code ?? 'ok' };
      return { allowed: false, code: r.err.code };
    };
    if (actor.cls !== 'anon') {
      const own = (await asSuper(actor.uid, `SELECT to_jsonb(x) AS j FROM public.${t} x WHERE (${m.owner}) LIMIT 1`)).rows[0]?.j;
      if (own) {
        const o = await outcome(own);
        const want = m.insert === 'own';
        mark('insert', record(o.allowed === want, `${t} INSERT own row as ${actor.key}`,
          o.allowed ? `UNEXPECTED ACCESS (P0): allowed (${o.code})` : `refused (${o.code}), expected allowed`));
      }
    }
    // Someone else's row: prefer a row the other customer owns, otherwise any
    // row the caller does not own (never the caller's own, which may be allowed).
    const notMine = `(${m.owner}) IS NOT TRUE`;
    const other = (await asSuper(actor.other ?? A, `SELECT to_jsonb(x) AS j FROM public.${t} x WHERE (${m.owner === NONE ? ALL : m.owner}) LIMIT 1`)).rows[0]?.j
      ?? (await asSuper(actor.uid, `SELECT to_jsonb(x) AS j FROM public.${t} x WHERE ${notMine} LIMIT 1`)).rows[0]?.j;
    if (other) {
      const o = await outcome(other);
      mark('insert', record(!o.allowed, `${t} INSERT another's row as ${actor.key}`, `UNEXPECTED ACCESS (P0): allowed (${o.code})`));
    }
  }

  const cell = (op) => `${op} ${tally[op][0]}/${tally[op][1]}`;
  const ok = Object.values(tally).every(([a, b]) => a === b);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(32)} ${['select', 'update', 'delete', 'insert'].map(cell).join(' · ')}`);
}

// Anonymous callers, strictly (F6 / O-1, migration 024). The matrix above counts
// an error as a denial (owner decision D-U1-b). These checks require the clean
// form: no row and no error from the owner-or-admin tables, and no access to
// the admin permission helpers at all.
console.log('\n=== anonymous callers, strictly (migration 024) ===');
const anon = ACTORS.find((x) => x.key === 'anon');
for (const t of ['cards', 'notifications', 'orders', 'profiles', 'support_messages', 'support_tickets', 'tap_events', 'tap_profiles']) {
  const r = await asActor(anon, `SELECT count(*)::int AS n FROM public.${t}`);
  const ok = record(!r.err && r.rows.rows[0].n === 0, `${t} anonymous SELECT`,
    r.err ? `refused with an error (${r.err.code} ${r.err.message.slice(0, 60)}), expected 0 rows` : `${r.rows.rows[0].n} row(s)`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${t.padEnd(32)} 0 rows, no error`);
}
for (const f of ['public.require_admin(text)', 'public.admin_has(text)', 'public.is_admin()']) {
  const priv = (await db.query(`SELECT has_function_privilege('anon', $1, 'EXECUTE') AS p`, [f])).rows[0].p;
  const call = await asActor(anon, `SELECT ${f.replace('(text)', "('orders.read')")}`);
  const ok = record(!priv && call.err?.code === '42501', `${f} for anon`,
    priv ? 'anon holds EXECUTE (directly or through PUBLIC)' : `call ${call.err ? call.err.code : 'succeeded'}`);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(32)} not executable by anon`);
}

// Admin functions (customer → admin, anon → admin). Every admin_* function a
// client role can execute must refuse a non-admin through the permission check
// (42501), before it touches anything. A different error is NOT a pass: a
// function that rejects NULL input before checking permissions might accept a
// non-admin's valid input. Informational helpers are listed with the answer a
// non-admin must get.
console.log('\n=== admin functions refuse non-admins (every callable admin_* RPC) ===');
const INFORMATIONAL = {
  'admin_role()': (v) => v === null, // the caller's admin role: none
  'admin_role_permissions(text)': () => true, // the static permission catalogue for a role name
  'admin_has(text)': (v) => v === false, // used by policies; a non-admin holds nothing
};
const adminFns = (await db.query(`
  SELECT p.oid::regprocedure::text AS sig, p.proname AS name, p.proretset AS setof,
         COALESCE((SELECT string_agg('NULL::' || format_type(t, NULL), ', ' ORDER BY ord)
                   FROM unnest(p.proargtypes) WITH ORDINALITY AS a(t, ord)), '') AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'admin\\_%' AND p.prorettype <> 'trigger'::regtype
  ORDER BY 1`)).rows;
const customer = ACTORS.find((x) => x.key === 'A');
let rpcChecked = 0;
const failuresBeforeRpc = failures.length;
for (const fn of adminFns) {
  for (const actor of [anon, customer]) {
    const canExec = (await db.query(`SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [actor.role, fn.sig])).rows[0].p;
    const sql = fn.setof ? `SELECT * FROM public.${fn.name}(${fn.args})` : `SELECT public.${fn.name}(${fn.args}) AS v`;
    const r = await asActor(actor, sql);
    rpcChecked++;
    const label = `${fn.sig} as ${actor.key}`;
    if (INFORMATIONAL[fn.sig] && !r.err) {
      const v = fn.setof ? r.rows.rows : r.rows.rows[0].v;
      record(INFORMATIONAL[fn.sig](v), label, `UNEXPECTED ACCESS (P0): returned ${JSON.stringify(v).slice(0, 60)}`);
    } else if (!r.err) {
      record(false, label, `UNEXPECTED ACCESS (P0): a non-admin call succeeded${canExec ? '' : ' without EXECUTE?'}`);
    } else {
      record(r.err.code === '42501', label,
        `refused with ${r.err.code} (${r.err.message.slice(0, 60)}), not by the permission check: inconclusive`);
    }
  }
}
const rpcFailures = failures.length - failuresBeforeRpc;
console.log(`  ${rpcFailures ? 'FAIL' : 'PASS'}  ${adminFns.length} admin functions × anon, customer = ${rpcChecked} calls; informational: ${Object.keys(INFORMATIONAL).join(', ')}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
console.log(`\n${pass} passed, ${fail} failed (${tables.length} tables, ${ACTORS.length} callers)\n`);
await db.close();
process.exit(fail === 0 ? 0 : 1);
