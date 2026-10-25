import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createLiveDb, ROOT } from './lib/live-db.mjs';

/**
 * BQ-1 production variant (V6-106): verifies
 * supabase/proposed/035_public_profile_respects_mode.production.sql against a
 * production-equivalent database rebuilt from the owner's read-only evidence:
 *
 *   supabase/baseline/000_live_baseline.sql                  the 2026-09-30 capture
 *   supabase/tests/live-storage-shim.sql                     test-only Storage stand-in
 *   docs/governance/evidence/2026-10-18_production-schema-migrations.csv
 *                                                            the seven migrations production
 *                                                            recorded after it, replayed in order
 *
 * On 2026-10-18 the owner's VERIFY-LIVE-DRIFT.sql found that replay equal to
 * production (function bodies by hash, CRs removed). It is evidence of
 * production on that day, not a fresh capture: see the proposal's header.
 * Isolated in-memory PGlite only; nothing here connects anywhere.
 */

const CSV = path.join(ROOT, 'docs', 'governance', 'evidence', '2026-10-18_production-schema-migrations.csv');
const CSV_SHA256 = 'a9fd38c7791c54e253413a7f366efc6f9b15451b245d96ed85e11236d2a87bce';
const PROPOSAL = path.join(ROOT, 'supabase', 'proposed', '035_public_profile_respects_mode.production.sql');
const REPO_035 = path.join(ROOT, 'supabase', 'migrations', '035_public_profile_respects_mode.sql');
const M034 = path.join(ROOT, 'supabase', 'migrations', '034_modes_and_info.sql');
const PROD_MD5 = '4a70098823695f40395d7c32439ffc98'; // production's body, CRs removed
const BASELINE_MD5 = 'acbaff4f0fb3014a0a080cbf15267cd9'; // the 2026-09-30 body
const ANCHOR = 'IF NOT FOUND THEN RETURN NULL; END IF;';
const INSERT = ANCHOR +
  '\n  -- BQ-1 (migration 035, DEC-2026-041): while the Tap shows another mode' +
  '\n  -- (Info), its Business profile is not public through this reader either.' +
  "\n  IF EXISTS (SELECT 1 FROM public.tap_mode_state s" +
  "\n             WHERE s.tap_profile_id = v_tap.id AND s.active_mode <> 'business') THEN" +
  '\n    RETURN NULL;' +
  '\n  END IF;';

const read = (f) => fs.readFileSync(f, 'utf8');
const noCr = (s) => s.replace(/\r/g, '');
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// RFC 4180: quoted fields with "" escapes. The statements column is a JSON array.
function parseCsv(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const csvBytes = fs.readFileSync(CSV);
const [header, ...csvRows] = parseCsv(csvBytes.toString('utf8'));
const RECORDED = csvRows.map(([version, name, statements]) => ({ version, name, statements: JSON.parse(statements) }));

/** Production as of 2026-10-18, rebuilt from the evidence. */
async function createProductionDb({ with034 = true } = {}) {
  const db = await createLiveDb();
  await db.exec(read(path.join(ROOT, 'supabase', 'tests', 'live-storage-shim.sql')));
  for (const m of RECORDED) for (const s of m.statements) await db.exec(s);
  if (with034) await db.exec(read(M034));
  return db;
}

const FN = `'public.get_public_profile(text)'::regprocedure`;
async function fnInfo(db) {
  const { rows: [r] } = await db.query(`
    SELECT pg_get_functiondef(p.oid) AS def, p.prosrc AS src, md5(replace(p.prosrc, chr(13), '')) AS md5,
           pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer, p.proconfig AS config,
           p.provolatile AS volatility, pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid) AS result, p.proacl::text AS acl
    FROM pg_proc p WHERE p.oid = ${FN}`);
  return r;
}
const ATTRS = ['owner', 'definer', 'config', 'volatility', 'args', 'result', 'acl'];

/** Everything else the change must leave alone: functions, privileges, policies. */
async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows.map((r) => JSON.stringify(r));
  return {
    functions: await q(`
      SELECT p.oid::regprocedure::text AS fn, md5(replace(p.prosrc, chr(13), '')) AS body,
             pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.provolatile, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.oid <> ${FN} ORDER BY 1`),
    tableGrants: await q(`
      SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' ORDER BY 1, 2, 3`),
    policies: await q(`
      SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
      FROM pg_policies ORDER BY 1, 2, 3`),
  };
}

