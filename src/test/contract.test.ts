import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The frontend calls only what Session A's contract publishes (owner gate
 * decisions 2026-10-20 §6.2; contract §1 rule 1). Read from the source, so an
 * operation added anywhere is checked without being listed here.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const contract = read('docs/v6/aaroh/api-contract.md');

const CLIENTS: Record<string, string[]> = {
  '/api/emergency': ['src/services/emergency.ts', 'src/lib/publicEmergencyClient.ts'],
  '/api/rescue': ['src/services/rescue.ts', 'src/lib/publicRescueClient.ts'],
  '/api/connect': ['src/services/connect.ts', 'src/lib/publicConnectClient.ts'],
};

const opsIn = (file: string) => [...read(file).matchAll(/\bop:\s*'([a-z][a-z.]*)'/g)].map((m) => m[1]!);

describe('every server call is in the published contract', () => {
  it('finds the contract and its version', () => {
    expect(contract).toMatch(/AAROH-API v0\.\d+/);
  });

  for (const [endpoint, files] of Object.entries(CLIENTS)) {
    it(`${endpoint}: the endpoint and each operation the frontend sends are documented`, () => {
      expect(contract).toContain(endpoint);
      const ops = files.flatMap(opsIn);
      expect(ops.length).toBeGreaterThan(0);
      for (const file of files) expect(read(file)).toContain(`'${endpoint}'`);
      const missing = ops.filter((op) => !contract.includes(`\`${op}\``));
      expect(missing).toEqual([]);
    });
  }

  it('the public Tap reads only the three published RPCs', () => {
    const rpcs = [...read('src/lib/publicTapClient.ts').matchAll(/rpc(?:<[^>]*>)?\('([a-z_]+)'/g)].map((m) => m[1]!);
    expect(rpcs.sort()).toEqual(['get_public_profile', 'get_public_tap_state', 'record_tap_event']);
    for (const name of rpcs) expect(contract).toContain(name);
  });
});
