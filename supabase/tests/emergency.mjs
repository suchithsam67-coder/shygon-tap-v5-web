// The emergency module (migration 029) and the Tap column guard (030).
//
// Part A works on the database directly: every emergency table and function
// is closed to the API roles; the state machine, idempotency, rate limits,
// attempt fencing, receipts and retention behave as 029's header says; 030's
// guard refuses the owner-write bypasses (with the chain before 030 as the
// negative control) and leaves the app's own writes alone.
//
// Part B drives the real server functions on the local stack over HTTP, with
// the SMS stand-in (supabase/local/sms-sim.mjs) playing Twilio and MSG91:
// owners, a second customer, visitors, a support administrator, forged tokens
// and forged receipts; provider refusals, outages, timeouts, a missing
// provider and a database failure in the middle of a send.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/emergency.mjs
import { createLiveDb, createMigratedDb, newMigrations } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';
import { clientAddress, TRUSTED_CLIENT_IP_HEADERS } from '../../netlify/lib/client-address.mjs';
import { visitorDigest } from '../../netlify/lib/emergency.mjs';

const t = createHarness('Emergency contacts and alerts (029) and the Tap column guard (030)');

// Every log line the server functions write during this run, to prove that
// no phone number, name or code reaches the logs.
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}

const TABLES = ['emergency_settings', 'emergency_contacts', 'emergency_contact_challenges', 'emergency_events',
  'emergency_event_recipients', 'emergency_delivery_attempts', 'emergency_audit'];

// ---------------------------------------------------------------------------
t.section('A. Database: closure, state machine, limits, retention, 030');

const db = await createMigratedDb();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);
const U1 = 'c1000000-0000-4000-8000-000000000001';
const U2 = 'c2000000-0000-4000-8000-000000000002';
await db.exec(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('${U1}', 'one@example.test', '{"full_name":"Asha Rao"}'), ('${U2}', 'two@example.test', '{"full_name":"Ben"}');`);

async function as(role, uid, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
    await tx.exec(`SET LOCAL ROLE ${role}`);
    return tx.query(sql, params);
  });
}
async function refused(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

await t.check('every emergency table: RLS on, no policy, no privilege for PUBLIC, anon or authenticated', async () => {
  for (const table of TABLES) {
    const r = await one(`SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon,
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS auth
      FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [table]);
    assert(r.rls && r.policies === 0 && !r.anon && !r.auth, `${table}: ${JSON.stringify(r)}`);
  }
  return `${TABLES.length} tables`;
});

await t.check('a signed-in customer and anon are refused on every emergency table (read and write)', async () => {
  await db.query(`INSERT INTO public.emergency_contacts (user_id, name, phone_e164) VALUES ($1, 'Probe', '+919811111111')`, [U1]);
  for (const table of TABLES) {
    for (const [role, uid] of [['anon', null], ['authenticated', U1]]) {
      const e1 = await refused(() => as(role, uid, `SELECT * FROM public.${table}`));
      assert(e1?.code === '42501', `${table} SELECT as ${role}: ${e1?.code ?? 'allowed'}`);
      const e2 = await refused(() => as(role, uid, `DELETE FROM public.${table}`));
      assert(e2?.code === '42501', `${table} DELETE as ${role}: ${e2?.code ?? 'allowed'}`);
    }
  }
  return 'permission denied (42501) for each';
});

await t.check('every emergency function: EXECUTE for service_role only (admin_list_emergency_events checks the caller itself)', async () => {
  const fns = await q(`SELECT p.oid::regprocedure::text AS sig,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'emergency\\_%'`);
  assert(fns.length >= 24, `only ${fns.length} emergency functions found`);
  const open = fns.filter((f) => f.anon || f.auth || !f.service).map((f) => f.sig);
  assertEqual(open, [], 'functions open to a client role (or closed to the server)');
  const adm = await one(`SELECT has_function_privilege('anon', 'public.admin_list_emergency_events(text,integer,integer)', 'EXECUTE') AS anon`);
  assertEqual(adm.anon, false, 'anon may execute the admin RPC');
  const e = await refused(() => as('authenticated', U1, `SELECT public.emergency_contacts_for($1)`, [U1]));
  assert(e?.code === '42501', `a customer calling emergency_contacts_for directly: ${e?.code ?? 'allowed'}`);
  return `${fns.length} functions closed`;
});

await t.check('the server role cannot rewrite or delete the audit trail or the attempt log', async () => {
  for (const table of ['emergency_audit', 'emergency_delivery_attempts']) {
    for (const verb of ['UPDATE', 'DELETE']) {
      const ok = await one(`SELECT has_table_privilege('service_role', 'public.${table}', $1) AS p`, [verb]);
      assertEqual(ok.p, false, `service_role ${verb} on ${table}`);
    }
  }
  return 'UPDATE and DELETE revoked; definer functions and the account cascade still can';
});

await db.query(`DELETE FROM public.emergency_contacts WHERE user_id = $1`, [U1]);

// Service-role helpers (the server function's view).
const svc = (sql, params) => as('service_role', null, sql, params);
const fn = async (name, args) => {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  return (await svc(`SELECT public.${name}(${placeholders}) AS v`, args)).rows[0].v;
};
const raised = async (name, args) => {
  const e = await refused(() => fn(name, args));
  return e ? (/emergency:([a-z_]+)/.exec(e.message)?.[1] ?? e.message) : null;
};

await t.check('contacts: validation, 5 per owner, one per number, a changed number is unverified again', async () => {
  assertEqual(await raised('emergency_contact_save', [U1, null, '', null, '+919811111111']), 'invalid_name', 'empty name');
  assertEqual(await raised('emergency_contact_save', [U1, null, 'Ravi', null, '98111']), 'invalid_phone', 'bad number');
  const first = await fn('emergency_contact_save', [U1, null, 'Ravi', 'Brother', '+919811111111']);
  assertEqual(first.phone, '+91 ••••• 11111', 'masked number');
  assertEqual(await raised('emergency_contact_save', [U1, null, 'Ravi again', null, '+919811111111']), 'duplicate_contact', 'same number twice');
  for (let i = 2; i <= 5; i++) await fn('emergency_contact_save', [U1, null, `C${i}`, null, `+91981111111${i}`]);
  assertEqual(await raised('emergency_contact_save', [U1, null, 'Sixth', null, '+919811111116']), 'too_many_contacts', 'sixth');
  await db.query(`UPDATE public.emergency_contacts SET verified_at = now() WHERE id = $1`, [first.id]);
  const edited = await fn('emergency_contact_save', [U1, first.id, 'Ravi', 'Brother', '+919811111119']);
  assertEqual(edited.verified, false, 'verification after a number change');
  assertEqual(await raised('emergency_contact_save', [U2, first.id, 'Hijack', null, '+919822222222']), 'contact_not_found',
    "another owner editing this owner's contact");
  assertEqual(await raised('emergency_contact_remove', [U2, first.id]), 'contact_not_found', "another owner removing it");
  return 'all refused as designed';
});

await t.check('visitor alerts: need an acknowledgement and a verified contact; removing the last verified contact turns them off', async () => {
  assertEqual(await raised('emergency_settings_set', [U1, true, false]), 'acknowledge_required', 'no acknowledgement');
  assertEqual(await raised('emergency_settings_set', [U1, true, true]), 'no_verified_contacts', 'no verified contact');
  const [c] = await q(`SELECT id FROM public.emergency_contacts WHERE user_id = $1 ORDER BY created_at LIMIT 1`, [U1]);
  await db.query(`UPDATE public.emergency_contacts SET verified_at = now() WHERE id = $1`, [c.id]);
  assertEqual((await fn('emergency_settings_set', [U1, true, true])).publicAlertsEnabled, true, 'enabled');
  const removed = await fn('emergency_contact_remove', [U1, c.id]);
  assertEqual(removed.publicAlertsDisabled, true, 'switched off with the last verified contact');
  assertEqual((await fn('emergency_settings_for', [U1])).publicAlertsEnabled, false, 'stored state');
  return 'off by default, on only with both';
});

