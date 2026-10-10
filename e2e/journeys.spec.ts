import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, dismissCookieNotice, eventually, razorpay, server, stayLocal, cspViolations } from './stack';

/**
 * The three V6 end-to-end journeys (Stage 5), on the local stack:
 *   (a) sign-up → profile → Tap → public Tap
 *   (b) checkout → payment → verification → fulfilment → entitlement
 *   (c) admin suspends → public Tap unavailable → restore → available
 * The browser is the customer; the database is read back through the server
 * client to prove the backend state, never only what the page says.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

async function signUpInBrowser(page: Page, name: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Date.now()}@example.test`;
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('journey-pass-1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/shygontap/account');
  const { data } = await server().from('profiles').select('id').eq('email', email).single();
  return { email, userId: data!.id as string };
}

async function signInInBrowser(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

const tierCard = (page: Page, name: string) => page.locator('.tier-card', { has: page.getByRole('heading', { name, exact: true }) });

// The production CSP blocked nothing on any page of the journey.
test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

test('(a) a new customer signs up, buys their Tap, publishes it, and a visitor sees it', async ({ page, browser }) => {
  await razorpay(page, { outcome: 'success', webhook: 'after' });
  const owner = await signUpInBrowser(page, 'Journey Owner');

  // No Tap yet: the dashboard invites the first purchase (D-10).
  await expect(page.getByRole('heading', { name: "You don't have a Tap yet" })).toBeVisible();
  await page.getByRole('button', { name: 'Choose your Tap experience' }).click();
  await page.waitForURL('**/shygontap/tiers');
  await expect(page.getByText('Pick the experience your Tap opens in.')).toBeVisible();

  // Buy Business. Payment confirmed → draft Tap → the editor opens.
  await tierCard(page, 'Business').click();
  await page.waitForURL('**/shygontap/tap');
  await expect(page.getByText('Your SHYGON Tap draft is ready').first()).toBeVisible();

  const db = server();
  const { data: tap } = await db.from('tap_profiles').select('slug, status, published').eq('user_id', owner.userId).single();
  expect([tap!.status, tap!.published]).toEqual(['draft', false]);
  const { data: owned } = await db.from('entitlements').select('type, key').eq('user_id', owner.userId).eq('is_active', true);
  expect(owned).toEqual([{ type: 'digital_plan', key: 'business' }]);

  // A visitor cannot see the draft.
  const visitor = await browser.newPage();
  await stayLocal(visitor.context());
  await visitor.goto(`/t/${tap!.slug}`);
  await expect(visitor.getByText('Tap not found')).toBeVisible();

  // Publish.
  await page.getByRole('button', { name: 'Publish Tap' }).click();
  await eventually(async () => (await db.from('tap_profiles').select('status').eq('user_id', owner.userId).single()).data?.status === 'active', 'Tap active');

  await visitor.goto(`/t/${tap!.slug}`);
  await expect(visitor.getByText('Journey Owner')).toBeVisible();
  await expect(visitor.getByText('Tap not found')).toHaveCount(0);
  await visitor.close();
});

