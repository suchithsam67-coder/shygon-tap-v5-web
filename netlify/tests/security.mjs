// Stage 5 security verification on the local stack (authn, headers, CORS).
//
//   - the customer functions accept only a token Supabase Auth itself
//     verifies: forged, expired, unsigned ("alg": "none"), service-role
//     impersonation and the public anon key are all refused 401, while the
//     same customer's real token is accepted (the control);
//   - the security headers in vercel.json (the source of truth; netlify.toml
//     must match) meet the policy below, and the host actually serves them;
//   - another site's page cannot call the API from a browser: no
//     Access-Control-Allow-Origin is ever returned for a foreign origin.
//
//   node --import ./scripts/ci/deny-network.mjs netlify/tests/security.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { startStack } from '../../supabase/local/stack.mjs';
import { signJwt } from '../../supabase/local/jwt.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../../supabase/local/testkit.mjs';

const t = createHarness('Security: tokens, headers and CORS (local stack)');
// The built site, as CI has it after `vite build`; the served-headers check needs pages to serve.
const DIST = path.resolve('dist');
const built = fs.existsSync(path.join(DIST, 'index.html'));
const stack = await startStack({ distDir: built ? DIST : null });

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const claimsOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

// ---------------------------------------------------------------------------
t.section('Tokens: only one Supabase Auth verified is accepted');

const customer = await signUp(stack);
const real = claimsOf(customer.token);
const now = Math.floor(Date.now() / 1000);
const wrongSecret = crypto.randomBytes(32).toString('hex');

