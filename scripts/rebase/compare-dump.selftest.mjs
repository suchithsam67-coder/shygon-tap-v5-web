#!/usr/bin/env node
/**
 * Self-test for scripts/rebase/compare-dump.mjs (F-30 / T-31 §0).
 *
 * Needs no other repository and no network: the 2026-09-30 baseline stands in
 * for a fresh production dump.
 *
 *   1. refusal  a dump that holds table data is refused.
 *   2. control  the baseline as-is: it loads completely, all V6 migrations apply,
 *               and no function V6 replaces has moved, so there is nothing to merge.
 *   3. planted  the baseline plus four planted differences, which must all be
 *               found:
 *                 - one broken entry, which load must name;
 *                 - a changed provision_tap_on_payment body, which must give a
 *                   merge proposal;
 *                 - a dropped cards_select_owner_or_admin policy, which 024 needs;
 *                 - a dropped cards.card_id column, which 041 needs.
 *               The changed body is away from V6's lines, so the merge must be
 *               clean and must carry every line V6 adds.
 *   4. conflict the baseline with a line changed that V6 also rewrites: the
 *               merge must report a conflict, stop the chain there, and leave
 *               the conflict markers in the proposal for a human.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, newMigrations } from '../../supabase/tests/lib/migrations.mjs';
import { createLiveDb } from '../../supabase/tests/lib/live-db.mjs';
import { InputError, readDump, runComparison } from './compare-dump.mjs';

const WORK = path.join(ROOT, 'node_modules', '.cache', 'rebase', 'selftest');
const BASELINE = path.join(ROOT, 'supabase', 'baseline', '000_live_baseline.sql');
const MARK = '-- planted-by-compare-dump-selftest';
let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const entry = (name, sql) => `\n--\n-- TOC entry 99999 (planted)\n-- Name: ${name}; Type: SELFTEST; Schema: public; Owner: -\n--\n\n${sql}\n`;

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

// 1. refusal
const withData = path.join(WORK, 'with-data.sql');
fs.writeFileSync(withData, '--\n-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: -\n--\n\nCOPY public.orders (id) FROM stdin;\n\\.\n');
try {
  readDump(withData);
  check(false, 'a dump with table data is refused');
} catch (error) {
  check(error instanceof InputError && /table data/.test(error.message), 'a dump with table data is refused');
}

// 2. control
const control = await runComparison({ dump: BASELINE, out: path.join(WORK, 'control') });
check(control.load.complete, `control: the baseline loads completely (${control.load.entries} entries)`);
check(control.replay.skipped !== undefined, 'control: without --v5 the replay is skipped');
check(control.v6.total > 0 && control.v6.applied === control.v6.total, `control: ${control.v6.applied} of ${control.v6.total} V6 migrations apply`);
check(control.bodies.length === 0, `control: nothing to merge (${control.bodies.length})`);

// 3. planted
// O = the 2026-09-30 body; V = the body after V6's first migration that replaces it.
const FN = `SELECT pg_get_functiondef(p.oid) AS def, replace(p.prosrc, E'\\r', '') AS src FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'provision_tap_on_payment'`;
const reference = await createLiveDb();
const { rows } = await reference.query(FN);
const O = rows[0]?.src ?? '';
let V = O;
let firstV6 = null;
for (const m of newMigrations()) {
  await reference.exec(m.sql);
  const now = (await reference.query(FN)).rows[0]?.src ?? '';
  if (now !== O) {
    V = now;
    firstV6 = m.name;
    break;
  }
}
await reference.close();
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const v6Only = lines(V).filter((l) => !lines(O).includes(l));
check(firstV6 !== null && v6Only.length > 0, `V6 changes provision_tap_on_payment first in ${firstV6} (${v6Only.length} new line(s))`);
check(rows.length === 1, 'the baseline has exactly one provision_tap_on_payment');
const def = rows[0].def.replace(/\r\n/g, '\n');
const changed = /\nBEGIN[ \t]*\n/i.test(def)
  ? def.replace(/\nBEGIN[ \t]*\n/i, (m) => `${m}  ${MARK}\n`)
  : def.replace(/AS \$function\$\n/, (m) => `${m}${MARK}\n`);
check(changed !== def, 'the planted body differs from the baseline body');

const planted = path.join(WORK, 'planted.sql');
fs.writeFileSync(
  planted,
  fs.readFileSync(BASELINE, 'utf8').replace(/\r\n/g, '\n') +
    entry('planted_broken; Type: TABLE', 'CREATE TABLE public.planted_broken (x public.no_such_type);') +
    entry('provision_tap_on_payment (planted)', `${changed};`) +
    entry('cards_select_owner_or_admin (planted drop)', 'DROP POLICY cards_select_owner_or_admin ON public.cards;') +
    entry('cards.card_id (planted drop)', 'ALTER TABLE public.cards DROP COLUMN card_id CASCADE;'),
);

const p = await runComparison({ dump: planted, out: path.join(WORK, 'planted') });
check(!p.load.complete && p.load.failures.length === 1 && /^planted_broken/.test(p.load.failures[0]), `planted: load names the one broken entry (${p.load.failures.join(' | ')})`);
const step = (n) => p.v6.steps.find((s) => s.migration.startsWith(n));
check(step('024') && !step('024').ok, `planted: 024 fails without the policy (${step('024')?.error ?? 'missing'})`);
check(step('041') && !step('041').ok, `planted: 041 fails without cards.card_id (${step('041')?.error ?? 'missing'})`);

const flagged = p.bodies.filter((b) => b.function.startsWith('provision_tap_on_payment('));
check(flagged.length === 1 && flagged[0].status === 'changed-in-base', 'planted: the changed provision_tap_on_payment body is found');
check(p.bodies.length === 1, `planted: nothing else is flagged (${p.bodies.map((b) => b.function).join(', ')})`);
const first = flagged[0]?.steps?.[0];
const proposal = first?.proposal ? path.join(p.outDir, first.proposal) : null;
check(proposal && fs.existsSync(proposal), `planted: a proposal is written for ${first?.migration ?? '?'} (${first?.merge ?? 'none'})`);
if (proposal && fs.existsSync(proposal)) {
  const text = fs.readFileSync(proposal, 'utf8');
  check(text.includes(MARK), 'planted: the proposal keeps the base change');
  check(/^-- PROPOSED/.test(text), 'planted: the proposal is labelled PROPOSED');
  check(first.merge === 'clean', `planted: a change away from V6's lines merges cleanly (${first.merge})`);
  check(!/^(<<<<<<<|>>>>>>>)/m.test(text), 'planted: the clean proposal has no conflict markers');
  check(v6Only.every((l) => text.includes(l)), `planted: the clean proposal carries every line V6's ${firstV6} adds`);
  check(flagged[0].steps.every((s) => s.merge === 'clean'), `planted: every V6 step merges cleanly (${flagged[0].steps.map((s) => s.migration.slice(0, 3)).join(', ')})`);
}

// 4. conflict: the base changes a line that V6 also changes.
const touched = lines(O).find((l) => !lines(V).includes(l) && !l.startsWith('--'));
check(touched !== undefined, `there is a line V6 rewrites (${touched ?? 'none'})`);
const rawLine = def.split('\n').find((l) => l.trim() === touched);
const conflictDump = path.join(WORK, 'conflict.sql');
fs.writeFileSync(
  conflictDump,
  fs.readFileSync(BASELINE, 'utf8').replace(/\r\n/g, '\n') +
    entry('provision_tap_on_payment (planted conflict)', `${def.replace(rawLine, `${rawLine} ${MARK}`)};`),
);
const c = await runComparison({ dump: conflictDump, out: path.join(WORK, 'conflict') });
const cf = c.bodies.find((b) => b.function.startsWith('provision_tap_on_payment('));
check(c.load.complete && cf?.status === 'changed-in-base', 'conflict: the changed body is found');
check(/conflict/.test(cf?.steps?.[0]?.merge ?? ''), `conflict: the overlap is reported as a conflict (${cf?.steps?.[0]?.merge ?? 'none'})`);
check(cf?.steps?.length === 1, 'conflict: the chain stops at the first conflict');
const cp = cf?.steps?.[0]?.proposal ? fs.readFileSync(path.join(c.outDir, cf.steps[0].proposal), 'utf8') : '';
check(/^<<<<<<< /m.test(cp) && /^>>>>>>> /m.test(cp), 'conflict: the proposal shows the conflict markers for a human');

console.log(`\ncompare-dump selftest: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
