import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No dead routes (V6 Stage 4): every internal address the app links or
 * navigates to is one the router answers, and every dashboard nav entry is a
 * real page. Read from the source, so a link added anywhere is covered without
 * being listed here.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Source without comments, so an address mentioned in prose is not taken for a link. */
const code = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

/** The route table: the account app's routes and the public Tap's (App.tsx). */
const routes = ['src/AccountApp.tsx', 'src/App.tsx']
  .flatMap((file) => [...read(file).matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]))
  .filter((route) => route !== '*');

const answered = (address: string) =>
  routes.some((route) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}/?$`).test(address));

/** Every string literal in the app that is an address on this site. */
const addresses = sources('src').flatMap((file) =>
  [...code(file).matchAll(/["'`](\/(?:shygontap|t|tap|aaroh)(?:\/[A-Za-z0-9._~:-]+)*\/?)(?:[?#][^"'`]*)?["'`]/g)].map((match) => ({
    file: file.replace(/\\/g, '/'),
    address: match[1],
  })),
);

describe('routes', () => {
  it('finds the route table and the addresses (the scan itself works)', () => {
    expect(routes).toContain('/shygontap/settings');
    expect(addresses.length).toBeGreaterThan(30);
  });

  it('every address the app links or navigates to is answered by a route', () => {
    const dead = addresses.filter(({ address }) => !answered(address));
    expect(dead).toEqual([]);
  });

  it('every dashboard nav entry is a real page', () => {
    const nav = [...read('src/components/app/AppShell.tsx').matchAll(/\{\s*to:\s*'([^']+)'/g)].map((match) => match[1]);
    expect(nav.length).toBeGreaterThanOrEqual(10);
    expect(nav.filter((to) => !answered(to))).toEqual([]);
  });
});
