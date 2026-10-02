import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Behaviour checks for migrations 022–024: one page per card, permanent Card
 * IDs, card management, the public card path, per-card analytics, promo codes
 * and the email outbox. Same harness as verify.mjs — a real Postgres (PGlite)
 * with every migration applied — and every check is something a customer, a
 * visitor or a replayed webhook could actually do.
 *
 * PGlite runs as a superuser, so row-level security is not in play here; the
 * RLS side is covered against a live project by rls-adversarial.mjs.
 */

const DIR = process.argv[2] ?? fileURLToPath(new URL('../migrations', import.meta.url));
const db = await PGlite.create();
await db.exec(fs.readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8'));
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(DIR, f), 'utf8'));
}
// Festival themes are irrelevant here and date-dependent; switch them off.
await db.exec(`UPDATE public.tap_event_themes SET active = false`);

let pass = 0;
let fail = 0;
const q = (sql, params) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

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

async function asUser(uid, fn) {
  await q(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  try {
    return await fn();
  } finally {
    await q(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

async function refused(sql, params) {
  try {
    await q(sql, params);
  } catch (e) {
    return e.message;
  }
  throw new Error('expected a refusal, but the statement succeeded');
}

async function newCustomer(email, name) {
  const { id } = await one(
    `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, jsonb_build_object('full_name', $2::text)) RETURNING id`,
    [email, name],
  );
  return id;
}

let orderSeq = 0;
/** What create-order + fulfilment do for one card, as the service role. */
async function buyCard(uid, sku = 'card-business-standard-pvc', extra = {}) {
  orderSeq++;
  const order = await one(
    `INSERT INTO public.orders (order_id, user_id, customer_id, amount_in_paise, payment_status, order_type, replaces_card_id)
     VALUES ($1, $2, $2, 39900, 'pending', 'physical', $3) RETURNING id`,
    [`ST-CARD-${orderSeq}`, uid, extra.replaces ?? null],
  );
  await q(
    `INSERT INTO public.order_items (order_id, sku, name, product_type, unit_price_in_paise, quantity, line_total_in_paise)
     VALUES ($1, $2, 'Card', 'card', 39900, 1, 39900)`,
    [order.id, sku],
  );
  await q(`UPDATE public.orders SET payment_status = 'paid', order_status = 'processing' WHERE id = $1`, [order.id]);
  const card = await one(
    `INSERT INTO public.cards (user_id, order_id, sku, status, replaces_card_id)
     VALUES ($1, $2, $3, 'pending', $4) RETURNING id, card_code`,
    [uid, order.id, sku, extra.replaces ?? null],
  );
  return { orderId: order.id, ...card };
}

const cardRow = (id) => one(`SELECT * FROM public.cards WHERE id = $1`, [id]);
/** What the customer does in the editor to make a draft page public (owner decision D-U4). */
const publish = (uid, pageId) =>
  asUser(uid, () => q(`UPDATE public.tap_profiles SET status = 'active', published = true, published_at = NOW() WHERE id = $1`, [pageId]));
const pagesOf = async (uid) =>
  (await q(`SELECT id, slug, status, published FROM public.tap_profiles WHERE user_id = $1 ORDER BY created_at, id`, [uid])).rows;

const alice = await newCustomer('alice@example.com', 'Alice Rao');
const bob = await newCustomer('bob@example.com', 'Bob Iyer');

console.log('\n=== one page per card ===');

let first;
let second;

await check('the first card gets a Card ID and opens the page its order provisioned', async () => {
  first = await buyCard(alice);
  const card = await cardRow(first.id);
  const pages = await pagesOf(alice);
  assert(/^[0-9A-Z]{8}$/.test(card.card_code), `card code was ${card.card_code}`);
  assert(!/[01IO]/.test(card.card_code), 'the code uses a look-alike character');
  assert(pages.length === 1, `expected 1 page, got ${pages.length}`);
  assert(card.tap_profile_id === pages[0].id, 'card not linked to the page');
  // D-U4 / O-12: a page is never public until the customer publishes it.
  assert(pages[0].status === 'draft' && pages[0].published === false, `page was ${pages[0].status}`);
  return `card ${card.card_code} → /t/${pages[0].slug} (draft)`;
});

await check('a second card gets its own, separately addressed, draft page', async () => {
  second = await buyCard(alice, 'card-rose-marble-premium-metal');
  const card = await cardRow(second.id);
  const pages = await pagesOf(alice);
  assert(pages.length === 2, `expected 2 pages, got ${pages.length}`);
  assert(card.tap_profile_id === pages[1].id, 'second card not on the new page');
  assert(pages[0].slug !== pages[1].slug, 'two pages share an address');
  assert(pages[1].status === 'draft' && pages[1].published === false, 'second page must start as a draft');
  return `${pages[0].slug}, ${pages[1].slug}`;
});

await check('a replayed card insert is refused and creates no page', async () => {
  const before = (await pagesOf(alice)).length;
  await refused(
    `INSERT INTO public.cards (user_id, order_id, sku, status) VALUES ($1, $2, 'card-rose-marble-premium-metal', 'pending')`,
    [alice, second.orderId],
  );
  const after = (await pagesOf(alice)).length;
  assert(before === after, `pages went from ${before} to ${after}`);
  return 'unique (order, sku) holds; still 2 pages';
});

await check('the page-created notification names the new address', async () => {
  const { rows } = await q(
    `SELECT title FROM public.notifications WHERE user_id = $1 AND title = 'Your new Tap page is ready'`,
    [alice],
  );
  assert(rows.length === 2, `expected 2, got ${rows.length}`);
  return '2 notifications';
});

console.log('\n=== the card link (/c/<Card ID>) ===');

await check('a new page opens in the experience bought with its card', async () => {
  const erin = await newCustomer('erin@example.com', 'Himavant Rao');
  const o1 = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_type, plan_id)
     VALUES ('ST-PLAN-1', $1, 39900, 'pending', 'physical', 'essential') RETURNING id`, [erin]);
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o1.id]);
  await q(`INSERT INTO public.cards (user_id, order_id, sku, status) VALUES ($1, $2, 'card-business-standard-pvc', 'pending')`, [erin, o1.id]);
  const o2 = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_type, plan_id)
     VALUES ('ST-PLAN-2', $1, 69800, 'pending', 'physical', 'business') RETURNING id`, [erin]);
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o2.id]);
  await q(`INSERT INTO public.cards (user_id, order_id, sku, status) VALUES ($1, $2, 'card-event-standard-pvc', 'pending')`, [erin, o2.id]);
  const pages = (await q(`SELECT slug, selected_ui_tier FROM public.tap_profiles WHERE user_id = $1 ORDER BY created_at, id`, [erin])).rows;
  assert(pages.length === 2, `pages=${pages.length}`);
  assert(pages[0].selected_ui_tier === 'essential' && pages[1].selected_ui_tier === 'business', JSON.stringify(pages));
  assert(pages[0].slug === 'himavant-rao', `slug was ${pages[0].slug}`);
  return `/shygontap/${pages[0].slug} essential, /shygontap/${pages[1].slug} business`;
});

