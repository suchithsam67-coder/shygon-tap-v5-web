import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Exercises the rules the migrations are supposed to enforce, against a real
 * Postgres. Everything here is a behaviour a customer or an attacker could
 * actually attempt.
 */

// fileURLToPath, not `.pathname` — the latter leaves %20 in place, and this
// project lives under a directory with a space in its name.
const DIR = process.argv[2] ?? fileURLToPath(new URL('../migrations', import.meta.url));
const db = await PGlite.create();

const BASELINE = fs.readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8');
await db.exec(BASELINE);
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(DIR, f), 'utf8'));
}

let pass = 0;
let fail = 0;
const q = (sql, params) => db.query(sql, params);

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Runs `fn` as a signed-in customer, the way PostgREST sets the claim. */
async function asUser(uid, fn) {
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return await fn();
  } finally {
    await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

/** Expects the statement to be refused. Returns the error message. */
async function refused(sql, params) {
  try {
    await q(sql, params);
  } catch (e) {
    return e.message;
  }
  throw new Error('expected a refusal, but the statement succeeded');
}

// --- a customer with a paid card order --------------------------------------
const { rows: [user] } = await q(
  `INSERT INTO auth.users (email, raw_user_meta_data)
   VALUES ('rider@example.com', '{"full_name":"Test Rider"}'::jsonb) RETURNING id`,
);
const uid = user.id;

const { rows: [order] } = await q(
  `INSERT INTO public.orders (order_id, user_id, customer_id, amount_in_paise, payment_status, order_type)
   VALUES ('ST-TEST-1', $1, $1, 39900, 'pending', 'physical') RETURNING id`,
  [uid],
);

console.log('\n=== catalog ===');

await check('four experiences + the Pass are the active digital SKUs', async () => {
  const { rows } = await q(
    `SELECT sku, ui_tier FROM public.products
     WHERE product_type IN ('digital_plan','lifetime_plan') AND active
     ORDER BY sort_order`,
  );
  const skus = rows.map((r) => r.sku);
  assert(
    JSON.stringify(skus) ===
      JSON.stringify([
        'plan-essential',
        'plan-business',
        'plan-premium',
        'plan-goat',
        'pass-customization',
      ]),
    'got ' + skus.join(', '),
  );
  return skus.join(', ');
});

await check('retired SKUs are delisted, not deleted', async () => {
  const { rows } = await q(
    `SELECT sku, active FROM public.products
     WHERE sku IN ('plan-pro','plan-3d','plan-custom','plan-lifetime') ORDER BY sku`,
  );
  assert(rows.length === 4, `expected 4 retired rows, got ${rows.length}`);
  assert(rows.every((r) => r.active === false), 'some retired SKU is still active');
  return rows.map((r) => r.sku).join(', ') + ' all inactive';
});

await check('experience ranks are essential<business<premium<goat', async () => {
  const { rows: [r] } = await q(
    `SELECT public.tier_rank('essential') e, public.tier_rank('business') b,
            public.tier_rank('premium') p, public.tier_rank('goat') g,
            public.tier_rank('pro') legacy_pro, public.tier_rank('3d') legacy_3d`,
  );
  assert(r.e === 0 && r.b === 1 && r.p === 2 && r.g === 3, JSON.stringify(r));
  // The bug this whole rename existed to kill: legacy `pro` meant BUSINESS.
  assert(r.legacy_pro === 1, `legacy 'pro' must rank as business, got ${r.legacy_pro}`);
  assert(r.legacy_3d === 3, `legacy '3d' must rank as goat, got ${r.legacy_3d}`);
  return "legacy 'pro'→business, '3d'→goat";
});

console.log('\n=== payment & provisioning ===');

await check('a customer cannot mark their own order paid', async () => {
  const msg = await asUser(uid, () =>
    refused(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [order.id]),
  );
  return msg.slice(0, 60);
});

// Since 019 a page is published the moment it is created ("automatic
// deployment"); before that it was provisioned as a draft.
await check('paying the order provisions a live Tap', async () => {
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [order.id]);
  const { rows } = await q(
    `SELECT slug, status, published, selected_ui_tier FROM public.tap_profiles WHERE user_id = $1`,
    [uid],
  );
  assert(rows.length === 1, 'no Tap provisioned');
  assert(rows[0].status === 'active', `status was ${rows[0].status}`);
  assert(rows[0].published === true, 'a new Tap must be published');
  assert(rows[0].slug, 'a new Tap must have an address');
  assert(rows[0].selected_ui_tier === 'essential', `tier was ${rows[0].selected_ui_tier}`);
  return `slug=${rows[0].slug}, status=active, essential`;
});

