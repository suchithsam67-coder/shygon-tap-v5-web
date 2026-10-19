import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, MIGRATIONS_DIR, ROOT } from './lib/live-db.mjs';

/**
 * Admin contract (doc 12 §2 contract freeze; M0.3 scope §5).
 *
 * The external Admin APK and the public Tap call these functions. Their
 * signatures, return types, security mode, search_path and EXECUTE grants must
 * never change, and their bodies may change only where an approved milestone
 * says so. This suite proves it for the migrations in this branch:
 *
 *   1. the snapshot taken from the live schema baseline equals the committed
 *      golden file (supabase/tests/golden/admin-contract.json);
 *   2. after migrations 020 onward, every frozen function still matches it,
 *      body and grants included, except what an approved decision lists
 *      (APPROVED_BODY_CHANGES, APPROVED_ACL_CHANGES);
 *   3. each approved change is exactly the approved one: body replacements
 *      applied to the live text, grants revoked from exactly the listed roles;
 *   4. nothing else in the schema moved: every other existing function, every
 *      policy (except APPROVED_POLICY_CHANGES), every existing relation's
 *      grants and every pre-existing trigger is identical, and every new
 *      relation (APPROVED_NEW_RELATIONS) is closed to anon/authenticated/PUBLIC
 *      with row level security on.
 *
 *   node supabase/tests/admin-contract.mjs [migrations-dir]   check
 *   node supabase/tests/admin-contract.mjs --write            regenerate the golden file
 *                                                             from the baseline (review the diff)
 */

const GOLDEN = path.join(ROOT, 'supabase', 'tests', 'golden', 'admin-contract.json');
const WRITE = process.argv.includes('--write');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? MIGRATIONS_DIR;

// Doc 12 §2: "Signatures/return shapes frozen" (plus every admin_* function).
const FROZEN_NAMES = [
  'get_public_profile', 'get_public_tap_state', 'get_public_tap', 'record_tap_event',
  'get_tap_analytics', 'get_tap_link_clicks', 'tap_edit_state', 'theme_options', 'tier_rank',
  'user_max_ui_tier', 'user_has_pass', 'claim_tap_slug', 'provision_tap_on_payment',
  'is_admin', 'admin_has', 'require_admin', 'admin_audit', 'card_apply_verified_action',
];

