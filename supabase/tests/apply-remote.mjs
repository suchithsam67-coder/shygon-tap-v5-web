import { MIGRATIONS_DIR, newMigrations } from './lib/migrations.mjs';
import { checkArgs, checkTarget, loadAllowlist } from './lib/push-guard.mjs';

/**
 * `npm run db:push`: applies NEW migrations to a NON-PRODUCTION Supabase
 * project through the Management API.
 *
 * Guarded by DEC-2026-023 S1, as narrowed by amendment A-1 (2026-10-02):
 *   - the committed allowlist supabase/non-production-projects.json is the
 *     only gate, with no override flag. A project ref that is not on it is
 *     refused, and so is any project if the file is missing or malformed.
 *     The production project is never listed. Production changes go through
 *     the approved pipeline or documented break-glass, never this script;
 *   - only migrations numbered 020 and up are sent. 001–019 are history
 *     (applied on live before the live baseline was captured) and are never
 *     re-applied;
 *   - every check runs before any network call.
 *
 * Needs, from the environment only (nothing is stored in this repo):
 *   SUPABASE_PROJECT_REF    the 20-character ref of an ALLOWLISTED project
 *   SUPABASE_ACCESS_TOKEN   a personal access token (a full-account credential:
 *                           never put it in a file, and never print it)
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<allowlisted ref> npm run db:push
 */

const API = 'https://api.supabase.com';

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// --- 1. the guard: no network call happens before every check passes --------
const args = checkArgs(process.argv.slice(2));
if (!args.ok) die(`REFUSED: ${args.reason}`);

const target = checkTarget(process.env.SUPABASE_PROJECT_REF, loadAllowlist());
if (!target.ok) {
  die(
    [
      `REFUSED: ${target.reason}`,
      '',
      'db:push only targets projects listed in supabase/non-production-projects.json.',
      'To use a NON-production project, add it there in a reviewed commit',
      '(Data Owner + Security Owner; DEC-2026-023 amendment A-1). Never list production.',
      'Production changes go through the approved pipeline or documented break-glass.',
    ].join('\n'),
  );
}
const ref = target.ref;

// --- 2. the plan: 020 onward only ------------------------------------------
const migrations = newMigrations(MIGRATIONS_DIR);
console.log(`\nTarget: ${ref} (on the non-production allowlist)`);
console.log(
  `Plan: ${migrations.length} migration(s) numbered 020 or higher. ` +
    '001–019 are history and are never sent.',
);
for (const { name } of migrations) console.log(`  - ${name}`);
if (migrations.length === 0) {
  console.log('\nNothing to apply.\n');
  process.exit(0);
}

// --- 3. the credential, from the environment only ----------------------------
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
if (!token) {
  die('Missing SUPABASE_ACCESS_TOKEN: a personal access token from https://supabase.com/dashboard/account/tokens');
}

async function api(pathname, init = {}) {
  const response = await fetch(API + pathname, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : (body?.message ?? JSON.stringify(body));
    throw new Error(`${response.status} ${detail}`);
  }
  return body;
}

// --- 4. confirm the project exists and is reachable before changing anything --
let project;
try {
  project = await api(`/v1/projects/${ref}`);
} catch (error) {
  if (String(error.message).startsWith('401')) {
    die('That access token was rejected. Generate a new one at\nhttps://supabase.com/dashboard/account/tokens');
  }
  if (String(error.message).startsWith('404')) {
    die(`No project "${ref}" on this account.\nCheck the ref, or create the project first at https://supabase.com/dashboard`);
  }
  die(`Could not reach the project: ${error.message}`);
}

console.log(`\nProject: ${project.name}  (${project.region}, ${project.status})`);
if (project.status !== 'ACTIVE_HEALTHY') {
  console.log(`WARNING: status is ${project.status}. A paused project must be resumed first.`);
}

// --- 5. apply, in order, stopping at the first failure ------------------------
console.log(`Applying ${migrations.length} migration(s)…\n`);

for (const { name, sql: query } of migrations) {
  process.stdout.write(`  ${name} … `);
  try {
    await api(`/v1/projects/${ref}/database/query`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    console.log('ok');
  } catch (error) {
    console.log('FAILED');
    console.error(`\n  ${error.message}\n`);
    console.error('  Nothing after this file was applied. Fix and re-run —');
    console.error('  every migration is idempotent, so re-running is safe.\n');
    process.exit(1);
  }
}

// --- 6. report what landed -----------------------------------------------------
const rows = await api(`/v1/projects/${ref}/database/query`, {
  method: 'POST',
  body: JSON.stringify({
    query: `SELECT sku, ui_tier, price_in_paise
            FROM public.products
            WHERE product_type IN ('digital_plan','lifetime_plan') AND active
            ORDER BY sort_order`,
  }),
});

console.log('\nActive digital catalog:');
for (const row of rows ?? []) {
  console.log(`  ${row.sku.padEnd(20)} ${String(row.ui_tier ?? '—').padEnd(10)} ₹${row.price_in_paise / 100}`);
}
console.log('\nAll migrations applied.\n');