await t.check('verification: 45 s cooldown, 5 per owner per hour, 3 per number per 24 h across owners; 5 wrong guesses', async () => {
  const [c] = await q(`SELECT id FROM public.emergency_contacts WHERE user_id = $1 AND verified_at IS NULL ORDER BY created_at LIMIT 1`, [U1]);
  await fn('emergency_verification_start', [U1, c.id, crypto.randomUUID(), 'h1']);
  assertEqual(await raised('emergency_verification_start', [U1, c.id, crypto.randomUUID(), 'h2']), 'verify_cooldown', 'immediate resend');
  for (let i = 0; i < 4; i++) {
    const r = await fn('emergency_verification_confirm', [U1, c.id, 'wrong']);
    assertEqual(r.code, 'wrong_code', `guess ${i + 1}`);
  }
  const last = await fn('emergency_verification_confirm', [U1, c.id, 'wrong']);
  assertEqual([last.code, last.attemptsLeft], ['too_many_attempts', 0], 'fifth wrong guess');
  assertEqual((await fn('emergency_verification_confirm', [U1, c.id, 'h1'])).code, 'too_many_attempts', 'the right code after 5 wrong');
  // Per number, across owners: three owners add the same stranger's number.
  const stranger = '+919833333333';
  const owners = [U1, U2];
  for (const u of owners) await fn('emergency_contact_save', [u, null, 'Stranger', null, stranger]);
  await db.query(`DELETE FROM public.emergency_contact_challenges`);
  const ids = await q(`SELECT id, user_id FROM public.emergency_contacts WHERE phone_e164 = $1 ORDER BY user_id = $2`, [stranger, U2]);
  await fn('emergency_verification_start', [ids[0].user_id, ids[0].id, crypto.randomUUID(), 'x']);
  await fn('emergency_verification_start', [ids[1].user_id, ids[1].id, crypto.randomUUID(), 'x']);
  await db.query(`UPDATE public.emergency_contact_challenges SET created_at = now() - interval '1 minute'`);
  await fn('emergency_verification_start', [ids[0].user_id, ids[0].id, crypto.randomUUID(), 'x']);
  await db.query(`UPDATE public.emergency_contact_challenges SET created_at = now() - interval '1 minute'`);
  assertEqual(await raised('emergency_verification_start', [ids[1].user_id, ids[1].id, crypto.randomUUID(), 'x']),
    'number_rate_limited', 'a fourth code to one number in 24 h');
  // Removing and re-adding the contact does not reset the number's count.
  await fn('emergency_contact_remove', [U2, ids[1].id]);
  const again = await fn('emergency_contact_save', [U2, null, 'Stranger', null, stranger]);
  assertEqual(await raised('emergency_verification_start', [U2, again.id, crypto.randomUUID(), 'x']), 'number_rate_limited',
    'after remove and re-add');
  // Per owner: 5 sends an hour.
  await db.query(`DELETE FROM public.emergency_contact_challenges`);
  const mine = await q(`SELECT id FROM public.emergency_contacts WHERE user_id = $1 AND verified_at IS NULL AND phone_e164 <> $2`, [U1, stranger]);
  assertEqual(mine.length, 4, 'unverified contacts to send to');
  for (const contact of [...mine, mine[0]]) {
    await fn('emergency_verification_start', [U1, contact.id, crypto.randomUUID(), 'x']);
    await db.query(`UPDATE public.emergency_contact_challenges SET created_at = now() - interval '1 minute'`);
  }
  assertEqual(await raised('emergency_verification_start', [U1, mine[1].id, crypto.randomUUID(), 'x']), 'verify_rate_limited',
    'a sixth send in an hour');
  return 'every limit holds';
});

await db.exec(`DELETE FROM public.emergency_contacts; DELETE FROM public.emergency_contact_challenges;`);
const verified = async (u, phone, name = 'Contact') => {
  const c = await fn('emergency_contact_save', [u, null, name, null, phone]);
  await db.query(`UPDATE public.emergency_contacts SET verified_at = now() WHERE id = $1`, [c.id]);
  return c.id;
};
await verified(U1, '+919844444441', 'Ravi');
await verified(U1, '+919844444442', 'Meera');
await db.query(`INSERT INTO public.emergency_contacts (user_id, name, phone_e164) VALUES ($1, 'Unverified', '+919844444443')`, [U1]);
const key = () => crypto.randomUUID().replace(/-/g, '');

let E1;
await t.check('an owner alert goes to verified contacts only; a repeated idempotency key returns the same alert', async () => {
  const k = key();
  const opened = await fn('emergency_alert_open', [U1, 'owner', k, null, null]);
  assert(opened.ok && !opened.replayed, JSON.stringify(opened));
  E1 = opened.eventId;
  const recipients = await q(`SELECT contact_name FROM public.emergency_event_recipients WHERE event_id = $1 ORDER BY 1`, [E1]);
  assertEqual(recipients.map((r) => r.contact_name), ['Meera', 'Ravi'], 'recipients');
  const replay = await fn('emergency_alert_open', [U1, 'owner', k, null, null]);
  assertEqual([replay.eventId, replay.replayed], [E1, true], 'replay');
  assertEqual((await one(`SELECT count(*)::int AS n FROM public.emergency_events WHERE user_id = $1`, [U1])).n, 1, 'events');
  assertEqual((await fn('emergency_alert_open', [U1, 'owner', 'short', null, null])).code, 'invalid_idempotency_key', 'bad key');
  return 'unverified contact excluded; one event';
});

