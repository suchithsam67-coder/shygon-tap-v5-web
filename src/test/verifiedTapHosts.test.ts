import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A verified tap's address carries the chip's one-time values (?e=…&c=…), so
 * both hosts must route /d/ to the app and send it with no referrer and no
 * caching (AAROH-API v0.11 §10d). The local stack applies only netlify.toml's
 * "/*" headers, so this is checked here, from the files the hosts read.
 */

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');

describe('the hosts serve /d/<code> safely', () => {
  it('Netlify: /d/* reaches the app before the 404 rule, and its headers come after "/*"', () => {
    const toml = read('netlify.toml');
    const route = toml.indexOf('from = "/d/*"\n  to = "/index.html"\n  status = 200');
    const notFound = toml.indexOf('from = "/*"\n  to = "/404.html"');
    expect(route).toBeGreaterThan(0);
    expect(route).toBeLessThan(notFound);
    const all = toml.indexOf('for = "/*"');
    const block = toml.slice(toml.indexOf('for = "/d/*"'));
    expect(toml.indexOf('for = "/d/*"')).toBeGreaterThan(all);
    expect(block).toMatch(/^for = "\/d\/\*"\n {2}\[headers\.values\]\n {4}Referrer-Policy = "no-referrer"\n {4}Cache-Control = "no-store"/);
  });

  it('Vercel: the same route, and the same headers in a rule after the global one', () => {
    const vercel = JSON.parse(read('vercel.json')) as {
      rewrites: { source: string; destination: string }[];
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    expect(vercel.rewrites).toContainEqual({ source: '/d/:path*', destination: '/index.html' });
    const sources = vercel.headers.map((rule) => rule.source);
    expect(sources.indexOf('/d/(.*)')).toBeGreaterThan(sources.indexOf('/(.*)'));
    const values = Object.fromEntries(vercel.headers.find((rule) => rule.source === '/d/(.*)')!.headers.map((h) => [h.key, h.value]));
    expect(values).toEqual({ 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });
  });
});