await check('a paid digital upgrade raises every page, never lowers one (live behaviour kept)', async () => {
  const erin = (await one(`SELECT id FROM auth.users WHERE email = 'erin@example.com'`)).id;
  const o = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_type, plan_id)
     VALUES ('ST-UPG-1', $1, 99900, 'pending', 'digitalUpgrade', 'premium') RETURNING id`, [erin]);
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o.id]);
  const tiers = (await q(`SELECT selected_ui_tier t FROM public.tap_profiles WHERE user_id = $1 ORDER BY created_at, id`, [erin])).rows.map((r) => r.t);
  assert(tiers.length === 2 && tiers.every((t) => t === 'premium'), tiers.join());
  const o2 = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_type, plan_id)
     VALUES ('ST-UPG-2', $1, 69900, 'pending', 'digitalUpgrade', 'business') RETURNING id`, [erin]);
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o2.id]);
  const after = (await q(`SELECT selected_ui_tier t FROM public.tap_profiles WHERE user_id = $1`, [erin])).rows.map((r) => r.t);
  assert(after.every((t) => t === 'premium'), `lowered: ${after.join()}`);
  return 'premium on both pages; a later business order lowers nothing';
});

await check('a card that was never activated says so', async () => {
  const { r } = await one(`SELECT public.get_public_card($1) r`, [first.card_code]);
  assert(r.state === 'not_activated', JSON.stringify(r));
  return 'state=not_activated';
});

await check('an activated card on a draft page opens nothing until the page is published', async () => {
  await q(`SELECT * FROM public.card_apply_verified_action($1, $2, 'activate')`, [alice, second.id]);
  const { r } = await one(`SELECT public.get_public_card($1) r`, [second.card_code]);
  assert(r.state === 'unavailable' && !r.slug, JSON.stringify(r));
  return 'state=unavailable, no address given out';
});

await check('an activated card resolves to its page with its design', async () => {
  const pages = await pagesOf(alice);
  await publish(alice, pages[1].id);
  const { r } = await one(`SELECT public.get_public_card(lower($1)) r`, [second.card_code]);
  assert(r.state === 'active', JSON.stringify(r));
  assert(r.slug === pages[1].slug, `slug was ${r.slug}`);
  assert(r.design === 'rose-marble' && r.finish === 'premium' && r.material === 'metal', JSON.stringify(r));
  return `rose-marble · premium · metal → ${r.slug}`;
});

await check('an unknown card code is simply unavailable', async () => {
  const { r } = await one(`SELECT public.get_public_card('ZZZZZZZZ') r`);
  assert(r.state === 'unavailable', JSON.stringify(r));
  return 'state=unavailable';
});

await check('taps are counted per card, and a quick repeat is not', async () => {
  await q(`SELECT public.record_card_tap($1, 'nfc')`, [second.card_code]);
  await q(`SELECT public.record_card_tap($1, 'nfc')`, [second.card_code]);
  await q(`SELECT public.record_card_tap($1, 'view')`, [second.card_code]);
  await q(`SELECT public.record_card_tap($1, 'link_click', 'phone')`, [second.card_code]);
  const card = await cardRow(second.id);
  assert(Number(card.tap_count) === 1, `tap_count was ${card.tap_count}`);
  assert(card.last_tapped_at, 'last_tapped_at not stamped');
  const { n } = await one(`SELECT count(*)::int n FROM public.tap_events WHERE card_id = $1`, [second.id]);
  assert(n === 3, `expected 3 events, got ${n}`);
  return 'tap_count=1, 3 events (nfc, view, click)';
});