// Same shape as supabase/tests/golden-public-tap.mjs, plus production's page
// families (tap_profiles.page_template) and card families (event, restaurant).
const id = (n) => `${String(n).padStart(2, '0')}b00000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
// [n, slug, display name, tap columns, entitlements [type, key, active], card skus]
const TAPS = [
  [1, 'ess-active', 'Essential Active', { selected_ui_tier: 'essential' }, [], []],
  [2, 'biz-active', 'Business Active', { selected_ui_tier: 'business', theme_layout: 'centered' }, [['digital_plan', 'business', true]], []],
  [3, 'prem-active', 'Premium Active', { selected_ui_tier: 'premium', theme_palette: 'aurora' }, [['digital_plan', 'premium', true]], []],
  [4, 'goat-active', 'Goat Active', { selected_ui_tier: 'goat', theme_palette: 'prism' }, [['digital_plan', 'goat', true]], []],
  [5, 'clamped-goat', 'Clamped Goat', { selected_ui_tier: 'goat', theme_palette: 'neon' }, [], []],
  [6, 'pass-holder', 'Pass Holder', { selected_ui_tier: 'essential' }, [['lifetime', 'lifetime', true]], []],
  [7, 'addons-owned', 'Addons Owned',
    { selected_ui_tier: 'business', enabled_customizations: ['phone', 'email', 'whatsapp', 'website', 'location', 'links'],
      custom_links: [{ label: 'Portfolio', url: 'https://example.test/portfolio' }] },
    [['digital_plan', 'business', true], ['customization', 'whatsapp', true], ['customization', 'website', true],
     ['customization', 'location', true], ['customization', 'links', true]], []],
  [8, 'addons-not-owned', 'Addons Not Owned', { enabled_customizations: ['phone', 'email', 'whatsapp', 'website'] }, [], []],
  [9, 'page-restaurant', 'Page Restaurant', { page_template: 'restaurant', enabled_customizations: ['phone', 'location', 'website'] }, [], []],
  [10, 'page-event', 'Page Event', { page_template: 'event', enabled_customizations: ['location', 'website', 'links'] }, [], ['card-event-golden']],
  [11, 'page-review', 'Page Review', { page_template: 'review' }, [], ['card-restaurant-golden']],
  [12, 'page-business', 'Page Business', { page_template: 'business', selected_ui_tier: 'business' }, [['digital_plan', 'business', true]], []],
  [13, 'paused-tap', 'Paused Tap', { status: 'paused' }, [], []],
  [14, 'suspended-tap', 'Suspended Tap', { suspended_at: '2026-01-01T00:00:00Z', suspended_reason: 'fixture' }, [], []],
  [15, 'Mixed-Case', 'Mixed Case', {}, [], []],
];
const SLUGS = [...TAPS.map((t) => t[1]), 'mixed-case', '  ess-active  ', 'nobody-here', '', null];

async function seed(db) {
  await db.exec('GRANT USAGE ON SCHEMA public TO anon, authenticated;');
  for (const [n, slug, name, cols, ents, skus] of TAPS) {
    const uid = id(n);
    await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, jsonb_build_object('full_name', $3::text))`,
      [uid, `${slug.toLowerCase()}@example.test`, name]);
    const row = {
      user_id: uid, slug, username: slug, display_name: name, headline: `${name} headline`, designation: 'Founder',
      company: 'Example Co', bio: `Bio of ${name}.`, avatar_url: `https://example.test/${n}.png`, location: 'Bengaluru',
      phone: `+9190000001${String(n).padStart(2, '0')}`, whatsapp: `+9180000001${String(n).padStart(2, '0')}`,
      email: `${slug.toLowerCase()}@example.test`, website: 'https://example.test', status: 'active',
      enabled_customizations: ['phone', 'email'], created_at: '2026-01-01T00:00:00Z', provisioned_at: '2026-01-01T00:00:00Z',
      ...cols,
    };
    const keys = Object.keys(row);
    const values = keys.map((k) => (k === 'custom_links' ? JSON.stringify(row[k]) : row[k]));
    await db.query(
      `INSERT INTO public.tap_profiles (customer_id, ${keys.join(', ')})
       VALUES ((SELECT id FROM public.customers WHERE user_id = $1), ${keys.map((_, i) => `$${i + 2}`).join(', ')})`,
      [uid, ...values]);
    for (const [type, key, active] of ents) {
      await db.query(`INSERT INTO public.entitlements (user_id, type, key, is_active, granted_at) VALUES ($1, $2, $3, $4, '2026-01-01T00:00:00Z')`,
        [uid, type, key, active]);
    }
    for (const [i, sku] of skus.entries()) {
      await db.query(
        `INSERT INTO public.cards (user_id, tap_profile_id, card_id, activation_code, sku, card_slot, status)
         VALUES ($1, (SELECT id FROM public.tap_profiles WHERE user_id = $1), $2, $3, $4, $5, 'active')`,
        [uid, `BQ1P-${n}-${i + 1}`, `SHY-BQP-${n}${i + 1}`, sku, i + 1]);
    }
  }
}

