import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * Identity contract and the P1 payment/fulfilment defect (M0.3 U4).
 * DEC-2026-029 Option A (rules B1–B7) and DEC-2026-024 Option A + D-U4, as
 * implemented by migration 021 (M0_3_IMPLEMENTATION_SCOPE.md §2 point 4, §5).
 *
 * Every statement mirrors what the frozen V5 code sends; none of that code is
 * changed:
 *   order        netlify/functions/create-order.mjs:150-175   (service key)
 *   claim        netlify/lib/fulfilment.mjs:93-104            (service key)
 *   safety net   netlify/lib/fulfilment.mjs:313-346           (service key)
 *   profile save src/pages/Settings.tsx:86-96, src/pages/Checkout.tsx:330-338
 *                (browser, signed in)
 *
 * Roles. Browser requests run as `authenticated` with the user's id as the JWT
 * subject, as PostgREST does. Server requests run as `service_role`. On
 * Supabase that role bypasses row level security; the test stand-in does not,
 * so this suite grants it BYPASSRLS (scaffolding, not a schema change).
 *
 * The suite runs twice: on a database with migrations 020 onward applied once,
 * and on one with them applied twice (idempotency). It then proves the
 * rollback in 021's header restores the baseline.
 *
 *   node supabase/tests/identity-contract.mjs [migrations-dir]
 */

const DIR = process.argv[2] ?? MIGRATIONS_DIR;

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

async function build(times) {
  const db = await createLiveDb();
  for (let i = 0; i < times; i++) {
    for (const { sql } of newMigrations(DIR)) await db.exec(sql);
  }
  await db.exec('ALTER ROLE service_role BYPASSRLS;');
  return db;
}

// --- the statements V5 sends ---------------------------------------------------

const ORDER = `
  INSERT INTO public.orders (order_id, user_id, customer_id, amount_in_paise, payment_status, order_status,
                             order_type, plan_id, razorpay_order_id, fulfillment_status)
  VALUES ($1, $2, $2, 39900, $3, 'placed', 'physical', 'essential', $4, $5) RETURNING id`;

const PAYABLE = ['pending', 'created', 'payment_pending', 'failed'];
const CLAIM = `
  UPDATE public.orders
     SET payment_status = 'paid', order_status = 'processing', fulfillment_status = 'processing', updated_at = now()
   WHERE id = $1
     AND payment_status IN (${[...PAYABLE, 'paid'].map((s) => `'${s}'`).join(', ')})
     AND fulfillment_status IN ('pending', 'retry')
  RETURNING id`;

const SAFETY_NET = `
  INSERT INTO public.tap_profiles (user_id, customer_id, published, status, slug, username, display_name, email,
                                   selected_ui_tier, enabled_customizations, edit_window_started_at)
  VALUES ($1, $1, false, 'draft', $2, $2, $3, $4, 'essential', ARRAY['phone', 'email'], $5)
  ON CONFLICT (user_id) DO NOTHING`;

