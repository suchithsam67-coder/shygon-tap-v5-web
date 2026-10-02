import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS_DIR, ROOT } from './lib/live-db.mjs';

/**
 * Migration-history checks (owner decision D-U1-a, 2026-10-02).
 *
 * These two checks test catalogue SEED DATA that migrations 001–019 inserted.
 * The live schema baseline is schema-only, so it holds no rows to check, and
 * the main suites (verify.mjs, rls-adversarial.mjs) no longer run 001–019.
 *
 * This job keeps them as history tests: it rebuilds the pre-baseline chain
 * (the old hand-written stand-in, supabase/tests/baseline.sql, plus 001–019)
 * in an isolated in-memory PGlite database and runs the two checks unchanged.
 * It never touches live, and it never applies 020 onward, which are written
 * against the live baseline.
 */

const HISTORY_LAST = 19;
const db = await PGlite.create();
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'baseline.sql'), 'utf8'));
for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  if (Number(f.slice(0, 3)) > HISTORY_LAST) continue;
  await db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
}

let pass = 0;
let fail = 0;
const q = (sql, params) => db.query(sql, params);

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\n=== catalog seed data (migration history 001–019; isolated, never live) ===');

await check('four experiences + the Pass are the active digital SKUs', async () => {
  const { rows } = await q(
    `SELECT sku, ui_tier FROM public.products
     WHERE product_type IN ('digital_plan','lifetime_plan') AND active
     ORDER BY sort_order`,
  );
  const skus = rows.map((r) => r.sku);
  assert(
    JSON.stringify(skus) ===
      JSON.stringify([
        'plan-essential',
        'plan-business',
        'plan-premium',
        'plan-goat',
        'pass-customization',
      ]),
    'got ' + skus.join(', '),
  );
  return skus.join(', ');
});

await check('retired SKUs are delisted, not deleted', async () => {
  const { rows } = await q(
    `SELECT sku, active FROM public.products
     WHERE sku IN ('plan-pro','plan-3d','plan-custom','plan-lifetime') ORDER BY sku`,
  );
  assert(rows.length === 4, `expected 4 retired rows, got ${rows.length}`);
  assert(rows.every((r) => r.active === false), 'some retired SKU is still active');
  return rows.map((r) => r.sku).join(', ') + ' all inactive';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