await t.check('owner limits: one alert in progress per 2 minutes, 5 per hour, 10 per 24 hours (refusals audited)', async () => {
  const busy = await fn('emergency_alert_open', [U1, 'owner', key(), null, null]);
  assertEqual([busy.code, busy.eventId], ['alert_in_progress', E1], 'second alert at once');
  await db.query(`UPDATE public.emergency_events SET created_at = now() - interval '3 minutes' WHERE user_id = $1`, [U1]);
  for (let i = 0; i < 4; i++) {
    const r = await fn('emergency_alert_open', [U1, 'owner', key(), null, null]);
    assert(r.ok, `alert ${i + 2}: ${JSON.stringify(r)}`);
    await db.query(`UPDATE public.emergency_events SET created_at = created_at - interval '3 minutes' WHERE user_id = $1`, [U1]);
  }
  const sixth = await fn('emergency_alert_open', [U1, 'owner', key(), null, null]);
  assert(sixth.code === 'alert_rate_limited' && sixth.retryAfter > 0, JSON.stringify(sixth));
  const audited = await one(`SELECT count(*)::int AS n FROM public.emergency_audit WHERE user_id = $1 AND action = 'alert.refused'`, [U1]);
  assert(audited.n >= 2, `refusals audited: ${audited.n}`);
  await db.query(`UPDATE public.emergency_events SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [U1]);
  // 5 so far today; 5 more make 10, the daily limit.
  for (let i = 0; i < 5; i++) {
    assert((await fn('emergency_alert_open', [U1, 'owner', key(), null, null])).ok, `day alert ${i}`);
    await db.query(`UPDATE public.emergency_events SET created_at = now() - interval '2 hours' WHERE user_id = $1`, [U1]);
  }
  const eleventh = await fn('emergency_alert_open', [U1, 'owner', key(), null, null]);
  assertEqual(eleventh.code, 'alert_rate_limited', 'eleventh alert in 24 h');
  return `retryAfter ${sixth.retryAfter} s on the sixth`;
});

await t.check('delivery: claim leases an attempt; only the current attempt can record; 3 attempts at most', async () => {
  const claims = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [E1])).rows;
  assertEqual(claims.length, 2, 'claimed recipients');
  assertEqual(claims[0].owner_name, 'Asha Rao', 'owner name for the message');
  const again = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [E1])).rows;
  assertEqual(again.length, 0, 'a second dispatcher claims nothing while the lease holds');
  const [a, b] = claims;
  const stale = await fn('emergency_attempt_finish', [a.recipient_id, a.attempt_no + 1, 'accepted', 'twilio', 'SMx', 'queued', 201, null]);
  assertEqual(stale.code, 'stale_attempt', 'a wrong attempt number');
  assertEqual((await fn('emergency_attempt_finish', [a.recipient_id, a.attempt_no, 'accepted', 'twilio', 'SM_A', 'queued', 201, null])).status,
    'accepted', 'accepted');
  assertEqual((await fn('emergency_attempt_finish', [b.recipient_id, b.attempt_no, 'transient', 'twilio', null, null, 503, '20503'])).status,
    'retry_wait', 'transient failure');
  assertEqual((await one(`SELECT status FROM public.emergency_events WHERE id = $1`, [E1])).status, 'sending', 'event while a retry is due');
  for (let attempt = 2; attempt <= 3; attempt++) {
    await db.query(`UPDATE public.emergency_event_recipients SET next_attempt_at = now() WHERE id = $1`, [b.recipient_id]);
    const [c] = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [E1])).rows;
    assertEqual(c.attempt_no, attempt, 'attempt number');
    await fn('emergency_attempt_finish', [c.recipient_id, c.attempt_no, 'timeout', 'twilio', null, null, null, 'timeout']);
  }
  const r = await one(`SELECT status, attempts FROM public.emergency_event_recipients WHERE id = $1`, [b.recipient_id]);
  assertEqual([r.status, r.attempts], ['failed', 3], 'after three attempts');
  await db.query(`UPDATE public.emergency_event_recipients SET next_attempt_at = now() WHERE id = $1`, [b.recipient_id]);
  assertEqual((await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [E1])).rows.length, 0, 'no fourth attempt');
  assertEqual((await one(`SELECT status FROM public.emergency_events WHERE id = $1`, [E1])).status, 'partial', 'event');
  const attempts = await one(`SELECT count(*)::int AS n FROM public.emergency_delivery_attempts a
    JOIN public.emergency_event_recipients r ON r.id = a.recipient_id WHERE r.event_id = $1`, [E1]);
  assertEqual(attempts.n, 4, 'attempt rows (1 + 3)');
  return 'partial: one accepted, one failed after 3 attempts';
});

await t.check('receipts: only delivered/read confirm delivery; a receipt never moves a message backwards', async () => {
  assertEqual((await fn('emergency_provider_status', ['twilio', 'SM_unknown', 'delivered', null])).matched, false, 'unknown sid');
  await fn('emergency_provider_status', ['twilio', 'SM_A', 'sent', null]);
  assertEqual((await one(`SELECT status FROM public.emergency_event_recipients WHERE provider_message_id = 'SM_A'`)).status,
    'accepted', '"sent" (carrier accepted) is not delivery');
  await fn('emergency_provider_status', ['twilio', 'SM_A', 'delivered', null]);
  await fn('emergency_provider_status', ['twilio', 'SM_A', 'undelivered', '30003']);
  const r = await one(`SELECT status, delivered_at IS NOT NULL AS d FROM public.emergency_event_recipients WHERE provider_message_id = 'SM_A'`);
  assertEqual([r.status, r.d], ['delivered', true], 'stays delivered');
  return 'forward only';
});

await t.check('a dispatcher that died mid-send: the lease expires, the attempt closes as lease_expired and counts', async () => {
  const opened = await fn('emergency_alert_open', [U2, 'owner', key(), null, null]);
  assertEqual(opened.code, 'no_verified_contacts', 'owner without verified contacts');
  await verified(U2, '+919855555551');
  const e = await fn('emergency_alert_open', [U2, 'owner', key(), null, null]);
  const [c] = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [e.eventId])).rows;
  await db.query(`UPDATE public.emergency_event_recipients SET lease_until = now() - interval '1 second' WHERE id = $1`, [c.recipient_id]);
  const [retry] = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [e.eventId])).rows;
  assertEqual(retry.attempt_no, 2, 'retried as attempt 2');
  const first = await one(`SELECT outcome FROM public.emergency_delivery_attempts WHERE recipient_id = $1 AND attempt_no = 1`, [c.recipient_id]);
  assertEqual(first.outcome, 'lease_expired', 'attempt 1');
  await fn('emergency_attempt_finish', [retry.recipient_id, 2, 'accepted', 'twilio', 'SM_B', 'queued', 201, null]);
  assertEqual((await one(`SELECT status FROM public.emergency_events WHERE id = $1`, [e.eventId])).status, 'sent', 'event');
  return 'outcome unknown, so it is never reported sent; retried within the limit';
});

await t.check('not configured: not_sent, no retry by itself; the owner can requeue once a provider exists', async () => {
  await db.query(`UPDATE public.emergency_events SET created_at = now() - interval '3 hours' WHERE user_id = $1`, [U2]);
  const e = await fn('emergency_alert_open', [U2, 'owner', key(), null, null]);
  const [c] = (await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [e.eventId])).rows;
  await fn('emergency_attempt_finish', [c.recipient_id, c.attempt_no, 'not_configured', null, null, null, null, 'not_configured']);
  assertEqual((await one(`SELECT status FROM public.emergency_events WHERE id = $1`, [e.eventId])).status, 'not_sent', 'event');
  assertEqual((await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [e.eventId])).rows.length, 0, 'nothing due');
  assertEqual(await fn('emergency_requeue_not_sent', [U1, e.eventId]).catch(() => 'refused'), 'refused', "another owner requeueing it");
  assertEqual(await fn('emergency_requeue_not_sent', [U2, e.eventId]), 1, 'requeued');
  assertEqual((await svc(`SELECT * FROM public.emergency_claim_due($1, 10)`, [e.eventId])).rows[0].attempt_no, 2, 'attempt 2');
  return 'BLOCKED state is explicit';
});

await t.check('retention: numbers erased 7 days after completion; alerts deleted after 180 days; codes after 24 h', async () => {
  await db.query(`UPDATE public.emergency_events SET completed_at = now() - interval '8 days' WHERE id = $1`, [E1]);
  const purged = await fn('emergency_purge', []);
  assert(purged.numbersErased >= 2, JSON.stringify(purged));
  const left = await one(`SELECT count(*)::int AS n FROM public.emergency_event_recipients WHERE event_id = $1 AND phone_e164 IS NOT NULL`, [E1]);
  assertEqual(left.n, 0, 'numbers left on the old alert');
  await db.query(`UPDATE public.emergency_events SET created_at = now() - interval '181 days' WHERE id = $1`, [E1]);
  await fn('emergency_purge', []);
  assertEqual((await one(`SELECT count(*)::int AS n FROM public.emergency_events WHERE id = $1`, [E1])).n, 0, 'old alert');
  const orphaned = await one(`SELECT count(*)::int AS n FROM public.emergency_audit WHERE event_id = $1`, [E1]);
  assertEqual(orphaned.n, 0, 'audit rows keep no link to a deleted alert');
  return JSON.stringify(purged);
});

await t.check('DEC-2026-038 Q4: a suspended account may still alert its own verified contacts; visitor alerts stop for it', async () => {
  const U3 = 'c3000000-0000-4000-8000-000000000003';
  await db.exec(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${U3}', 'three@example.test', '{"full_name":"Chitra"}');
    INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
    VALUES ('${U3}', (SELECT id FROM public.customers WHERE user_id = '${U3}'), 'chitra-q4', 'chitra-q4', 'Chitra', 'active');`);
  await verified(U3, '+919866666661');
  await fn('emergency_settings_set', [U3, true, true]);
  assert(await fn('emergency_public_target', ['chitra-q4']), 'visitor alerts available before the suspension');
  await db.query(`UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'test' WHERE id = $1`, [U3]);
  const opened = await fn('emergency_alert_open', [U3, 'owner', key(), null, null]);
  assert(opened.ok, `owner alert while suspended: ${JSON.stringify(opened)}`);
  assertEqual(await fn('emergency_public_target', ['chitra-q4']), null, 'visitor alerts while suspended');
  return 'safety over moderation for the owner\'s own contacts';
});