await check('analytics report totals, devices, cards and the last tap', async () => {
  const { a } = await asUser(alice, () => one(`SELECT public.get_page_analytics(30) a`));
  assert(Number(a.totals.taps) === 1 && Number(a.totals.views) === 1 && Number(a.totals.clicks) === 1, JSON.stringify(a.totals));
  assert(a.devices.length >= 1, 'no device breakdown');
  assert(a.cards.length === 2, `expected 2 cards, got ${a.cards.length}`);
  assert(a.lastTap && a.lastTap.cardCode === second.card_code, JSON.stringify(a.lastTap));
  assert(a.daily.length === 1 && a.weekly.length === 1 && a.monthly.length === 1, 'series missing');
  const { a: filtered } = await asUser(alice, () =>
    one(`SELECT public.get_page_analytics(30, NULL, $1) a`, [first.id]),
  );
  assert(Number(filtered.totals.taps) === 0, 'card filter leaked another card’s taps');
  return `taps=1 views=1 clicks=1, devices=${a.devices.map((d) => d.device).join('/')}`;
});

await check('tap history lists events without any visitor identity', async () => {
  const { rows } = await asUser(alice, () => q(`SELECT * FROM public.get_tap_history(NULL, NULL, 10)`));
  assert(rows.length === 3, `expected 3, got ${rows.length}`);
  assert(!('visitor_hash' in rows[0]), 'visitor digest leaked');
  assert(rows[0].card_code === second.card_code, 'card not attributed');
  return `${rows.length} events, newest ${rows[0].event_type}`;
});

await check("another customer's analytics are empty", async () => {
  const { a } = await asUser(bob, () => one(`SELECT public.get_page_analytics(30) a`));
  assert(Number(a.totals.taps) === 0 && a.cards.length === 0, JSON.stringify(a.totals));
  return 'nothing visible';
});

console.log('\n=== card management ===');

await check('a customer can name their card', async () => {
  await asUser(alice, () => q(`SELECT public.customer_set_card_nickname($1, '  Front desk  ')`, [second.id]));
  const card = await cardRow(second.id);
  assert(card.nickname === 'Front desk', `nickname was ${card.nickname}`);
  return 'Front desk';
});

await check("nobody can name someone else's card", async () => {
  const msg = await asUser(bob, () =>
    refused(`SELECT public.customer_set_card_nickname($1, 'mine now')`, [second.id]),
  );
  return msg;
});

await check('reporting a card lost switches it off at once', async () => {
  await asUser(alice, () => q(`SELECT public.customer_report_card_lost($1)`, [second.id]));
  const card = await cardRow(second.id);
  const { r } = await one(`SELECT public.get_public_card($1) r`, [second.card_code]);
  assert(card.status === 'suspended' && card.lost_at, `status=${card.status} lost_at=${card.lost_at}`);
  assert(r.state === 'inactive', JSON.stringify(r));
  await q(`SELECT public.record_card_tap($1, 'nfc')`, [second.card_code]);
  const after = await cardRow(second.id);
  assert(Number(after.tap_count) === 1, 'a lost card still counted a tap');
  return 'suspended + lost_at; link inactive; taps ignored';
});

let replacement;
await check('a replacement opens the same page, with a new Card ID', async () => {
  const pagesBefore = await pagesOf(alice);
  replacement = await buyCard(alice, 'card-rose-marble-premium-metal', { replaces: second.id });
  const card = await cardRow(replacement.id);
  const old = await cardRow(second.id);
  const pagesAfter = await pagesOf(alice);
  assert(card.tap_profile_id === old.tap_profile_id, 'replacement is on a different page');
  assert(card.card_code !== old.card_code, 'replacement reused the lost code');
  assert(card.is_replacement === true, 'not flagged as a replacement');
  assert(old.status === 'replaced', `old card is ${old.status}`);
  assert(pagesAfter.length === pagesBefore.length, 'a replacement created a page');
  return `${old.card_code} → ${card.card_code}, same page`;
});

console.log('\n=== page addresses and the edit rule, per page ===');

await check('each page keeps its own 14-day window', async () => {
  const pages = await pagesOf(alice);
  await asUser(alice, () => q(`UPDATE public.tap_profiles SET bio = 'Page one' WHERE id = $1`, [pages[0].id]));
  // A different page of the same customer is still editable.
  await asUser(alice, () => q(`UPDATE public.tap_profiles SET bio = 'Page two' WHERE id = $1`, [pages[1].id]));
  const msg = await asUser(alice, () =>
    refused(`UPDATE public.tap_profiles SET bio = 'Page one again' WHERE id = $1`, [pages[0].id]),
  );
  assert(/once every 14 days/i.test(msg), msg);
  const { rows } = await asUser(alice, () => q(`SELECT * FROM public.tap_page_edit_state($1)`, [pages[1].id]));
  assert(rows[0].reason === 'cooling_down' && rows[0].can_edit === false, JSON.stringify(rows[0]));
  return 'page 2 editable after page 1; page 1 then refused';
});

