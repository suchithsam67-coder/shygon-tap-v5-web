import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, ROOT } from './lib/live-db.mjs';
import { createStackDb } from '../local/db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

/**
 * Migration 027, the AAROH catalogue (DEC-2026-037, 2026-10-13/14), on real
 * catalogue rows, and the store's AAROH data against the design system.
 *
 * The store sells SHYGON TAP V5 and AAROH side by side. 027 adds AAROH's 20
 * rows (the design system's ten editions x Standard / Premium Finish, ₹999 /
 * ₹1,499, stock 0), one numbered series per edition, and teaches
 * card_design_of the AAROH SKUs. It must leave every V5 row exactly as it was.
 * Every edition's words in src/data/aaroh.ts must be the design system's own
 * (design-assets/canvas), apart from the declared AAROH_TEXT_CHANGES, and
 * every edition must have its four landscape renders in both sizes.
 *
 * The live schema baseline holds no rows, so 027 is proven on the catalogue
 * the history migrations put on live (the stand-in baseline plus 001-019, as
 * history-seed.mjs builds it). Then the local stack (baseline + 020 onward +
 * seed.sql) shows what customers can and cannot buy.
 *
 * Isolated, in-memory and offline. It never touches live.
 *
 *   node supabase/tests/aaroh-catalog.mjs
 */

const t = createHarness('AAROH catalogue (027 on the catalogue rows, isolated, never live)');
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS_DIR, '027_aaroh_catalog.sql'), 'utf8').replace(/\r\n/g, '\n');
const ROLLBACK = MIGRATION.split('-- ROLLBACK (begin)\n')[1]
  .split('-- ROLLBACK (end)')[0]
  .split('\n')
  .map((line) => line.replace(/^-- ?/, ''))
  .join('\n');

const V5_DESIGNS = [
  'business', 'restaurant', 'event', 'google-review', 'obsidian-smoke',
  'rose-marble', 'carbon-aurum', 'sandstone-jaali', 'sapphire-night', 'aurora-glass',
];
/** The design system's editions, E01-E10, in order. */
const EDITIONS = [
  'obsidian', 'aureate', 'monolith', 'ivory-veil', 'cobalt',
  'emerald-cipher', 'prism', 'carbon-weave', 'heritage-geometry', 'liquid-form',
];
const AAROH_SKUS = EDITIONS.flatMap((e) => [`card-aaroh-${e}-standard`, `card-aaroh-${e}-premium`]);

/** The pixel width of a WebP file (lossy VP8 or lossless VP8L). */
function readWebpWidth(buf) {
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return buf.readUInt16LE(26) & 0x3fff;
  if (chunk === 'VP8L') return 1 + (((buf[22] & 0x3f) << 8) | buf[21]);
  if (chunk === 'VP8X') return 1 + buf.readUIntLE(24, 3);
  throw new Error('not a WebP file');
}

async function historyDb() {
  const db = await PGlite.create();
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'baseline.sql'), 'utf8'));
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
    if (Number(f.slice(0, 3)) > 19) continue;
    await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

/** Every products row, every column that matters, in a stable order. */
async function products(db) {
  const { rows } = await db.query(
    `SELECT sku, name, category, material, tier, price_in_paise, stock, product_type, image_url, short_description, active, sort_order
       FROM public.products ORDER BY sku`,
  );
  return rows;
}
const editionsOf = async (db) => (await db.query(`SELECT design, name, chapter_size, issued FROM public.card_editions ORDER BY design`)).rows;
const designOf = async (db, sku) => (await db.query(`SELECT public.card_design_of($1) AS d`, [sku])).rows[0].d;
const bodyOf = async (db) => (await db.query(`SELECT prosrc FROM pg_proc WHERE proname = 'card_design_of'`)).rows[0].prosrc;

t.section('027 on the catalogue as the history migrations left it');

const db = await historyDb();
const before = await products(db);
const editionsBefore = await editionsOf(db);
const functionBefore = await bodyOf(db);

await t.check('premise: 60 V5 card rows (10 designs x 6 configurations), all active; no AAROH row', async () => {
  const cards = before.filter((r) => r.product_type === 'card');
  assertEqual(cards.length, 60, 'card rows');
  assert(cards.every((r) => r.active !== false), 'a V5 row is inactive');
  assertEqual(before.filter((r) => r.sku.startsWith('card-aaroh-')).length, 0, 'AAROH rows');
});

await db.exec(MIGRATION);
const after = await products(db);

await t.check('027 adds exactly the 20 AAROH rows, priced ₹999 / ₹1,499, listed, with stock 0', async () => {
  const added = after.filter((r) => !before.some((b) => b.sku === r.sku));
  assertEqual(added.map((r) => r.sku).sort(), [...AAROH_SKUS].sort(), 'added SKUs');
  for (const row of added) {
    const premium = row.sku.endsWith('-premium');
    assertEqual(
      [row.product_type, row.tier, row.material, row.price_in_paise, row.stock, row.active],
      ['card', premium ? 'premium' : 'standard', null, premium ? 149900 : 99900, 0, true],
      row.sku,
    );
    assert(row.category === row.sku.replace(/^card-/, '').replace(/-(standard|premium)$/, ''), `${row.sku} category ${row.category}`);
    assert(fs.existsSync(path.join(ROOT, 'public', row.image_url)), `${row.sku} image ${row.image_url} is missing`);
  }
});