// Bodies an approved decision changes. Everything else must be byte-identical.
const D_U4 = [
  // [baseline text, approved text] — DEC-2026-024 D-U4; the owner's wording (title 2026-10-05, body 2026-10-03).
  ["NEW.user_id, NEW.user_id, true, 'active', v_slug,", "NEW.user_id, NEW.user_id, false, 'draft', v_slug,"],
  ["'Your SHYGON Tap is live'", "'Your SHYGON Tap draft is ready'"],
  [
    "'Your Tap page has been created automatically. Complete your profile whenever you are ready.'",
    "'Your Tap page has been created. Review and publish it from your SHYGON dashboard.'",
  ],
];
// F2 (migration 022, DEC-2026-035 / V6-010): the admin note moves off the
// customer's order row into order_admin_notes. Same JSON shape for the admin app.
const F2_GET = [[
  "    'order', to_jsonb(o) - 'customer_id',\n",
  "    'order', (to_jsonb(o) - 'customer_id') || jsonb_build_object('admin_note',\n        (SELECT n.note FROM public.order_admin_notes n WHERE n.order_id = o.id)),\n",
]];
const F2_UPD = [
  ["    admin_note       = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),\n", ''],
  [
    "  WHERE id = p_order_id;\n\n  -- Cards leave the building with the order they belong to.\n",
    "  WHERE id = p_order_id;\n\n  -- The note is internal: it lives in order_admin_notes, which no customer can\n  -- read, not on the customer's own order row. A blank note keeps the existing one.\n  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN\n    INSERT INTO public.order_admin_notes (order_id, note, updated_by, updated_at)\n    VALUES (p_order_id, btrim(p_note), v_admin, NOW())\n    ON CONFLICT (order_id) DO UPDATE\n      SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;\n  END IF;\n\n  -- Cards leave the building with the order they belong to.\n",
  ],
];
// V6-073 + V6-032 (migration 025, DEC-2026-035): salted daily visitor hash,
// 10-second dedupe and a per-visitor hourly cap. Same signature and grants.
const V6_073 = [
  ["  v_ref     TEXT;\nBEGIN\n",
   "  v_ref     TEXT;\n  v_day     DATE;\n  v_salt    TEXT;\n  v_hash    TEXT;\n  v_link    TEXT;\nBEGIN\n"],
  ["  INSERT INTO public.tap_events\n    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)\n  VALUES (\n    v_tap_id,\n    p_event,\n    left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),\n    md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||\n        to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),\n",
   "  -- V6-073: the visitor hash is salted with a random value per UTC day. The\n  -- salt never leaves the database and is deleted after two days, so a hash\n  -- cannot be reversed to an IP address and user agent by brute force, nor\n  -- linked across days. Unique visitors per day still count correctly.\n  v_day := (NOW() AT TIME ZONE 'UTC')::date;\n  INSERT INTO public.tap_visitor_salts (day, salt)\n  VALUES (v_day, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))\n  ON CONFLICT (day) DO NOTHING;\n  SELECT s.salt INTO v_salt FROM public.tap_visitor_salts s WHERE s.day = v_day;\n  DELETE FROM public.tap_visitor_salts WHERE day < v_day - 1;\n  v_hash := encode(sha256(convert_to(\n    v_salt || '|' || COALESCE(v_ua, '') || '|' || COALESCE(v_ip, ''), 'UTF8')), 'hex');\n  v_link := left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48);\n\n  -- V6-032: the same visitor sending the same event within 10 seconds counts\n  -- once (double taps, reloads), and no visitor records more than 60 events\n  -- on one Tap in an hour. Both read idx_tap_events_profile_visitor_time.\n  IF EXISTS (\n       SELECT 1 FROM public.tap_events e\n       WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash\n         AND e.event_type = p_event AND e.link_key IS NOT DISTINCT FROM v_link\n         AND e.occurred_at > NOW() - INTERVAL '10 seconds')\n     OR (SELECT count(*) FROM public.tap_events e\n         WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash\n           AND e.occurred_at > NOW() - INTERVAL '1 hour') >= 60 THEN\n    RETURN;\n  END IF;\n\n  INSERT INTO public.tap_events\n    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)\n  VALUES (\n    v_tap_id,\n    p_event,\n    v_link,\n    v_hash,\n"],
];
// V6-071 (migration 025, DEC-2026-035): the owner's visibility list is kept as
// given; phone and email are no longer forced back on. Not a frozen function,
// so "no other existing function changed" defers to this entry.
const V6_071 = [
  ["NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[]) || ARRAY['phone','email']) AS u(value) WHERE value<>'' ORDER BY value);",
   "NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[])) AS u(value) WHERE value<>'' ORDER BY value);"],
];
const APPROVED_BODY_CHANGES = {
  'provision_tap_on_payment()': {
    decision: 'DEC-2026-024 D-U4 (migration 021)', replacements: D_U4,
    summary: 'published/status, notification title and body; nothing else',
  },
  'admin_get_order(uuid)': {
    decision: 'DEC-2026-035 V6-010 F2 (migration 022)', replacements: F2_GET,
    summary: 'order.admin_note read from order_admin_notes; nothing else',
  },
  'admin_update_order_status(uuid,text,text,text,text)': {
    decision: 'DEC-2026-035 V6-010 F2 (migration 022)', replacements: F2_UPD,
    summary: 'note written to order_admin_notes instead of the order row; nothing else',
  },
  'record_tap_event(text,text,text)': {
    decision: 'DEC-2026-035 V6-073 + V6-032 (migration 025)', replacements: V6_073,
    summary: 'salted daily visitor hash, dedupe and hourly cap; nothing else',
  },
  'enforce_tap_edit_rules()': {
    decision: 'DEC-2026-035 V6-071 (migration 025)', replacements: V6_071,
    summary: 'phone and email no longer forced visible; nothing else',
  },
};