await check('a page address can be changed, and the old one keeps working', async () => {
  const pages = await pagesOf(bob);
  // Bob has not bought anything yet: give him a page, never edited.
  const b = await buyCard(bob, 'card-custom-standard-pvc');
  const bobPages = await pagesOf(bob);
  assert(pages.length === 0 && bobPages.length === 1, 'setup');
  const old = bobPages[0].slug;
  await publish(bob, bobPages[0].id);
  const claimed = await asUser(bob, () =>
    one(`SELECT public.claim_tap_slug('bob-builds', $1) s`, [bobPages[0].id]),
  );
  assert(claimed.s === 'bob-builds', `claimed ${claimed.s}`);
  const { s } = await one(`SELECT public.resolve_tap_alias($1) s`, [old]);
  assert(s === 'bob-builds', `alias resolved to ${s}`);
  const card = await cardRow(b.id);
  assert(card.card_code && card.edition_serial === null, 'custom card must not take an edition number');
  return `${old} → bob-builds (alias kept)`;
});

await check("nobody can claim another page's old address", async () => {
  const pages = await pagesOf(alice);
  const bobPages = await pagesOf(bob);
  const oldBob = (await one(`SELECT slug FROM public.tap_slug_aliases WHERE tap_profile_id = $1`, [bobPages[0].id])).slug;
  const msg = await asUser(alice, () =>
    refused(`SELECT public.claim_tap_slug($1, $2)`, [oldBob, pages[1].id]),
  );
  assert(/already taken/i.test(msg), msg);
  return msg;
});

await check('reserved addresses are refused', async () => {
  const pages = await pagesOf(alice);
  const msg = await asUser(alice, () => refused(`SELECT public.claim_tap_slug('billing', $1)`, [pages[1].id]));
  assert(/reserved/i.test(msg), msg);
  return msg;
});

await check("the admin customer view lists every page (it used to error on a second)", async () => {
  const admin = await newCustomer('owner@shygontech.com', 'Owner');
  await q(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, 'owner', true)`, [admin]);
  const { c } = await asUser(admin, () => one(`SELECT public.admin_get_customer($1) c`, [alice]));
  assert(c.taps.length === 2, `taps=${c.taps.length}`);
  assert(c.tap && c.tap.id === c.taps[0].id, 'primary tap missing');
  const { l } = await asUser(admin, () => one(`SELECT public.admin_list_customers('alice') l`));
  assert(l.rows[0].tap_count === 2, JSON.stringify(l.rows[0]));
  return `2 pages, ${c.cards.length} cards`;
});

console.log('\n=== promo codes ===');

await check('DRAGON takes 30% off the cart value', async () => {
  const { r } = await asUser(bob, () => one(`SELECT public.check_promo_code('dragon', 100000, 'physical') r`));
  assert(r.ok === true && r.discountInPaise === 30000 && r.percent === 30, JSON.stringify(r));
  return `₹1,000 → −₹300`;
});

await check('NEWTAP takes 20% off', async () => {
  const { r } = await asUser(bob, () => one(`SELECT public.check_promo_code(' NewTap ', 59900, 'digitalUpgrade') r`));
  assert(r.ok === true && r.discountInPaise === 11980, JSON.stringify(r));
  return `₹599 → −₹119.80`;
});

await check('an unknown code is refused', async () => {
  const { r } = await asUser(bob, () => one(`SELECT public.check_promo_code('FREEBIE', 100000, 'physical') r`));
  assert(r.ok === false && /not valid/.test(r.message), JSON.stringify(r));
  return r.message;
});

await check('expiry, start date, minimum and per-customer limit are enforced', async () => {
  await q(`INSERT INTO public.promo_codes (code, discount_percent, expires_at) VALUES ('OLDCODE', 10, NOW() - interval '1 day')`);
  await q(`INSERT INTO public.promo_codes (code, discount_percent, starts_at) VALUES ('SOON', 10, NOW() + interval '1 day')`);
  await q(`INSERT INTO public.promo_codes (code, discount_percent, min_subtotal_in_paise) VALUES ('BIGCART', 10, 200000)`);
  await q(`INSERT INTO public.promo_codes (code, discount_percent, max_uses_per_customer) VALUES ('ONCE', 50, 1)`);
  const msgs = [];
  for (const code of ['OLDCODE', 'SOON', 'BIGCART']) {
    const { r } = await asUser(bob, () => one(`SELECT public.check_promo_code($1, 100000, 'physical') r`, [code]));
    assert(r.ok === false, `${code} was accepted`);
    msgs.push(r.message);
  }
  // Use ONCE on a paid order, then try again.
  const order = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_type)
     VALUES ('ST-PROMO-1', $1, 50000, 'pending', 'physical') RETURNING id`,
    [bob],
  );
  const { r: reserved } = await one(
    `SELECT public.promo_reserve('ONCE', $1, $2, 100000, 'physical') r`,
    [bob, order.id],
  );
  assert(reserved.ok === true, JSON.stringify(reserved));
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [order.id]);
  const { status } = await one(`SELECT status FROM public.promo_redemptions WHERE order_id = $1`, [order.id]);
  const { times_used } = await one(`SELECT times_used FROM public.promo_codes WHERE code = 'ONCE'`);
  assert(status === 'redeemed' && times_used === 1, `status=${status} used=${times_used}`);
  const { r: again } = await asUser(bob, () => one(`SELECT public.check_promo_code('ONCE', 100000, 'physical') r`));
  assert(again.ok === false && /already used/.test(again.message), JSON.stringify(again));
  return [...msgs, again.message].join(' | ');
});

