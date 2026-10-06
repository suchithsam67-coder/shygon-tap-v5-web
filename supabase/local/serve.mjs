// Runs the SHYGON local stack with the built site (V6, D-4).
//
//   node supabase/local/serve.mjs [--build] [--app-port 4173] [--gateway-port 54321]
//   npm run stack            (builds the site for the stack, then serves it)
//
// The site is built into .e2e/dist against the local gateway, with keys
// derived from a seed kept in .e2e/keys.json (gitignored; created on first
// run). No .env file is read: the build gets an empty env folder. When it is
// ready it prints one line and writes .e2e/stack.json (URLs and the stack's
// own throwaway keys) for the end-to-end tests. Ctrl+C stops it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../tests/lib/live-db.mjs';
import { startStack, stackSecrets } from './stack.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const appPort = Number(arg('--app-port', process.env.STACK_APP_PORT ?? 4173));
const gatewayPort = Number(arg('--gateway-port', process.env.STACK_GATEWAY_PORT ?? 54321));
const rebuild = process.argv.includes('--build');
const verbose = process.argv.includes('--verbose');

const E2E = path.join(ROOT, '.e2e');
const DIST = path.join(E2E, 'dist');
fs.mkdirSync(path.join(E2E, 'env'), { recursive: true });

const keysFile = path.join(E2E, 'keys.json');
if (!fs.existsSync(keysFile)) {
  fs.writeFileSync(keysFile, JSON.stringify({ seed: crypto.randomBytes(32).toString('hex') }, null, 2));
}
const { seed } = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const secrets = stackSecrets(seed);
const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;

// The build bakes in the gateway URL and anon key, so it is redone whenever
// either would differ from what the last build used.
const stamp = JSON.stringify({ gatewayUrl, anonKey: secrets.anonKey, keyId: secrets.razorpayKeyId });
const stampFile = path.join(E2E, 'build-stamp.json');
const stale = !fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(stampFile) || fs.readFileSync(stampFile, 'utf8') !== stamp;
if (rebuild || stale) {
  console.log('local stack: building the site against the local gateway...');
  Object.assign(process.env, {
    VITE_SUPABASE_URL: gatewayUrl,
    VITE_SUPABASE_ANON_KEY: secrets.anonKey,
    VITE_RAZORPAY_KEY_ID: secrets.razorpayKeyId,
  });
  const { build } = await import('vite');
  await build({
    root: ROOT,
    mode: 'production',
    envDir: path.join(E2E, 'env'),
    logLevel: verbose ? 'info' : 'warn',
    build: { outDir: DIST, emptyOutDir: true },
  });
  fs.writeFileSync(stampFile, stamp);
}

const stack = await startStack({
  seed,
  gatewayPort,
  appPort,
  distDir: DIST,
  log: verbose ? (line) => console.log(`  ${line}`) : () => {},
});
fs.writeFileSync(
  path.join(E2E, 'stack.json'),
  JSON.stringify(
    { appUrl: stack.appUrl, gatewayUrl: stack.gatewayUrl, anonKey: stack.keys.anonKey, serviceRoleKey: stack.keys.serviceRoleKey },
    null,
    2,
  ),
);
console.log(`local stack ready: app ${stack.appUrl}  gateway ${stack.gatewayUrl}`);

const stop = async () => {
  await stack.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