await t.check('deleting an account deletes its contacts, alerts, recipients, attempts and audit (ON DELETE CASCADE)', async () => {
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [U2]);
  for (const table of TABLES) {
    const col = table === 'emergency_event_recipients' ? null : table === 'emergency_delivery_attempts' ? null : 'user_id';
    if (!col) continue;
    const n = (await one(`SELECT count(*)::int AS n FROM public.${table} WHERE user_id = $1`, [U2])).n;
    assertEqual(n, 0, `${table} rows left`);
  }
  const orphans = await one(`SELECT
      (SELECT count(*) FROM public.emergency_event_recipients r WHERE NOT EXISTS (SELECT 1 FROM public.emergency_events e WHERE e.id = r.event_id))
    + (SELECT count(*) FROM public.emergency_delivery_attempts a WHERE NOT EXISTS (SELECT 1 FROM public.emergency_event_recipients r WHERE r.id = a.recipient_id)) AS n`);
  assertEqual(Number(orphans.n), 0, 'orphan rows');
  return 'nothing left';
});

// 030: the owner-write bypasses, with the chain before 030 as the negative control.
async function tapDb(withGuard) {
  const d = withGuard ? await createMigratedDb() : await createLiveDb();
  if (!withGuard) for (const { name, sql } of newMigrations()) if (name < '030') await d.exec(sql);
  await d.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);
  await d.exec(`INSERT INTO auth.users (id, email) VALUES ('${U1}', 'one@example.test'), ('${U2}', 'two@example.test');
    INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status, last_content_edit_at)
    VALUES ('${U1}', (SELECT id FROM public.customers WHERE user_id = '${U1}'), 'asha', 'asha', 'Asha', 'draft', now()),
           ('${U2}', (SELECT id FROM public.customers WHERE user_id = '${U2}'), NULL, 'u2', 'Ben', 'draft', NULL);`);
  return d;
}
async function owner(d, uid, sql) {
  try {
    const r = await d.transaction(async (tx) => {
      await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [uid]);
      await tx.exec('SET LOCAL ROLE authenticated');
      return tx.query(sql);
    });
    return { ok: true, n: r.affectedRows ?? r.rows.length, rows: r.rows };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message.split('\n')[0] };
  }
}
const before030 = await tapDb(false);
const after030 = await tapDb(true);
const BYPASSES = [
  ['AB-1 clear last_content_edit_at (skip the paid edit window)', U1, `UPDATE public.tap_profiles SET last_content_edit_at = NULL WHERE user_id = '${U1}'`],
  ['AB-2 write a reserved first address directly', U2, `UPDATE public.tap_profiles SET slug = 'admin' WHERE user_id = '${U2}'`],
  ['AB-3 set card_id', U1, `UPDATE public.tap_profiles SET card_id = gen_random_uuid() WHERE user_id = '${U1}'`],
  ['AB-3 set published_at', U1, `UPDATE public.tap_profiles SET published_at = now() - interval '1 year' WHERE user_id = '${U1}'`],
  ['AB-3 set edit_window_started_at', U1, `UPDATE public.tap_profiles SET edit_window_started_at = now() - interval '1 year' WHERE user_id = '${U1}'`],
];
for (const [label, uid, sql] of BYPASSES) {
  await t.check(`030 ${label}: allowed before 030, refused (42501) after`, async () => {
    const control = await owner(before030, uid, sql);
    assert(control.ok && control.n === 1, `negative control did not reproduce: ${JSON.stringify(control)}`);
    const fixed = await owner(after030, uid, sql);
    assert(!fixed.ok && fixed.code === '42501', `after 030: ${JSON.stringify(fixed)}`);
    return 'CONFIRMED and closed';
  });
}
await t.check('030 leaves the app alone: claim_tap_slug, a content edit (window stamped), publish/pause, the server role', async () => {
  const slug = await owner(after030, U2, `SELECT public.claim_tap_slug('ben-k') AS s`);
  assert(slug.ok && slug.rows[0].s === 'ben-k', JSON.stringify(slug));
  const edit = await owner(after030, U2, `UPDATE public.tap_profiles SET headline = 'Hello' WHERE user_id = '${U2}' RETURNING last_content_edit_at`);
  assert(edit.ok && edit.rows[0].last_content_edit_at !== null, JSON.stringify(edit));
  const status = await owner(after030, U2, `UPDATE public.tap_profiles SET status = 'active' WHERE user_id = '${U2}' RETURNING published`);
  assert(status.ok && status.rows[0].published === true, JSON.stringify(status));
  const window = await owner(after030, U1, `UPDATE public.tap_profiles SET headline = 'Again' WHERE user_id = '${U1}'`);
  assert(!window.ok && /once every/.test(window.message), `the edit window still applies: ${JSON.stringify(window)}`);
  await after030.query(`UPDATE public.tap_profiles SET last_content_edit_at = NULL WHERE user_id = '${U1}'`);
  return 'unchanged behaviour';
});
await before030.close();
await after030.close();
await db.close();

// ---------------------------------------------------------------------------
t.section('A2. The trusted client address (B-9 Part B, V6-126)');