await check('order + payment notifications were raised', async () => {
  const { rows } = await q(
    `SELECT category, title FROM public.notifications WHERE user_id = $1 ORDER BY created_at`,
    [uid],
  );
  const titles = rows.map((r) => r.title);
  assert(titles.includes('Order placed'), 'missing order notification');
  assert(titles.includes('Payment confirmed'), 'missing payment notification');
  return titles.join(' / ');
});

await check('the account event log recorded it', async () => {
  const { rows } = await q(
    `SELECT event_type FROM public.account_events WHERE user_id = $1 ORDER BY created_at`,
    [uid],
  );
  const types = rows.map((r) => r.event_type);
  assert(types.includes('order.placed'), 'missing order.placed');
  assert(types.includes('payment.paid'), 'missing payment.paid');
  assert(types.includes('tap.created'), 'missing tap.created');
  return types.join(', ');
});

console.log('\n=== entitlement enforcement ===');

await check('cannot select an experience that was never bought', async () => {
  const msg = await asUser(uid, () =>
    refused(`UPDATE public.tap_profiles SET selected_ui_tier = 'goat' WHERE user_id = $1`, [uid]),
  );
  assert(/have not purchased/i.test(msg), msg);
  return msg.slice(0, 55);
});

await check('cannot select a locked colour palette', async () => {
  const msg = await asUser(uid, () =>
    refused(`UPDATE public.tap_profiles SET theme_palette = 'neon' WHERE user_id = $1`, [uid]),
  );
  assert(/palette is not unlocked/i.test(msg), msg);
  return msg.slice(0, 55);
});

await check('Essential unlocks exactly 4 palettes; the Pass unlocks 12', async () => {
  const { rows: [r] } = await q(
    `SELECT array_length(public.theme_options('palette','essential',false),1) free,
            array_length(public.theme_options('palette','essential',true),1) with_pass,
            array_length(public.theme_options('palette','goat',false),1) goat`,
  );
  assert(r.free === 4, `essential had ${r.free}`);
  assert(r.with_pass === 12, `with pass had ${r.with_pass}`);
  assert(r.goat === 12, `goat had ${r.goat}`);
  return `essential=4, +pass=12, goat=12`;
});

// 024: WhatsApp is included in Essential; Instagram starts at Business.
await check('cannot enable a button above the page tier that was never bought', async () => {
  const msg = await asUser(uid, () =>
    refused(
      `UPDATE public.tap_profiles SET enabled_customizations = ARRAY['phone','instagram'] WHERE user_id = $1`,
      [uid],
    ),
  );
  assert(/add-on has not been purchased/i.test(msg), msg);
  return msg.slice(0, 55);
});

console.log('\n=== the 14-day editing rule ===');

await check('the first content edit is allowed', async () => {
  await asUser(uid, () =>
    q(`UPDATE public.tap_profiles SET bio = 'First bio' WHERE user_id = $1`, [uid]),
  );
  const { rows } = await q(
    `SELECT last_content_edit_at FROM public.tap_profiles WHERE user_id = $1`,
    [uid],
  );
  assert(rows[0].last_content_edit_at !== null, 'last_content_edit_at was not stamped');
  return 'stamped by the database';
});

await check('a second content edit inside 14 days is refused', async () => {
  const msg = await asUser(uid, () =>
    refused(`UPDATE public.tap_profiles SET bio = 'Second bio' WHERE user_id = $1`, [uid]),
  );
  assert(/once every 14 days/i.test(msg), msg);
  return msg.slice(0, 60);
});

await check('publishing is NOT rationed by the edit rule', async () => {
  await q(`UPDATE public.tap_profiles SET slug = 'test-rider' WHERE user_id = $1`, [uid]);
  await asUser(uid, () =>
    q(`UPDATE public.tap_profiles SET status = 'active' WHERE user_id = $1`, [uid]),
  );
  const { rows } = await q(
    `SELECT status, published FROM public.tap_profiles WHERE user_id = $1`,
    [uid],
  );
  assert(rows[0].status === 'active' && rows[0].published === true, JSON.stringify(rows[0]));
  return 'status=active, published=true (kept in step)';
});

await check('the Pass lifts the limit immediately', async () => {
  await q(
    `INSERT INTO public.entitlements (user_id, type, key, is_active) VALUES ($1,'lifetime','lifetime',true)`,
    [uid],
  );
  await asUser(uid, () =>
    q(`UPDATE public.tap_profiles SET bio = 'Third bio, with the Pass' WHERE user_id = $1`, [uid]),
  );
  const { rows } = await q(`SELECT bio FROM public.tap_profiles WHERE user_id = $1`, [uid]);
  assert(rows[0].bio === 'Third bio, with the Pass', 'edit did not land');
  return 'edit accepted';
});

