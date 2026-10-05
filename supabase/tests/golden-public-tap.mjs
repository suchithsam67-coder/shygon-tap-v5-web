import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, MIGRATIONS_DIR, ROOT } from './lib/live-db.mjs';

/**
 * Golden test for the public Tap (doc 12 §0 rule 4: "legacy /t/<slug>
 * behaviour must be byte-compatible").
 *
 * The public page reads exactly two functions as `anon`: get_public_profile
 * and get_public_tap_state (src/lib/publicTapClient.ts). This suite seeds the
 * same real-shaped Taps into several databases and requires their output to
 * be byte-identical:
 *
 *   - the live schema baseline (what production serves today);
 *   - the baseline plus each migration from 020 on, one stage at a time;
 *   - the committed golden file supabase/tests/golden/public-tap.json.
 *
 * The slugs cover every experience, clamping, the Pass, add-ons owned and not
 * owned, paused / draft / archived / suspended Taps, slug normalisation,
 * unknown and empty slugs, a Tap with no user_id, and the card states of F3
 * (DEC-2026-022 Q2 OPEN): with every card suspended or expired the output is
 * still served unchanged. Those F3 cases characterise today's behaviour; they
 * are not a decision.
 *
 * Seasonal themes are date-driven, so none is seeded: the output does not
 * depend on the day the suite runs.
 *
 *   node supabase/tests/golden-public-tap.mjs [migrations-dir]   check
 *   node supabase/tests/golden-public-tap.mjs --write            regenerate the golden
 *                                                                file from the baseline
 */

const GOLDEN = path.join(ROOT, 'supabase', 'tests', 'golden', 'public-tap.json');
const WRITE = process.argv.includes('--write');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? MIGRATIONS_DIR;