await check('a total usage limit counts live reservations, not abandoned ones', async () => {
  await q(`INSERT INTO public.promo_codes (code, discount_percent, max_uses) VALUES ('LASTONE', 10, 1)`);
  const o1 = await one(`INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status) VALUES ('ST-L1', $1, 1000, 'pending') RETURNING id`, [alice]);
  const o2 = await one(`INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status) VALUES ('ST-L2', $1, 1000, 'pending') RETURNING id`, [bob]);
  const { r: a } = await one(`SELECT public.promo_reserve('LASTONE', $1, $2, 10000, 'physical') r`, [alice, o1.id]);
  const { r: b } = await one(`SELECT public.promo_reserve('LASTONE', $1, $2, 10000, 'physical') r`, [bob, o2.id]);
  assert(a.ok === true && b.ok === false, `a=${a.ok} b=${b.ok}`);
  // Alice abandons checkout: after 30 minutes her hold lapses.
  await q(`UPDATE public.promo_redemptions SET created_at = NOW() - interval '31 minutes' WHERE order_id = $1`, [o1.id]);
  const { r: c } = await one(`SELECT public.promo_reserve('LASTONE', $1, $2, 10000, 'physical') r`, [bob, o2.id]);
  assert(c.ok === true, JSON.stringify(c));
  return 'second checkout refused while the first holds it; allowed after it lapses';
});

await check('guessing codes is throttled', async () => {
  const guesser = await newCustomer('guess@example.com', 'Guess');
  let last;
  for (let i = 0; i < 16; i++) {
    ({ r: last } = await asUser(guesser, () => one(`SELECT public.check_promo_code($1, 100000) r`, [`GUESS${i}`])));
  }
  assert(/Too many attempts/.test(last.message), last.message);
  return last.message;
});

await check('the delivery charge and the custom card are in the catalogue', async () => {
  const { rows } = await q(
    `SELECT sku, price_in_paise FROM public.products
     WHERE sku IN ('delivery-standard', 'card-custom-premium-metal', 'addon-youtube') ORDER BY sku`,
  );
  const map = Object.fromEntries(rows.map((r) => [r.sku, r.price_in_paise]));
  assert(map['delivery-standard'] === 4900, JSON.stringify(map));
  assert(map['card-custom-premium-metal'] === 79900, JSON.stringify(map));
  assert(map['addon-youtube'] === 9900, JSON.stringify(map));
  return 'delivery ₹49, custom ₹799 (any finish), YouTube ₹99';
});

console.log('\n=== emails ===');

const outbox = async (uid) =>
  (await q(`SELECT template, status FROM public.email_outbox WHERE user_id = $1 ORDER BY created_at, template`, [uid])).rows;