// EXECUTE grants an approved decision removes. Grantee '' is PUBLIC. Every
// other grant on every frozen function must stay exactly as on live.
const APPROVED_ACL_CHANGES = {
  'require_admin(text)': { decision: 'DEC-2026-035 V6-030 O-1 (migration 024)', remove: ['anon'] },
  'admin_has(text)': { decision: 'DEC-2026-035 V6-030 O-1 (migration 024)', remove: ['', 'anon'] },
  'get_public_tap(text)': { decision: 'DEC-2026-035 V6-071 (migration 025)', remove: ['anon', 'authenticated'] },
};

// Policies an approved decision removes or re-targets. Their USING / WITH CHECK
// expressions must stay identical; any other policy change fails.
const OWNER_OR_ADMIN = ['cards', 'notifications', 'orders', 'profiles', 'support_messages',
  'support_tickets', 'tap_events', 'tap_profiles'].map((t) => `${t}.${t}_select_owner_or_admin`);
const APPROVED_POLICY_CHANGES = {
  removed: { 'tap_profiles.tap_profiles_insert_own': 'DEC-2026-035 D-6, O-14 (migration 023)' },
  roles: Object.fromEntries(OWNER_OR_ADMIN.map((p) => [p, { to: '{authenticated}', decision: 'DEC-2026-035 V6-030 F6 (migration 024)' }])),
};

// Relations an approved decision adds. None may be reachable by anon,
// authenticated or PUBLIC, and each must have row level security on.
const APPROVED_NEW_RELATIONS = {
  order_admin_notes: 'DEC-2026-035 V6-010 F2 (migration 022)',
  tap_visitor_salts: 'DEC-2026-035 V6-073 (migration 025)',
};

// New admin_* functions (new names, not overloads), with their decision.
// state 'PROPOSED' passes the check but is reported as not approved.
const NEW_ADMIN_FUNCTIONS = {
  'admin_list_emergency_events(text,integer,integer)': { decision: 'DEC-2026-038 (migration 029)', state: 'PROPOSED' },
};

// Relations a PROPOSED decision adds. Held to the same rule (closed, RLS on),
// but NOT approved: the check names them as pending so the gate output says so.
// Move an entry to APPROVED_NEW_RELATIONS only when the owner approves it.
const PROPOSED_NEW_RELATIONS = Object.fromEntries([
  'emergency_settings', 'emergency_contacts', 'emergency_contact_challenges', 'emergency_events',
  'emergency_event_recipients', 'emergency_delivery_attempts', 'emergency_audit',
].map((t) => [t, 'DEC-2026-038 PROPOSED (migration 029)']));

const aclItems = (acl) => (acl ? acl.replace(/^\{|\}$/g, '').split(',').filter(Boolean) : []);
const grantee = (item) => item.slice(0, item.indexOf('='));

const FUNCTIONS_SQL = `
  SELECT p.oid::regprocedure::text AS signature,
         p.proname AS name,
         pg_get_function_arguments(p.oid) AS arguments,
         pg_get_function_result(p.oid) AS result,
         l.lanname AS language,
         p.prosecdef AS security_definer,
         p.provolatile::text AS volatility,
         COALESCE(array_to_string(p.proconfig, ' | '), '') AS config,
         COALESCE(p.proacl::text, '') AS acl,
         md5(p.prosrc) AS body_md5,
         p.prosrc AS body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
  ORDER BY 1`;

const isFrozen = (name) => name.startsWith('admin_') || FROZEN_NAMES.includes(name);
const contractOf = ({ body, ...rest }) => rest; // the golden file stores the hash, not the text

