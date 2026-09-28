import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Applies every migration to a real Supabase project through the Management
 * API, so nobody has to paste SQL by hand.
 *
 * Needs two things, neither of which is stored in this repo:
 *
 *   SUPABASE_ACCESS_TOKEN   a personal access token from
 *                           https://supabase.com/dashboard/account/tokens
 *   SUPABASE_PROJECT_REF    the 20-character ref in your project URL,
 *                           https://<ref>.supabase.co
 *
 * Run it as:
 *   SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=abcd… npm run db:push
 *
 * The token is read from the environment and never written anywhere. It is a
 * full-account credential — do not paste it into a file that gets committed.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'migrations');
const API = 'https://api.supabase.com';

const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const ref = process.env.SUPABASE_PROJECT_REF?.trim();

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!token || !ref) {
  die(
    [
      'Missing credentials.',
      '',
      '  SUPABASE_ACCESS_TOKEN  ' + (token ? 'set' : 'NOT SET — https://supabase.com/dashboard/account/tokens'),
      '  SUPABASE_PROJECT_REF   ' + (ref ? ref : 'NOT SET — the 20 chars in https://<ref>.supabase.co'),
      '',
      'Then: SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=… npm run db:push',
      '',
      'No token? Paste supabase/APPLY_ALL.sql into the dashboard SQL editor instead.',
    ].join('\n'),
  );
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

// --- confirm the project exists and is reachable before changing anything ---
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

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log(`Applying ${files.length} migrations…\n`);

for (const file of files) {
  const query = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  process.stdout.write(`  ${file} … `);
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

// --- report what landed ------------------------------------------------------
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