// supabase-js upsert(..., { onConflict: 'id' }) sets every column it was given.
const upsertProfile = (cols) => `
  INSERT INTO public.profiles (${Object.keys(cols).join(', ')})
  VALUES (${Object.keys(cols).map((_, i) => `$${i + 1}`).join(', ')})
  ON CONFLICT (id) DO UPDATE SET ${Object.keys(cols).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;

// --- one full pass ---------------------------------------------------------------

async function suite(db, label) {
  const q = (sql, params) => db.query(sql, params);

  async function as(role, uid, fn) {
    await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
    await db.exec(`SET ROLE ${role};`);
    try {
      return await fn();
    } finally {
      await db.exec('RESET ROLE;');
      await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
    }
  }
  const service = (fn) => as('service_role', null, fn);
  async function attempt(fn) {
    try { return { res: await fn(), err: null }; } catch (err) { return { res: null, err }; }
  }
  const refused42501 = (r) => {
    assert(r.err, 'NOT REFUSED');
    assert(r.err.code === '42501', `refused with ${r.err.code}, expected 42501: ${r.err.message}`);
    return `refused 42501 (${r.err.message.slice(0, 48)})`;
  };

  // Accounts. The first 10 hex digits differ, because sign-up derives the
  // unique customer code from them (O-13); the collision accounts share them on purpose.
  const U = {
    FIRST: 'b1000000-0000-4000-8000-000000000001',
    RETURNING: 'b2000000-0000-4000-8000-000000000002',
    FAILED: 'b3000000-0000-4000-8000-000000000003',
    NOCUST: 'b4000000-0000-4000-8000-000000000004',
    RETRY: 'b5000000-0000-4000-8000-000000000005',
    ROLLBACK: 'b6000000-0000-4000-8000-000000000006',
    SAVER: 'b7000000-0000-4000-8000-000000000007',
    NOPROF: 'b8000000-0000-4000-8000-000000000008',
    ALICE: 'b9000000-0000-4000-8000-000000000009',
    BOB: 'ba000000-0000-4000-8000-00000000000a',
    VICTIM: 'bb000000-0000-4000-8000-00000000000b',
    SIGNUP: 'bc000000-0000-4000-8000-00000000000c',
    // The collision accounts share their first 31 hex digits, so each one's
    // shorter codes are the others' too.
    COLL_A: 'c1000000-0000-4000-8000-000000000001', // signs up: holds CUST-C100000000
    COLL_B: 'c1000000-0000-4000-8000-000000000002', // no customers row; 10 digits taken
    COLL_D: 'c1000000-0000-4000-8000-000000000003', // 10 and 11 digits taken
    COLL_E: 'c1000000-0000-4000-8000-000000000004', // 10–32 digits and -2 taken
    COLL_F: 'c1000000-0000-4000-8000-000000000006', // every candidate taken: the cap
    COLL_S: 'c1000000-0000-4000-8000-000000000005', // signs up into a taken code (O-13)
  };
  const hex = (u) => u.replace(/-/g, '').toUpperCase();
  const signUp = (u, name) => q(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
    [u, `${name.toLowerCase().replace(/ /g, '.')}@example.test`, name],
  );
  // Accounts older than the sign-up trigger: no customers row and no profile.
  async function legacyAccount(u, email) {
    await db.exec('ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;');
    try {
      await q(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, email]);
    } finally {
      await db.exec('ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;');
    }
  }

  for (const [u, n] of [[U.FIRST, 'First Buyer'], [U.RETURNING, 'Returning Buyer'], [U.FAILED, 'Failed Buyer'],
    [U.RETRY, 'Retry Buyer'], [U.SAVER, 'Profile Saver'], [U.ALICE, 'Alice'], [U.BOB, 'Bob'], [U.COLL_A, 'Collision A']]) {
    await signUp(u, n);
  }
  for (const [u, e] of [[U.NOCUST, 'nocust@example.test'], [U.ROLLBACK, 'rollback@example.test'],
    [U.NOPROF, 'noprof@example.test'], [U.VICTIM, 'victim@example.test'], [U.COLL_B, 'coll.b@example.test'],
    [U.COLL_D, 'coll.d@example.test'], [U.COLL_E, 'coll.e@example.test'], [U.COLL_F, 'coll.f@example.test']]) {
    await legacyAccount(u, e);
  }

  // Legacy holder accounts whose customers rows occupy the given codes.
  let holderSeq = 0;
  async function holdCodes(codes) {
    const id = `('f0000000-0000-4000-8000-' || lpad(to_hex($1::int + g), 12, '0'))::uuid`;
    await db.exec('ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;');
    try {
      await q(`INSERT INTO auth.users (id, email) SELECT ${id}, 'holder.' || ($1::int + g) || '@example.test'
               FROM generate_series(1, $2::int) AS g`, [holderSeq, codes.length]);
    } finally {
      await db.exec('ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;');
    }
    await q(`INSERT INTO public.customers (user_id, customer_id) SELECT ${id}, ($3::text[])[g]
             FROM generate_series(1, $2::int) AS g`, [holderSeq, codes.length, codes]);
    holderSeq += codes.length;
  }

  const custOf = async (u) => (await q(`SELECT id FROM public.customers WHERE user_id = $1`, [u])).rows[0]?.id ?? null;
  const custRows = async (u) => (await q(`SELECT count(*)::int AS n FROM public.customers WHERE user_id = $1`, [u])).rows[0].n;
  const taps = async (u) => (await q(
    `SELECT id, user_id, customer_id, status, published, slug, display_name, email, selected_ui_tier
       FROM public.tap_profiles WHERE user_id = $1`, [u])).rows;
  const tapNotes = async (u) => (await q(
    `SELECT title, body, link FROM public.notifications WHERE user_id = $1 AND category = 'tap' ORDER BY created_at`, [u])).rows;
  const orderRow = async (id) => (await q(
    `SELECT payment_status, order_status, fulfillment_status FROM public.orders WHERE id = $1`, [id])).rows[0];
  let orderSeq = 0;
  const placeOrder = (u, payment = 'pending', fulfilment = 'pending') => service(async () => {
    orderSeq++;
    return (await q(ORDER, [`ST-U4-${orderSeq}`, u, payment, `order_u4_${orderSeq}`, fulfilment])).rows[0].id;
  });

  // Bob already has a Tap; so does Alice (for the refusal checks).
  for (const [u, slug] of [[U.RETURNING, 'returning-buyer'], [U.BOB, 'bob-tap'], [U.ALICE, 'alice-tap']]) {
    await q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status, published)
             VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, $2, 'active', true)`, [u, slug]);
  }
  const C = { BOB: await custOf(U.BOB), ALICE: await custOf(U.ALICE) };

  console.log(`\n=== ${label}: sign-up (handle_new_user, unchanged) ===`);

  await check('sign-up creates one customers row (C ≠ U) and a profile linked to it', async () => {
    await signUp(U.SIGNUP, 'Sign Up');
    const c = (await q(`SELECT id, customer_id, registered_email FROM public.customers WHERE user_id = $1`, [U.SIGNUP])).rows;
    const p = (await q(`SELECT customer_id, full_name FROM public.profiles WHERE id = $1`, [U.SIGNUP])).rows[0];
    assert(c.length === 1, `${c.length} customers rows`);
    assert(c[0].id !== U.SIGNUP, 'customers.id equals the user id');
    assert(c[0].customer_id === `CUST-${hex(U.SIGNUP).slice(0, 10)}`, `code ${c[0].customer_id}`);
    assert(p.customer_id === c[0].id && p.full_name === 'Sign Up', json(p));
    return `code ${c[0].customer_id}; profile → customers.id`;
  });

  await check('KNOWN, OPEN (O-13): sign-up itself still refuses a colliding customer code', async () => {
    const r = await attempt(() => signUp(U.COLL_S, 'Collision S'));
    assert(r.err?.code === '23505', `expected 23505 (handle_new_user unchanged), got ${r.err ? r.err.code : 'success'}`);
    return `23505 ${r.err.constraint ?? ''} (handle_new_user is outside U4; owner decision applies to the helper)`;
  });

  console.log(`\n=== ${label}: payment and fulfilment (I-1, D-U4) ===`);

  const firstOrder = await placeOrder(U.FIRST);

  await check('I-1: the first-time buyer\'s paid claim succeeds and creates one Tap with the right customers.id', async () => {
    const r = await service(() => q(CLAIM, [firstOrder]));
    assert(r.rows.length === 1, `claim matched ${r.rows.length} row(s)`);
    assert(json(await orderRow(firstOrder)) === json({ payment_status: 'paid', order_status: 'processing', fulfillment_status: 'processing' }),
      json(await orderRow(firstOrder)));
    const t = await taps(U.FIRST);
    const c = await custOf(U.FIRST);
    assert(t.length === 1, `${t.length} Taps`);
    assert(t[0].customer_id === c && c !== U.FIRST, `customer_id ${t[0].customer_id}, customers.id ${c}`);
    return 'order paid/processing; Tap.customer_id = customers.id (≠ user id)';
  });

  await check('D-U4: the new Tap is an unpublished draft, and the notification says so', async () => {
    const [t] = await taps(U.FIRST);
    assert(t.status === 'draft' && t.published === false, json(t));
    assert(t.slug && t.display_name === 'First Buyer', json(t));
    const notes = await tapNotes(U.FIRST);
    assert(json(notes) === json([{
      title: 'Your SHYGON Tap draft is ready',
      body: 'Your Tap page has been created. Review and publish it from your SHYGON dashboard.',
      link: '/shygontap/tap',
    }]), json(notes));
    return `status=draft, published=false, slug=${t.slug}; "Your SHYGON Tap draft is ready"`;
  });

  await check('D-U4 / O-12: an anonymous visitor sees nothing of the new Tap', async () => {
    const [t] = await taps(U.FIRST);
    const r = await as('anon', null, () =>
      q(`SELECT public.get_public_tap_state($1) AS s, public.get_public_profile($1) AS p`, [t.slug]));
    assert(r.rows[0].s === 'unavailable' && r.rows[0].p === null, json(r.rows[0]));
    return 'state=unavailable, profile=null (name and email not public)';
  });

  await check('the owner can publish the draft from the dashboard (the notification\'s promise)', async () => {
    const [t] = await taps(U.FIRST);
    await as('authenticated', U.FIRST, () => q(`UPDATE public.tap_profiles SET status = 'active' WHERE user_id = $1`, [U.FIRST]));
    const r = await as('anon', null, () => q(`SELECT public.get_public_tap_state($1) AS s`, [t.slug]));
    assert(r.rows[0].s === 'active', `state ${r.rows[0].s}`);
    return 'status=active, publicly served';
  });

  await check('a duplicate claim / duplicate webhook matches 0 rows and changes nothing', async () => {
    const before = json([await taps(U.FIRST), await tapNotes(U.FIRST)]);
    const r = await service(() => q(CLAIM, [firstOrder]));
    assert(r.rows.length === 0, `matched ${r.rows.length} row(s)`);
    assert(json([await taps(U.FIRST), await tapNotes(U.FIRST)]) === before, 'Tap or notifications changed');
    return '0 rows; one Tap; no new notification';
  });

  await check('a returning buyer\'s claim leaves the existing Tap unchanged', async () => {
    const before = json(await taps(U.RETURNING));
    const id = await placeOrder(U.RETURNING);
    const r = await service(() => q(CLAIM, [id]));
    assert(r.rows.length === 1, `matched ${r.rows.length} row(s)`);
    assert(json(await taps(U.RETURNING)) === before, 'the Tap changed');
    assert((await tapNotes(U.RETURNING)).length === 0, 'a "ready" notification was sent for an existing Tap');
    assert((await custRows(U.RETURNING)) === 1, 'customers rows changed');
    return 'claimed; Tap byte-identical; no notification';
  });

  await check('a failed payment provisions nothing', async () => {
    const id = await placeOrder(U.FAILED);
    await service(() => q(`UPDATE public.orders SET payment_status = 'failed' WHERE id = $1`, [id]));
    assert((await taps(U.FAILED)).length === 0, 'a Tap was created');
    assert((await tapNotes(U.FAILED)).length === 0, 'a Tap notification was sent');
    return 'no Tap, no notification';
  });

  await check('missing customer: the claim creates exactly one customers row (live code format) and links the Tap', async () => {
    assert((await custRows(U.NOCUST)) === 0, 'fixture already has a customers row');
    const id = await placeOrder(U.NOCUST);
    const r = await service(() => q(CLAIM, [id]));
    assert(r.rows.length === 1, `matched ${r.rows.length} row(s)`);
    const c = (await q(`SELECT id, customer_id, registered_email FROM public.customers WHERE user_id = $1`, [U.NOCUST])).rows;
    assert(c.length === 1, `${c.length} customers rows`);
    assert(c[0].customer_id === `CUST-${hex(U.NOCUST).slice(0, 10)}` && c[0].registered_email === 'nocust@example.test', json(c[0]));
    const t = await taps(U.NOCUST);
    assert(t.length === 1 && t[0].customer_id === c[0].id && t[0].status === 'draft', json(t));
    return `${c[0].customer_id}; draft Tap linked to it`;
  });

  await check('a fulfilment failure rolls back everything: no partial Tap, no customers row', async () => {
    const id = await placeOrder(U.ROLLBACK);
    let inside = null;
    const r = await attempt(() => db.transaction(async (tx) => {
      await tx.exec('SET LOCAL ROLE service_role;');
      await tx.query(CLAIM, [id]);
      inside = (await tx.query(`SELECT count(*)::int AS n FROM public.tap_profiles WHERE user_id = $1`, [U.ROLLBACK])).rows[0].n;
      await tx.query('SELECT 1 / 0'); // the fulfilment fails after the claim
    }));
    assert(r.err?.code === '22012', `expected the simulated failure, got ${r.err ? r.err.code : 'success'}`);
    assert(inside === 1, `the claim had not provisioned inside the transaction (${inside})`);
    assert(json(await orderRow(id)) === json({ payment_status: 'pending', order_status: 'placed', fulfillment_status: 'pending' }),
      json(await orderRow(id)));
    assert((await taps(U.ROLLBACK)).length === 0 && (await custRows(U.ROLLBACK)) === 0 && (await tapNotes(U.ROLLBACK)).length === 0,
      'something survived the rollback');
    return 'Tap existed inside the transaction; after it: order pending, 0 Taps, 0 customers rows';
  });

  console.log(`\n=== ${label}: retry and the safety net (I-3) ===`);

  const retryOrder = await placeOrder(U.RETRY, 'paid', 'retry');
  const created = (await q(`SELECT created_at FROM public.orders WHERE id = $1`, [retryOrder])).rows[0].created_at;
  const netFor = async (u) => service(async () => {
    const slug = (await q(`SELECT public.generate_tap_slug($1) AS s`, [u])).rows[0].s;
    const p = (await q(`SELECT full_name, email FROM public.profiles WHERE id = $1`, [u])).rows[0];
    return q(SAFETY_NET, [u, slug, p?.full_name ?? null, p?.email ?? null, created]);
  });

  await check('retry (paid → paid) claims the order but cannot provision; the safety net then can', async () => {
    const r = await service(() => q(CLAIM, [retryOrder]));
    assert(r.rows.length === 1, `matched ${r.rows.length} row(s)`);
    assert((await taps(U.RETRY)).length === 0, 'the trigger provisioned on paid → paid');
    await netFor(U.RETRY);
    const t = await taps(U.RETRY);
    assert(t.length === 1 && t[0].customer_id === await custOf(U.RETRY), json(t));
    assert(t[0].status === 'draft' && t[0].published === false, json(t[0]));
    return 'I-3 fixed: safety-net Tap stored with customers.id, as a draft';
  });

  await check('the safety net and the claim are idempotent on a retry', async () => {
    const before = json(await taps(U.RETRY));
    await netFor(U.RETRY);
    const r = await service(() => q(CLAIM, [retryOrder]));
    assert(r.rows.length === 0, `second claim matched ${r.rows.length} row(s)`);
    assert(json(await taps(U.RETRY)) === before, 'the Tap changed');
    return 'one Tap; second claim 0 rows';
  });

  console.log(`\n=== ${label}: profile saves from the browser (I-2) ===`);

  const settingsSave = (u, extra = {}) => ({
    id: u, customer_id: u, email: 'profile.saver@example.test', full_name: 'Profile Saver',
    phone: '+910000000007', company: 'Acme', job_title: 'Owner', ...extra,
  });

  await check('Settings save (customer_id = user id) succeeds and stores customers.id', async () => {
    const cols = settingsSave(U.SAVER);
    for (let i = 0; i < 2; i++) {
      await as('authenticated', U.SAVER, () => q(upsertProfile(cols), Object.values(cols)));
    }
    const p = (await q(`SELECT customer_id, company, job_title FROM public.profiles WHERE id = $1`, [U.SAVER])).rows[0];
    assert(p.customer_id === await custOf(U.SAVER) && p.company === 'Acme' && p.job_title === 'Owner', json(p));
    assert((await custRows(U.SAVER)) === 1, 'customers rows changed');
    return 'saved twice; customer_id = customers.id';
  });

  await check('Checkout save (customer_id = user id) succeeds and stores customers.id', async () => {
    const cols = { id: U.SAVER, customer_id: U.SAVER, email: 'profile.saver@example.test', full_name: 'Shipping Name', phone: '+910000000077' };
    await as('authenticated', U.SAVER, () => q(upsertProfile(cols), Object.values(cols)));
    const p = (await q(`SELECT customer_id, full_name, phone FROM public.profiles WHERE id = $1`, [U.SAVER])).rows[0];
    assert(p.customer_id === await custOf(U.SAVER) && p.full_name === 'Shipping Name', json(p));
    return 'saved; customer_id = customers.id';
  });

  await check('Checkout save for an account with no profile and no customers row creates both, once', async () => {
    const cols = { id: U.NOPROF, customer_id: U.NOPROF, email: 'noprof@example.test', full_name: 'No Profile', phone: '+910000000008' };
    await as('authenticated', U.NOPROF, () => q(upsertProfile(cols), Object.values(cols)));
    const p = (await q(`SELECT customer_id FROM public.profiles WHERE id = $1`, [U.NOPROF])).rows;
    assert((await custRows(U.NOPROF)) === 1, 'not exactly one customers row');
    assert(p.length === 1 && p[0].customer_id === await custOf(U.NOPROF), json(p));
    return 'profile inserted; one customers row';
  });

  await check('ordinary profile and Tap edits are untouched by the trigger', async () => {
    const a = await as('authenticated', U.ALICE, () => q(`UPDATE public.profiles SET company = 'Alice Co' WHERE id = $1`, [U.ALICE]));
    const b = await as('authenticated', U.ALICE, () => q(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [U.ALICE]));
    assert(a.affectedRows === 1 && b.affectedRows === 1, `${a.affectedRows}/${b.affectedRows}`);
    return 'profile and Tap updates succeed';
  });

  console.log(`\n=== ${label}: a client cannot choose the customer record (rule B2) ===`);

  const aliceProfile = async () => json((await q(`SELECT * FROM public.profiles WHERE id = $1`, [U.ALICE])).rows[0]);
  const aliceTap = async () => json((await q(`SELECT * FROM public.tap_profiles WHERE user_id = $1`, [U.ALICE])).rows[0]);

  for (const [what, value] of [["another customer's customers.id", () => C.BOB], ['a random id', () => 'dddddddd-0000-4000-8000-000000000000'],
    ["another account's user id", () => U.BOB]]) {
    await check(`profile save with ${what} is refused with 42501`, async () => {
      const before = await aliceProfile();
      const cols = { id: U.ALICE, customer_id: value(), email: 'alice@example.test', full_name: 'Alice' };
      const r = await attempt(() => as('authenticated', U.ALICE, () => q(upsertProfile(cols), Object.values(cols))));
      const msg = refused42501(r);
      assert((await aliceProfile()) === before, 'the profile changed');
      return `${msg}; unchanged`;
    });
  }

  await check("profile UPDATE of customer_id to another customer's id is refused with 42501", async () => {
    const before = await aliceProfile();
    const msg = refused42501(await attempt(() => as('authenticated', U.ALICE, () =>
      q(`UPDATE public.profiles SET customer_id = $1 WHERE id = $2`, [C.BOB, U.ALICE]))));
    assert((await aliceProfile()) === before, 'the profile changed');
    return `${msg}; unchanged`;
  });

  await check("Tap UPDATE of customer_id to another customer's id is refused with 42501", async () => {
    const before = await aliceTap();
    const msg = refused42501(await attempt(() => as('authenticated', U.ALICE, () =>
      q(`UPDATE public.tap_profiles SET customer_id = $1 WHERE user_id = $2`, [C.BOB, U.ALICE]))));
    assert((await aliceTap()) === before, 'the Tap changed');
    return `${msg}; unchanged`;
  });

  await check("Tap INSERT with another customer's id is refused with 42501", async () => {
    const msg = refused42501(await attempt(() => as('authenticated', U.SAVER, () =>
      q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username) VALUES ($1, $2, 'saver-tap', 'saver-tap')`, [U.SAVER, C.BOB]))));
    assert((await taps(U.SAVER)).length === 0, 'a Tap was created');
    return msg;
  });

  await check('a client may re-send its own customers.id (no change)', async () => {
    const r = await as('authenticated', U.ALICE, () =>
      q(`UPDATE public.profiles SET customer_id = $1 WHERE id = $2`, [C.ALICE, U.ALICE]));
    assert(r.affectedRows === 1, `${r.affectedRows} rows`);
    return 'accepted';
  });

  await check("a client cannot write customer_id on another account's row, and creates no customers row for it", async () => {
    const msg = refused42501(await attempt(() => as('authenticated', U.ALICE, () =>
      q(`INSERT INTO public.profiles (id, customer_id, email) VALUES ($1, $1, 'victim@example.test')`, [U.VICTIM]))));
    assert((await custRows(U.VICTIM)) === 0, 'a customers row was created for the victim');
    assert((await q(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [U.VICTIM])).rows[0].n === 0, 'a profile was created');
    return `${msg}; victim untouched`;
  });

  await check('an anonymous request cannot write customer_id', async () => {
    const msg = refused42501(await attempt(() => as('anon', null, () =>
      q(`INSERT INTO public.profiles (id, customer_id) VALUES ($1, $1)`, [U.VICTIM]))));
    assert((await custRows(U.VICTIM)) === 0, 'a customers row was created');
    return msg;
  });

  console.log(`\n=== ${label}: server writes (scope §2 point 4) ===`);

  await check('a server write of the user id is mapped; any other value is left alone (the FK decides)', async () => {
    const saverC = await custOf(U.SAVER);
    // profiles.customer_id is UNIQUE on live: use a customers row no profile holds
    // (the legacy account whose row the claim above created).
    const otherC = await custOf(U.NOCUST);
    await service(() => q(`UPDATE public.profiles SET customer_id = $1 WHERE id = $1`, [U.SAVER]));
    assert((await q(`SELECT customer_id FROM public.profiles WHERE id = $1`, [U.SAVER])).rows[0].customer_id === saverC, 'not mapped');
    await service(() => q(`UPDATE public.profiles SET customer_id = $1 WHERE id = $2`, [otherC, U.SAVER]));
    assert((await q(`SELECT customer_id FROM public.profiles WHERE id = $1`, [U.SAVER])).rows[0].customer_id === otherC, 'not left alone');
    await service(() => q(`UPDATE public.profiles SET customer_id = $1 WHERE id = $2`, [saverC, U.SAVER])); // restore
    const fk = await attempt(() => service(() =>
      q(`UPDATE public.profiles SET customer_id = 'dddddddd-0000-4000-8000-000000000000' WHERE id = $1`, [U.SAVER])));
    assert(fk.err?.code === '23503', `unknown id: expected 23503, got ${fk.err ? fk.err.code : 'success'}`);
    return 'user id → customers.id; another valid id kept; unknown id → 23503 (FK)';
  });

  await check('NULL is left to NOT NULL, and a Tap without user_id is left alone', async () => {
    const n = await attempt(() => service(() => q(`UPDATE public.profiles SET customer_id = NULL WHERE id = $1`, [U.SAVER])));
    assert(n.err?.code === '23502', `expected 23502, got ${n.err ? n.err.code : 'success'}`);
    const c = await custOf(U.SIGNUP);
    await service(() => q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username) VALUES (NULL, $1, 'orphan-tap', 'orphan-tap')`, [c]));
    const t = (await q(`SELECT customer_id FROM public.tap_profiles WHERE slug = 'orphan-tap'`)).rows[0];
    assert(t.customer_id === c, json(t));
    return 'NULL → 23502; user_id NULL row stored as given';
  });

  console.log(`\n=== ${label}: customer_id_for() and the collision fallback (O-13, owner decision 2026-10-05) ===`);

  await check('the helpers are not executable by anon, authenticated or PUBLIC', async () => {
    const r = (await q(`
      SELECT f, has_function_privilege('anon', f, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', f, 'EXECUTE') AS auth,
                has_function_privilege('service_role', f, 'EXECUTE') AS svc,
                COALESCE((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE'), true) AS public_grant
        FROM unnest(ARRAY['public.customer_id_for(uuid)', 'public.resolve_customer_id()']) AS f
        JOIN pg_proc p ON p.oid = f::regprocedure`)).rows;
    for (const x of r) assert(!x.anon && !x.auth && !x.public_grant && x.svc, json(x));
    const call = await attempt(() => as('authenticated', U.ALICE, () => q(`SELECT public.customer_id_for($1)`, [U.ALICE])));
    assert(call.err?.code === '42501', `authenticated call: ${call.err ? call.err.code : 'success'}`);
    const trig = await attempt(() => q(`SELECT public.resolve_customer_id()`));
    assert(trig.err, 'the trigger function could be called directly');
    return 'EXECUTE: service_role only; a client call is refused';
  });

  await check('customer_id_for returns the existing row, and creates nothing for NULL or an unknown account', async () => {
    const total = async () => (await q(`SELECT count(*)::int AS n FROM public.customers`)).rows[0].n;
    const before = await total();
    const r = (await q(`SELECT public.customer_id_for($1) AS a, public.customer_id_for($1) AS b,
                               public.customer_id_for(NULL) AS n, public.customer_id_for('eeeeeeee-0000-4000-8000-000000000000') AS x`, [U.BOB])).rows[0];
    assert(r.a === C.BOB && r.b === C.BOB && r.n === null && r.x === null, json(r));
    assert((await total()) === before, 'a customers row was created');
    return 'existing id returned twice; NULL and unknown → NULL; no rows';
  });

  // Every code customer_id_for may try for an account, in order.
  const candidates = (u) => [
    ...Array.from({ length: 23 }, (_, i) => `CUST-${hex(u).slice(0, 10 + i)}`),
    ...Array.from({ length: 999 }, (_, i) => `CUST-${hex(u)}-${i + 2}`),
  ];
  const holdersOf = async (codes) => json((await q(
    `SELECT * FROM public.customers WHERE customer_id = ANY($1::text[]) ORDER BY customer_id`, [codes])).rows);
  const codeOf = async (u) => (await q(`SELECT id, customer_id FROM public.customers WHERE user_id = $1`, [u])).rows;

  await check('collision: 10 digits taken → 11 digits, the shortest free code; the holder is untouched', async () => {
    const taken = candidates(U.COLL_B).slice(0, 1);
    const before = await holdersOf(taken);
    assert(JSON.parse(before).length === 1, 'fixture: the 10-digit code is not taken');
    const id = (await q(`SELECT public.customer_id_for($1) AS id`, [U.COLL_B])).rows[0].id;
    const c = await codeOf(U.COLL_B);
    assert(c.length === 1 && c[0].id === id && c[0].customer_id === candidates(U.COLL_B)[1], json(c));
    assert((await holdersOf(taken)) === before, 'the existing customer changed');
    return `${c[0].customer_id}; holder of ${taken[0]} unchanged`;
  });

  await check('collision: 10 and 11 digits taken → 12 digits', async () => {
    const id = (await q(`SELECT public.customer_id_for($1) AS id`, [U.COLL_D])).rows[0].id;
    const c = await codeOf(U.COLL_D);
    assert(c.length === 1 && c[0].id === id && c[0].customer_id === candidates(U.COLL_D)[2], json(c));
    return c[0].customer_id;
  });

  await check('collision: every length up to 32 digits and -2 taken → the full id with -3; nothing overwritten', async () => {
    const all = candidates(U.COLL_E);
    await holdCodes([...all.slice(3, 23), all[23]]); // 13–32 digits and -2 (10–12 are A, B, D)
    const taken = all.slice(0, 24);
    const before = await holdersOf(taken);
    assert(JSON.parse(before).length === 24, `fixture: ${JSON.parse(before).length} of 24 codes taken`);
    // Through the trigger this time, as a browser profile save would reach it.
    const cols = { id: U.COLL_E, customer_id: U.COLL_E, email: 'coll.e@example.test' };
    await as('authenticated', U.COLL_E, () => q(upsertProfile(cols), Object.values(cols)));
    const c = await codeOf(U.COLL_E);
    assert(c.length === 1 && c[0].customer_id === `CUST-${hex(U.COLL_E)}-3`, json(c));
    assert((await holdersOf(taken)) === before, 'an existing customer changed');
    const p = (await q(`SELECT customer_id FROM public.profiles WHERE id = $1`, [U.COLL_E])).rows[0];
    assert(p.customer_id === c[0].id, json(p));
    return `${c[0].customer_id}; 24 holders unchanged; profile linked`;
  });

  await check('collision: every candidate taken (… -1000) → refused 23505, nothing created or overwritten', async () => {
    const all = candidates(U.COLL_F);
    await holdCodes(all.slice(22)); // the full id and -2 … -1000 (shorter codes are shared and taken)
    const before = await holdersOf(all);
    assert(JSON.parse(before).length === all.length, `fixture: ${JSON.parse(before).length} of ${all.length} codes taken`);
    const r = await attempt(() => q(`SELECT public.customer_id_for($1) AS id`, [U.COLL_F]));
    assert(r.err?.code === '23505' && /No free customer code/.test(r.err.message), `got ${r.err ? `${r.err.code} ${r.err.message}` : 'success'}`);
    assert((await codeOf(U.COLL_F)).length === 0, 'a customers row was created');
    assert((await holdersOf(all)) === before, 'an existing customer changed');
    return `${all.length} candidates tried in order; 23505; 0 rows created`;
  });
}