await t.check('every SHYGON TAP V5 row and every other row is unchanged, column by column', async () => {
  const bySku = new Map(after.map((r) => [r.sku, r]));
  for (const was of before) assertEqual(bySku.get(was.sku), was, was.sku);
  return `${before.length} rows unchanged`;
});

await t.check('one numbered series per edition (chapters of 100); the V5 series are untouched', async () => {
  const series = await editionsOf(db);
  const added = series.filter((s) => !editionsBefore.some((b) => b.design === s.design));
  assertEqual(
    added.map((s) => [s.design, s.chapter_size, s.issued]),
    EDITIONS.map((e) => [`aaroh-${e}`, 100, 0]).sort((a, b) => a[0].localeCompare(b[0])),
    'AAROH series',
  );
  for (const was of editionsBefore) assertEqual(series.find((s) => s.design === was.design), was, was.design);
});

await t.check('card_design_of: AAROH SKUs map to their edition (both finishes share it); V5 maps as before', async () => {
  for (const edition of EDITIONS) {
    for (const finish of ['standard', 'premium']) assertEqual(await designOf(db, `card-aaroh-${edition}-${finish}`), `aaroh-${edition}`, `${edition} ${finish}`);
  }
  for (const design of V5_DESIGNS) assertEqual(await designOf(db, `card-${design}-premium-metal`), design, design);
  for (const sku of ['card-aaroh-obsidian', 'card-aaroh-obsidian-gold', 'plan-business', 'card-business-standard']) {
    assertEqual(await designOf(db, sku), null, sku);
  }
});

await t.check('idempotent: applying 027 again changes nothing', async () => {
  await db.exec(MIGRATION);
  assertEqual(await products(db), after, 'products after a second run');
});

await t.check('the header rollback restores the catalogue, the series and card_design_of exactly', async () => {
  await db.exec(ROLLBACK);
  assertEqual(await products(db), before, 'products after rollback');
  assertEqual(await editionsOf(db), editionsBefore, 'card_editions after rollback');
  assertEqual(await bodyOf(db), functionBefore, 'card_design_of body');
});
await db.close();

await t.check('the store data matches 027: editions, finishes and display prices in src/data/aaroh.ts', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'data', 'aaroh.ts'), 'utf8');
  const editionBlock = source.split('export const AAROH_EDITIONS')[1].split('export const AAROH_STORE_PATH')[0];
  const ids = [...editionBlock.matchAll(/^\s{4}id: '([a-z-]+)',$/gm)].map((m) => m[1]);
  assertEqual(ids, EDITIONS, 'editions, in the design system order');
  const finishBlock = source.split('export const AAROH_FINISHES')[1].split('export const AAROH_EDITIONS')[0];
  const finishes = [...finishBlock.matchAll(/id: '([a-z]+)',[\s\S]*?price: (\d+),/g)].map((m) => [m[1], Number(m[2])]);
  assertEqual(finishes, [['standard', 999], ['premium', 1499]], 'finishes and display prices');
});