await t.check('clientAddress: only the header TRUSTED_CLIENT_IP_HEADER names; no fallback; unset or anything else refuses', async () => {
  const saved = process.env.TRUSTED_CLIENT_IP_HEADER;
  const req = (headers) => new Request('https://shygon.example/api/emergency', { headers });
  const all = { 'x-nf-client-connection-ip': '192.0.2.1', 'x-vercel-forwarded-for': '192.0.2.2', 'x-real-ip': '192.0.2.3', 'x-forwarded-for': '192.0.2.4' };
  const at = (setting, headers) => {
    if (setting === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = setting;
    return clientAddress(req(headers));
  };
  try {
    assertEqual(at('x-nf-client-connection-ip', all), '192.0.2.1', 'Netlify');
    assertEqual(at('x-vercel-forwarded-for', all), '192.0.2.2', 'Vercel: a visitor-sent Netlify header is ignored');
    assertEqual(at('X-Vercel-Forwarded-For', { 'x-vercel-forwarded-for': '192.0.2.9, 10.0.0.1' }), '192.0.2.9', 'name case; first entry');
    assertEqual(at('x-nf-client-connection-ip', { 'x-vercel-forwarded-for': '192.0.2.2', 'x-real-ip': '192.0.2.3', 'x-forwarded-for': '192.0.2.4' }),
      null, 'no fallback to another header');
    for (const setting of [undefined, '', 'x-forwarded-for', 'x-real-ip', 'on']) assertEqual(at(setting, all), null, `refused: ${JSON.stringify(setting)}`);
    assertEqual(at('x-nf-client-connection-ip', { 'x-nf-client-connection-ip': '  ' }), null, 'blank');
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';
    const visitor = (forged) => visitorDigest('s', req({ 'x-vercel-forwarded-for': '192.0.2.2', 'x-nf-client-connection-ip': forged }), '2026-10-20');
    assert(typeof visitor('192.0.2.50') === 'string' && visitor('192.0.2.50') === visitor('192.0.2.51'), 'a forged Netlify header changes the visitor on Vercel');
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    assertEqual(visitorDigest('s', req(all), '2026-10-20'), null, 'unset: no visitor, so the caller refuses');
  } finally {
    if (saved === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = saved;
  }
  return `${TRUSTED_CLIENT_IP_HEADERS.join(' or ')}; fail-closed`;
});

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack (real functions, SMS stand-in)');

const stack = await startStack();
const sms = stack.sms;
// Distinct visitors: the host replaces any address header a caller sends, so
// these checks name their visitor through the stack's opt-in simulator (B-9);
// an empty address plays a host that reports none.
process.env.STACK_SIM_CLIENT_ADDRESS = '1';
const api = (body, { token, ip = '203.0.113.7', headers = {} } = {}) =>
  callFunction(stack, 'emergency', { token, body, headers: { 'x-shygon-sim-client': ip || 'none', ...headers } });
const bodies = [];
const record = (r) => {
  bodies.push(JSON.stringify(r.body));
  return r;
};
const call = async (body, opts) => record(await api(body, opts));
const codeOf = (r) => r.body?.error?.code;

const asha = await signUp(stack, { name: 'Asha Rao' });
const ben = await signUp(stack, { name: 'Ben Thomas' });
await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'asha-rao', 'asha-rao', 'Asha Rao', 'active')`, [asha.userId]);
const NUMBERS = ['+919876500001', '+919876500002', '+919876500003', '+919876500009'];
const digits = (n) => n.replace(/\D/g, '').slice(2);
stack.useSms('twilio');

let ravi;
let meera;
await t.check('unauthenticated, garbage and anon-key tokens are refused (401) on every owner operation', async () => {
  for (const op of ['contacts.list', 'contacts.save', 'alerts.create', 'alerts.get', 'settings.set']) {
    for (const token of [undefined, 'garbage', stack.keys.anonKey]) {
      const r = await call({ op }, { token });
      assert(r.status === 401 && codeOf(r) === 'unauthenticated', `${op} with ${token ? 'a bad token' : 'no token'}: ${r.status}`);
    }
  }
  const nope = await call({ op: 'admin.everything' }, { token: asha.token });
  assertEqual([nope.status, codeOf(nope)], [400, 'unknown_op'], 'unknown op');
  return '15 refusals';
});

await t.check('contacts.save: the browser only ever gets a masked number; bad input is refused', async () => {
  const bad = await call({ op: 'contacts.save', name: 'Ravi', phone: '12345' }, { token: asha.token });
  assertEqual([bad.status, codeOf(bad)], [400, 'invalid_phone'], 'bad number');
  const r1 = await call({ op: 'contacts.save', name: 'Ravi Rao', relationship: 'Brother', phone: '98765 00001' }, { token: asha.token });
  assertEqual(r1.status, 201, 'created');
  ravi = r1.body.contact;
  assertEqual([ravi.phone, ravi.verified], ['+91 ••••• 00001', false], 'masked, unverified');
  meera = (await call({ op: 'contacts.save', name: 'Meera', phone: NUMBERS[1] }, { token: asha.token })).body.contact;
  const list = await call({ op: 'contacts.list' }, { token: asha.token });
  assertEqual(list.body.contacts.length, 2, 'listed');
  assert(!JSON.stringify(list.body).includes(digits(NUMBERS[0])), 'a full number reached the browser');
  return 'masked';
});

await t.check("another customer cannot list, edit, remove or verify the owner's contacts", async () => {
  const list = await call({ op: 'contacts.list' }, { token: ben.token });
  assertEqual(list.body.contacts, [], "Ben's list");
  for (const body of [
    { op: 'contacts.save', contactId: ravi.id, name: 'Hijacked', phone: NUMBERS[3] },
    { op: 'contacts.remove', contactId: ravi.id },
    { op: 'contacts.verify.request', contactId: ravi.id },
    { op: 'contacts.verify.confirm', contactId: ravi.id, code: '123456' },
  ]) {
    const r = await call(body, { token: ben.token });
    assertEqual([r.status, codeOf(r)], [404, 'contact_not_found'], body.op);
  }
  assertEqual(sms.messages.length, 0, 'texts sent by the attempts');
  return '404 each, nothing sent';
});

await t.check('direct REST: a customer reaches no emergency table and no emergency function', async () => {
  for (const table of TABLES) {
    const res = await fetch(`${stack.gatewayUrl}/rest/v1/${table}?select=*`, {
      headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${asha.token}` },
    });
    assert(res.status === 401 || res.status === 403, `${table}: HTTP ${res.status}`);
  }
  for (const [rpc, args] of [['emergency_contacts_for', { p_user: asha.userId }], ['emergency_alert_open',
    { p_user: asha.userId, p_initiator: 'owner', p_idempotency_key: 'k'.repeat(20) }]]) {
    const res = await fetch(`${stack.gatewayUrl}/rest/v1/rpc/${rpc}`, {
      method: 'POST',
      headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${asha.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    assert(res.status === 401 || res.status === 403 || res.status === 404, `${rpc}: HTTP ${res.status}`);
  }
  return `${TABLES.length} tables, 2 functions refused`;
});

await t.check('verification: no provider = 503 and nothing pretended; with Twilio a code reaches only the contact', async () => {
  stack.useSms(null);
  const none = await call({ op: 'contacts.verify.request', contactId: ravi.id }, { token: asha.token });
  assertEqual([none.status, codeOf(none)], [503, 'provider_not_configured'], 'no provider');
  const open = (await stack.query(`SELECT count(*)::int AS n FROM public.emergency_contact_challenges WHERE contact_id = $1 AND consumed_at IS NULL`, [ravi.id])).rows[0].n;
  assertEqual(open, 0, 'open codes after a send that never happened');
  stack.useSms('twilio');
  await stack.query(`UPDATE public.emergency_contact_challenges SET created_at = now() - interval '1 minute'`);
  const sent = await call({ op: 'contacts.verify.request', contactId: ravi.id }, { token: asha.token });
  assertEqual(sent.status, 200, `request: ${JSON.stringify(sent.body)}`);
  const msg = sms.messages.at(-1);
  assertEqual(msg.to, NUMBERS[0], 'sent to the contact');
  assert(/Asha Rao wants to add you as an emergency contact/.test(msg.body), 'names the owner');
  const code = /code: (\d{6})/.exec(msg.body)[1];
  assert(!JSON.stringify(sent.body).includes(code), 'the code reached the browser');
  const wrong = await call({ op: 'contacts.verify.confirm', contactId: ravi.id, code: code === '000000' ? '111111' : '000000' }, { token: asha.token });
  assertEqual([wrong.status, codeOf(wrong), wrong.body.error.attemptsLeft], [400, 'wrong_code', 4], 'wrong code');
  const ok = await call({ op: 'contacts.verify.confirm', contactId: ravi.id, code }, { token: asha.token });
  assertEqual(ok.body.contact.verified, true, 'verified');
  const again = await call({ op: 'contacts.verify.request', contactId: ravi.id }, { token: asha.token });
  assertEqual(codeOf(again), 'already_verified', 'already verified');
  // Meera: verified the same way.
  await call({ op: 'contacts.verify.request', contactId: meera.id }, { token: asha.token });
  const code2 = /code: (\d{6})/.exec(sms.messages.at(-1).body)[1];
  await call({ op: 'contacts.verify.confirm', contactId: meera.id, code: code2 }, { token: asha.token });
  return 'contact verified with the code they received';
});

const newKey = () => crypto.randomUUID();
let alert1;
await t.check('alerts.create: 201, accepted by the provider = "sent", never "delivered" without a receipt', async () => {
  const missing = await call({ op: 'alerts.create' }, { token: asha.token });
  assertEqual(codeOf(missing), 'invalid_idempotency_key', 'no key');
  const noContacts = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: ben.token });
  assertEqual([noContacts.status, codeOf(noContacts)], [422, 'no_verified_contacts'], 'owner without contacts');
  const before = sms.messages.length;
  const k = newKey();
  const r = await call({ op: 'alerts.create', idempotencyKey: k }, { token: asha.token });
  assertEqual(r.status, 201, JSON.stringify(r.body));
  alert1 = { ...r.body.event, key: k };
  assertEqual(r.body.event.status, 'sent', 'event status');
  assertEqual(r.body.event.recipients.map((x) => x.status), ['accepted', 'accepted'], 'recipients');
  assertEqual(r.body.event.deliveryReceipts, 'supported', 'receipts');
  assertEqual(sms.messages.length - before, 2, 'texts');
  assert(sms.messages.slice(-2).every((m) => /Asha Rao has asked for help/.test(m.body) && /call 112/.test(m.body)), 'message text');
  assert(sms.messages.slice(-2).every((m) => !/police|ambulance will/i.test(m.body)), 'no promise of emergency services');
  assert(!JSON.stringify(r.body).includes(digits(NUMBERS[0])), 'a full number in the response');
  return `"${r.body.safety}"`;
});

