/**
 * Runs every step given, one after another, and fails if ANY of them failed
 * (V5 release audit B-8: `a && b && c` stopped at the first failure, so the
 * steps after it never ran and their results were never seen).
 *
 *   node scripts/run-tests.mjs [--deny-network] <step> <step> ...
 *
 * A step ending in .mjs runs as `node <file>` (with --deny-network, through
 * scripts/ci/deny-network.mjs); any other step runs as `npm run <step>`.
 * The summary lists every step with PASS or FAIL; the exit code is 1 if any failed.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const denyNetwork = args.includes('--deny-network');
const steps = args.filter((a) => a !== '--deny-network');
if (steps.length === 0) {
  console.error('run-tests: name at least one step');
  process.exit(2);
}

const results = [];
for (const step of steps) {
  console.log(`\n##### ${step}`);
  const started = Date.now();
  const run = step.endsWith('.mjs')
    ? spawnSync(process.execPath, [...(denyNetwork ? ['--import', './scripts/ci/deny-network.mjs'] : []), step], { stdio: 'inherit' })
    // npm is a .cmd on Windows, which Node only starts through a shell.
    : spawnSync('npm', ['run', step], { stdio: 'inherit', shell: true });
  results.push({ step, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log('\n##### summary');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.step}  (${r.seconds} s)`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} of ${results.length} steps passed${failed.length ? `; failed: ${failed.map((r) => r.step).join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