await t.check('every edition text in src/data/aaroh.ts is the design system’s own, apart from the declared changes', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'data', 'aaroh.ts'), 'utf8');
  const editionBlock = source.split('export const AAROH_EDITIONS')[1].split('export const AAROH_STORE_PATH')[0];
  const changesBlock = source.split('export const AAROH_TEXT_CHANGES')[1].split(']\n')[0];
  const changes = [...changesBlock.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert(changes.length >= 4, 'AAROH_TEXT_CHANGES not found');
  const canvas = ['Sheet.dc.html', 'Moodboard.dc.html']
    .map((f) => fs.readFileSync(path.join(ROOT, 'design-assets', 'canvas', f), 'utf8'))
    .join('\n');
  const fields = ['title', 'character', 'description', 'finishLine', 'printed', 'physical', 'simplify', 'surface', 'edge'];
  const undo = (text) => changes.reduce((acc, [store, original]) => acc.split(store).join(original), text);
  let checked = 0;
  for (const field of fields) {
    for (const m of editionBlock.matchAll(new RegExp(`\\n    ${field}:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'g'))) {
      const value = undo(m[1].replace(/\\'/g, "'"));
      assert(canvas.includes(value), `${field} is not in the design system: ${value}`);
      checked++;
    }
  }
  for (const m of editionBlock.matchAll(/\n    colours: \[([^\]]*)\]/g)) {
    for (const hex of m[1].match(/#[0-9A-F]{6}/gi)) assert(canvas.includes(hex), `swatch ${hex} is not in the design system`);
    checked++;
  }
  assertEqual(checked, EDITIONS.length * (fields.length + 1), 'fields checked');
  return `${checked} fields`;
});

await t.check('every edition has its landscape renders: two finishes, both faces, 1200 and 600 px wide', async () => {
  const dir = path.join(ROOT, 'public', 'assets', 'aaroh');
  const width = (file) => readWebpWidth(fs.readFileSync(file));
  let count = 0;
  for (const edition of EDITIONS) for (const finish of ['standard', 'premium']) for (const side of ['front', 'back']) {
    for (const [suffix, expected] of [['', 1200], ['-600', 600]]) {
      const file = path.join(dir, `${edition}-${finish}-${side}${suffix}.webp`);
      assert(fs.existsSync(file), `${path.basename(file)} is missing`);
      assertEqual(width(file), expected, path.basename(file));
      count++;
    }
  }
  return `${count} images`;
});

t.section('The local stack: what a customer can buy');

await t.check('seed.sql + 027: the 60 V5 rows are listed, and the 20 AAROH rows sit beside them', async () => {
  const stackDb = await createStackDb();
  const rows = (await products(stackDb)).filter((r) => r.product_type === 'card');
  await stackDb.close();
  assertEqual(rows.filter((r) => r.sku.startsWith('card-aaroh-')).map((r) => r.sku).sort(), [...AAROH_SKUS].sort(), 'AAROH rows');
  const v5 = rows.filter((r) => !r.sku.startsWith('card-aaroh-'));
  assertEqual(v5.length, 60, 'V5 rows');
  assert(v5.every((r) => r.active === true), 'a V5 row is delisted');
});

const stack = await startStack();
const sql = async (text, params) => (await stack.query(text, params)).rows;
const shipping = { name: 'A Customer', phone: '9876543210', address: '1 Test Street', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const orderCard = (customer, card) =>
  callFunction(stack, 'create-order', { token: customer.token, body: { orderType: 'physical', quantity: 1, shipping, ...card } });
const ordersOf = async (userId) => (await sql(`SELECT count(*)::int AS n FROM public.orders WHERE user_id = $1`, [userId]))[0].n;
const anonRead = async (query) =>
  (await fetch(`${stack.gatewayUrl}/rest/v1/products?${query}`, {
    headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${stack.keys.anonKey}` },
  })).json();

const previousFlag = process.env.CARD_SALES_ENABLED;
try {
  await t.check('sales closed (the default until launch): V5 and AAROH card orders are refused with 409', async () => {
    delete process.env.CARD_SALES_ENABLED;
    const customer = await signUp(stack);
    for (const card of [
      { productId: 'rose-marble', tier: 'premium', material: 'metal' },
      { productId: 'aaroh-obsidian', tier: 'standard' },
    ]) {
      const response = await orderCard(customer, card);
      assertEqual(response.status, 409, `${card.productId} status`);
    }
    assertEqual(await ordersOf(customer.userId), 0, 'orders written');
  });

  process.env.CARD_SALES_ENABLED = 'true';

  await t.check('sales open: every V5 design is sold at its catalogue price', async () => {
    const customer = await signUp(stack);
    for (const design of V5_DESIGNS) {
      const response = await orderCard(customer, { productId: design, tier: 'standard', material: 'pvc' });
      assertEqual(response.status, 200, `${design} status (${JSON.stringify(response.body)})`);
      const [row] = await sql(`SELECT price_in_paise FROM public.products WHERE sku = $1`, [`card-${design}-standard-pvc`]);
      assertEqual(response.body.amount, row.price_in_paise, `${design} amount`);
    }
    return `${V5_DESIGNS.length} designs`;
  });

  await t.check('sales open: AAROH is refused until stock is counted (027 lists it with stock 0)', async () => {
    const customer = await signUp(stack);
    const response = await orderCard(customer, { productId: 'aaroh-aureate', tier: 'premium' });
    assertEqual(response.status, 409, 'status');
    assert(/out of stock/i.test(response.body.error), response.body.error);
    assertEqual(await ordersOf(customer.userId), 0, 'orders written');
  });

  await t.check('the storefront catalogue read (anon, RLS) lists V5 and AAROH cards and the experiences', async () => {
    const cards = (await anonRead('select=sku&product_type=eq.card')).map((r) => r.sku);
    assertEqual(cards.length, 60 + AAROH_SKUS.length, 'listed card rows');
    assert(AAROH_SKUS.every((sku) => cards.includes(sku)), 'AAROH rows listed');
    const plans = (await anonRead('select=sku&product_type=eq.digital_plan&active=eq.true')).map((r) => r.sku).sort();
    assertEqual(plans, ['plan-business', 'plan-essential', 'plan-goat', 'plan-premium'], 'experiences');
  });
} finally {
  if (previousFlag === undefined) delete process.env.CARD_SALES_ENABLED;
  else process.env.CARD_SALES_ENABLED = previousFlag;
  await stack.close();
}

process.exit(t.finish() ? 0 : 1);
