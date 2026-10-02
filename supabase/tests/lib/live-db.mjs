import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, MIGRATIONS_DIR, FIRST_NEW_MIGRATION, newMigrations } from './migrations.mjs';

export { ROOT, MIGRATIONS_DIR, FIRST_NEW_MIGRATION, newMigrations };

/**
 * Builds an isolated in-memory database from the live schema baseline, the
 * origin for all database work since DEC-2026-023 (Option A):
 *
 *   supabase/tests/live-platform-shim.sql      Supabase roles + auth.users / auth.uid()
 *   supabase/baseline/000_live_baseline.sql    the live `public` schema, unmodified
 *   supabase/tests/live-auth-shim.sql          the sign-up trigger the dump leaves out
 *   supabase/migrations/020_… onward           new work
 *
 * Migrations 001–019 are history. They were applied to live before the
 * baseline was captured, and they are never re-run here or anywhere else.
 */

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

/** A fresh database holding exactly the live schema (no migrations applied). */
export async function createLiveDb() {
  const db = await PGlite.create();
  await db.exec(read('supabase', 'tests', 'live-platform-shim.sql'));

  // pg_dump writes psql meta-commands (\restrict / \unrestrict) that are not
  // SQL, and the dump is applied one TOC entry at a time so a failure names
  // the object it came from.
  const baseline = read('supabase', 'baseline', '000_live_baseline.sql')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\\(un)?restrict\b/.test(line))
    .join('\n');
  const failures = [];
  for (const chunk of baseline.split(/\n(?=--\n-- TOC entry )/)) {
    try {
      await db.exec(chunk);
    } catch (error) {
      const name = (chunk.match(/-- Name: ([^\n]+)/) || [])[1] || '(preamble)';
      const message = String(error.message).split('\n')[0];
      // Every new database already has a public schema.
      if (/^public; Type: SCHEMA;/.test(name) && /already exists/.test(message)) continue;
      failures.push(`${name}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`the live baseline did not load:\n  ${failures.join('\n  ')}`);
  }

  // The dump's preamble turns row_security off and empties search_path for the
  // session. Left in place, RLS would refuse every query instead of filtering.
  await db.exec('RESET ALL;');
  await db.exec(read('supabase', 'tests', 'live-auth-shim.sql'));
  return db;
}

/** createLiveDb() plus every migration from 020 on. Throws on the first failure. */
export async function createMigratedDb(dir = MIGRATIONS_DIR) {
  const db = await createLiveDb();
  for (const { name, sql } of newMigrations(dir)) {
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`${name} failed: ${error.message}`);
    }
  }
  return db;
}