// --- run ---------------------------------------------------------------------------

for (const times of [1, 2]) {
  const db = await build(times);
  await suite(db, times === 1 ? 'migrations applied once' : 'migrations applied twice');
  await db.close();
}

console.log('\n=== rollback (021 header) ===');

await check('the ROLLBACK block restores the live baseline, and I-1 returns without 021', async () => {
  const file = path.join(DIR, '021_resolve_customer_id.sql');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const block = text.split('-- ROLLBACK (begin)\n')[1]?.split('-- ROLLBACK (end)')[0];
  assert(block, 'no ROLLBACK (begin) … (end) block in 021');
  const sql = block.split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');

  const live = await createLiveDb();
  const db = await build(1);
  await db.exec(sql);
  const body = (d) => d.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.provision_tap_on_payment()'::regprocedure`);
  assert((await body(db)).rows[0].prosrc === (await body(live)).rows[0].prosrc, 'provision_tap_on_payment differs from the baseline');
  const left = (await db.query(`
    SELECT (SELECT count(*)::int FROM pg_proc WHERE proname IN ('customer_id_for', 'resolve_customer_id')) AS functions,
           (SELECT count(*)::int FROM pg_trigger WHERE tgname LIKE '%customer_id%') AS triggers`)).rows[0];
  assert(left.functions === 0 && left.triggers === 0, json(left));

  // Without 021 the defect is back: a first-time buyer's claim fails again.
  const u = 'b1000000-0000-4000-8000-000000000001';
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'rollback.check@example.test')`, [u]);
  const id = (await db.query(ORDER, ['ST-RB-1', u, 'pending', 'order_rb_1', 'pending'])).rows[0].id;
  let err = null;
  try { await db.query(CLAIM, [id]); } catch (e) { err = e; }
  assert(err?.code === '23503', `expected I-1 (23503) after rollback, got ${err ? err.code : 'success'}`);

  // And 021 applies again cleanly.
  await db.exec(fs.readFileSync(file, 'utf8'));
  await live.close();
  await db.close();
  return 'baseline body restored; helpers and triggers gone; I-1 reproduces; 021 re-applies';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