const hostile = {
  'a garbage token': 'not-a-token',
  "the customer's claims signed with another secret": signJwt(real, wrongSecret),
  "the customer's claims, correctly signed but expired": signJwt({ ...real, iat: now - 7200, exp: now - 3600 }, stack.secrets.jwtSecret),
  'an unsigned token ("alg": "none")': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...real, exp: now + 3600 })}.`,
  'a forged service-role token': signJwt({ ...real, role: 'service_role' }, wrongSecret),
  'the public anon key (a project key, not a person)': stack.keys?.anonKey ?? stack.secrets.anonKey,
  "the customer's token with its signature cut off": customer.token.split('.').slice(0, 2).join('.') + '.',
};

for (const fn of ['create-order', 'verify-payment', 'card-otp']) {
  await t.check(`${fn}: every hostile token is refused 401`, async () => {
    const refusals = [];
    for (const [label, token] of Object.entries(hostile)) {
      const response = await callFunction(stack, fn, { token, body: {} });
      if (response.status !== 401) refusals.push(`${label}: ${response.status}`);
    }
    assertEqual(refusals, [], 'accepted');
    return `${Object.keys(hostile).length} tokens refused`;
  });
}

await t.check("the control: the customer's real token gets past authentication", async () => {
  for (const fn of ['create-order', 'verify-payment', 'card-otp']) {
    const response = await callFunction(stack, fn, { token: customer.token, body: {} });
    assert(response.status !== 401, `${fn} refused the real token (${response.status})`);
  }
});

await t.check('a token for an account that no longer exists is refused', async () => {
  const gone = await signUp(stack);
  await stack.query(`DELETE FROM auth.users WHERE id = $1`, [gone.userId]);
  const response = await callFunction(stack, 'create-order', { token: gone.token, body: { orderType: 'digitalUpgrade', planId: 'business' } });
  assertEqual(response.status, 401, 'status');
});

// ---------------------------------------------------------------------------
t.section('Security headers');

const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const policy = Object.fromEntries((vercel.headers.find((rule) => rule.source === '/(.*)')?.headers ?? []).map(({ key, value }) => [key, value]));
const directives = Object.fromEntries(
  (policy['Content-Security-Policy'] ?? '').split(';').map((part) => part.trim()).filter(Boolean)
    .map((part) => { const [name, ...values] = part.split(/\s+/); return [name, values]; }),
);

await t.check('the CSP allows no inline or eval script, no plugins, no framing, no base or form hijack', async () => {
  const script = directives['script-src'] ?? [];
  assert(script.length > 0, 'no script-src');
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", 'data:', '*', 'http:', 'https:']) {
    assert(!script.includes(bad), `script-src allows ${bad}`);
  }
  assertEqual(directives['default-src'], ["'self'"], 'default-src');
  assertEqual(directives['object-src'], ["'none'"], 'object-src');
  assertEqual(directives['frame-ancestors'], ["'none'"], 'frame-ancestors');
  assertEqual(directives['base-uri'], ["'self'"], 'base-uri');
  assertEqual(directives['form-action'], ["'self'"], 'form-action');
  assert('upgrade-insecure-requests' in directives, 'upgrade-insecure-requests');
  for (const origin of directives['connect-src'] ?? []) {
    assert(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'https://*.razorpay.com'].includes(origin), `connect-src allows ${origin}`);
  }
  return `script-src ${script.join(' ')}`;
});

await t.check('HSTS for a year, no sniffing, no framing, a strict referrer, no camera, microphone or location', async () => {
  const maxAge = Number(/max-age=(\d+)/.exec(policy['Strict-Transport-Security'] ?? '')?.[1]);
  assert(maxAge >= 31536000, `HSTS max-age ${maxAge}`);
  assertEqual(policy['X-Content-Type-Options'], 'nosniff', 'X-Content-Type-Options');
  assertEqual(policy['X-Frame-Options'], 'DENY', 'X-Frame-Options');
  assert(['strict-origin-when-cross-origin', 'strict-origin', 'no-referrer', 'same-origin'].includes(policy['Referrer-Policy']), `Referrer-Policy ${policy['Referrer-Policy']}`);
  for (const feature of ['camera=()', 'microphone=()', 'geolocation=()']) {
    assert((policy['Permissions-Policy'] ?? '').includes(feature), `Permissions-Policy lacks ${feature}`);
  }
});

await t.check('netlify.toml serves exactly the same headers as vercel.json', async () => {
  const toml = fs.readFileSync('netlify.toml', 'utf8').replace(/\r\n/g, '\n');
  const missing = Object.entries(policy).filter(([key, value]) => !toml.includes(`${key} = ${JSON.stringify(value)}`)).map(([key]) => key);
  assertEqual(missing, [], 'differs on Netlify');
});

await t.check('the host serves them on the landing page, a public Tap, the store and the 404 page', async () => {
  assert(built, 'no dist/index.html: run `npx vite build` first (CI builds before this suite)');
  const slug = `sec-${Date.now()}`;
  await stack.query(
    `INSERT INTO public.tap_profiles (user_id, customer_id, username, slug, status, published)
     SELECT $1, c.id, $2, $2, 'active', true FROM public.customers c WHERE c.user_id = $1`,
    [customer.userId, slug],
  );
  const gaps = [];
  for (const path of ['/shygontap', `/t/${slug}`, '/shygontap/store', '/no-such-page']) {
    const response = await fetch(`${stack.appUrl}${path}`, { redirect: 'manual' });
    for (const key of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
      if (!response.headers.get(key)) gaps.push(`${path}: ${key}`);
    }
  }
  assertEqual(gaps, [], 'missing');
});

// ---------------------------------------------------------------------------
t.section('CORS: another site cannot call the API from a browser');

await t.check('a cross-origin preflight to every function gets no Access-Control-Allow-Origin', async () => {
  const leaks = [];
  for (const fn of ['create-order', 'verify-payment', 'card-otp', 'check-delivery', 'razorpay-webhook', 'payment-mode', 'health']) {
    const preflight = await fetch(`${stack.appUrl}/api/${fn}`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    const allowed = preflight.headers.get('access-control-allow-origin');
    if (allowed) leaks.push(`${fn}: ${allowed}`);
  }
  assertEqual(leaks, [], 'allowed');
});

await t.check('a cross-origin request with credentials is not let in either', async () => {
  const response = await fetch(`${stack.appUrl}/api/health`, { headers: { origin: 'https://evil.example' } });
  assertEqual([response.headers.get('access-control-allow-origin'), response.headers.get('access-control-allow-credentials')], [null, null], 'CORS headers');
});

const ok = t.finish();
await stack.close();
process.exit(ok ? 0 : 1);