await check('the Pass does NOT grant any experience', async () => {
  const { rows: [r] } = await q(`SELECT public.user_max_ui_tier($1) tier`, [uid]);
  assert(r.tier === 'essential', `Pass leaked an experience: ${r.tier}`);
  const { rows: [p] } = await q(`SELECT public.user_has_pass($1) has`, [uid]);
  assert(p.has === true, 'pass not detected');
  return 'has_pass=true but max experience still essential';
});

await check('the Pass unlocks every palette', async () => {
  await asUser(uid, () =>
    q(`UPDATE public.tap_profiles SET theme_palette = 'neon' WHERE user_id = $1`, [uid]),
  );
  const { rows } = await q(`SELECT theme_palette FROM public.tap_profiles WHERE user_id = $1`, [uid]);
  assert(rows[0].theme_palette === 'neon', 'palette did not change');
  return "'neon' accepted on Essential + Pass";
});

console.log('\n=== the public read path ===');

/*
 * Seasonal themes are switched off for the entitlement check below.
 *
 * Migration 005 seeds real festival dates, and a live one legitimately
 * overrides the customer's chosen palette — so this assertion used to pass or
 * fail depending on the day it was run. It failed on 15 Sep 2026 because
 * Ganesh Chaturthi (14–25 Sep, 'molten') was live, which was the feature
 * working, not a regression.
 *
 * What this check is about is entitlement clamping, so the seasonal layer is
 * removed from the picture and tested on its own immediately afterwards.
 */
await q(`UPDATE public.tap_event_themes SET active = false`);

await check('an active Tap resolves, clamped to what was bought', async () => {
  const { rows: [r] } = await q(`SELECT public.get_public_profile('test-rider') p`);
  assert(r.p, 'no profile returned');
  assert(r.p.experience === 'essential', `experience was ${r.p.experience}`);
  assert(r.p.theme.palette === 'neon', `palette was ${r.p.theme.palette}`);
  assert(r.p.whatsapp === null, 'an unpurchased add-on leaked');
  return `experience=essential, palette=neon, whatsapp withheld`;
});

await check('a live seasonal theme overrides the chosen palette', async () => {
  // Dated from CURRENT_DATE so it is live whenever this suite runs.
  await q(`
    INSERT INTO public.tap_event_themes
      (code, name, starts_on, ends_on, palette, layout, buttons, font, animation, priority, active)
    VALUES ('suite-probe', 'Suite Probe', CURRENT_DATE - 1, CURRENT_DATE + 1,
            'abyss', 'immersive', 'glow', 'display', 'dynamic', 999, true)
    ON CONFLICT (code) DO UPDATE
      SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on,
          palette = EXCLUDED.palette, priority = EXCLUDED.priority, active = true
  `);
  const { rows: [r] } = await q(`SELECT public.get_public_profile('test-rider') p`);
  assert(r.p.theme.palette === 'abyss', `expected the event palette, got ${r.p.theme.palette}`);
  return "'neon' chosen, 'abyss' served while the event runs";
});

await check('the chosen palette returns once the event ends', async () => {
  await q(`UPDATE public.tap_event_themes SET active = false WHERE code = 'suite-probe'`);
  const { rows: [r] } = await q(`SELECT public.get_public_profile('test-rider') p`);
  assert(r.p.theme.palette === 'neon', `palette stayed ${r.p.theme.palette}`);
  return 'back to neon';
});

await check('a paused Tap reports paused, not missing', async () => {
  await q(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [uid]);
  const { rows: [s] } = await q(`SELECT public.get_public_tap_state('test-rider') s`);
  assert(s.s === 'paused', `state was ${s.s}`);
  const { rows: [p] } = await q(`SELECT public.get_public_profile('test-rider') p`);
  assert(p.p === null, 'a paused Tap still served its content');
  return 'state=paused, content withheld';
});

await check('a draft Tap is unavailable, and says nothing more', async () => {
  await q(`UPDATE public.tap_profiles SET status = 'draft' WHERE user_id = $1`, [uid]);
  const { rows: [s] } = await q(`SELECT public.get_public_tap_state('test-rider') s`);
  assert(s.s === 'unavailable', `state was ${s.s}`);
  return 'state=unavailable';
});

await check('an unknown slug is unavailable', async () => {
  const { rows: [s] } = await q(`SELECT public.get_public_tap_state('nobody-here') s`);
  assert(s.s === 'unavailable', `state was ${s.s}`);
  return 'state=unavailable';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
