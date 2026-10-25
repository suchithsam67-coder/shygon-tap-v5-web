import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The frontend calls only what Session A's contract publishes (owner gate
 * decisions 2026-10-20 §6.2; contract §1 rule 1). Read from the source, so an
 * operation added anywhere is checked without being listed here.
 *
 * That only holds if every operation and RPC name is written out where it is
 * sent. A name held in a variable (`rpc(FN, …)`, `call({ op })`, a template)
 * could reach the server without ever being read here, so any such call fails
 * this test (OpenCode review 2026-10-25, finding #5). So does any file outside
 * the known clients that talks to these endpoints.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const contract = read('docs/v6/aaroh/api-contract.md');
/** Source without block comments and whole-line `//` comments: a comment is not a call. */
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = (file: string) => stripComments(read(file));

const CLIENTS: Record<string, string[]> = {
  '/api/emergency': ['src/services/emergency.ts', 'src/lib/publicEmergencyClient.ts'],
  '/api/rescue': ['src/services/rescue.ts', 'src/lib/publicRescueClient.ts'],
  '/api/connect': ['src/services/connect.ts', 'src/lib/publicConnectClient.ts'],
  '/api/modes': ['src/services/tapMode.ts'],
};
const PUBLIC_TAP = 'src/lib/publicTapClient.ts';
const PUBLIC_RPCS = ['get_public_profile', 'get_public_tap_mode', 'get_public_tap_state', 'record_tap_event'];

/** Every `op` property, as written: `op: 'a.b'` gives the name, anything else gives null. */
function opProperties(source: string): (string | null)[] {
  const found: (string | null)[] = [];
  for (const m of source.matchAll(/\bop\s*:\s*/g)) {
    const rest = source.slice(m.index! + m[0].length);
    const literal = /^(['"])([^'"\n]*)\1/.exec(rest);
    found.push(literal ? literal[2]! : null);
  }
  // Shorthand `{ op }` or `{ slug, op }`: the name is a variable.
  const shorthand = source.match(/[{,]\s*op\s*(?=[,}])/g) ?? [];
  for (let n = 0; n < shorthand.length; n += 1) found.push(null);
  return found;
}

/**
 * Every call of `rpc`, as written: the quoted name, or null when its first
 * argument is anything else. The definition (`function rpc…`) is not a call;
 * a type argument (`rpc<Record<string, unknown>>(…)`) is skipped, however nested.
 */
function rpcCalls(source: string): (string | null)[] {
  const found: (string | null)[] = [];
  for (const m of source.matchAll(/\brpc\b/g)) {
    if (/function\s+$/.test(source.slice(Math.max(0, m.index! - 12), m.index!))) continue;
    let i = m.index! + 3;
    while (/\s/.test(source[i] ?? '')) i += 1;
    if (source[i] === '<') {
      let depth = 0;
      for (; i < source.length; i += 1) {
        if (source[i] === '<') depth += 1;
        if (source[i] === '>' && --depth === 0) break;
      }
      i += 1;
      while (/\s/.test(source[i] ?? '')) i += 1;
    }
    if (source[i] !== '(') continue; // not a call: a word in a comment, or the `/rpc/` path
    const literal = /^\(\s*(['"])([^'"\n]*)\1/.exec(source.slice(i));
    found.push(literal ? literal[2]! : null);
  }
  return found;
}

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [rel] : [];
  });

describe('the contract check sees every call (finding #5)', () => {
  it('flags an operation or RPC name that is not written out, and passes one that is', () => {
    expect(opProperties("call({ op: 'settings.get' })")).toEqual(['settings.get']);
    expect(opProperties('call({ op: "requests.create", slug })')).toEqual(['requests.create']);
    expect(opProperties('const someOp = pick(); call({ op: someOp })')).toEqual([null]);
    expect(opProperties('call({ op })')).toEqual([null]);
    expect(opProperties('call({ slug, op })')).toEqual([null]);
    expect(opProperties('call({ op: `requests.${decision}` })')).toEqual([null]);

    expect(rpcCalls("await rpc('get_public_profile', { p_slug })")).toEqual(['get_public_profile']);
    expect(rpcCalls("await rpc<PublicProfile | null>('get_public_profile', {})")).toEqual(['get_public_profile']);
    expect(rpcCalls("await rpc<Record<string, unknown>>('get_public_tap_mode', {})")).toEqual(['get_public_tap_mode']);
    expect(rpcCalls("const FN = 'admin_get_order';\nawait rpc(FN, {})")).toEqual([null]);
    expect(rpcCalls('await rpc<Record<string, unknown>>(name, {})')).toEqual([null]);
    expect(rpcCalls('await rpc(`get_${what}`, {})')).toEqual([null]);
    expect(rpcCalls('async function rpc<T>(fn: string, body: unknown) {}')).toEqual([]);
    expect(rpcCalls('fetch(`${URL_BASE}/rest/v1/rpc/${fn}`)')).toEqual([]);
  });

  it('reads code, not comments: a comment neither counts as a call nor hides one', () => {
    const source = stripComments('/** Calls `/api/emergency` with { op: someOp }. */\n// rpc(FN)\nawait rpc(FN, {});\n');
    expect(rpcCalls(source)).toEqual([null]);
    expect(opProperties(source)).toEqual([]);
    expect(/['"`]\/api\/emergency['"`]/.test(source)).toBe(false);
  });
});

describe('every server call is in the published contract', () => {
  it('finds the contract and its version', () => {
    expect(contract).toMatch(/AAROH-API v0\.\d+/);
  });

  for (const [endpoint, files] of Object.entries(CLIENTS)) {
    it(`${endpoint}: the endpoint and each operation the frontend sends are documented, and written out`, () => {
      expect(contract).toContain(endpoint);
      for (const file of files) expect(code(file)).toContain(`'${endpoint}'`);
      const ops = files.flatMap((file) => opProperties(code(file)));
      expect(ops.length).toBeGreaterThan(0);
      expect(ops.filter((op) => op === null), `${endpoint}: an op that is not a quoted name`).toEqual([]);
      const missing = ops.filter((op) => !contract.includes(`\`${op}\``));
      expect(missing).toEqual([]);
    });
  }

  it('the public Tap reads only the published RPCs (P-1 to P-3, and P-6 since v0.8), each written out', () => {
    const rpcs = rpcCalls(code(PUBLIC_TAP));
    expect(rpcs.filter((name) => name === null), 'an rpc call whose name is not a quoted string').toEqual([]);
    expect([...new Set(rpcs)].sort()).toEqual(PUBLIC_RPCS);
    for (const name of rpcs) expect(contract).toContain(name!);
  });

  it('nothing outside those clients calls the AAROH endpoints or PostgREST functions directly', () => {
    const allowed = new Set([...Object.values(CLIENTS).flat(), PUBLIC_TAP]);
    const strays = sourceFiles('src').filter(
      (file) => !allowed.has(file) && /['"`]\/api\/(emergency|rescue|connect|modes|prive)['"`]|rest\/v1\/rpc/.test(code(file)),
    );
    expect(strays).toEqual([]);
  });
});
