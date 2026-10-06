// The SHYGON local stack (V6, decision D-4: end-to-end testing without Docker).
//
//   database   PGlite: the live schema baseline + migrations 020 onward +
//              the catalogue fixture (db.mjs)
//   gateway    Supabase-compatible REST + Auth + Realtime handshake (gateway.mjs)
//   app host   the built site and the real server functions (app-host.mjs)
//   Razorpay   a stand-in reached in place of api.razorpay.com (razorpay-sim.mjs)
//
// Fidelity, stated plainly: the database, its RLS, grants, triggers and
// functions are real Postgres running the production schema. The HTTP layers
// (PostgREST, GoTrue, Kong) and Razorpay are local stand-ins covering exactly
// what SHYGON uses. Every secret is generated from a per-stack seed; nothing
// is read from .env and nothing leaves the machine: while the stack runs, any
// fetch to a host other than loopback (or the Razorpay stand-in) throws.
import crypto from 'node:crypto';
import net from 'node:net';
import { ROOT } from '../tests/lib/live-db.mjs';
import { createStackDb } from './db.mjs';
import { createGateway } from './gateway.mjs';
import { projectKeys } from './jwt.mjs';
import { createRazorpaySim } from './razorpay-sim.mjs';
import { createAppHost } from './app-host.mjs';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Every value the stack needs, derived from one seed (stable across processes). */
export function stackSecrets(seed) {
  const derive = (label, length) => crypto.createHmac('sha256', seed).update(label).digest('hex').slice(0, length);
  const jwtSecret = derive('jwt', 64);
  return {
    jwtSecret,
    ...projectKeys(jwtSecret),
    razorpayKeyId: `rzp_test_${derive('rzp-key-id', 14)}`,
    razorpayKeySecret: derive('rzp-key-secret', 40),
    razorpayWebhookSecret: derive('rzp-webhook-secret', 40),
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

/** Routes api.razorpay.com to the stand-in and refuses every other non-loopback host. */
function installFetchRouter(sim) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function localStackFetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init);
    const { hostname } = new URL(request.url);
    if (hostname === 'api.razorpay.com') return sim.api(request);
    if (LOOPBACK.has(hostname)) return realFetch(input, init);
    throw new TypeError(`fetch failed: the local stack does not reach ${hostname}`);
  };
  return () => {
    globalThis.fetch = realFetch;
  };
}

/** Server-function settings that would reach a real provider; cleared for the stack. */
const PROVIDER_SETTINGS = [
  'SMS_PROVIDER', 'MSG91_AUTH_KEY', 'MSG91_TEMPLATE_ID', 'MSG91_ORDER_TEMPLATE_ID', 'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TWILIO_MESSAGING_SERVICE_SID', 'SHIPROCKET_EMAIL', 'SHIPROCKET_PASSWORD',
  'OTP_DEV_MODE', 'ALLOW_LIVE_PAYMENTS_LOCALLY', 'VITE_SUPABASE_URL',
];

/**
 * Starts the stack in this process. Ports default to free ones.
 * @returns {Promise<{ db, gateway, sim, keys, secrets, gatewayUrl, appUrl, close: () => Promise<void> }>}
 */
export async function startStack({
  seed = crypto.randomBytes(32).toString('hex'),
  gatewayPort = 0,
  appPort = 0,
  distDir = null,
  autoconfirm = true,
  log = () => {},
} = {}) {
  const secrets = stackSecrets(seed);
  const db = await createStackDb();

  const gwPort = gatewayPort || (await freePort());
  const gatewayUrl = `http://127.0.0.1:${gwPort}`;
  const gateway = await createGateway({ db, secret: secrets.jwtSecret, publicUrl: gatewayUrl, autoconfirm, log });
  await listen(gateway.server, gwPort);

  const hostPort = appPort || (await freePort());
  const appUrl = `http://127.0.0.1:${hostPort}`;

  const previousEnv = {};
  const setEnv = (name, value) => {
    if (!(name in previousEnv)) previousEnv[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  setEnv('SUPABASE_URL', gatewayUrl);
  setEnv('SUPABASE_SERVICE_ROLE_KEY', secrets.serviceRoleKey);
  setEnv('RAZORPAY_KEY_ID', secrets.razorpayKeyId);
  setEnv('RAZORPAY_KEY_SECRET', secrets.razorpayKeySecret);
  setEnv('RAZORPAY_WEBHOOK_SECRET', secrets.razorpayWebhookSecret);
  for (const name of PROVIDER_SETTINGS) setEnv(name, undefined);

  const sim = createRazorpaySim({
    keyId: secrets.razorpayKeyId,
    keySecret: secrets.razorpayKeySecret,
    webhookSecret: secrets.razorpayWebhookSecret,
    webhookUrl: () => `${appUrl}/api/razorpay-webhook`,
    log,
  });
  const restoreFetch = installFetchRouter(sim);
  const host = createAppHost({ root: ROOT, distDir, appUrl, gatewayUrl, sim, log });
  await listen(host.server, hostPort);

  return {
    db,
    gateway,
    sim,
    secrets,
    keys: { anonKey: secrets.anonKey, serviceRoleKey: secrets.serviceRoleKey },
    /** Superuser SQL, queued behind in-flight API requests (one connection). */
    query: (sql, params) => gateway.exclusive(() => db.query(sql, params)),
    gatewayUrl,
    appUrl,
    async close() {
      host.server.closeAllConnections?.();
      gateway.server.closeAllConnections?.();
      await new Promise((resolve) => host.server.close(resolve));
      await new Promise((resolve) => gateway.server.close(resolve));
      restoreFetch();
      for (const [name, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await db.close();
    },
  };
}
