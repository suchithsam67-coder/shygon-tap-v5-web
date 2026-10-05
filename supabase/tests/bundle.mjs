import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, ROOT } from './lib/live-db.mjs';

/**
 * Writes `supabase/APPLY_ALL.sql`: the migrations from 020 onward, in order,
 * and proves the bundle by executing it, twice, on the live schema baseline.
 *
 * Since SHYGON V6 (DEC-2026-035, backlog V6-040) the bundle contains ONLY the
 * migrations written for the live baseline (DEC-2026-023 Option A). The
 * 001–019 history, which must never be replayed on live, is no longer bundled.
 *
 * The bundle is a convenience for the human production gate, not a shortcut
 * around it: each migration still needs its VERIFY ON LIVE queries and its
 * DEC-2026-018 approval before it is applied.
 *
 *   npm run db:bundle                          regenerate and prove
 *   node supabase/tests/bundle.mjs --check     fail if the committed bundle is stale
 */

const OUT = path.join(ROOT, 'supabase', 'APPLY_ALL.sql');
const CHECK = process.argv.includes('--check');
const migrations = newMigrations();

const header = `-- ============================================================================
-- SHYGON — MIGRATIONS 020 ONWARD, IN ORDER (live-baseline migrations only)
-- ============================================================================
-- GENERATED FILE. Do not edit: change the numbered files in
-- supabase/migrations/ and re-run \`npm run db:bundle\`.
--
-- Contains ONLY the migrations written for the live schema baseline
-- (DEC-2026-023 Option A). The 001–019 history is NOT in this file and must
-- never be re-applied to live.
--
-- Production gate (human only): apply each migration only after its own
-- VERIFY ON LIVE queries (see its header) and its DEC-2026-018 approval
-- (24-hour cool-off + checklist). Every migration here is idempotent and
-- carries tested rollback SQL in its header (supabase/tests/migration-rollbacks.mjs).
--
-- Source files, in the order they appear below:
${migrations.map((m, i) => `--   ${i + 1}. ${m.name}`).join('\n')}
-- ============================================================================
`;

const bundle = header + migrations
  .map(({ name, sql }) => `\n-- ###########################################################################\n-- ## ${name}\n-- ###########################################################################\n\n${sql.replace(/\r\n/g, '\n')}\n`)
  .join('');

if (CHECK) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== bundle) {
    console.error('FAIL  supabase/APPLY_ALL.sql is stale: run `npm run db:bundle` and commit it.');
    process.exit(1);
  }
  console.log(`PASS  supabase/APPLY_ALL.sql is current (${migrations.length} migrations, 020 onward)`);
} else {
  fs.writeFileSync(OUT, bundle);
  console.log(`wrote supabase/APPLY_ALL.sql — ${migrations.length} migrations (020 onward), ${(bundle.length / 1024).toFixed(0)} kB`);
}

// ---- prove the bundle on the live baseline, the way an editor would run it ----
const history = bundle.match(/^-- ## (0(0\d|1\d)_[^\n]+)$/gm) ?? [];
if (history.length) {
  console.error(`FAIL  bundle contains history migrations: ${history.join(', ')}`);
  process.exit(1);
}
console.log('PASS  bundle contains no 001–019 history migration');

const db = await createLiveDb();
for (const step of ['applies as one batch on the live baseline', 'is idempotent (applied twice)']) {
  try {
    await db.exec(bundle);
    console.log(`PASS  bundle ${step}`);
  } catch (error) {
    console.error(`FAIL  bundle ${step}: ${String(error.message).split('\n')[0]}`);
    process.exit(1);
  }
}
await db.close();
