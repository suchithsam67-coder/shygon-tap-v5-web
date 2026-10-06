// The public Tap: lifecycle, the six states, field privacy and analytics
// (V6 Stage 3; V6-071, V6-073, V6-032).
//
// Part A compares the live schema baseline with baseline + 020 onward, so each
// fix is shown failing before its migration (a negative control in the run).
// Part B drives the Tap through its real lifecycle on the local stack, over
// HTTP, as each real caller: the customer (REST under RLS), an administrator
// (admin RPCs) and anonymous visitors (the two public functions the page
// calls, exactly as src/lib/publicTapClient.ts calls them).
//
//   node supabase/tests/public-tap.mjs
import { createLiveDb, createMigratedDb } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';

const t = createHarness('Public Tap: lifecycle, states, privacy, analytics');

// ---------------------------------------------------------------------------
t.section('A. Live baseline vs baseline + 020 onward (negative controls)');

const U = 'b1000000-0000-4000-8000-000000000001';
async function seedTap(db) {
  await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;`);
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${U}', 'probe@example.test');`);
  await db.exec(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status, location, phone, email, enabled_customizations)
    VALUES ('${U}', (SELECT id FROM public.customers WHERE user_id = '${U}'), 'probe', 'probe', 'Probe Person', 'active',
            '12 Secret Lane, Bengaluru', '+919800000000', 'probe@example.test', ARRAY['phone', 'email']);`);
}
async function as(db, role, uid, sql) {
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`SET ROLE ${role};`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('RESET ROLE;');
    await db.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

const baseline = await createLiveDb();
await seedTap(baseline);
const migrated = await createMigratedDb();
await seedTap(migrated);

await t.check('V6-071: on live, anon reads a hidden address through get_public_tap (the leak 025 closes)', async () => {
  const rows = (await as(baseline, 'anon', null, `SELECT location FROM public.get_public_tap('probe')`)).rows;
  assertEqual(rows.map((r) => r.location), ['12 Secret Lane, Bengaluru'], 'live answer');
  const profile = (await as(baseline, 'anon', null, `SELECT public.get_public_profile('probe')->>'location' AS l`)).rows[0].l;
  assertEqual(profile, null, 'get_public_profile withholds it');
  return 'CONFIRMED on the baseline';
});

await t.check('V6-071: after 025, anon and signed-in callers may not execute get_public_tap; the server still can', async () => {
  for (const role of ['anon', 'authenticated']) {
    let refused = false;
    try {
      await as(migrated, role, role === 'anon' ? null : U, `SELECT * FROM public.get_public_tap('probe')`);
    } catch (error) {
      refused = /permission denied for function get_public_tap/.test(error.message);
    }
    assert(refused, `${role} was not refused`);
  }
  const server = (await as(migrated, 'service_role', null, `SELECT count(*)::int AS n FROM public.get_public_tap('probe')`)).rows[0].n;
  assertEqual(server, 1, 'service_role');
});

await t.check('V6-071: on live, an owner switching their phone off is overridden (phone stays public)', async () => {
  await as(baseline, 'authenticated', U, `UPDATE public.tap_profiles SET enabled_customizations = ARRAY['email'] WHERE user_id = '${U}'`);
  const enabled = (await baseline.query(`SELECT enabled_customizations FROM public.tap_profiles WHERE user_id = '${U}'`)).rows[0].enabled_customizations;
  assertEqual(enabled, ['email', 'phone'], 'live stores');
  const phone = (await as(baseline, 'anon', null, `SELECT public.get_public_profile('probe')->>'phone' AS p`)).rows[0].p;
  assertEqual(phone, '+919800000000', 'live public phone');
  return 'CONFIRMED on the baseline';
});

await t.check('V6-071: after 025, the owner can hide phone and email; the public profile follows', async () => {
  await as(migrated, 'authenticated', U, `UPDATE public.tap_profiles SET enabled_customizations = ARRAY['email'] WHERE user_id = '${U}'`);
  let row = (await as(migrated, 'anon', null, `SELECT public.get_public_profile('probe') AS p`)).rows[0].p;
  assertEqual([row.phone, row.email], [null, 'probe@example.test'], 'phone hidden');
  await as(migrated, 'authenticated', U, `UPDATE public.tap_profiles SET enabled_customizations = ARRAY[]::text[] WHERE user_id = '${U}'`);
  row = (await as(migrated, 'anon', null, `SELECT public.get_public_profile('probe') AS p`)).rows[0].p;
  assertEqual([row.phone, row.email], [null, null], 'both hidden');
  const stored = (await migrated.query(`SELECT phone, email FROM public.tap_profiles WHERE user_id = '${U}'`)).rows[0];
  assertEqual([stored.phone, stored.email], ['+919800000000', 'probe@example.test'], 'values kept on the Tap');
});

await t.check('V6-071: the owner still cannot switch on an add-on they did not buy', async () => {
  let refused = false;
  try {
    await as(migrated, 'authenticated', U, `UPDATE public.tap_profiles SET enabled_customizations = ARRAY['location'] WHERE user_id = '${U}'`);
  } catch (error) {
    refused = /That add-on has not been purchased/.test(error.message);
  }
  assert(refused, 'location without the add-on was accepted');
});

await baseline.close();
await migrated.close();

// ---------------------------------------------------------------------------
t.section('B. The Tap lifecycle on the local stack (HTTP, real callers)');

const stack = await startStack();
const sql = async (text, params) => (await stack.query(text, params)).rows;

/** Exactly what src/lib/publicTapClient.ts sends. */
async function publicRpc(fn, body, headers = {}) {
  const response = await fetch(`${stack.gatewayUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: stack.keys.anonKey,
      authorization: `Bearer ${stack.keys.anonKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const profileOf = async (slug) => {
  const response = await publicRpc('get_public_profile', { p_slug: slug });
  assertEqual(response.status, 200, `get_public_profile(${JSON.stringify(slug)}) status`);
  return response.body;
};
const stateOf = async (slug) => {
  const response = await publicRpc('get_public_tap_state', { p_slug: slug });
  assertEqual(response.status, 200, `get_public_tap_state(${JSON.stringify(slug)}) status`);
  return response.body === 'active' || response.body === 'paused' ? response.body : 'unavailable';
};

// A paying customer, provisioned by the real payment chain.
const owner = await signUp(stack, { name: 'Lifecycle Owner' });
{
  const created = await callFunction(stack, 'create-order', { token: owner.token, body: { orderType: 'digitalUpgrade', planId: 'business' } });
  const paid = stack.sim.pay({ order_id: created.body.order_id });
  const verified = await callFunction(stack, 'verify-payment', { token: owner.token, body: paid });
  assertEqual(verified.status, 200, 'setup payment');
}
const [tap] = await sql(`SELECT id, slug FROM public.tap_profiles WHERE user_id = $1`, [owner.userId]);
const slug = tap.slug;

// An administrator with tap.moderate.
const admin = await signUp(stack, { name: 'Moderator' });
await sql(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, 'admin', true)`, [admin.userId]);

