import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './migrations.mjs';

/**
 * The `npm run db:push` safeguard: DEC-2026-023 S1, as narrowed by amendment
 * A-1 (repository owner, 2026-10-02).
 *
 * The committed allowlist `supabase/non-production-projects.json` is the ONLY
 * gate. A project ref that is not on it is refused, and there is no override
 * flag. Adding a project means a reviewed commit to that file (CODEOWNERS:
 * Data Owner + Security Owner). The production project is never added.
 *
 * Every check here runs before any network call, and every failure closes the
 * gate: a missing, unreadable or malformed allowlist allows no project at all.
 */

export const ALLOWLIST_PATH = path.join(ROOT, 'supabase', 'non-production-projects.json');

/** A Supabase project ref: the 20 lowercase characters in https://<ref>.supabase.co */
export const REF_PATTERN = /^[a-z0-9]{20}$/;

/** The override that S1 originally proposed and amendment A-1 removed. */
export const REMOVED_OVERRIDE_FLAG = '--i-know-this-is-not-production';

const closed = (problems) => ({ refs: new Set(), problems });

/** Parses the allowlist file's text. Any problem means no project is allowed. */
export function parseAllowlist(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return closed([`it is not valid JSON (${error.message})`]);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.projects)) {
    return closed(['it must be an object with a "projects" array']);
  }
  const refs = new Set();
  const problems = [];
  data.projects.forEach((project, i) => {
    const ref = typeof project?.ref === 'string' ? project.ref : '';
    if (!REF_PATTERN.test(ref)) {
      problems.push(`projects[${i}].ref is not a 20-character lowercase project ref`);
    } else if (refs.has(ref)) {
      problems.push(`projects[${i}].ref is listed twice`);
    } else {
      refs.add(ref);
    }
  });
  return problems.length > 0 ? closed(problems) : { refs, problems: [] };
}

/** Reads and parses the committed allowlist. Unreadable means closed. */
export function loadAllowlist(file = ALLOWLIST_PATH) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return closed([`${path.relative(ROOT, file)} could not be read (${error.code ?? error.message})`]);
  }
  return parseAllowlist(text);
}

/** db:push takes no arguments. Argument values are never echoed back. */
export function checkArgs(argv) {
  if (argv.length === 0) return { ok: true };
  if (argv.includes(REMOVED_OVERRIDE_FLAG)) {
    return {
      ok: false,
      reason:
        `${REMOVED_OVERRIDE_FLAG} no longer exists. DEC-2026-023 amendment A-1 made the committed ` +
        'allowlist the only gate, with no override.',
    };
  }
  return { ok: false, reason: `db:push takes no arguments (${argv.length} given).` };
}

/** The only gate: the ref must be well formed and on a valid allowlist. */
export function checkTarget(ref, allowlist) {
  const value = typeof ref === 'string' ? ref.trim() : '';
  if (value === '') {
    return { ok: false, reason: 'SUPABASE_PROJECT_REF is not set.' };
  }
  if (!REF_PATTERN.test(value)) {
    return { ok: false, reason: 'SUPABASE_PROJECT_REF is not a 20-character lowercase project ref.' };
  }
  if (allowlist.problems.length > 0) {
    return {
      ok: false,
      reason:
        'supabase/non-production-projects.json is invalid, so every project is refused:\n  ' +
        allowlist.problems.join('\n  '),
    };
  }
  if (!allowlist.refs.has(value)) {
    return {
      ok: false,
      reason: `project ${value} is not on the non-production allowlist (supabase/non-production-projects.json).`,
    };
  }
  return { ok: true, ref: value };
}