// Distinct first 10 hex digits per account: sign-up derives the unique
// customer code from them (observation O-13).
const id = (n) => `${String(n).padStart(2, '0')}a00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

// [n, slug, display name, tap columns, entitlements [type, key, active], cards [status, expires]]
const TAPS = [
  [1, 'ess-active', 'Essential Active', { selected_ui_tier: 'essential' }, [], []],
  [2, 'biz-active', 'Business Active', { selected_ui_tier: 'business', theme_layout: 'centered', theme_buttons: 'outline' }, [['digital_plan', 'business', true]], []],
  [3, 'prem-active', 'Premium Active', { selected_ui_tier: 'premium', theme_palette: 'aurora', theme_layout: 'split', theme_buttons: 'glass', theme_font: 'mono', theme_animation: 'signature' }, [['digital_plan', 'premium', true]], []],
  [4, 'goat-active', 'Goat Active', { selected_ui_tier: 'goat', theme_palette: 'prism', theme_layout: 'immersive', theme_buttons: 'glow', theme_font: 'editorial', theme_animation: 'dynamic' }, [['digital_plan', 'goat', true]], []],
  [5, 'clamped-goat', 'Clamped Goat', { selected_ui_tier: 'goat', theme_palette: 'neon', theme_layout: 'immersive' }, [], []],
  [6, 'pass-holder', 'Pass Holder', { selected_ui_tier: 'essential', theme_palette: 'neon' }, [['lifetime', 'lifetime', true]], []],
  [7, 'addons-owned', 'Addons Owned',
    { selected_ui_tier: 'business', enabled_customizations: ['phone', 'email', 'whatsapp', 'website', 'instagram', 'linkedin', 'youtube', 'location', 'links'],
      custom_links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] },
    [['digital_plan', 'business', true], ['customization', 'whatsapp', true], ['customization', 'website', true], ['customization', 'instagram', true],
     ['customization', 'linkedin', true], ['customization', 'youtube', true], ['customization', 'location', true], ['customization', 'links', true]], []],
  [8, 'addons-not-owned', 'Addons Not Owned',
    { enabled_customizations: ['phone', 'email', 'whatsapp', 'website', 'links'], custom_links: [{ label: 'Hidden', url: 'https://example.test/hidden' }] }, [], []],
  [9, 'revoked-plan', 'Revoked Plan', { selected_ui_tier: 'business' }, [['digital_plan', 'business', false]], []],
  // Live's CHECK keeps selected_ui_tier canonical; the legacy name survives in entitlement keys.
  [10, 'legacy-pro', 'Legacy Pro', { selected_ui_tier: 'business' }, [['digital_plan', 'pro', true]], []],
  [11, 'paused-tap', 'Paused Tap', { status: 'paused' }, [], []],
  [12, 'draft-tap', 'Draft Tap', { status: 'draft' }, [], []],
  [13, 'archived-tap', 'Archived Tap', { status: 'archived' }, [], []],
  [14, 'suspended-tap', 'Suspended Tap', { suspended_at: '2026-01-01T00:00:00Z', suspended_reason: 'golden fixture' }, [], []],
  [15, 'Mixed-Case', 'Mixed Case', {}, [], []],
  [16, 'f3-cards-suspended', 'F3 Cards Suspended', {}, [], [['suspended', null], ['suspended', null]]],
  [17, 'f3-card-expired', 'F3 Card Expired', {}, [], [['active', '2020-01-01T00:00:00Z']]],
  [18, 'f3-card-active', 'F3 Card Active', {}, [], [['active', null]]],
  [19, 'f3-card-pending', 'F3 Card Pending', {}, [], [['pending', null]]],
  [20, 'f3-mixed-cards', 'F3 Mixed Cards', {}, [], [['suspended', null], ['active', '2099-01-01T00:00:00Z']]],
  [22, 'no-channels', 'No Channels', { enabled_customizations: [] }, [], []], // the column default
];

const SLUGS = [
  ...TAPS.map((t) => t[1]),
  'mixed-case', 'MIXED-CASE', '  ess-active  ', 'GOAT-ACTIVE',
  'no-user-tap', // a legacy row with tap_profiles.user_id NULL
  'nobody-here', 'admin', '', null,
];

async function seed(db) {
  // Supabase grants the API roles schema usage; the dump already has it, kept explicit.
  await db.exec('GRANT USAGE ON SCHEMA public TO anon, authenticated;');
  for (const [n, slug, name, cols, ents, cards] of TAPS) {
    const uid = id(n);
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
      [uid, `${slug.toLowerCase()}@example.test`, name],
    );
    const row = {
      user_id: uid,
      slug,
      username: slug,
      display_name: name,
      headline: `${name} headline`,
      designation: 'Founder',
      company: 'Example Co',
      bio: `Bio of ${name}.`,
      avatar_url: `https://example.test/${n}.png`,
      location: 'Bengaluru',
      phone: `+9190000000${String(n).padStart(2, '0')}`,
      whatsapp: `+9180000000${String(n).padStart(2, '0')}`,
      email: `${slug.toLowerCase()}@example.test`,
      website: 'https://example.test',
      instagram: 'example',
      linkedin: 'example',
      youtube: 'example',
      status: 'active',
      enabled_customizations: ['phone', 'email'], // what provisioning sets
      created_at: '2026-01-01T00:00:00Z',
      provisioned_at: '2026-01-01T00:00:00Z',
      ...cols,
    };
    const keys = Object.keys(row);
    const values = keys.map((k) => (k === 'custom_links' ? JSON.stringify(row[k]) : row[k]));
    // On live, customer_id references customers.id, which sign-up created.
    await db.query(
      `INSERT INTO public.tap_profiles (customer_id, ${keys.join(', ')})
       VALUES ((SELECT id FROM public.customers WHERE user_id = $1), ${keys.map((_, i) => `$${i + 2}`).join(', ')})`,
      [uid, ...values],
    );
    for (const [type, key, active] of ents) {
      await db.query(`INSERT INTO public.entitlements (user_id, type, key, is_active, granted_at) VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z')`,
        [uid, type, key, active]);
    }
    let slot = 0;
    for (const [status, expires] of cards) {
      slot++;
      // card_id and activation_code are given: where pgcrypto lives on live is
      // unverified (DEC-2026-024 I-5), so the stand-in cannot generate them.
      await db.query(
        `INSERT INTO public.cards (user_id, tap_profile_id, card_id, activation_code, sku, card_slot, status, activation_expires_at)
         VALUES ($1, (SELECT id FROM public.tap_profiles WHERE user_id = $1), $2, $3, 'card-golden', $4, $5, $6)`,
        [uid, `GOLDEN-${n}-${slot}`, `SHY-GLD-${n}${slot}`, slot, status, expires],
      );
    }
  }
  // A legacy Tap row without user_id (nullable on live). customer_id is UNIQUE
  // on tap_profiles, so it gets a customer of its own.
  await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'nouser@example.test')`, [id(21)]);
  await db.query(
    `INSERT INTO public.tap_profiles (customer_id, user_id, slug, username, display_name, email, status)
     VALUES ((SELECT id FROM public.customers WHERE user_id = $1), NULL, 'no-user-tap', 'no-user-tap', 'No User', 'nouser@example.test', 'active')`,
    [id(21)],
  );
}

async function render(db) {
  const out = {};
  await db.exec('SET ROLE anon;');
  try {
    for (const slug of SLUGS) {
      const { rows: [r] } = await db.query(
        `SELECT public.get_public_tap_state($1) AS state, public.get_public_profile($1)::text AS profile`,
        [slug],
      );
      out[slug === null ? '<null>' : JSON.stringify(slug)] = { state: r.state, profile: r.profile };
    }
  } finally {
    await db.exec('RESET ROLE;');
  }
  return out;
}

const migrations = newMigrations(DIR);

// Stage 0 is the live baseline; stage k adds the first k migrations.
const stages = [];
for (let k = 0; k <= (WRITE ? 0 : migrations.length); k++) {
  const db = await createLiveDb();
  for (const { sql } of migrations.slice(0, k)) await db.exec(sql);
  await seed(db);
  stages.push({ label: k === 0 ? 'live baseline' : `baseline + ${migrations.slice(0, k).map((m) => m.name.slice(0, 3)).join(' + ')}`, out: await render(db) });
  await db.close();
}

if (WRITE) {
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify({
    description:
      'Public Tap output (get_public_tap_state, get_public_profile as anon) for the fixtures in ' +
      'supabase/tests/golden-public-tap.mjs on supabase/baseline/000_live_baseline.sql. Generated by ' +
      '`node supabase/tests/golden-public-tap.mjs --write`. Do not edit by hand.',
    slugs: stages[0].out,
  }, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, GOLDEN)} (${SLUGS.length} slugs)`);
  process.exit(0);
}

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    const detail = fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('\n=== golden public Tap (/t/<slug>) ===');