await t.check('the same idempotency key again: 200, the same alert, no second text (double tap, network retry)', async () => {
  const before = sms.messages.length;
  const [a, b] = await Promise.all([
    api({ op: 'alerts.create', idempotencyKey: alert1.key }, { token: asha.token }),
    api({ op: 'alerts.create', idempotencyKey: alert1.key }, { token: asha.token }),
  ]);
  assertEqual([a.status, b.status, a.body.event.id, b.body.event.id, a.body.replayed], [200, 200, alert1.id, alert1.id, true], 'replays');
  assertEqual(sms.messages.length, before, 'texts');
  const busy = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  assertEqual([busy.status, codeOf(busy), busy.body.error.eventId], [409, 'alert_in_progress', alert1.id], 'a new key at once');
  return 'one alert, two texts in total';
});

await t.check('receipts: a signed "delivered" confirms; a forged or unsigned receipt is refused (403) and changes nothing', async () => {
  const [m1, m2] = sms.messages.filter((m) => /has asked for help/.test(m.body)).slice(-2);
  const forged = await sms.deliver(m1.sid, 'delivered', { signature: 'Zm9yZ2Vk' });
  assertEqual(forged.status, 403, 'forged signature');
  const unsigned = await fetch(`${stack.appUrl}/api/sms-status`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ MessageSid: m1.sid, MessageStatus: 'delivered' }),
  });
  assertEqual(unsigned.status, 403, 'no signature');
  let r = await call({ op: 'alerts.get', eventId: alert1.id }, { token: asha.token });
  assertEqual(r.body.event.status, 'sent', 'still unconfirmed');
  assertEqual((await sms.deliver(m1.sid, 'delivered')).status, 200, 'signed receipt');
  assertEqual((await sms.deliver(m2.sid, 'undelivered', { errorCode: 30003 })).status, 200, 'signed failure receipt');
  r = await call({ op: 'alerts.get', eventId: alert1.id }, { token: asha.token });
  assertEqual(r.body.event.status, 'partial', 'one delivered, one undelivered');
  const statuses = r.body.event.recipients.map((x) => x.status).sort();
  assertEqual(statuses, ['delivered', 'undelivered'], 'recipients');
  return 'delivery shown only as the provider reported it';
});

await t.check("another customer cannot read, retry, cancel or report the owner's alert", async () => {
  for (const op of ['alerts.get', 'alerts.retry', 'alerts.cancel', 'alerts.report']) {
    const r = await call({ op, eventId: alert1.id }, { token: ben.token });
    assertEqual([r.status, codeOf(r)], [404, 'event_not_found'], op);
  }
  assertEqual((await call({ op: 'alerts.list' }, { token: ben.token })).body.events, [], "Ben's alerts");
  return '404 each';
});

// Moves the owner's earlier alerts out of the 2-minute and 1-hour windows.
const freshWindow = (by = '2 hours') => stack.query(`UPDATE public.emergency_events SET created_at = created_at - $2::interval WHERE user_id = $1`, [asha.userId, by]);

await t.check('provider refusal (400): failed at once, no retry', async () => {
  await freshWindow();
  sms.queue('reject', 'reject');
  const before = sms.messages.length;
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  assertEqual(r.body.event.status, 'failed', 'event');
  assert(r.body.event.recipients.every((x) => x.status === 'failed' && x.lastError === '21211'), JSON.stringify(r.body.event.recipients));
  await stack.query(`UPDATE public.emergency_event_recipients SET next_attempt_at = now()`);
  const sweep = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  assertEqual(sweep.status, 200, 'sweep');
  assertEqual(sms.messages.length - before, 2, 'provider calls (no retry of a permanent refusal)');
  return 'failed, 2 calls';
});

let retryEvent;
await t.check('provider outage (500 / 429 / timeout / network): retried by the sweep, at most 3 attempts', async () => {
  await freshWindow();
  sms.queue('error', 'timeout');
  const t0 = Date.now();
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  retryEvent = r.body.event.id;
  assertEqual(r.body.event.status, 'sending', 'event while retries are due');
  assert(r.body.event.recipients.every((x) => x.status === 'retry_wait'), JSON.stringify(r.body.event.recipients));
  assert(Date.now() - t0 < 15000, 'the timeout bounded the request');
  const unauth = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: 'Bearer wrong' } });
  assertEqual(unauth.status, 401, 'sweep without the secret');
  const noAuth = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST' });
  assertEqual(noAuth.status, 401, 'sweep with no secret');
  // Attempt 2: one busy, one network failure. Attempt 3: one accepted, one error.
  sms.queue('busy', 'network', 'accept', 'error');
  for (let i = 0; i < 2; i++) {
    await stack.query(`UPDATE public.emergency_event_recipients SET next_attempt_at = now() WHERE event_id = $1 AND status = 'retry_wait'`, [retryEvent]);
    await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  }
  await stack.query(`UPDATE public.emergency_event_recipients SET next_attempt_at = now() WHERE event_id = $1`, [retryEvent]);
  await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  const after = await call({ op: 'alerts.get', eventId: retryEvent }, { token: asha.token });
  const recips = after.body.event.recipients.map((x) => [x.status, x.attempts]).sort();
  assertEqual(recips, [['accepted', 3], ['failed', 3]], 'after three attempts each');
  assertEqual(after.body.event.status, 'partial', 'event');
  const attempts = (await stack.query(`SELECT count(*)::int AS n FROM public.emergency_delivery_attempts a
    JOIN public.emergency_event_recipients r ON r.id = a.recipient_id WHERE r.event_id = $1`, [retryEvent])).rows[0].n;
  assertEqual(attempts, 6, 'attempt rows');
  return 'bounded: 6 provider calls for 2 contacts';
});

await t.check('no provider configured: the alert is recorded as not_sent (BLOCKED), never as sent; retry once configured', async () => {
  await freshWindow();
  stack.useSms(null);
  const before = sms.messages.length;
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  assertEqual([r.body.event.status, r.body.event.providerConfigured], ['not_sent', false], 'event');
  assertEqual(sms.messages.length, before, 'texts');
  const early = await call({ op: 'alerts.retry', eventId: r.body.event.id }, { token: asha.token });
  assertEqual([early.body.requeued, early.body.event.status], [0, 'not_sent'], 'retry while still unconfigured');
  stack.useSms('twilio');
  const later = await call({ op: 'alerts.retry', eventId: r.body.event.id }, { token: asha.token });
  assertEqual([later.body.requeued, later.body.event.status], [2, 'sent'], 'retry once configured');
  return 'explicit BLOCKED state, then sent';
});

await t.check('database failure mid-send: the provider accepted but nothing could be recorded, so nothing is reported sent', async () => {
  await freshWindow();
  await stack.query(`REVOKE EXECUTE ON FUNCTION public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text) FROM service_role`);
  let r;
  try {
    r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  } finally {
    await stack.query(`GRANT EXECUTE ON FUNCTION public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text) TO service_role`);
  }
  assertEqual(r.body.event.status, 'sending', 'event');
  assert(r.body.event.recipients.every((x) => x.status === 'sending'), JSON.stringify(r.body.event.recipients));
  assert(logLines.some((l) => l.includes('emergency.attempt-unrecorded')), 'the failure was logged');
  // The lease runs out; the sweep closes the attempt as lease_expired and retries within the limit.
  await stack.query(`UPDATE public.emergency_event_recipients SET lease_until = now() - interval '1 second' WHERE event_id = $1`, [r.body.event.id]);
  await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  const after = await call({ op: 'alerts.get', eventId: r.body.event.id }, { token: asha.token });
  assertEqual(after.body.event.status, 'sent', 'after recovery');
  return 'outcome unknown is shown as sending, then retried (at most 3 attempts)';
});

