import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Which migration files count as new work (DEC-2026-023 Option A).
 *
 * 001–019 were applied to live before the live schema baseline was captured.
 * They are history and are never re-run: not locally, not in CI and not by
 * `npm run db:push`. New work starts at 020.
 *
 * This module has no dependencies beyond Node, so the db:push guard can use it
 * without loading a database engine.
 */

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
export const FIRST_NEW_MIGRATION = 20;

/**
 * Migrations numbered 020 and up, in order. `only` limits it to one number.
 * Line endings are normalized to LF, as for the baseline: a file saved with
 * CRLF would otherwise put \r into every function body it creates.
 */
export function newMigrations(dir = MIGRATIONS_DIR, only = null) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 3)) >= FIRST_NEW_MIGRATION)
    .filter((f) => only === null || Number(f.slice(0, 3)) === only)
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n') }));
}
