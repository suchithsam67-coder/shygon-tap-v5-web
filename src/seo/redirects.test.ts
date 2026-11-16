import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { rulesAfterCatchAll } from './build';

/**
 * Netlify answers with the first [[redirects]] rule that matches: a rule after
 * the /* catch-all never runs (V5's /admin answered 404 that way, release audit
 * 2026-11-15). The build refuses such a file (vite.config.ts).
 */

const rule = (from: string, to: string, status: number) => `[[redirects]]\n  from = "${from}"\n  to = "${to}"\n  status = ${status}\n`;

describe('rules after the Netlify catch-all', () => {
  it("this repository's netlify.toml has none: the catch-all is the last rule", () => {
    const toml = fs.readFileSync(path.join(process.cwd(), 'netlify.toml'), 'utf8');
    expect(toml).toMatch(/from = "\/\*"/);
    expect(rulesAfterCatchAll(toml)).toEqual([]);
  });

  it('names every rule that the catch-all shadows, in file order', () => {
    const toml = [rule('/shygontap', '/shygontap.html', 200), rule('/*', '/404.html', 404), rule('/admin', '/admin/index.html', 200), rule('/admin/*', '/admin/index.html', 200)].join('\n');
    expect(rulesAfterCatchAll(toml)).toEqual(['/admin', '/admin/*']);
  });

  it('a file without a catch-all, or with Windows line ends, is read the same way', () => {
    expect(rulesAfterCatchAll(rule('/a', '/a.html', 200))).toEqual([]);
    const windows = [rule('/*', '/404.html', 404), rule('/late', '/late.html', 200)].join('\n').replace(/\n/g, '\r\n');
    expect(rulesAfterCatchAll(windows)).toEqual(['/late']);
  });
});