test('(b) a paying customer upgrades: payment verified, order fulfilled once, entitlement granted; failure and cancel grant nothing', async ({ page }) => {
  // Set-up (not under test): a customer who already owns Business and a Tap.
  const customer = await apiCustomer('Upgrade Customer');
  const db = server();
  await buyExperience(customer, 'business');

  // Cancelled in the payment window: nothing charged, nothing granted.
  await razorpay(page, { outcome: 'dismiss' });
  await signInInBrowser(page, customer.email, customer.password);
  await page.goto('/shygontap/tiers');
  await tierCard(page, 'Premium').click();
  await expect(page.getByText('Payment cancelled')).toBeVisible();

  // Declined by the bank: told so, nothing granted, the order is marked failed.
  await page.evaluate(() => {
    (window as unknown as { __RZP_SCENARIO: unknown }).__RZP_SCENARIO = { outcome: 'failure', webhook: 'after' };
  });
  await tierCard(page, 'Premium').click();
  await expect(page.getByText('Upgrade failed')).toBeVisible();
  await eventually(async () => {
    const { data } = await db.from('orders').select('payment_status').eq('user_id', customer.userId).eq('payment_status', 'failed');
    return (data?.length ?? 0) > 0;
  }, 'failed order recorded');

  // Paid, with Razorpay's webhook arriving before the browser verifies.
  await page.evaluate(() => {
    (window as unknown as { __RZP_SCENARIO: unknown }).__RZP_SCENARIO = { outcome: 'success', webhook: 'before' };
  });
  await tierCard(page, 'Premium').click();
  await expect(page.getByText('Upgrade complete')).toBeVisible();

  const { data: owned } = await db.from('entitlements').select('key').eq('user_id', customer.userId).eq('type', 'digital_plan').eq('is_active', true).order('key');
  expect(owned!.map((e) => e.key)).toEqual(['business', 'premium']);
  const { data: orders } = await db.from('orders').select('payment_status, fulfillment_status, plan_id').eq('user_id', customer.userId).eq('plan_id', 'premium');
  expect(orders!.filter((o) => o.payment_status === 'paid')).toEqual([{ payment_status: 'paid', fulfillment_status: 'fulfilled', plan_id: 'premium' }]);
  const { data: taps } = await db.from('tap_profiles').select('id').eq('user_id', customer.userId);
  expect(taps).toHaveLength(1);
  await expect(tierCard(page, 'Premium').getByText(/Active now|Purchased/)).toBeVisible();
});

test('(c) an administrator suspends a Tap, the public page goes dark, and restoring brings it back', async ({ page }) => {
  const db = server();
  // Set-up: an owner with a published Tap, and an administrator.
  const owner = await apiCustomer('Moderated Owner');
  await buyExperience(owner, 'business');
  const { error: publishError } = await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  expect(publishError).toBeNull();
  const { data: tap } = await db.from('tap_profiles').select('id, slug').eq('user_id', owner.userId).single();

  const moderator = await apiCustomer('Journey Moderator');
  await db.from('admin_users').insert({ user_id: moderator.userId, role: 'admin', is_active: true });

  await page.goto(`/t/${tap!.slug}`);
  await expect(page.getByText('Moderated Owner')).toBeVisible();

  // Suspend (the admin app calls this RPC with the administrator's session).
  const suspended = await moderator.client.rpc('admin_set_tap_suspension', { p_tap_id: tap!.id, p_suspended: true, p_reason: 'Journey check' });
  expect(suspended.error).toBeNull();
  await page.reload();
  await expect(page.getByText('Tap not found')).toBeVisible();
  await expect(page.getByText('Moderated Owner')).toHaveCount(0);

  // The owner cannot lift it themselves.
  const ownerTry = await owner.client.from('tap_profiles').update({ suspended_at: null }).eq('user_id', owner.userId).select('id');
  expect(ownerTry.error?.code).toBe('42501');

  // Restore.
  const restored = await moderator.client.rpc('admin_set_tap_suspension', { p_tap_id: tap!.id, p_suspended: false, p_reason: null });
  expect(restored.error).toBeNull();
  await page.reload();
  await expect(page.getByText('Moderated Owner')).toBeVisible();

  const { data: audit } = await db.from('admin_audit_log').select('action').eq('entity_id', tap!.id).order('created_at');
  expect(audit!.map((a) => a.action)).toEqual(['tap.suspended', 'tap.restored']);
});

test('cards are not for sale in the release candidate: the store says so and offers the digital Tap', async ({ page }) => {
  await page.goto('/shygontap/store');
  await dismissCookieNotice(page);
  await expect(page.getByText('SHYGON cards are coming soon')).toBeVisible();
  await expect(page.getByRole('button', { name: /Cart/ })).toHaveCount(0);
  await page.goto('/shygontap/store/business');
  await expect(page.getByText('SHYGON cards are coming soon')).toBeVisible();
  await expect(page.getByRole('button', { name: /Buy Now|Add to Cart/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Choose your Tap experience' }).click();
  await page.waitForURL('**/shygontap/auth');
});
