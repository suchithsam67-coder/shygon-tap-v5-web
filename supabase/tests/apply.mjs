import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Executes the SHYGON migrations against a real Postgres (PGlite/WASM) to prove
 * they run, rather than only reading them.
 *
 * Two things Supabase provides that a bare Postgres does not, shimmed below:
 *   - the `auth` schema (`auth.users`, `auth.uid()`)
 *   - the `anon` / `authenticated` / `service_role` roles that GRANT targets
 *
 * And the four tables the live project already had before migration 001 — the
 * migrations only ALTER those, they never create them. The column list comes
 * from the header comment in 002, which recorded what was actually live.
 */

// fileURLToPath, not `.pathname` — the latter leaves %20 in place, and this
// project lives under a directory with a space in its name.
const MIGRATIONS_DIR =
  process.argv[2] ?? fileURLToPath(new URL('../migrations', import.meta.url));
const ONLY = process.argv[3] ? Number(process.argv[3]) : null;

const BASELINE = fs.readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8');

const db = await PGlite.create();

async function run(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  PASS  ${label}`);
    return true;
  } catch (error) {
    console.log(`  FAIL  ${label}`);
    console.log(`        ${String(error.message).split('\n').join('\n        ')}`);
    if (error.position) {
      const pos = Number(error.position);
      const near = sql.slice(Math.max(0, pos - 220), pos + 120);
      const line = sql.slice(0, pos).split('\n').length;
      console.log(`        --- at line ~${line}, near: ---`);
      console.log(
        near
          .split('\n')
          .map((l) => '        | ' + l)
          .join('\n'),
      );
    }
    return false;
  }
}

console.log('\n=== baseline (what the live project already had) ===');
if (!(await run('baseline', BASELINE))) process.exit(1);

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

console.log('\n=== migrations ===');
let failed = 0;
for (const file of files) {
  const n = Number(file.slice(0, 3));
  if (ONLY !== null && n !== ONLY) continue;
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const ok = await run(file, sql);
  if (!ok) {
    failed++;
    break; // later files assume earlier ones landed
  }
}

if (failed === 0) {
  console.log('\n=== idempotency: running every migration a second time ===');
  for (const file of files) {
    const n = Number(file.slice(0, 3));
    if (ONLY !== null && n !== ONLY) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    if (!(await run(file + ' (re-run)', sql))) {
      failed++;
      break;
    }
  }
}

console.log(failed === 0 ? '\nALL MIGRATIONS APPLIED\n' : '\nSTOPPED ON FAILURE\n');
process.exit(failed === 0 ? 0 : 1);
