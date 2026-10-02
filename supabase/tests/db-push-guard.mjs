import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MIGRATIONS_DIR, ROOT, newMigrations } from './lib/migrations.mjs';
import {
  ALLOWLIST_PATH,
  REMOVED_OVERRIDE_FLAG,
  checkArgs,
  checkTarget,
  loadAllowlist,
  parseAllowlist,
} from './lib/push-guard.mjs';

/**
 * Tests for the `npm run db:push` safeguard (DEC-2026-023 S1, amendment A-1).
 *
 * Unit checks cover the guard functions. End-to-end checks run the real
 * supabase/tests/apply-remote.mjs in a child process under the outbound-network
 * guard (scripts/ci/deny-network.mjs). Every refusal must happen with NO network
 * attempt. The guard prints "network-guard: refused …" if one is made.
 *
 * Nothing here can reach Supabase: the network is denied, the project ref is
 * fake, the token is a placeholder, and no .env is read.
 */

const FAKE_REF = 'abcdefghijklmnopqrst'; // 20 lowercase characters; not a real project
const FAKE_TOKEN = 'placeholder-not-a-token';
const DENY_NETWORK = pathToFileURL(path.join(ROOT, 'scripts', 'ci', 'deny-network.mjs')).href;
const SCRIPT = path.join(ROOT, 'supabase', 'tests', 'apply-remote.mjs');
const NETWORK_ATTEMPT = /network-guard: refused outbound fetch/;