const setStatus = async (status) => {
  const { error } = await owner.client.from('tap_profiles').update({ status }).eq('user_id', owner.userId).select('id').single();
  if (error) throw new Error(`owner status ${status}: ${error.message}`);
};
const moderate = async (suspended, reason) => {
  const { error } = await admin.client.rpc('admin_set_tap_suspension', { p_tap_id: tap.id, p_suspended: suspended, p_reason: reason ?? null });
  if (error) throw new Error(`moderation: ${error.message}`);
};

await t.check('provisioned by payment: a draft that the public cannot see', async () => {
  assertEqual([await profileOf(slug), await stateOf(slug)], [null, 'unavailable'], 'draft');
});

await t.check('published by its owner: active and public', async () => {
  await setStatus('active');
  const profile = await profileOf(slug);
  assertEqual([profile?.slug, profile?.displayName, await stateOf(slug)], [slug, 'Lifecycle Owner', 'active'], 'active');
});

await t.check('paused by its owner: "temporarily unavailable", no profile data', async () => {
  await setStatus('paused');
  assertEqual([await profileOf(slug), await stateOf(slug)], [null, 'paused'], 'paused');
  await setStatus('active');
  assertEqual(await stateOf(slug), 'active', 'resumed');
});

await t.check('suspended by an administrator: unavailable, the owner is told, and the audit log records it', async () => {
  await moderate(true, 'Reported content');
  assertEqual([await profileOf(slug), await stateOf(slug)], [null, 'unavailable'], 'suspended');
  const notes = await sql(`SELECT title, body FROM public.notifications WHERE user_id = $1 AND title = 'Your Tap profile was suspended'`, [owner.userId]);
  assertEqual(notes.map((n) => n.body), ['Reported content'], 'owner notified with the reason');
  const audit = await sql(`SELECT action FROM public.admin_audit_log WHERE admin_id = $1 AND entity_id = $2`, [admin.userId, tap.id]);
  assertEqual(audit.map((a) => a.action), ['tap.suspended'], 'audited');
});