await t.check('cancel: stops what is not sent yet; an accepted text cannot be recalled', async () => {
  await freshWindow();
  sms.queue('accept', 'error');
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  const c = await call({ op: 'alerts.cancel', eventId: r.body.event.id }, { token: asha.token });
  assertEqual(c.body.event.stopped, 1, 'stopped');
  assertEqual(c.body.event.recipients.map((x) => x.status).sort(), ['accepted', 'cancelled'], 'recipients');
  assertEqual(c.body.event.status, 'partial', 'event (one text did go)');
  const again = await call({ op: 'alerts.cancel', eventId: r.body.event.id }, { token: asha.token });
  assertEqual(codeOf(again), 'already_cancelled', 'twice');
  return 'honest about the text already sent';
});

await t.check('owner rate limit over HTTP: 429 with Retry-After after 5 alerts in an hour', async () => {
  let last;
  await freshWindow('25 hours');
  for (let i = 0; i < 6; i++) {
    await freshWindow('3 minutes');
    last = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
    if (last.status === 429) break;
  }
  assertEqual([last.status, codeOf(last)], [429, 'alert_rate_limited'], 'refused');
  assert(last.body.error.retryAfter > 0, 'retryAfter');
  return `retry after ${last.body.error.retryAfter} s`;
});

await t.check('settings.set over HTTP: acknowledgement required; enabling needs a verified contact', async () => {
  const noAck = await call({ op: 'settings.set', publicAlertsEnabled: true }, { token: asha.token });
  assertEqual(codeOf(noAck), 'acknowledge_required', 'no acknowledgement');
  const benOn = await call({ op: 'settings.set', publicAlertsEnabled: true, acknowledge: true }, { token: ben.token });
  assertEqual([benOn.status, codeOf(benOn)], [422, 'no_verified_contacts'], 'Ben');
  const on = await call({ op: 'settings.set', publicAlertsEnabled: true, acknowledge: true }, { token: asha.token });
  assertEqual(on.body.settings.publicAlertsEnabled, true, 'Asha');
  return 'off by default';
});

await t.check('host switch: without EMERGENCY_PUBLIC_ALERTS=on, visitor alerts are unavailable even when the owner turned them on', async () => {
  assertEqual((await call({ op: 'public.status', slug: 'asha-rao' })).body.available, false, 'status');
  const before = sms.messages.length;
  const r = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.9' });
  assertEqual([r.status, codeOf(r)], [404, 'unavailable'], 'alert');
  assertEqual(sms.messages.length, before, 'texts');
  process.env.EMERGENCY_PUBLIC_ALERTS = 'on';
  return 'fail-closed by default (DEC-2026-038 Q2)';
});

await t.check('visitor alert: relay only, owner told in-app, 15-minute and per-visitor limits, unknown/paused Taps unavailable', async () => {
  assertEqual((await call({ op: 'public.status', slug: 'asha-rao' })).body.available, true, 'available');
  assertEqual((await call({ op: 'public.status', slug: 'nobody-here' })).body.available, false, 'unknown Tap');
  const noConfirm = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey() });
  assertEqual(codeOf(noConfirm), 'confirm_required', 'without confirmation');
  const noIp = await api({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '' });
  assertEqual(codeOf(noIp), 'unavailable', 'no client address from the host');
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
  try {
    const unconfigured = await api({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.23' });
    assertEqual([unconfigured.status, codeOf(unconfigured)], [404, 'unavailable'], 'a host without TRUSTED_CLIENT_IP_HEADER (B-9 Part B)');
  } finally {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-nf-client-connection-ip';
  }
  const before = sms.messages.length;
  const r = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.20' });
  assertEqual([r.status, r.body.outcome], [202, 'sent'], JSON.stringify(r.body));
  assertEqual(Object.keys(r.body).sort(), ['outcome', 'safety'], 'what the visitor learns');
  assertEqual(sms.messages.length - before, 2, 'texts');
  assert(/someone using Asha Rao's SHYGON profile reported an emergency/.test(sms.messages.at(-1).body), 'visitor-alert wording');
  const note = (await stack.query(`SELECT title FROM public.notifications WHERE user_id = $1 AND category = 'security'`, [asha.userId])).rows;
  assertEqual(note.map((n) => n.title), ['Your emergency contacts were alerted'], 'owner notified');
  const again = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.21' });
  assertEqual([again.status, codeOf(again)], [429, 'alert_rate_limited'], 'a second visitor within 15 minutes');
  await stack.query(`UPDATE public.emergency_events SET created_at = created_at - interval '20 minutes' WHERE initiator = 'public'`);
  const sameVisitor = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.20' });
  assertEqual(codeOf(sameVisitor), 'alert_rate_limited', 'the same visitor again today');
  await stack.query(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [asha.userId]);
  const paused = await call({ op: 'public.alert', slug: 'asha-rao', idempotencyKey: newKey(), confirm: true }, { ip: '198.51.100.22' });
  assertEqual([paused.status, codeOf(paused)], [404, 'unavailable'], 'paused Tap');
  await stack.query(`UPDATE public.tap_profiles SET status = 'active' WHERE user_id = $1`, [asha.userId]);
  await stack.query(`UPDATE public.profiles SET suspended_at = now() WHERE id = $1`, [asha.userId]);
  assertEqual((await call({ op: 'public.status', slug: 'asha-rao' })).body.available, false, 'suspended account');
  await stack.query(`UPDATE public.profiles SET suspended_at = NULL WHERE id = $1`, [asha.userId]);
  return 'relay only; the visitor never learns who or how many';
});

await t.check('the public Tap payload carries no emergency data', async () => {
  const anon = supabaseClient(stack);
  const { data } = await anon.rpc('get_public_profile', { p_slug: 'asha-rao' });
  const text = JSON.stringify(data);
  assert(data && !/emergency|Ravi|Meera|98765000/i.test(text), text.slice(0, 200));
  return 'no contact, no setting';
});

await t.check('report: a reported visitor alert turns visitor alerts off and tells SHYGON', async () => {
  const [event] = (await call({ op: 'alerts.list' }, { token: asha.token })).body.events.filter((e) => e.initiator === 'public');
  const r = await call({ op: 'alerts.report', eventId: event.id, reason: 'I was not in trouble' }, { token: asha.token });
  assertEqual([r.body.reported, r.body.publicAlertsDisabled], [true, true], 'reported');
  assertEqual((await call({ op: 'public.status', slug: 'asha-rao' })).body.available, false, 'visitor alerts off');
  const admin = (await stack.query(`SELECT title FROM public.admin_notifications WHERE category = 'security'`)).rows;
  assertEqual(admin.map((a) => a.title), ['Emergency alert reported'], 'admin notified');
  assertEqual(codeOf(await call({ op: 'alerts.report', eventId: event.id }, { token: asha.token })), 'already_reported', 'twice');
  return 'abuse path closed until the owner turns it on again';
});

await t.check('admin investigation: a customer is refused; a support admin sees status and errors, no names or numbers; the read is audited', async () => {
  const customer = supabaseClient(stack);
  await customer.auth.signInWithPassword({ email: ben.email, password: 'local-test-pass-1' });
  const refusedCall = await customer.rpc('admin_list_emergency_events', { p_status: null, p_limit: 10, p_offset: 0 });
  assert(refusedCall.error && /administrator access/.test(refusedCall.error.message), JSON.stringify(refusedCall.error));
  const support = await signUp(stack, { name: 'Support Agent' });
  await stack.query(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, 'support', true)`, [support.userId]);
  const { data, error } = await support.client.rpc('admin_list_emergency_events', { p_status: null, p_limit: 50, p_offset: 0 });
  assert(!error, error?.message);
  assert(data.length > 0 && data.some((e) => e.recipients.some((x) => x.attemptLog.length > 0)), 'attempt log visible');
  const text = JSON.stringify(data);
  assert(!/Ravi|Meera/.test(text) && !text.includes(digits(NUMBERS[0])), 'names or numbers visible to the admin');
  const audit = (await stack.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE admin_id = $1 AND action = 'emergency.events.read'`, [support.userId])).rows[0].n;
  assertEqual(audit, 1, 'audited reads');
  return `${data.length} alerts visible for investigation`;
});

