import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BrowserContext, Page } from '@playwright/test';

/** What supabase/local/serve.mjs wrote when the stack came up. */
export function stack(): { appUrl: string; gatewayUrl: string; anonKey: string; serviceRoleKey: string } {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), '.e2e', 'stack.json'), 'utf8'));
}

/** Node 20 has no WebSocket and no journey subscribes, so Realtime is never built. */
class NoRealtime {
  constructor() {
    throw new Error('Realtime is not used by the journeys.');
  }
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { transport: (globalThis as { WebSocket?: unknown }).WebSocket ?? NoRealtime },
} as const;

/** The server's view of the stack's database, for setting up and checking. */
export function server(): SupabaseClient {
  const s = stack();
  return createClient(s.gatewayUrl, s.serviceRoleKey, options as never);
}

/** A customer signed in through the API (for set-up that is not under test). */
export async function apiCustomer(name: string) {
  const s = stack();
  const client = createClient(s.gatewayUrl, s.anonKey, options as never);
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@example.test`;
  // A throwaway account on the local stack; generated so no literal looks like a credential.
  const password = `journey-${randomUUID()}`;
  const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (error || !data.user || !data.session) throw new Error(`sign-up failed: ${error?.message}`);
  return { client, email, password, userId: data.user.id, token: data.session.access_token };
}

/**
 * Set-up that is not under test: buys an experience for `customer` through the
 * real server functions and the Razorpay stand-in, webhook first, and waits
 * until the order is fulfilled. Returns the Razorpay order id.
 */
export async function buyExperience(customer: { token: string }, planId: string): Promise<string> {
  const { appUrl } = stack();
  const created = await fetch(`${appUrl}/api/create-order`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${customer.token}` },
    body: JSON.stringify({ orderType: 'digitalUpgrade', planId }),
  });
  const order = await created.json();
  if (!created.ok) throw new Error(`create-order ${created.status}: ${JSON.stringify(order)}`);
  const paid = await fetch(`${appUrl}/__sim/razorpay/pay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: order.key_id, order_id: order.order_id, outcome: 'success', webhook: 'before' }),
  });
  if (!(await paid.json()).razorpay_payment_id) throw new Error('the stand-in did not take the payment');
  const db = server();
  await eventually(
    async () => (await db.from('orders').select('fulfillment_status').eq('razorpay_order_id', order.order_id).single()).data?.fulfillment_status === 'fulfilled',
    `order ${order.order_id} fulfilled`,
  );
  return order.order_id;
}

/** Nothing leaves the machine: every request to a non-local host is aborted. */
export async function stayLocal(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => route.abort());
}

/**
 * Razorpay Checkout is the stack's stand-in (supabase/local/razorpay-sim.mjs).
 * `scenario` decides what the "customer" does in the payment window and when
 * Razorpay's webhook arrives.
 */
export async function razorpay(
  page: Page,
  scenario: { outcome?: 'success' | 'failure' | 'dismiss'; webhook?: 'before' | 'after' | 'none'; capture?: 'auto' | 'manual' } = {},
) {
  await page.addInitScript((s) => {
    (window as unknown as { __RZP_SCENARIO: unknown }).__RZP_SCENARIO = s;
  }, scenario);
  await page.route('https://checkout.razorpay.com/v1/checkout.js', async (route) => {
    const script = await page.request.get('/__sim/razorpay/checkout.js');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: await script.text() });
  });
}

export async function dismissCookieNotice(page: Page) {
  const notice = page.getByRole('button', { name: 'Got it' });
  if (await notice.isVisible().catch(() => false)) await notice.click();
}

/** Waits until `check` returns a truthy value (the webhook path is asynchronous). */
export async function eventually<T>(check: () => Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`timed out waiting for: ${label}`);
}
