// Bundle budget gate for the public Tap (doc 12 M0.1; DEC-2026-019).
//
// Fails when the JavaScript a browser must download before the public Tap can
// render is over budget. That set is the entry module plus its static-import
// closure: everything dist/index.html loads (<script type="module" src> and
// <link rel="modulepreload">), followed through static `import … from "./x.js"`
// statements in case a preload link is ever missing. Chunks reached only via
// dynamic import() load lazily and are not counted.
//
// Sizes are measured the way Vite's build report does it (zlib gzip at its
// default level, 1 kB = 1000 bytes), so the total matches the "gzip:" column
// that `vite build` prints.
//
// CSS is reported but not gated: M0.1 caps JavaScript only.
//
//   npm run test:bundle                  (after `vite build`)
//   node scripts/check-bundle-size.mjs [distDir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Hard cap from doc 12 M0.1. It is raised only by an APPROVED DEC-2026-019.
const JS_BUDGET_BYTES = 90_000;

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));
const INDEX = path.join(DIST, 'index.html');

const fail = (message) => {
  console.error(`FAIL  ${message}`);
  process.exit(1);
};

if (!fs.existsSync(INDEX)) fail(`${path.relative(ROOT, INDEX)} not found. Run \`vite build\` first.`);

const html = fs.readFileSync(INDEX, 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
// Same-origin asset path relative to dist/, or null for anything external.
const local = (ref) => (ref && !/^([a-z]+:)?\/\//i.test(ref) ? ref.replace(/^\//, '') : null);

const js = new Set();
const css = new Set();
for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
  const src = local(attr(tag, 'src'));
  if (src && attr(tag, 'type') === 'module') js.add(src);
}
for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
  const href = local(attr(tag, 'href'));
  const rel = attr(tag, 'rel');
  if (href && rel === 'modulepreload') js.add(href);
  if (href && rel === 'stylesheet') css.add(href);
}
if (js.size === 0) fail('dist/index.html loads no module script. The measurement would be meaningless.');

// Static imports only: `import x from "./a.js"`, `import "./a.js"`,
// `export * from "./a.js"`. A dynamic `import("./a.js")` has a "(" after
// `import`, so it never matches.
const STATIC_IMPORT =
  /(?:^|[;\s}])(?:import\s*(?:[\w$*{}\s,]+?\s*from\s*)?|export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*)["'](\.{1,2}\/[^"']+?\.js)["']/g;

const queue = [...js];
while (queue.length > 0) {
  const rel = queue.shift();
  const file = path.join(DIST, rel);
  if (!fs.existsSync(file)) fail(`${rel} is referenced but missing from ${path.relative(ROOT, DIST)}/`);
  for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
    const dep = path.posix.join(path.posix.dirname(rel), spec);
    if (!js.has(dep)) {
      js.add(dep);
      queue.push(dep);
    }
  }
}

const gzipBytes = (rel) => zlib.gzipSync(fs.readFileSync(path.join(DIST, rel))).length;
const kB = (bytes) => `${(bytes / 1000).toFixed(2)} kB`;

console.log('\nPublic Tap entry bundle (gzip, measured the way Vite reports it)');
let jsTotal = 0;
for (const rel of [...js].sort()) {
  const size = gzipBytes(rel);
  jsTotal += size;
  console.log(`  JS   ${rel.padEnd(40)} ${kB(size).padStart(10)}`);
}
let cssTotal = 0;
for (const rel of [...css].sort()) {
  const size = gzipBytes(rel);
  cssTotal += size;
  console.log(`  CSS  ${rel.padEnd(40)} ${kB(size).padStart(10)}  (reported, not gated)`);
}

const remaining = JS_BUDGET_BYTES - jsTotal;
console.log(`\n  JS total  ${jsTotal} B = ${kB(jsTotal)}  /  budget ${kB(JS_BUDGET_BYTES)}  ->  ${remaining >= 0 ? `${kB(remaining)} remaining` : `${kB(-remaining)} OVER`}`);
console.log(`  CSS total ${cssTotal} B = ${kB(cssTotal)}  (not gated in M0.1)\n`);

if (remaining < 0) {
  fail(`public Tap entry JS is ${kB(-remaining)} over the ${kB(JS_BUDGET_BYTES)} budget. Changing the budget needs an APPROVED DEC-2026-019.`);
}
console.log('PASS  public Tap entry JS is within budget');