check('the golden file is the live baseline output', () => {
  assert(fs.existsSync(GOLDEN), `${path.relative(ROOT, GOLDEN)} is missing; run with --write and review it`);
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).slugs;
  const diffs = Object.keys({ ...golden, ...stages[0].out })
    .filter((k) => JSON.stringify(golden[k]) !== JSON.stringify(stages[0].out[k]));
  assert(diffs.length === 0, `differs for ${diffs.join(', ')}`);
  const served = Object.values(golden).filter((v) => v.profile !== null).length;
  return `${Object.keys(golden).length} slugs, ${served} served`;
});

check('the fixtures exercise every public state', () => {
  const states = new Set(Object.values(stages[0].out).map((v) => v.state));
  assert(['active', 'paused', 'unavailable'].every((s) => states.has(s)), `states seen: ${[...states].join(', ')}`);
  const f3 = ['"f3-cards-suspended"', '"f3-card-expired"'].map((k) => stages[0].out[k]);
  assert(f3.every((v) => v.state === 'active' && v.profile !== null),
    'F3 characterisation: a Tap whose cards are all suspended or expired is no longer served on the baseline');
  return 'active, paused, unavailable; F3: served with all cards suspended or expired (today\'s behaviour)';
});

for (const stage of stages.slice(1)) {
  check(`${stage.label}: byte-identical to the live baseline`, () => {
    const diffs = Object.keys(stages[0].out)
      .filter((k) => JSON.stringify(stage.out[k]) !== JSON.stringify(stages[0].out[k]));
    assert(diffs.length === 0, `differs for ${diffs.join(', ')}`);
    return `${Object.keys(stage.out).length} slugs identical`;
  });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
