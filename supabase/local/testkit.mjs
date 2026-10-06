// Shared helpers for suites that run against the local stack (V6).
import { createClient } from '@supabase/supabase-js';
import { hashPassword } from './auth.mjs';

/** supabase-js builds a Realtime client; Node 20 has no WebSocket, and no suite subscribes. */
class NoRealtime {
  constructor() {
    throw new Error('Realtime is not used by the test suites.');
  }
}

export function createHarness(title) {
  let passed = 0;
  let failed = 0;
  const failures = [];
  console.log(`\n=== ${title} ===`);
  return {
    async check(name, fn) {
      try {
        const detail = await fn();
        passed++;
        console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
      } catch (error) {
        failed++;
        failures.push(name);
        console.log(`  FAIL  ${name}\n        ${String(error?.stack ?? error).split('\n').slice(0, 3).join('\n        ')}`);
      }
    },
    section(heading) {
      console.log(`\n--- ${heading} ---`);
    },
    finish() {
      console.log(`\n${passed} passed, ${failed} failed`);
      if (failed) console.log(`Failed: ${failures.join('; ')}`);
      return failed === 0;
    },
  };
}

export function supabaseClient(stack, key = stack.keys.anonKey) {
  return createClient(stack.gatewayUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: globalThis.WebSocket ?? NoRealtime },
  });
}

let counter = 0;
/** Signs a new customer up through the Auth endpoint; returns their client and token. */
export async function signUp(stack, { name = 'Test Customer', email } = {}) {
  counter += 1;
  const address = email ?? `customer${counter}.${Date.now()}@example.test`;
  const client = supabaseClient(stack);
  const { data, error } = await client.auth.signUp({ email: address, password: 'local-test-pass-1', options: { data: { full_name: name } } });
  if (error) throw new Error(`sign-up failed: ${error.message}`);
  return { client, email: address, userId: data.user.id, token: data.session.access_token };
}

/**
 * An account created before the sign-up trigger existed: an auth user with no
 * customers or profiles row (the M0.3 I-1 shape). Signs in normally.
 */
export async function legacyAccount(stack) {
  counter += 1;
  const email = `legacy${counter}.${Date.now()}@example.test`;
  await stack.query(`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created`);
  try {
    await stack.query(
      `INSERT INTO auth.users (email, encrypted_password, email_confirmed_at, updated_at) VALUES ($1, $2, now(), now())`,
      [email, hashPassword('local-test-pass-1')],
    );
  } finally {
    await stack.query(`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created`);
  }
  const client = supabaseClient(stack);
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'local-test-pass-1' });
  if (error) throw new Error(`legacy sign-in failed: ${error.message}`);
  return { client, email, userId: data.user.id, token: data.session.access_token };
}

/** POSTs JSON to one of the server functions on the stack's host. */
export async function callFunction(stack, name, { token, body, headers = {} } = {}) {
  const response = await fetch(`${stack.appUrl}/api/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}
