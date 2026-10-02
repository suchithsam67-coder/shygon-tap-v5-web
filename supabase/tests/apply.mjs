import { createLiveDb, newMigrations, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * Executes the SHYGON migrations against a real Postgres (PGlite/WASM) to prove
 * they run, rather than only reading them.
 *
 * Since DEC-2026-023 (Option A) the database starts from the authoritative
 * live schema baseline, not from the old hand-written stand-in:
 *   live-platform-shim.sql + supabase/baseline/000_live_baseline.sql
 *   + live-auth-shim.sql   (see ./lib/live-db.mjs)
 * and only migrations 020 onward are applied. 001–019 were applied to live
 * before the baseline was captured; they are history and are never re-run.
 *
 *   node supabase/tests/apply.mjs [migrations-dir] [only-number]
 */

const DIR = process.argv[2] ?? MIGRATIONS_DIR;
const ONLY = process.argv[3] ? Number(process.argv[3]) : null;

async function run(db, label, sql) {
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

console.log('\n=== baseline: the live schema (supabase/baseline/000_live_baseline.sql) ===');
let db;
try {
  db = await createLiveDb();
  console.log('  PASS  live baseline loaded');
} catch (error) {
  console.log(`  FAIL  live baseline\n        ${error.message}`);
  process.exit(1);
}

const migrations = newMigrations(DIR, ONLY);

console.log('\n=== migrations (020 onward; 001–019 are history and are not re-run) ===');
if (migrations.length === 0) console.log('  (none yet)');
let failed = 0;
for (const { name, sql } of migrations) {
  if (!(await run(db, name, sql))) {
    failed++;
    break; // later files assume earlier ones landed
  }
}

if (failed === 0 && migrations.length > 0) {
  console.log('\n=== idempotency: running every migration a second time ===');
  for (const { name, sql } of migrations) {
    if (!(await run(db, name + ' (re-run)', sql))) {
      failed++;
      break;
    }
  }
}

console.log(failed === 0 ? '\nALL MIGRATIONS APPLIED\n' : '\nSTOPPED ON FAILURE\n');
process.exit(failed === 0 ? 0 : 1);
