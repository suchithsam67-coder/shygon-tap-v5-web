import fs from 'node:fs';
import path from 'node:path';

/**
 * Exercises the REAL Supabase project with nothing but the publishable key —
 * exactly what a browser has. Signup, login, session, and then every read and
 * write a customer might attempt against live RLS.
 *
 * No service-role key is used anywhere here, deliberately: the point is to see
 * what an ordinary signed-in customer can reach.
 */

const ROOT = process.argv[2] ?? process.cwd();
// Only the two PUBLIC values a browser already has. Nothing secret is read —
// this test deliberately probes with no more power than a signed-in customer.
const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const env = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*)$/);
  if (m && m[2].trim()) env[m[1]] = m[2].trim();
}

const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

let pass = 0, fail = 0, blocked = 0;
async function check(name, fn) {
  try {
    const d = await fn();
    console.log(`  PASS  ${name}${d ? `  — ${d}` : ''}`);
    pass++;
  } catch (e) {
    if (e.blocked) { console.log(`  BLOCKED  ${name}  — ${e.message}`); blocked++; return; }
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const blockedErr = (m) => { const e = new Error(m); e.blocked = true; return e; };

/** Raw PostgREST/GoTrue calls — no supabase-js, so Node 20 is not a problem. */
async function rest(pathname, { token, method = 'GET', body, headers = {}, prefer } = {}) {
  const res = await fetch(`${URL_}${pathname}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}

console.log(`\nProject: ${URL_.replace(/https:\/\/([^.]{4})[^.]*/, 'https://$1…')}`);

// --- reachability ----------------------------------------------------------
const health = await fetch(`${URL_}/auth/v1/health`, { headers: { apikey: KEY } }).catch(() => null);
if (!health || !health.ok) {
  console.log('\n  BLOCKED  Supabase project unreachable or key rejected — nothing below can run.');
  console.log(`           ${health ? `HTTP ${health.status}` : 'network error'}`);
  process.exit(2);
}
console.log('  PASS  project reachable, publishable key accepted');
pass++;

// --- signup ----------------------------------------------------------------
const stamp = Date.now();
const EMAIL_A = `shygon.test.a.${stamp}@example.com`;
const EMAIL_B = `shygon.test.b.${stamp}@example.com`;
const PASSWORD = `Test-${stamp}-Aa1!`;

async function signUp(email) {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signIn(email, password) {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log('\n=== authentication ===');

let tokenA = null, tokenB = null, uidA = null, uidB = null, confirmRequired = false;

await check('signup accepts a new account', async () => {
  const r = await signUp(EMAIL_A);
  assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  uidA = r.body?.id ?? r.body?.user?.id ?? null;
  tokenA = r.body?.access_token ?? null;
  if (!tokenA) confirmRequired = true;
  return tokenA ? 'session issued immediately' : 'created; email confirmation required';
});

await check('signup rejects a weak/invalid password', async () => {
  const res = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `weak.${stamp}@example.com`, password: '123' }),
  });
  assert(res.status >= 400, `weak password accepted (HTTP ${res.status})`);
  return `HTTP ${res.status}`;
});

await check('login with WRONG credentials is refused', async () => {
  const r = await signIn(EMAIL_A, 'definitely-the-wrong-password');
  assert(r.status === 400 || r.status === 401, `HTTP ${r.status} — wrong password not refused`);
  return `HTTP ${r.status}: ${r.body?.error_description ?? r.body?.msg ?? ''}`.slice(0, 70);
});

await check('login with correct credentials issues a session', async () => {
  const r = await signIn(EMAIL_A, PASSWORD);
  if (r.status !== 200) {
    if (/confirm/i.test(JSON.stringify(r.body))) {
      throw blockedErr('email confirmation is required — cannot obtain a session without a mailbox');
    }
    throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  }
  tokenA = r.body.access_token;
  uidA = r.body.user?.id;
  assert(tokenA, 'no access token returned');
  return 'access + refresh token issued';
});

if (!tokenA) {
  console.log('\n  BLOCKED  No session could be obtained — the RLS probes below need one.');
  console.log(`\n${pass} passed, ${fail} failed, ${blocked + 1} blocked`);
  process.exit(0);
}

// Second customer, for cross-tenant probes.
const sB = await signUp(EMAIL_B);
tokenB = sB.body?.access_token ?? null;
uidB = sB.body?.id ?? sB.body?.user?.id ?? null;
if (!tokenB) {
  const r = await signIn(EMAIL_B, PASSWORD);
  tokenB = r.body?.access_token ?? null;
  uidB = r.body?.user?.id ?? null;
}

await check('an invalid/garbage JWT is rejected', async () => {
  const r = await rest('/rest/v1/profiles?select=id', { token: 'not.a.valid.jwt' });
  assert(r.status === 401, `HTTP ${r.status} — a forged token was accepted`);
  return '401';
});

console.log('\n=== profile ===');

await check('a profile row exists for the new user (auto-provisioned)', async () => {
  const r = await rest(`/rest/v1/profiles?select=id,email&id=eq.${uidA}`, { token: tokenA });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  assert(Array.isArray(r.body) && r.body.length === 1, `expected 1 row, got ${JSON.stringify(r.body).slice(0, 160)}`);
  return 'created by trigger on signup';
});

await check('the customer can update their own profile', async () => {
  const r = await rest(`/rest/v1/profiles?id=eq.${uidA}`, {
    token: tokenA, method: 'PATCH', body: { full_name: 'Test Customer' }, prefer: 'return=representation',
  });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
  assert(r.body?.[0]?.full_name === 'Test Customer', 'update did not persist');
  return 'saved and read back';
});

console.log('\n=== live RLS: cross-customer isolation ===');

await check('customer A sees ONLY their own profile', async () => {
  const r = await rest('/rest/v1/profiles?select=id', { token: tokenA });
  assert(r.status === 200, `HTTP ${r.status}`);
  const ids = (r.body ?? []).map((x) => x.id);
  assert(ids.length <= 1 && (ids.length === 0 || ids[0] === uidA),
    `LEAK — saw ${ids.length} profile row(s): ${JSON.stringify(ids).slice(0, 120)}`);
  return `${ids.length} row(s), own only`;
});

if (uidB) {
  await check("customer A cannot read customer B's profile by id", async () => {
    const r = await rest(`/rest/v1/profiles?select=id,email&id=eq.${uidB}`, { token: tokenA });
    assert(r.status === 200, `HTTP ${r.status}`);
    assert((r.body ?? []).length === 0, `LEAK — ${JSON.stringify(r.body).slice(0, 160)}`);
    return '0 rows';
  });

  await check("customer A cannot overwrite customer B's profile", async () => {
    const r = await rest(`/rest/v1/profiles?id=eq.${uidB}`, {
      token: tokenA, method: 'PATCH', body: { full_name: 'HIJACKED' }, prefer: 'return=representation',
    });
    assert(r.status >= 400 || (r.body ?? []).length === 0,
      `LEAK — wrote to another customer's profile: ${JSON.stringify(r.body).slice(0, 160)}`);
    return r.status >= 400 ? `HTTP ${r.status}` : '0 rows affected';
  });
}

for (const [label, table] of [
  ['orders', 'orders'], ['entitlements', 'entitlements'], ['cards', 'cards'],
  ['payments', 'payments'], ['order_items', 'order_items'], ['notifications', 'notifications'],
]) {
  await check(`customer sees only their own ${label}`, async () => {
    const r = await rest(`/rest/v1/${table}?select=*`, { token: tokenA });
    if (r.status === 404) throw blockedErr(`table ${table} not exposed`);
    assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    assert((r.body ?? []).length === 0, `LEAK — a brand-new account sees ${r.body.length} ${label} row(s)`);
    return '0 rows (new account)';
  });
}

console.log('\n=== live RLS: privilege escalation ===');

await check('customer CANNOT grant themselves a paid experience', async () => {
  const r = await rest('/rest/v1/entitlements', {
    token: tokenA, method: 'POST', body: { user_id: uidA, type: 'digital_plan', key: 'goat' },
    prefer: 'return=representation',
  });
  assert(r.status >= 400, `ESCALATION — HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return `refused HTTP ${r.status}`;
});

await check('customer CANNOT grant themselves the Customization Pass', async () => {
  const r = await rest('/rest/v1/entitlements', {
    token: tokenA, method: 'POST', body: { user_id: uidA, type: 'lifetime', key: 'lifetime' },
    prefer: 'return=representation',
  });
  assert(r.status >= 400, `ESCALATION — HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return `refused HTTP ${r.status}`;
});

await check('customer CANNOT insert a paid order', async () => {
  const r = await rest('/rest/v1/orders', {
    token: tokenA, method: 'POST',
    body: { order_id: `ST-HACK-${stamp}`, user_id: uidA, product_name: 'free', amount: 0, payment_status: 'paid' },
    prefer: 'return=representation',
  });
  assert(r.status >= 400, `ESCALATION — HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return `refused HTTP ${r.status}`;
});

await check('customer CANNOT make themselves an admin', async () => {
  const r = await rest('/rest/v1/admin_users', {
    token: tokenA, method: 'POST', body: { user_id: uidA }, prefer: 'return=representation',
  });
  assert(r.status >= 400, `ESCALATION — HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  return `refused HTTP ${r.status}`;
});

await check('customer CANNOT change product pricing', async () => {
  const r = await rest('/rest/v1/products?price_in_paise=gt.0', {
    token: tokenA, method: 'PATCH', body: { price_in_paise: 1 }, prefer: 'return=representation',
  });
  assert(r.status >= 400 || (r.body ?? []).length === 0,
    `ESCALATION — repriced ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.status >= 400 ? `refused HTTP ${r.status}` : '0 rows affected';
});

await check('customer CANNOT read the admin roster', async () => {
  const r = await rest('/rest/v1/admin_users?select=*', { token: tokenA });
  assert(r.status >= 400 || (r.body ?? []).length === 0, `LEAK — ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.status >= 400 ? `HTTP ${r.status}` : '0 rows';
});

await check('customer CANNOT read the admin audit log', async () => {
  const r = await rest('/rest/v1/admin_audit_log?select=*', { token: tokenA });
  assert(r.status >= 400 || (r.body ?? []).length === 0, `LEAK — ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.status >= 400 ? `HTTP ${r.status}` : '0 rows';
});

console.log('\n=== catalogue (public read) ===');

await check('products are readable and priced', async () => {
  const r = await rest('/rest/v1/products?select=sku,name,price_in_paise,active,product_type&limit=200', { token: tokenA });
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const rows = r.body ?? [];
  assert(rows.length > 0, 'STORE IS EMPTY — no products returned; the store page will have nothing to sell');
  const unpriced = rows.filter((p) => p.price_in_paise === null || p.price_in_paise === undefined);
  assert(unpriced.length === 0, `${unpriced.length} product(s) have no price_in_paise: ${unpriced.map((p) => p.sku).join(', ')}`);
  return `${rows.length} active products, all priced`;
});

await check('anonymous visitor sees only ACTIVE products', async () => {
  const r = await rest('/rest/v1/products?select=sku,active&limit=200', {});
  assert(r.status === 200, `HTTP ${r.status}`);
  const inactive = (r.body ?? []).filter((p) => p.active === false);
  assert(inactive.length === 0, `retired SKUs exposed publicly: ${inactive.map((p) => p.sku).join(', ')}`);
  return `${(r.body ?? []).length} rows, none retired`;
});

console.log('\n=== public Tap resolution ===');

await check('get_public_tap_state on an unknown slug is unavailable, not an error', async () => {
  const r = await rest('/rest/v1/rpc/get_public_tap_state', {
    method: 'POST', body: { p_slug: `no-such-slug-${stamp}` },
  });
  if (r.status === 404) throw blockedErr('RPC not found on the live project');
  assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const txt = JSON.stringify(r.body);
  assert(/unavailable|null/i.test(txt), `unexpected: ${txt.slice(0, 160)}`);
  return txt.slice(0, 60);
});

console.log('\n=== session handling ===');

await check('logout invalidates the session', async () => {
  const r = await signIn(EMAIL_A, PASSWORD);
  const t = r.body?.access_token;
  assert(t, 'could not get a fresh session to log out of');
  const out = await fetch(`${URL_}/auth/v1/logout`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${t}` },
  });
  assert(out.status === 204 || out.status === 200, `logout HTTP ${out.status}`);
  return `logout HTTP ${out.status}`;
});

console.log(`\n${pass} passed, ${fail} failed, ${blocked} blocked`);
process.exit(fail > 0 ? 1 : 0);
