import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

/**
 * Concatenates every migration, in order, into `supabase/APPLY_ALL.sql` — one
 * file to paste into the Supabase SQL editor instead of four.
 *
 * Then proves the bundle by executing it as a single statement batch against a
 * real Postgres, which is exactly how the SQL editor will run it. Applying the
 * four separately is already proven by `db:apply`; this proves the combined
 * form too, because "paste all four at once" is what a human will actually do
 * and it is not automatically equivalent — one transaction, one failure point.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS = path.join(HERE, '..', 'migrations');
const OUT = path.join(HERE, '..', 'APPLY_ALL.sql');

const files = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const header = `-- ============================================================================
-- SHYGON TAP — ALL MIGRATIONS, IN ORDER
-- ============================================================================
-- GENERATED FILE. Do not edit: change the numbered files in
-- supabase/migrations/ and re-run \`npm run db:bundle\`.
--
-- HOW TO APPLY
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It is one transaction, so either all of it lands or none of it does. Every
-- statement is idempotent, so running it again is safe.
--
-- Source files, in the order they appear below:
${files.map((f, i) => `--   ${i + 1}. ${f}`).join('\n')}
--
-- Generated ${new Date().toISOString().slice(0, 10)}
-- ============================================================================

`;

const body = files
  .map((f) => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    return `\n-- ###########################################################################\n-- ## ${f}\n-- ###########################################################################\n\n${sql}\n`;
  })
  .join('\n');

const bundle = header + body;
fs.writeFileSync(OUT, bundle);
console.log(`wrote ${path.relative(process.cwd(), OUT)} — ${files.length} migrations, ${(bundle.length / 1024).toFixed(0)} kB`);

// ---- prove the bundle, the way the SQL editor will run it -------------------
const db = await PGlite.create();
await db.exec(fs.readFileSync(path.join(HERE, 'baseline.sql'), 'utf8'));

try {
  await db.exec(bundle);
  console.log('PASS  bundle applies as one batch');
} catch (error) {
  console.error('FAIL  bundle did not apply');
  console.error('      ' + error.message);
  process.exit(1);
}

try {
  await db.exec(bundle);
  console.log('PASS  bundle is idempotent (applied twice)');
} catch (error) {
  console.error('FAIL  bundle is not idempotent');
  console.error('      ' + error.message);
  process.exit(1);
}

const { rows } = await db.query(`
  SELECT sku FROM public.products
  WHERE product_type IN ('digital_plan','lifetime_plan') AND active
  ORDER BY sort_order
`);
console.log('PASS  catalog after bundle: ' + rows.map((r) => r.sku).join(', '));