let pass = 0;
let fail = 0;
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
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Runs a db:push script with ONLY the given variables (nothing inherited that could hold a credential). */
function runPush(script, { env = {}, args = [] } = {}) {
  const base = { PATH: process.env.PATH ?? '' };
  if (process.env.SystemRoot) base.SystemRoot = process.env.SystemRoot; // needed by Node on Windows
  const r = spawnSync(process.execPath, ['--import', DENY_NETWORK, script, ...args], {
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** A throwaway copy of the push script, its two lib modules, an allowlist and a migrations folder. */
function sandbox({ allowlist, migrations }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shygon-dbpush-'));
  const tests = path.join(dir, 'supabase', 'tests');
  fs.mkdirSync(path.join(tests, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'supabase', 'migrations'), { recursive: true });
  for (const f of ['apply-remote.mjs', 'lib/migrations.mjs', 'lib/push-guard.mjs']) {
    fs.copyFileSync(path.join(ROOT, 'supabase', 'tests', f), path.join(tests, f));
  }
  fs.writeFileSync(path.join(dir, 'supabase', 'non-production-projects.json'), allowlist);
  for (const [name, sql] of Object.entries(migrations)) {
    fs.writeFileSync(path.join(dir, 'supabase', 'migrations', name), sql);
  }
  return { dir, script: path.join(tests, 'apply-remote.mjs') };
}
const listing = (refs) => JSON.stringify({ description: 'test', projects: refs.map((ref) => ({ ref })) });

console.log('\n=== allowlist parsing (fails closed) ===');

await check('the committed allowlist is valid', async () => {
  const a = loadAllowlist(ALLOWLIST_PATH);
  assert(a.problems.length === 0, a.problems.join('; '));
  return `${a.refs.size} non-production project(s) listed`;
});

await check('a missing allowlist closes the gate', async () => {
  const a = loadAllowlist(path.join(os.tmpdir(), 'shygon-no-such-allowlist.json'));
  assert(a.problems.length === 1 && a.refs.size === 0, JSON.stringify(a.problems));
  return 'no project allowed';
});

await check('invalid JSON closes the gate', async () => {
  const a = parseAllowlist('{ not json');
  assert(a.problems.length === 1 && a.refs.size === 0, JSON.stringify(a.problems));
  return 'no project allowed';
});

await check('a malformed or duplicated ref closes the WHOLE list, not just that entry', async () => {
  for (const projects of [
    [{ ref: FAKE_REF }, { ref: 'TOO-SHORT' }],
    [{ ref: FAKE_REF }, { ref: FAKE_REF }],
    [{ ref: FAKE_REF }, { label: 'no ref' }],
  ]) {
    const a = parseAllowlist(JSON.stringify({ projects }));
    assert(a.refs.size === 0 && a.problems.length > 0, `allowed ${[...a.refs]} for ${JSON.stringify(projects)}`);
  }
  return 'every case closed';
});

await check('a list without a "projects" array closes the gate', async () => {
  for (const text of ['[]', '{}', '{"projects": "x"}', 'null']) {
    const a = parseAllowlist(text);
    assert(a.refs.size === 0 && a.problems.length > 0, `allowed something for ${text}`);
  }
  return 'every case closed';
});

console.log('\n=== target and argument checks ===');

const open = parseAllowlist(listing([FAKE_REF]));

await check('an allowlisted ref is accepted (control)', async () => {
  const t = checkTarget(` ${FAKE_REF} `, open);
  assert(t.ok && t.ref === FAKE_REF, JSON.stringify(t));
  return 'accepted, whitespace trimmed';
});

await check('unset, empty, malformed and differently-cased refs are refused', async () => {
  for (const ref of [undefined, '', '   ', 'short', FAKE_REF.toUpperCase(), `${FAKE_REF}x`, 'sbp_0123456789abcdef0123']) {
    assert(!checkTarget(ref, open).ok, `accepted ${JSON.stringify(ref)}`);
  }
  return '7 refused';
});

await check('a well-formed ref that is not listed is refused', async () => {
  const t = checkTarget('zyxwvutsrqponmlkjihg', open);
  assert(!t.ok && /not on the non-production allowlist/.test(t.reason), JSON.stringify(t));
  return 'refused';
});

await check('nothing is accepted while the allowlist is invalid, even a listed-looking ref', async () => {
  const t = checkTarget(FAKE_REF, parseAllowlist('{ not json'));
  assert(!t.ok && /invalid/.test(t.reason), JSON.stringify(t));
  return 'refused';
});

await check('there is no override flag (amendment A-1)', async () => {
  const a = checkArgs([REMOVED_OVERRIDE_FLAG]);
  assert(!a.ok && /no longer exists/.test(a.reason), JSON.stringify(a));
  const b = checkArgs(['--force']);
  assert(!b.ok, 'accepted --force');
  assert(!b.reason.includes('--force'), 'argument values must not be echoed');
  assert(checkArgs([]).ok, 'refused an empty argument list');
  return 'every argument refused; values not echoed';
});

console.log('\n=== migration selection: 020 onward only ===');

await check('only files numbered 020+ are selected', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shygon-migs-'));
  try {
    for (const f of ['001_a.sql', '019_b.sql', '020_c.sql', '021_d.sql', 'README.md', '20_bad.sql', 'x020_e.sql']) {
      fs.writeFileSync(path.join(dir, f), '-- test');
    }
    const names = newMigrations(dir).map((m) => m.name);
    assert(JSON.stringify(names) === JSON.stringify(['020_c.sql', '021_d.sql']), `got ${names.join(', ')}`);
    return names.join(', ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await check('the repository selection never includes 001–019', async () => {
  const names = newMigrations(MIGRATIONS_DIR).map((m) => m.name);
  assert(names.every((n) => Number(n.slice(0, 3)) >= 20), `selected ${names.join(', ')}`);
  return names.length === 0 ? 'none at 020+ yet' : names.join(', ');
});

console.log('\n=== the real db:push script, network denied ===');

await check('no variables set: refused, no network attempt', async () => {
  const r = runPush(SCRIPT);
  assert(r.code === 1, `exit ${r.code}`);
  assert(/REFUSED: SUPABASE_PROJECT_REF is not set/.test(r.out), r.out.trim().slice(0, 200));
  assert(!NETWORK_ATTEMPT.test(r.out), 'a network call was attempted');
  return 'exit 1, nothing sent';
});

await check('a ref that is not on the committed allowlist: refused, no network attempt', async () => {
  const r = runPush(SCRIPT, { env: { SUPABASE_PROJECT_REF: FAKE_REF, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN } });
  assert(r.code === 1, `exit ${r.code}`);
  assert(/REFUSED: project .* is not on the non-production allowlist/.test(r.out), r.out.trim().slice(0, 200));
  assert(!NETWORK_ATTEMPT.test(r.out), 'a network call was attempted');
  assert(!r.out.includes(FAKE_TOKEN), 'the token was printed');
  return 'exit 1, nothing sent, token not printed';
});

await check('the removed override flag: refused, no network attempt', async () => {
  const r = runPush(SCRIPT, {
    env: { SUPABASE_PROJECT_REF: FAKE_REF, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN },
    args: [REMOVED_OVERRIDE_FLAG],
  });
  assert(r.code === 1, `exit ${r.code}`);
  assert(/no longer exists/.test(r.out), r.out.trim().slice(0, 200));
  assert(!NETWORK_ATTEMPT.test(r.out), 'a network call was attempted');
  return 'exit 1, nothing sent';
});

console.log('\n=== a sandbox copy with the fake ref allowlisted ===');

await check('allowlisted, but only history files: nothing applied, no network attempt', async () => {
  const sb = sandbox({ allowlist: listing([FAKE_REF]), migrations: { '019_history.sql': 'SELECT 1;' } });
  try {
    const r = runPush(sb.script, { env: { SUPABASE_PROJECT_REF: FAKE_REF } });
    assert(r.code === 0, `exit ${r.code}: ${r.out.trim().slice(0, 200)}`);
    assert(/Nothing to apply/.test(r.out), r.out.trim().slice(0, 200));
    assert(!r.out.includes('019_history.sql'), '019 appeared in the plan');
    assert(!NETWORK_ATTEMPT.test(r.out), 'a network call was attempted');
    return 'exit 0, 019 not planned, nothing sent';
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

await check('allowlisted with 019 + 020: only 020 is planned, and only the Supabase API is contacted', async () => {
  const sb = sandbox({
    allowlist: listing([FAKE_REF]),
    migrations: { '019_history.sql': 'SELECT 1;', '020_new.sql': 'SELECT 2;' },
  });
  try {
    const r = runPush(sb.script, { env: { SUPABASE_PROJECT_REF: FAKE_REF, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN } });
    assert(/Plan: 1 migration\(s\)/.test(r.out) && /- 020_new\.sql/.test(r.out), r.out.trim().slice(0, 300));
    assert(!r.out.includes('019_history.sql'), '019 appeared in the plan');
    assert(r.code === 1, `exit ${r.code} (the denied network should stop it)`);
    const hosts = (r.out.match(/network-guard: refused outbound fetch to (.*)/) ?? [])[1] ?? '';
    assert(/^api\.supabase\.com x\d+$/.test(hosts.trim()), `contacted: ${hosts || 'nothing'}`);
    assert(!r.out.includes(FAKE_TOKEN), 'the token was printed');
    return `planned 020 only; attempted ${hosts.trim()} (denied)`;
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

await check('an invalid allowlist in the sandbox: refused, no network attempt', async () => {
  const sb = sandbox({ allowlist: '{ not json', migrations: { '020_new.sql': 'SELECT 2;' } });
  try {
    const r = runPush(sb.script, { env: { SUPABASE_PROJECT_REF: FAKE_REF, SUPABASE_ACCESS_TOKEN: FAKE_TOKEN } });
    assert(r.code === 1, `exit ${r.code}`);
    assert(/is invalid, so every project is refused/.test(r.out), r.out.trim().slice(0, 200));
    assert(!NETWORK_ATTEMPT.test(r.out), 'a network call was attempted');
    return 'exit 1, nothing sent';
  } finally {
    fs.rmSync(sb.dir, { recursive: true, force: true });
  }
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