await t.check('a suspended Tap cannot be restored or re-published by its owner', async () => {
  const cleared = await owner.client.from('tap_profiles').update({ suspended_at: null }).eq('user_id', owner.userId).select('id');
  assert(cleared.error?.code === '42501', `clearing suspension: ${JSON.stringify(cleared.error ?? cleared.data)}`);
  await setStatus('active'); // allowed, but the suspension still wins
  assertEqual(await stateOf(slug), 'unavailable', 'still unavailable');
});

await t.check('a customer cannot call the moderation RPC (refused, nothing changes)', async () => {
  const { error } = await owner.client.rpc('admin_set_tap_suspension', { p_tap_id: tap.id, p_suspended: false, p_reason: null });
  assert(error, 'the customer call succeeded');
  assertEqual(await stateOf(slug), 'unavailable', 'still suspended');
});

await t.check('restored by an administrator: active again, the owner is told', async () => {
  await moderate(false);
  assertEqual(await stateOf(slug), 'active', 'restored');
  const notes = await sql(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND title = 'Your Tap profile was restored'`, [owner.userId]);
  assertEqual(notes[0].n, 1, 'restore notification');
});

await t.check('deactivated (archived) by its owner: unavailable', async () => {
  await setStatus('archived');
  assertEqual([await profileOf(slug), await stateOf(slug)], [null, 'unavailable'], 'archived');
  await setStatus('active');
});

// ---------------------------------------------------------------------------
t.section('C. The six states and hostile addresses');

await t.check('missing: a well-formed address with no Tap is unavailable', async () => {
  assertEqual([await profileOf('no-such-tap'), await stateOf('no-such-tap')], [null, 'unavailable'], 'missing');
});

await t.check('invalid: hostile or malformed addresses answer 200 "unavailable", never an error', async () => {
  const hostile = ['', '   ', "x' OR '1'='1", "'; DROP TABLE tap_profiles; --", '../../etc/passwd', '%00', 'a'.repeat(2000), 'ünïcødé-😀', null];
  for (const value of hostile) {
    assertEqual([await profileOf(value), await stateOf(value)], [null, 'unavailable'], `slug ${JSON.stringify(value)?.slice(0, 30)}`);
  }
  const still = await sql(`SELECT count(*)::int AS n FROM public.tap_profiles`);
  assert(still[0].n > 0, 'tap_profiles still has rows');
  return `${hostile.length} addresses`;
});

await t.check('the public profile carries only whitelisted fields, never an internal one', async () => {
  const profile = await profileOf(slug);
  const allowed = ['slug', 'experience', 'displayName', 'headline', 'designation', 'company', 'bio', 'avatarUrl', 'location', 'phone', 'whatsapp', 'email', 'website', 'instagram', 'linkedin', 'youtube', 'customLinks', 'theme', 'baseTheme', 'activeEvent'];
  assertEqual(Object.keys(profile).sort(), [...allowed].sort(), 'keys');
  const [customer] = await sql(`SELECT id, customer_id FROM public.customers WHERE user_id = $1`, [owner.userId]);
  const text = JSON.stringify(profile);
  for (const internal of [owner.userId, tap.id, customer.id, customer.customer_id]) {
    assert(!text.includes(internal), `leaks an internal identifier: ${internal}`);
  }
});

// Characterises today's behaviour so that changing it is a decision, not an
// accident: provisioning copies the login email into the Tap's public email
// field, switched on, so it is public once the owner publishes. Open owner
// decision D-11 (privacy by default); the owner can now hide it (V6-071).
await t.check('CURRENT BEHAVIOUR (D-11 open): a new Tap starts with the login email as its public email', async () => {
  const [row] = await sql(`SELECT email, enabled_customizations FROM public.tap_profiles WHERE id = $1`, [tap.id]);
  assertEqual(row.email, owner.email, 'pre-filled email');
  assert(row.enabled_customizations.includes('email'), 'email switched on');
  assertEqual((await profileOf(slug)).email, owner.email, 'public once published');
  return 'login email public by default after publishing';
});

await t.check('the owner hides and shows phone and email through the app path (REST under RLS)', async () => {
  const { error } = await owner.client.from('tap_profiles').update({ phone: '+919811111111', email: 'public@example.test', enabled_customizations: ['email'] }).eq('user_id', owner.userId).select('id').single();
  if (error) throw new Error(error.message);
  let profile = await profileOf(slug);
  assertEqual([profile.phone, profile.email], [null, 'public@example.test'], 'phone hidden');
  await owner.client.from('tap_profiles').update({ enabled_customizations: ['phone', 'email'] }).eq('user_id', owner.userId);
  profile = await profileOf(slug);
  assertEqual([profile.phone, profile.email], ['+919811111111', 'public@example.test'], 'both shown');
});

// ---------------------------------------------------------------------------
t.section('D. Analytics: salted hash, dedupe, cap (V6-073, V6-032)');

const eventsOf = async () => sql(`SELECT event_type, link_key, visitor_hash FROM public.tap_events WHERE tap_profile_id = $1 ORDER BY occurred_at`, [tap.id]);
const visit = (event, linkKey, agent = 'Mozilla/5.0 (Phone A)') =>
  publicRpc('record_tap_event', { p_slug: slug, p_event: event, p_link_key: linkKey ?? null }, { 'user-agent': agent });

await t.check('a view is recorded with a 64-hex salted hash, not md5(agent|ip|date)', async () => {
  const response = await visit('view');
  assertEqual(response.status, 204, 'void function answers 204');
  const events = await eventsOf();
  assertEqual(events.length, 1, 'events');
  assert(/^[0-9a-f]{64}$/.test(events[0].visitor_hash), `hash ${events[0].visitor_hash}`);
  const unsalted = await sql(
    `SELECT md5($1 || '|' || '127.0.0.1' || '|' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')) AS h`,
    ['Mozilla/5.0 (Phone A)'],
  );
  assert(events[0].visitor_hash !== unsalted[0].h, 'hash is the unsalted md5');
});

await t.check('the same visitor repeating the same event within 10 seconds counts once', async () => {
  await visit('view');
  await visit('view');
  assertEqual((await eventsOf()).filter((e) => e.event_type === 'view').length, 1, 'views');
});

await t.check('a different visitor, or a different event, is counted', async () => {
  await visit('view', null, 'Mozilla/5.0 (Phone B)');
  await visit('nfc');
  const events = await eventsOf();
  assertEqual(events.filter((e) => e.event_type === 'view').length, 2, 'views');
  assertEqual(new Set(events.filter((e) => e.event_type === 'view').map((e) => e.visitor_hash)).size, 2, 'distinct visitors');
  assertEqual(events.filter((e) => e.event_type === 'nfc').length, 1, 'nfc');
});

await t.check('one visitor records at most 60 events on one Tap per hour', async () => {
  const agent = 'Flood/1.0';
  for (let i = 0; i < 75; i++) await visit('link_click', `link-${i}`, agent);
  const hashes = await sql(`SELECT visitor_hash, count(*)::int AS n FROM public.tap_events WHERE tap_profile_id = $1 AND event_type = 'link_click' GROUP BY 1`, [tap.id]);
  assertEqual(hashes.map((h) => h.n), [60], 'capped');
});

await t.check('nothing is recorded for a Tap the public cannot see', async () => {
  const before = (await eventsOf()).length;
  await setStatus('paused');
  await visit('view', null, 'Mozilla/5.0 (Phone C)');
  await setStatus('active');
  assertEqual((await eventsOf()).length, before, 'events while paused');
});

await t.check('salts stay in the database: one per day, closed to every API role', async () => {
  const salts = await sql(`SELECT day FROM public.tap_visitor_salts`);
  assert(salts.length >= 1 && salts.length <= 2, `salt rows: ${salts.length}`);
  const anonRead = await supabaseClient(stack).from('tap_visitor_salts').select('salt');
  assert(anonRead.error?.code === '42501', `anon read: ${JSON.stringify(anonRead.error ?? anonRead.data)}`);
  const ownerRead = await owner.client.from('tap_visitor_salts').select('salt');
  assert(ownerRead.error?.code === '42501', `customer read: ${JSON.stringify(ownerRead.error ?? ownerRead.data)}`);
});

await t.check('old salts are deleted, so earlier days can no longer be re-hashed', async () => {
  await sql(`INSERT INTO public.tap_visitor_salts (day, salt) VALUES (current_date - 5, 'old')`);
  await visit('qr', null, 'Mozilla/5.0 (Phone D)');
  const days = await sql(`SELECT count(*)::int AS n FROM public.tap_visitor_salts WHERE day < (now() AT TIME ZONE 'UTC')::date - 1`);
  assertEqual(days[0].n, 0, 'salts older than yesterday');
});

const ok = t.finish();
await stack.close();
process.exit(ok ? 0 : 1);