async function snapshot(db) {
  const all = (await db.query(FUNCTIONS_SQL)).rows;
  const policies = (await db.query(
    `SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
     FROM pg_policies ORDER BY 1, 2, 3`,
  )).rows;
  const tableGrants = (await db.query(
    `SELECT c.relname, COALESCE(c.relacl::text, '') AS acl, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'S') ORDER BY 1`,
  )).rows;
  const triggers = (await db.query(
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def, t.tgenabled::text AS enabled
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2`,
  )).rows;
  return { all, policies, tableGrants, triggers };
}

const byKey = (rows, key) => new Map(rows.map((r) => [key(r), r]));

// --- build ---------------------------------------------------------------------

const baseDb = await createLiveDb();
const base = await snapshot(baseDb);
const frozenBase = base.all.filter((f) => isFrozen(f.name)).map(contractOf);
const missing = FROZEN_NAMES.filter((n) => !base.all.some((f) => f.name === n));

if (WRITE) {
  const golden = {
    description:
      'Contract snapshot of the doc 12 §2 frozen functions and every admin_* function, taken from ' +
      'supabase/baseline/000_live_baseline.sql. Generated by `node supabase/tests/admin-contract.mjs --write`. ' +
      'Do not edit by hand; a change here is a contract change and needs a decision.',
    frozenNamesNotOnLive: missing,
    functions: frozenBase,
  };
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, GOLDEN)} (${frozenBase.length} functions)`);
  process.exit(0);
}

const migDb = await createLiveDb();
const applied = [];
for (const { name, sql } of newMigrations(DIR)) {
  await migDb.exec(sql);
  applied.push(name);
}
const mig = await snapshot(migDb);

// --- checks --------------------------------------------------------------------

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

function diffRows(expected, actual, key, fields) {
  const a = byKey(actual, key);
  const problems = [];
  for (const e of expected) {
    const got = a.get(key(e));
    if (!got) { problems.push(`${key(e)}: missing`); continue; }
    for (const f of fields) {
      if (got[f] !== e[f]) problems.push(`${key(e)}.${f}: ${JSON.stringify(e[f])} -> ${JSON.stringify(got[f])}`);
    }
  }
  return problems;
}

const SIGNATURE_FIELDS = ['name', 'arguments', 'result', 'language', 'security_definer', 'volatility', 'config', 'acl'];

console.log(`\n=== admin contract (baseline vs baseline + ${applied.join(', ') || 'no migrations'}) ===`);

await check('the golden file is the live baseline snapshot', () => {
  assert(fs.existsSync(GOLDEN), `${path.relative(ROOT, GOLDEN)} is missing; run with --write and review it`);
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert(JSON.stringify(golden.functions) === JSON.stringify(frozenBase),
    'the baseline snapshot differs from the golden file (baseline or golden edited?)');
  assert(JSON.stringify(golden.frozenNamesNotOnLive) === JSON.stringify(missing), 'frozen-name coverage changed');
  return `${frozenBase.length} functions${missing.length ? `; not on live: ${missing.join(', ')}` : ''}`;
});

await check('every frozen function keeps its signature, return type, security, search_path and grants', () => {
  const frozenMig = mig.all.filter((f) => isFrozen(f.name));
  const fixedAcl = frozenBase.filter((f) => !APPROVED_ACL_CHANGES[f.signature]);
  const problems = [
    ...diffRows(fixedAcl, frozenMig, (f) => f.signature, SIGNATURE_FIELDS),
    ...diffRows(frozenBase.filter((f) => APPROVED_ACL_CHANGES[f.signature]), frozenMig, (f) => f.signature,
      SIGNATURE_FIELDS.filter((x) => x !== 'acl')),
  ];
  const added = frozenMig.filter((f) => !frozenBase.some((b) => b.signature === f.signature));
  // A new signature under a name that already exists is an overload: it can
  // change which function an existing caller reaches. Never allowed.
  const overloads = added.filter((f) => frozenBase.some((b) => b.name === f.name)).map((f) => f.signature);
  // A brand-new admin_* name breaks no existing caller, but it is still part of
  // the admin contract, so it must be listed with its decision.
  const unlisted = added.filter((f) => !overloads.includes(f.signature) && !NEW_ADMIN_FUNCTIONS[f.signature]).map((f) => f.signature);
  assert(problems.length === 0, problems.join('; '));
  assert(overloads.length === 0, `new overloads of frozen names: ${overloads.join(', ')}`);
  assert(unlisted.length === 0, `new admin functions without a decision: ${unlisted.join(', ')}`);
  const pending = added.filter((f) => NEW_ADMIN_FUNCTIONS[f.signature]?.state === 'PROPOSED').map((f) => f.signature);
  return `${frozenBase.length} unchanged (grants of ${Object.keys(APPROVED_ACL_CHANGES).join(', ')} checked below)` +
    (pending.length ? `; new, PROPOSED, NOT APPROVED: ${pending.join(', ')}` : '');
});

for (const [signature, { decision, remove }] of Object.entries(APPROVED_ACL_CHANGES)) {
  await check(`${signature}: EXECUTE grants differ from live by exactly the approved revoke (${decision})`, () => {
    const before = aclItems(base.all.find((f) => f.signature === signature).acl);
    const after = aclItems(mig.all.find((f) => f.signature === signature).acl);
    for (const g of remove) assert(before.some((i) => grantee(i) === g), `live has no grant to ${g || 'PUBLIC'} to revoke`);
    const expected = before.filter((i) => !remove.includes(grantee(i)));
    assert(JSON.stringify([...after].sort()) === JSON.stringify([...expected].sort()),
      `grants ${JSON.stringify(after)}, expected ${JSON.stringify(expected)}`);
    return `revoked from ${remove.map((g) => g || 'PUBLIC').join(', ')}; ${after.length} grants kept`;
  });
}

await check('every frozen body is byte-identical, except the approved changes', () => {
  const m = byKey(mig.all, (f) => f.signature);
  const changed = frozenBase.filter((f) => m.get(f.signature).body_md5 !== f.body_md5).map((f) => f.signature);
  const unapproved = changed.filter((s) => !APPROVED_BODY_CHANGES[s]);
  assert(unapproved.length === 0, `body changed without a decision: ${unapproved.join(', ')}`);
  return changed.length ? `changed (approved): ${changed.join(', ')}` : 'none changed';
});

for (const [signature, { decision, replacements }] of Object.entries(APPROVED_BODY_CHANGES)) {
  await check(`${signature}: the body differs from live by exactly the approved edit (${decision})`, () => {
    const before = base.all.find((f) => f.signature === signature).body;
    const after = mig.all.find((f) => f.signature === signature).body;
    let expected = before;
    for (const [from, to] of replacements) {
      assert(expected.split(from).length === 2, `the baseline body does not contain ${JSON.stringify(from)} exactly once`);
      expected = expected.replace(from, () => to);
    }
    assert(after === expected, 'the migrated body is not the baseline body with only the approved replacements');
    return APPROVED_BODY_CHANGES[signature].summary;
  });
}

await check('no other existing function changed (signature, body, grants)', () => {
  const others = base.all.filter((f) => !isFrozen(f.name));
  const approved = others.filter((f) => APPROVED_BODY_CHANGES[f.signature]);
  const problems = [
    ...diffRows(others.filter((f) => !APPROVED_BODY_CHANGES[f.signature]), mig.all, (f) => f.signature, [...SIGNATURE_FIELDS, 'body_md5']),
    // An approved body change (checked above) keeps everything else.
    ...diffRows(approved, mig.all, (f) => f.signature, SIGNATURE_FIELDS),
  ];
  assert(problems.length === 0, problems.join('; '));
  const added = mig.all.filter((f) => !base.all.some((b) => b.signature === f.signature)).map((f) => f.signature);
  return `${others.length - approved.length} unchanged; body approved: ${approved.map((f) => f.signature).join(', ') || 'none'}; new: ${added.join(', ') || 'none'}`;
});

await check('no policy changed, added or removed, except the approved ones', () => {
  const key = (p) => `${p.tablename}.${p.policyname}`;
  const m = byKey(mig.policies, key);
  const problems = [];
  for (const p of base.policies) {
    const k = key(p);
    const got = m.get(k);
    if (APPROVED_POLICY_CHANGES.removed[k]) {
      if (got) problems.push(`${k}: should have been removed`);
      continue;
    }
    if (!got) { problems.push(`${k}: removed without a decision`); continue; }
    const roles = APPROVED_POLICY_CHANGES.roles[k]?.to ?? p.roles;
    for (const f of ['schemaname', 'permissive', 'cmd', 'qual', 'with_check']) {
      if (got[f] !== p[f]) problems.push(`${k}.${f} changed`);
    }
    if (got.roles !== roles) problems.push(`${k}.roles: ${p.roles} -> ${got.roles} (expected ${roles})`);
  }
  const added = mig.policies.filter((p) => !base.policies.some((b) => key(b) === key(p))).map(key);
  if (added.length) problems.push(`added without a decision: ${added.join(', ')}`);
  assert(problems.length === 0, problems.join('; '));
  const removed = Object.keys(APPROVED_POLICY_CHANGES.removed).length;
  const retargeted = Object.keys(APPROVED_POLICY_CHANGES.roles).length;
  return `${base.policies.length - removed - retargeted} identical; ${retargeted} re-targeted to authenticated; ${removed} removed`;
});

await check('no table grant or RLS switch changed on existing relations; new ones are closed', () => {
  const m = byKey(mig.tableGrants, (r) => r.relname);
  const problems = diffRows(base.tableGrants, mig.tableGrants, (r) => r.relname, ['acl', 'relrowsecurity', 'relforcerowsecurity']);
  const added = mig.tableGrants.filter((r) => !base.tableGrants.some((b) => b.relname === r.relname));
  for (const r of added) {
    if (!APPROVED_NEW_RELATIONS[r.relname] && !PROPOSED_NEW_RELATIONS[r.relname]) {
      problems.push(`${r.relname}: new relation without a decision`);
      continue;
    }
    const open = aclItems(r.acl).filter((i) => ['', 'anon', 'authenticated'].includes(grantee(i)));
    if (open.length) problems.push(`${r.relname}: reachable by ${open.join(', ')}`);
    if (!r.relrowsecurity) problems.push(`${r.relname}: row level security is off`);
  }
  assert(problems.length === 0, problems.join('; '));
  assert(m.size === base.tableGrants.length + added.length, 'a relation disappeared');
  const pending = added.filter((r) => PROPOSED_NEW_RELATIONS[r.relname]).map((r) => r.relname);
  const approved = added.filter((r) => APPROVED_NEW_RELATIONS[r.relname]).map((r) => r.relname);
  return `${base.tableGrants.length} existing identical; new: ${approved.join(', ') || 'none'} (closed, RLS on)` +
    (pending.length ? `; PROPOSED, NOT APPROVED: ${pending.join(', ')} (closed, RLS on; DEC-2026-038)` : '');
});

await check('every pre-existing trigger is unchanged (new ones listed)', () => {
  const problems = diffRows(base.triggers, mig.triggers, (t) => `${t.relname}.${t.tgname}`, ['def', 'enabled']);
  assert(problems.length === 0, problems.join('; '));
  const added = mig.triggers
    .filter((t) => !base.triggers.some((b) => b.relname === t.relname && b.tgname === t.tgname))
    .map((t) => `${t.relname}.${t.tgname}`);
  return `${base.triggers.length} unchanged; new: ${added.join(', ') || 'none'}`;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
await baseDb.close();
await migDb.close();
process.exit(fail === 0 ? 0 : 1);