await t.check('MSG91: the DLT template and variables are used; with no receipts the status stays "sent" (unconfirmed)', async () => {
  stack.useSms('msg91', { receipts: false });
  await freshWindow();
  await stack.query(`DELETE FROM public.emergency_events WHERE user_id = $1 AND initiator = 'owner'`, [asha.userId]);
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  assertEqual([r.body.event.status, r.body.event.deliveryReceipts], ['sent', 'not_supported'], 'event');
  const last = sms.messages.at(-1);
  assertEqual([last.provider, last.templateId, last.vars.name], ['msg91', 'tmpl_emergency_owner', 'Asha Rao'], 'template');
  const without = await sms.deliverMsg91(last.sid, 1, { secret: stack.secrets.msg91DlrSecret });
  assertEqual(without.status, 503, 'receipts refused while MSG91_DLR_SECRET is unset');
  return 'accepted, delivery unconfirmed';
});

await t.check('MSG91 receipts (V6-114): only a report with the secret header counts; 1 = delivered, 17 = not delivered; nothing moves back', async () => {
  stack.useSms('msg91');
  await stack.query(`DELETE FROM public.emergency_events WHERE user_id = $1 AND initiator = 'owner'`, [asha.userId]);
  const r = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: asha.token });
  assertEqual([r.body.event.status, r.body.event.deliveryReceipts], ['sent', 'supported'], 'event before reports');
  const [a, b] = sms.messages.filter((m) => m.provider === 'msg91').slice(-2);
  assertEqual((await sms.deliverMsg91(a.sid, 1, { secret: 'not-the-secret' })).status, 403, 'wrong secret');
  assertEqual((await sms.deliverMsg91(a.sid, 1)).status, 403, 'no secret header');
  let e = await call({ op: 'alerts.get', eventId: r.body.event.id }, { token: asha.token });
  assertEqual(e.body.event.status, 'sent', 'unchanged by refused reports');
  assertEqual((await sms.deliverMsg91(a.sid, 1, { secret: stack.secrets.msg91DlrSecret })).body.matched, 1, 'delivered report');
  assertEqual((await sms.deliverMsg91(b.sid, 17, { secret: stack.secrets.msg91DlrSecret })).body.matched, 1, 'blocked-number report');
  assertEqual((await sms.deliverMsg91(a.sid, 2, { secret: stack.secrets.msg91DlrSecret })).body.matched, 1, 'a late failure report for a delivered message');
  assertEqual((await sms.deliverMsg91('unknown-request', 1, { secret: stack.secrets.msg91DlrSecret })).body.matched, 0, 'unknown request id');
  e = await call({ op: 'alerts.get', eventId: r.body.event.id }, { token: asha.token });
  assertEqual(e.body.event.status, 'partial', 'event');
  const byStatus = e.body.event.recipients.map((x) => [x.status, x.lastError]).sort();
  assertEqual(byStatus, [['delivered', null], ['undelivered', 'blocked_number']], 'recipients (fixed error vocabulary, no provider free text)');
  stack.useSms('twilio');
  return 'delivered and not-delivered both shown as the provider reported';
});

await t.check('operator smoke script (scripts/release/emergency-smoke.mjs) runs end to end: verify, SEND, receipt, contact removed', async () => {
  const { runSmoke } = await import('../../scripts/release/emergency-smoke.mjs');
  const operator = await signUp(stack, { name: 'Operator Test' });
  const lines = [];
  const evidence = await runSmoke({
    base: stack.appUrl, token: operator.token, phone: '+919876500077', pollMs: 20, maxPolls: 50,
    ask: async (question) => (/6-digit/.test(question) ? /code: (\d{6})/.exec(sms.messages.at(-1).body)[1] : 'SEND'),
    log: (line) => {
      lines.push(line);
      if (/^alert .*: sent/.test(line)) setTimeout(() => sms.deliver(sms.messages.at(-1).sid, 'delivered'), 5);
    },
  });
  assertEqual([evidence.result, evidence.finalStatus, evidence.deliveryReceipts], ['delivered-confirmed', 'delivered', 'supported'], 'evidence');
  const left = (await stack.query(`SELECT count(*)::int AS n FROM public.emergency_contacts WHERE user_id = $1`, [operator.userId])).rows[0].n;
  assertEqual(left, 0, 'smoke contact removed');
  assert(!JSON.stringify(evidence).includes('9876500077') && !lines.join(' ').includes('9876500077'), 'a number in the evidence or output');
  return evidence.result;
});

await t.check('B-4: the /__sim control routes drive the running stack the way a browser test would', async () => {
  const sim = async (method, route, body) => {
    const res = await fetch(`${stack.appUrl}${route}`, {
      method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const owner = await signUp(stack, { name: 'Browser Owner' });
  const phone = '+919876500088';
  assertEqual((await sim('POST', '/__sim/sms/provider', { provider: null })).status, 200, 'provider off');
  const saved = await call({ op: 'contacts.save', name: 'Browser Contact', phone }, { token: owner.token });
  const none = await call({ op: 'contacts.verify.request', contactId: saved.body.contact.id }, { token: owner.token });
  assertEqual(codeOf(none), 'provider_not_configured', 'no provider');
  assertEqual((await sim('POST', '/__sim/sms/provider', { provider: 'twilio' })).status, 200, 'provider on');
  await stack.query(`UPDATE public.emergency_contact_challenges SET created_at = now() - interval '1 minute'`);
  await call({ op: 'contacts.verify.request', contactId: saved.body.contact.id }, { token: owner.token });
  const code = await sim('GET', `/__sim/sms/last-code?to=${encodeURIComponent(phone)}`);
  assert(code.status === 200 && /^\d{6}$/.test(code.body.code), JSON.stringify(code));
  const ok = await call({ op: 'contacts.verify.confirm', contactId: saved.body.contact.id, code: code.body.code }, { token: owner.token });
  assertEqual(ok.body.contact.verified, true, 'verified with the code read through the route');
  assertEqual((await sim('POST', '/__sim/sms/queue', { scenarios: ['nonsense'] })).status, 400, 'unknown scenario');
  assertEqual((await sim('POST', '/__sim/sms/queue', { scenarios: ['accept'] })).body.queued, 1, 'queued');
  const alert = await call({ op: 'alerts.create', idempotencyKey: newKey() }, { token: owner.token });
  const listed = (await sim('GET', '/__sim/sms/messages')).body;
  assert(listed.every((m) => !('body' in m)), 'the messages route returns no bodies');
  const last = listed.at(-1);
  assertEqual((await sim('POST', '/__sim/sms/deliver', { sid: last.sid, status: 'delivered' })).body.status, 200, 'receipt');
  const got = await call({ op: 'alerts.get', eventId: alert.body.event.id }, { token: owner.token });
  assertEqual(got.body.event.status, 'delivered', 'delivered through the route');
  const before = (await sim('POST', '/__sim/switches', {})).body;
  const on = (await sim('POST', '/__sim/switches', { RESCUE_RELAY: true, SOMETHING_ELSE: true })).body;
  assertEqual(on, { ...before, RESCUE_RELAY: true }, 'only the two named switches exist');
  await sim('POST', '/__sim/switches', { RESCUE_RELAY: before.RESCUE_RELAY });
  return 'provider, scenarios, code, receipt, switches';
});

await t.check('nothing secret or personal reached a response or a log line', async () => {
  const secrets = [stack.secrets.twilioAuthToken, stack.secrets.twilioAccountSid, stack.secrets.msg91AuthKey, stack.secrets.cronSecret,
    stack.keys.serviceRoleKey];
  const leaks = [];
  for (const text of [...bodies, ...logLines]) {
    for (const s of secrets) if (text.includes(s)) leaks.push('a provider or server secret');
    for (const n of NUMBERS) if (text.includes(digits(n))) leaks.push('a contact number');
    if (/Ravi Rao|Meera/.test(text) && logLines.includes(text)) leaks.push('a contact name in a log');
  }
  assertEqual([...new Set(leaks)], [], 'leaks');
  return `${bodies.length} responses, ${logLines.length} log lines checked`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