async function render(db, slugs = SLUGS) {
  const out = {};
  await db.exec('SET ROLE anon;');
  try {
    for (const slug of slugs) {
      const { rows: [r] } = await db.query(
        `SELECT public.get_public_tap_state($1) AS state, public.get_public_profile($1)::text AS profile`, [slug]);
      out[slug === null ? '<null>' : JSON.stringify(slug)] = r;
    }
  } finally {
    await db.exec('RESET ROLE;');
  }
  return out;
}

function rollbackOf(sql) {
  const m = noCr(sql).match(/-- ROLLBACK \(begin\)\n([\s\S]*?)\n-- ROLLBACK \(end\)/);
  if (!m) throw new Error('no ROLLBACK block');
  return m[1].split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');
}
async function setMode(db, slug, mode) {
  await db.query(
    `INSERT INTO public.tap_mode_state (tap_profile_id, user_id, active_mode)
     SELECT t.id, t.user_id, $2 FROM public.tap_profiles t WHERE t.slug = $1
     ON CONFLICT (tap_profile_id) DO UPDATE SET active_mode = EXCLUDED.active_mode`, [slug, mode]);
}
async function refuses(db, sql, pattern) {
  try { await db.exec(sql); } catch (e) {
    await db.exec('ROLLBACK;').catch(() => {});
    if (!pattern.test(e.message)) throw new Error(`refused for another reason: ${e.message}`);
    return e.message;
  }
  throw new Error('it ran');
}

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diffKeys = (a, b) => Object.keys(a).filter((k) => !same(a[k], b[k]));

const proposal = read(PROPOSAL);
const FWD_MD5 = md5(noCr((await (async () => {
  const db = await createProductionDb({ with034: false });
  const { src } = await fnInfo(db);
  await db.close();
  return src;
})())).replace(ANCHOR, INSERT));

console.log('=== BQ-1 production variant (evidence of 2026-10-18; isolated PGlite) ===');

await check('the evidence is the recorded file, and the replay gives production\'s body', async () => {
  const sha = crypto.createHash('sha256').update(csvBytes).digest('hex');
  assert(sha === CSV_SHA256, `evidence sha256 ${sha}`);
  assert(header.join(',') === 'version,name,statements' && RECORDED.length === 7, `${RECORDED.length} migrations`);
  const db = await createProductionDb({ with034: false });
  const info = await fnInfo(db);
  await db.close();
  assert(info.md5 === PROD_MD5, `body md5 ${info.md5}`);
  assert(noCr(info.src).split(ANCHOR).length === 2, 'the anchor occurs once');
  assert(/'pageTemplate'/.test(info.src) && /tier_buttons/.test(info.src), 'production drift present');
  return `7 recorded migrations; body ${PROD_MD5} (baseline's is ${BASELINE_MD5})`;
});

await check('the proposal names the right hashes, and its ROLLBACK is the captured definition', async () => {
  assert(proposal.includes(`'${PROD_MD5}', '${FWD_MD5}'`), 'pre-check hashes');
  assert(proposal.includes(CSV_SHA256), 'evidence checksum');
  assert(!/^\s*(GRANT|REVOKE)\b/im.test(proposal.replace(/^--.*$/gm, '')), 'no GRANT or REVOKE');
  const db = await createProductionDb({ with034: false });
  const { def } = await fnInfo(db);
  await db.close();
  assert(rollbackOf(proposal) === noCr(def).replace(/\s*$/, '') + ';', 'ROLLBACK differs from the captured definition');
  return `forward ${FWD_MD5}`;
});

await check('refuses without 034, and nothing changes', async () => {
  const db = await createProductionDb({ with034: false });
  const msg = await refuses(db, proposal, /needs migration 034/);
  const info = await fnInfo(db);
  await db.close();
  assert(info.md5 === PROD_MD5, `body ${info.md5}`);
  return msg.slice(0, 60);
});

await check('migrations/035 also refuses without 034, and nothing changes (review #7)', async () => {
  const db = await createLiveDb();
  const msg = await refuses(db, read(REPO_035), /needs migration 034/);
  const info = await fnInfo(db);
  await db.close();
  assert(info.md5 === BASELINE_MD5, `body ${info.md5}`);
  return 'no reader that fails for every slug';
});

await check('refuses on any other body (the repository baseline), and nothing changes', async () => {
  const db = await createLiveDb();
  await db.exec(read(M034));
  const msg = await refuses(db, proposal, /not the captured production body/);
  const info = await fnInfo(db);
  await db.close();
  assert(info.md5 === BASELINE_MD5, `body ${info.md5}`);
  return 'no silent overwrite of a body it was not written for';
});

// The main run: one production-equivalent database, before / after / rollback.
const db = await createProductionDb();
await seed(db);
const before = { info: await fnInfo(db), snap: await snapshot(db), out: await render(db) };
await db.exec(proposal);
const after = { info: await fnInfo(db), snap: await snapshot(db), out: await render(db) };