await check('a paid order queues exactly one confirmation, even if replayed', async () => {
  const carol = await newCustomer('carol@gmail.com', 'Carol');
  const o = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status) VALUES ('ST-MAIL-1', $1, 44800, 'pending') RETURNING id`,
    [carol],
  );
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o.id]);
  await q(`UPDATE public.orders SET payment_status = 'paid', updated_at = NOW() WHERE id = $1`, [o.id]);
  await q(`UPDATE public.orders SET payment_status = 'pending' WHERE id = $1`, [o.id]);
  await q(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [o.id]);
  const rows = (await outbox(carol)).filter((r) => r.template === 'order_confirmed');
  assert(rows.length === 1, `got ${rows.length}`);
  return '1 order_confirmed';
});

await check('shipping, delivery and cancellation are queued; the preference is honoured', async () => {
  const dan = await newCustomer('dan@gmail.com', 'Dan');
  const o = await one(
    `INSERT INTO public.orders (order_id, user_id, amount_in_paise, payment_status, order_status) VALUES ('ST-MAIL-2', $1, 44800, 'paid', 'processing') RETURNING id`,
    [dan],
  );
  await q(`UPDATE public.orders SET order_status = 'shipped' WHERE id = $1`, [o.id]);
  await q(`UPDATE public.orders SET order_status = 'out_for_delivery' WHERE id = $1`, [o.id]);
  await q(`UPDATE public.profiles SET notify_order_updates = false WHERE id = $1`, [dan]);
  await q(`UPDATE public.orders SET order_status = 'delivered' WHERE id = $1`, [o.id]);
  await q(`UPDATE public.orders SET order_status = 'cancelled' WHERE id = $1`, [o.id]);
  const templates = (await outbox(dan)).map((r) => r.template);
  assert(templates.includes('order_shipped') && templates.includes('order_out_for_delivery'), templates.join());
  assert(!templates.includes('order_delivered'), 'sent despite the preference');
  assert(templates.includes('order_cancelled'), 'cancellation must always be sent');
  return templates.join(', ');
});

await check('card activation, deactivation and loss are queued', async () => {
  const templates = (await outbox(alice)).map((r) => r.template);
  assert(templates.includes('card_activated'), templates.join());
  assert(templates.includes('card_lost'), templates.join());
  assert(templates.includes('card_replaced'), templates.join());
  return [...new Set(templates)].join(', ');
});

await check('the sender claims due emails once, with a lease', async () => {
  const { rows: claimed } = await q(`SELECT * FROM public.email_outbox_claim(5)`);
  assert(claimed.length === 5, `claimed ${claimed.length}`);
  const { rows: again } = await q(`SELECT * FROM public.email_outbox_claim(50)`);
  assert(!again.some((r) => claimed.some((c) => c.id === r.id)), 'a leased email was claimed twice');
  await q(`SELECT public.email_outbox_complete($1, 'sent', NULL, 'x@example.com', 'msg-1')`, [claimed[0].id]);
  await q(`SELECT public.email_outbox_complete($1, 'postpone', NULL, NULL, NULL, 60)`, [claimed[1].id]);
  const sent = await one(`SELECT status, sent_at FROM public.email_outbox WHERE id = $1`, [claimed[0].id]);
  const later = await one(`SELECT status, attempts FROM public.email_outbox WHERE id = $1`, [claimed[1].id]);
  assert(sent.status === 'sent' && sent.sent_at, JSON.stringify(sent));
  assert(later.status === 'pending' && later.attempts === 0, JSON.stringify(later));
  return 'claimed 5, no double claim; sent + postponed recorded';
});

await check('admin app: cards, emails and promo codes are listable', async () => {
  const admin = (await one(`SELECT user_id FROM public.admin_users WHERE role = 'owner' LIMIT 1`)).user_id;
  const { c } = await asUser(admin, () => one(`SELECT public.admin_list_cards(NULL, 'lost') c`));
  assert(c.total >= 1 && c.rows[0].lost_at, JSON.stringify(c).slice(0, 200));
  const { e } = await asUser(admin, () => one(`SELECT public.admin_list_emails() e`));
  assert(e.total > 0 && e.counts, 'no emails');
  const { p } = await asUser(admin, () => one(`SELECT public.admin_list_promo_codes() p`));
  assert(p.some((row) => row.code === 'DRAGON'), 'DRAGON missing');
  const msg = await asUser(bob, () => refused(`SELECT public.admin_list_cards()`));
  return `lost cards=${c.total}, emails=${e.total}, promos=${p.length}; customer refused (${msg.slice(0, 30)})`;
});

console.log('\n=== GST, stock, timeline, cancellation, funnel (026) ===');

const owner = async () => (await one(`SELECT user_id FROM public.admin_users WHERE role = 'owner' LIMIT 1`)).user_id;

await check('GST settings exist, readable, and only an admin can change them', async () => {
  const t = await one(`SELECT rate_percent, prices_include_tax, enabled FROM public.tax_settings`);
  assert(Number(t.rate_percent) === 18 && t.prices_include_tax === true, JSON.stringify(t));
  await refused(`SELECT public.admin_update_tax_settings(true, 5, true)`);
  const admin = await owner();
  const { r } = await asUser(admin, () => one(`SELECT public.admin_update_tax_settings(true, 18, true, '29ABCDE1234F1Z5', 'SHYGON Technologies Pvt. Ltd.') r`));
  assert(r.gstin === '29ABCDE1234F1Z5', JSON.stringify(r));
  return '18% inclusive; GSTIN saved by owner, refused otherwise';
});

let stockCard;
await check('blank cards are imported once, and a chip is assigned only to a matching card', async () => {
  const admin = await owner();
  const { r } = await asUser(admin, () => one(
    `SELECT public.admin_import_physical_cards('business', 'pvc', 'standard', ARRAY['04:AA:01', '04:AA:02', '04:aa:01'], 'B1') r`));
  assert(r.added === 2 && r.skipped.length === 1, JSON.stringify(r));
  stockCard = await buyCard(bob, 'card-business-standard-pvc');
  const wrong = await buyCard(bob, 'card-event-standard-pvc');
  const msg = await asUser(admin, () => refused(`SELECT public.admin_assign_physical_card($1, '04:AA:02')`, [wrong.id]));
  assert(/needs event/.test(msg), msg);
  await asUser(admin, () => q(`SELECT public.admin_assign_physical_card($1, '04:aa:01')`, [stockCard.id]));
  const card = await cardRow(stockCard.id);
  assert(card.card_uid === '04:AA:01', `chip ${card.card_uid}`);
  const again = await asUser(admin, () => refused(`SELECT public.admin_assign_physical_card($1, '04:AA:02')`, [stockCard.id]));
  const dup = await asUser(admin, () => refused(`SELECT public.admin_assign_physical_card($1, '04:AA:01')`, [wrong.id]));
  return `2 imported, duplicate skipped; mismatch refused; "${again.slice(0, 28)}…"; "${dup.slice(0, 30)}…"`;
});

await check('admin card actions are audited and show in the card history', async () => {
  const admin = await owner();
  await asUser(admin, () => q(`SELECT public.admin_set_card_state($1, 'damaged', 'cracked in transit')`, [stockCard.id]));
  const { h } = await asUser(admin, () => one(`SELECT public.admin_card_history($1) h`, [stockCard.id]));
  const events = h.events.map((e) => e.event);
  assert(events.includes('card.chip_assigned') && events.includes('card.damaged'), events.join());
  assert(h.physical && h.physical.status === 'assigned', 'physical link missing');
  const { h: repl } = await asUser(admin, () => one(`SELECT public.admin_card_history($1) h`, [replacement.id]));
  assert(repl.replaces.length === 1, 'replacement history missing');
  await refused(`SELECT public.admin_set_card_state($1, 'activate')`, [stockCard.id]);
  return events.join(', ');
});

await check('the order timeline records payment, status and the card being made', async () => {
  const rows = (await q(`SELECT kind, status FROM public.order_status_history WHERE order_id = $1 ORDER BY id`, [stockCard.orderId])).rows;
  const seen = rows.map((r) => `${r.kind}:${r.status}`);
  assert(seen.includes('payment:paid') && seen.includes('card:card_assigned'), seen.join());
  return seen.join(' → ');
});

await check('a customer can ask to cancel a paid, unshipped order once; not a shipped one', async () => {
  const { r } = await asUser(bob, () => one(`SELECT public.customer_request_cancellation($1, 'Ordered by mistake') r`, [stockCard.orderId]));
  assert(r.already === false, JSON.stringify(r));
  const { r: twice } = await asUser(bob, () => one(`SELECT public.customer_request_cancellation($1, 'again') r`, [stockCard.orderId]));
  assert(twice.already === true, 'second request not idempotent');
  await q(`UPDATE public.orders SET order_status = 'shipped' WHERE id = $1`, [stockCard.orderId]);
  const shipped = await buyCard(bob);
  await q(`UPDATE public.orders SET order_status = 'shipped' WHERE id = $1`, [shipped.orderId]);
  const msg = await asUser(bob, () => refused(`SELECT public.customer_request_cancellation($1, 'too late')`, [shipped.orderId]));
  const other = await asUser(alice, () => refused(`SELECT public.customer_request_cancellation($1, 'not mine')`, [shipped.orderId]));
  const { n } = await one(`SELECT count(*)::int n FROM public.support_tickets WHERE order_id = $1`, [stockCard.orderId]);
  assert(n === 1, `tickets ${n}`);
  return `request + ticket; shipped refused ("${msg.slice(0, 30)}…"); other customer refused (${other.slice(0, 15)})`;
});

await check('a refund reported by the webhook syncs once', async () => {
  await q(`UPDATE public.orders SET razorpay_payment_id = 'pay_ref' WHERE id = $1`, [stockCard.orderId]);
  await q(`SELECT public.orders_refund_from_webhook('pay_ref', 'rfnd_1', 44800, 'processed')`);
  await q(`SELECT public.orders_refund_from_webhook('pay_ref', 'rfnd_1', 44800, 'processed')`);
  const o = await one(`SELECT payment_status, refund_amount_in_paise FROM public.orders WHERE id = $1`, [stockCard.orderId]);
  const { n } = await one(`SELECT count(*)::int n FROM public.email_outbox WHERE subject_id = $1 AND template = 'order_refunded'`, [stockCard.orderId]);
  assert(o.payment_status === 'refunded' && n === 1, JSON.stringify({ o, n }));
  return 'refunded, one refund email';
});

await check('store funnel counts distinct sessions per step and ignores junk', async () => {
  for (const [s, events] of [['sessAAAAAAAA', ['store_visit', 'product_view', 'add_to_cart', 'checkout_started', 'payment_opened', 'payment_success']],
                             ['sessBBBBBBBB', ['store_visit', 'product_view']], ['sessCCCCCCCC', ['store_visit', 'store_visit']]]) {
    for (const e of events) await q(`SELECT public.track_store_event($1, $2, 'business')`, [s, e]);
  }
  await q(`SELECT public.track_store_event('x', 'store_visit')`);
  await q(`SELECT public.track_store_event('sessDDDDDDDD', 'drop table')`);
  const admin = await owner();
  const { f } = await asUser(admin, () => one(`SELECT public.admin_store_funnel(30) f`));
  const counts = Object.fromEntries(f.steps.map((s) => [s.step, Number(s.sessions)]));
  assert(counts.visit === 3 && counts.view === 2 && counts.cart === 1 && counts.paid === 1, JSON.stringify(counts));
  await asUser(bob, () => refused(`SELECT public.admin_store_funnel(30)`));
  return JSON.stringify(counts);
});

await check('support tickets and replies are emailed', async () => {
  const t = await one(`INSERT INTO public.support_tickets (user_id, subject) VALUES ($1, 'Help with my card') RETURNING id`, [alice]);
  await q(`INSERT INTO public.support_messages (ticket_id, author_role, body) VALUES ($1, 'support', 'Here to help')`, [t.id]);
  const templates = (await q(`SELECT template FROM public.email_outbox WHERE subject_id = $1`, [t.id])).rows.map((r) => r.template);
  assert(templates.includes('support_ticket_created') && templates.includes('support_reply'), templates.join());
  return templates.join(', ');
});

console.log('\n=== 027: buttons by tier, card details ===');

await check('Essential shows WhatsApp but not Instagram; Business shows both', async () => {
  const carol = await newCustomer('carol@example.com', 'Carol Das');
  await buyCard(carol);
  const [page] = await pagesOf(carol);
  await publish(carol, page.id);
  // What fulfilment's applyProfileDetails writes, as the service role.
  await q(`UPDATE public.tap_profiles SET whatsapp = '+919876543210', instagram = '@carol',
             enabled_customizations = ARRAY['email','phone','instagram','whatsapp'] WHERE id = $1`, [page.id]);
  const before = (await one(`SELECT public.get_public_profile($1) p`, [page.slug])).p;
  assert(before.whatsapp === '+919876543210', 'WhatsApp should be included in Essential');
  assert(before.instagram === null, 'Instagram must not show on Essential');
  await q(`INSERT INTO public.entitlements (user_id, type, key, is_active) VALUES ($1, 'digital_plan', 'business', true)`, [carol]);
  await q(`UPDATE public.tap_profiles SET selected_ui_tier = 'business' WHERE id = $1`, [page.id]);
  const after = (await one(`SELECT public.get_public_profile($1) p`, [page.slug])).p;
  assert(after.instagram === '@carol' && after.whatsapp === '+919876543210', JSON.stringify(after));
  return 'essential: whatsapp only · business: + instagram';
});

await check('a customer cannot switch on a button their page tier does not include', async () => {
  const dan = await newCustomer('dan@example.com', 'Dan Roy');
  await buyCard(dan);
  const [page] = await pagesOf(dan);
  const msg = await asUser(dan, () =>
    refused(`UPDATE public.tap_profiles SET enabled_customizations = ARRAY['email','phone','linkedin'] WHERE id = $1`, [page.id]));
  assert(/not been purchased/i.test(msg), msg);
  await asUser(dan, () => q(`UPDATE public.tap_profiles SET enabled_customizations = ARRAY['email','phone','whatsapp'] WHERE id = $1`, [page.id]));
  const row = await one(`SELECT enabled_customizations e FROM public.tap_profiles WHERE id = $1`, [page.id]);
  assert(row.e.includes('whatsapp'), JSON.stringify(row));
  return 'linkedin refused on Essential, whatsapp allowed';
});

await check('a bought add-on still unlocks a button above the tier', async () => {
  const eve = await newCustomer('eve@example.com', 'Eve Nair');
  await buyCard(eve);
  const [page] = await pagesOf(eve);
  await q(`INSERT INTO public.entitlements (user_id, type, key, is_active) VALUES ($1, 'customization', 'linkedin', true)`, [eve]);
  await asUser(eve, () => q(`UPDATE public.tap_profiles SET enabled_customizations = ARRAY['email','phone','linkedin'] WHERE id = $1`, [page.id]));
  return 'linkedin add-on works on Essential';
});

await check('tier_buttons grows with the tier and card-details is a reserved address', async () => {
  const r = await one(`SELECT array_length(public.tier_buttons('essential'),1) e, array_length(public.tier_buttons('business'),1) b,
                              array_length(public.tier_buttons('premium'),1) p, array_length(public.tier_buttons('goat'),1) g,
                              public.tap_slug_reserved('card-details') reserved`);
  assert(r.e === 3 && r.b === 6 && r.p === 9 && r.g === 10 && r.reserved === true, JSON.stringify(r));
  return '3 → 6 → 9 → 10 buttons';
});

await check('orders keep the card details the customer typed', async () => {
  const o = await one(`INSERT INTO public.orders (order_id, user_id, customer_id, amount_in_paise, payment_status, order_type, profile_details)
                       VALUES ('ST-DETAILS-1', $1, $1, 39900, 'pending', 'physical', '{"displayName":"Alice Rao"}') RETURNING profile_details`, [alice]);
  assert(o.profile_details.displayName === 'Alice Rao', JSON.stringify(o));
  return 'stored';
});

console.log('\n=== 028: verified-buyer reviews ===');

await check('only a paying customer can review a card, once, and the public sees a first name only', async () => {
  const buyer = await newCustomer('rev@example.com', 'Ravi Kumar');
  const stranger = await newCustomer('str@example.com', 'Sam Stranger');
  const msg = await asUser(stranger, () => refused(`SELECT public.submit_product_review('business', 5, 'Great', 'Nice')`));
  assert(/bought this card/i.test(msg), msg);
  await buyCard(buyer, 'card-business-standard-pvc');
  const mine = await asUser(buyer, () => one(`SELECT public.my_product_review('business') r`));
  assert(mine.r.eligible === true, JSON.stringify(mine));
  await asUser(buyer, () => q(`SELECT public.submit_product_review('business', 4, 'Solid', 'Works on every phone')`));
  await asUser(buyer, () => q(`SELECT public.submit_product_review('business', 5, 'Excellent', 'Works on every phone')`));
  const bad = await asUser(buyer, () => refused(`SELECT public.submit_product_review('business', 9, 'x', 'y')`));
  assert(/1 to 5/.test(bad), bad);
  const { r } = await one(`SELECT public.get_product_reviews('business') r`);
  const text = JSON.stringify(r);
  assert(Number(r.count) === 1 && Number(r.average) === 5, text);
  assert(r.reviews[0].author === 'Ravi K.', r.reviews[0].author);
  assert(!text.includes('rev@example.com') && !text.includes(buyer), 'review leaks identity');
  return `1 review, 5★ by ${r.reviews[0].author}; stranger refused; one per customer`;
});

await check('a pattern in place of a design id unlocks nothing', async () => {
  const buyer = (await one(`SELECT id FROM auth.users WHERE email = 'rev@example.com'`)).id;
  for (const pattern of ['.*', 'bus.*', '(']) {
    const mine = await asUser(buyer, () => one(`SELECT public.my_product_review($1) r`, [pattern]));
    assert(mine.r.eligible === false, `${pattern}: ${JSON.stringify(mine)}`);
  }
  return '".*", "bus.*" and "(" are not eligible';
});

await check('an admin can hide a review; other customers cannot', async () => {
  const admin = await owner();
  const list = await asUser(admin, () => one(`SELECT public.admin_list_reviews('business') l`));
  const id = list.l.rows[0].id;
  await asUser(bob, () => refused(`SELECT public.admin_set_review_hidden($1, true, 'spam')`, [id]));
  await asUser(admin, () => q(`SELECT public.admin_set_review_hidden($1, true, 'spam')`, [id]));
  const { r } = await one(`SELECT public.get_product_reviews('business') r`);
  assert(Number(r.count) === 0, JSON.stringify(r));
  return 'hidden by admin, customer refused';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