await check('get_public_profile differs from production by exactly the guard', async () => {
  assert(noCr(after.info.src) === noCr(before.info.src).replace(ANCHOR, INSERT), 'the body is not production + guard');
  assert(after.info.md5 === FWD_MD5, `md5 ${after.info.md5}`);
  for (const k of ATTRS) assert(same(after.info[k], before.info[k]), `${k}: ${before.info[k]} -> ${after.info[k]}`);
  return `owner, SECURITY DEFINER, search_path, volatility, signature and grants (${before.info.acl}) unchanged`;
});

await check('every other function, table privilege and policy is unchanged', async () => {
  for (const k of Object.keys(before.snap)) {
    assert(same(before.snap[k], after.snap[k]), `${k} changed`);
  }
  return `${before.snap.functions.length} functions, ${before.snap.tableGrants.length} table grants, ${before.snap.policies.length} policies`;
});

await check('Business and no-state Taps: byte-identical output, production\'s pageTemplate kept', async () => {
  const changed = diffKeys(before.out, after.out);
  assert(changed.length === 0, `changed: ${changed.join(', ')}`);
  const served = Object.values(after.out).filter((r) => r.profile !== null).length;
  assert(served >= 14, `only ${served} slugs return a payload: the comparison would be vacuous`);
  const ev = JSON.parse(after.out['"page-event"'].profile);
  assert(ev.pageTemplate === 'event', `pageTemplate ${ev.pageTemplate}`);
  return `${SLUGS.length} slugs (${served} with a payload), incl. page families and card families`;
});

await check('while Info is live the legacy reader returns null; P-2 still answers active', async () => {
  await db.query(`UPDATE public.tap_mode_catalog SET enabled = true WHERE mode = 'info'`);
  await setMode(db, 'biz-active', 'info');
  await setMode(db, 'page-event', 'info');
  const out = await render(db);
  for (const s of ['"biz-active"', '"page-event"']) {
    assert(out[s].profile === null, `${s} still public`);
    assert(out[s].state === 'active', `${s} state ${out[s].state}`);
  }
  const others = diffKeys(before.out, out).filter((k) => !['"biz-active"', '"page-event"'].includes(k));
  assert(others.length === 0, `other Taps changed: ${others.join(', ')}`);
  return 'older clients show their "Tap not found" page, never Business';
});

await check('after the kill switch (Info off in the catalogue) it is still null', async () => {
  await db.query(`UPDATE public.tap_mode_catalog SET enabled = false WHERE mode = 'info'`);
  const out = await render(db, ['biz-active', 'page-event']);
  assert(out['"biz-active"'].profile === null && out['"page-event"'].profile === null, 'Business shown after the kill switch');
  return 'the guard reads the Tap\'s state, not the catalogue';
});

await check('switching back to Business restores the byte-identical payload', async () => {
  await setMode(db, 'biz-active', 'business');
  await setMode(db, 'page-event', 'business');
  const changed = diffKeys(before.out, await render(db));
  assert(changed.length === 0, `changed: ${changed.join(', ')}`);
});

await check('a re-run is accepted and changes nothing (idempotent)', async () => {
  await db.exec(proposal);
  const info = await fnInfo(db);
  assert(info.md5 === FWD_MD5, `md5 ${info.md5}`);
  assert(same(await snapshot(db), after.snap), 'snapshot changed');
  assert(diffKeys(before.out, await render(db)).length === 0, 'output changed');
});

await check('ROLLBACK restores the captured definition, attributes and grants exactly', async () => {
  await db.exec(rollbackOf(proposal));
  const info = await fnInfo(db);
  assert(info.md5 === PROD_MD5, `md5 ${info.md5}`);
  assert(noCr(info.def) === noCr(before.info.def), 'definition differs');
  for (const k of ATTRS) assert(same(info[k], before.info[k]), `${k}: ${info[k]}`);
  assert(same(await snapshot(db), before.snap), 'functions, privileges or policies differ');
  assert(diffKeys(before.out, await render(db)).length === 0, 'output differs');
  return 'equal to the capture (CRs aside: the evidence cannot show whether live stores them)';
});
await db.close();

await check('negative control: the baseline-derived migrations/035 would remove production\'s drift', async () => {
  const ctl = await createProductionDb();
  await seed(ctl);
  const pre = await render(ctl);
  await ctl.exec(read(REPO_035));
  const post = await render(ctl);
  await ctl.close();
  const changed = diffKeys(pre, post);
  assert(changed.length > 0, 'no change: the control proves nothing');
  const ev = JSON.parse(post['"page-event"'].profile);
  assert(!('pageTemplate' in ev), 'pageTemplate survived');
  return `${changed.length} slugs change; pageTemplate dropped: never apply migrations/035 to production`;
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
