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

  // The AAROH overview's selection offers no purchase while card sales are closed.
  await page.goto('/shygontap/store/aaroh?design=obsidian');
  const overview = page.getByRole('dialog', { name: /AAROH Obsidian/ });
  await expect(overview).toBeVisible();
  await overview.getByRole('button', { name: 'Skip intro' }).click();
  const choose = overview.locator('#ao-choose');
  await choose.scrollIntoViewIfNeeded();
  await expect(choose.getByText('SHYGON cards are coming soon')).toBeVisible();
  await expect(choose.getByRole('button', { name: 'Choose Obsidian' })).toHaveCount(0);
  await expect(choose.getByRole('heading', { name: 'AAROH Obsidian, coming soon' })).toBeVisible();
  await expect(choose.getByText('Pricing announced when card sales open.')).toBeVisible();
  await expect(choose).not.toContainText('₹');
  await choose.getByRole('button', { name: 'Choose your Tap experience' }).click();
  await page.waitForURL('**/shygontap/auth');
});

test('AAROH (DEC-2026-037): ten editions beside V5; one themed overview explains, previews and hands off', async ({ page }) => {
  // V5 stays on sale beside AAROH: its product pages are not redirected.
  await page.goto('/shygontap/store');
  await dismissCookieNotice(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Two cards. One SHYGON profile.' })).toBeVisible();
  // No AAROH price before card sales open (owner, 2026-10-16).
  await expect(page.locator('.store-choice-aaroh')).toContainText('Pricing announced when card sales open.');
  await expect(page.locator('.store-choice-aaroh').getByRole('heading', { name: 'SHYGON AAROH' })).toBeVisible();
  await expect(page.locator('.store-choice-aaroh').getByText('Coming soon', { exact: true })).toBeVisible();
  await expect(page.locator('.store-choice-aaroh').getByRole('link', { name: 'Preview the experience' })).toHaveAttribute('href', '/shygontap/store/aaroh?design=obsidian');
  await expect(page.locator('.store-choice-aaroh')).not.toContainText('₹');
  await expect(page.locator('#compare')).toContainText('Announced when card sales open');
  const v5 = await page.request.get('/shygontap/store/business', { maxRedirects: 0 });
  expect(v5.status()).toBe(200);

  // The collection: the design system's ten editions, in order.
  await page.goto('/shygontap/store/aaroh');
  await expect(page.getByRole('heading', { level: 1, name: 'SHYGON AAROH' })).toBeVisible();
  await expect(page.getByText('Coming soon', { exact: true })).toBeVisible();
  await expect(page.getByText('VERSION 01 · ONE CARD. MORE POSSIBILITIES.')).toBeVisible();
  await expect(page.getByText('A physical card, connected to a digital experience powered by SHYGON OS.')).toBeVisible();
  await expect(page.getByText('Explore the collection, discover the planned capabilities, and preview the AAROH experience.')).toBeVisible();
  await expect(page.getByText('Pricing announced when card sales open.')).toBeVisible();
  await expect(page.locator('.aaroh-collection')).not.toContainText('₹');
  const collection = page.getByRole('list', { name: 'The ten AAROH editions' });
  await expect(collection.getByRole('listitem')).toHaveCount(10);
  await expect(collection.getByRole('heading', { level: 3 })).toHaveText([
    'Obsidian', 'Aureate', 'Monolith', 'Ivory Veil', 'Cobalt',
    'Emerald Cipher', 'Prism', 'Carbon Weave', 'Heritage Geometry', 'Liquid Form',
  ]);

  // The hero card plays the intro; it can be paused and pointed at an edition.
  const hero = page.locator('#intro');
  await expect(hero.getByText('Meet AAROH.')).toBeVisible();
  await hero.getByRole('button', { name: 'Pause the intro' }).click();
  await hero.getByRole('button', { name: 'Show Prism' }).click();
  await expect(hero.getByRole('button', { name: 'Show Prism' })).toHaveAttribute('aria-pressed', 'true');
  await expect(hero.getByText('Controlled iridescence behind a lenticular screen.')).toBeVisible();
  await expect(hero.getByRole('button', { name: 'Explore Prism' })).toBeVisible();

  // Opening an edition: a modal dialog at a deep link, in that edition's theme.
  await collection.getByRole('button', { name: 'Explore Cobalt' }).click();
  await expect(page).toHaveURL(/\/shygontap\/store\/aaroh\?design=cobalt$/);
  let overview = page.getByRole('dialog', { name: /AAROH Cobalt/ });
  await expect(overview).toBeVisible();
  await expect(overview.getByText('Meet AAROH.')).toBeVisible();
  await expect.poll(() => overview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(8, 20, 47)');

  // The welcome can be skipped; then the card turns to its back on request.
  await overview.getByRole('button', { name: 'Skip intro' }).click();
  await expect(overview.getByRole('button', { name: 'Replay intro' })).toBeVisible();
  await overview.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(overview.locator('.ao-object .ac')).toHaveAttribute('data-side', 'back');

  // Switching edition re-themes in place and keeps the deep link current.
  await overview.getByRole('button', { name: 'Next edition: Emerald Cipher' }).click();
  await expect(page).toHaveURL(/\?design=emerald-cipher$/);
  overview = page.getByRole('dialog', { name: /AAROH Emerald Cipher/ });
  await expect(overview).toBeVisible();
  await expect.poll(() => overview.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(12, 33, 26)');

  // Features: live ones link to the account; the roadmap is labelled Planned, its actions disabled; no Privé.
  const features = overview.locator('#ao-features');
  await features.scrollIntoViewIfNeeded();
  await expect(features.getByRole('heading', { name: 'Available now' })).toBeVisible();
  await expect(features.getByRole('heading', { name: 'Upcoming SHYGON OS features' })).toBeVisible();
  await expect(features.getByText(/does not include or guarantee/)).toBeVisible();
  await expect(features.getByText(/Privé/)).toHaveCount(0);
  await features.getByRole('button', { name: /^Analytics/ }).click();
  await expect(features.getByRole('link', { name: /Open analytics/ })).toHaveAttribute('href', '/shygontap/analytics');
  await features.getByRole('button', { name: /^Student Passport/ }).click();
  await expect(features.getByRole('heading', { level: 3, name: 'Student Passport' })).toBeVisible();
  await expect(features.getByRole('button', { name: 'Not available yet' })).toBeDisabled();
  await expect(features.getByRole('link', { name: /Open analytics/ })).toHaveCount(0);

  // Closing returns to the collection, with focus on the edition last shown.
  await overview.getByRole('button', { name: 'Close the overview' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/shygontap\/store\/aaroh$/);
  await expect(collection.getByRole('button', { name: 'Explore Emerald Cipher' })).toBeFocused();

  // A returning visitor goes straight to the overview; Escape closes it.
  await collection.getByRole('button', { name: 'Explore Obsidian' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Replay intro' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // An edition's old address is a 301 to its deep link.
  const old = await page.request.get('/shygontap/store/aaroh/cobalt', { maxRedirects: 0 });
  expect(old.status()).toBe(301);
  expect(new URL(old.headers().location, 'http://host').pathname + new URL(old.headers().location, 'http://host').search).toBe('/shygontap/store/aaroh?design=cobalt');
});

test('AAROH overview with reduced motion: nothing plays by itself, every scene is one press away', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/shygontap/store/aaroh?design=prism');
  await dismissCookieNotice(page);
  const overview = page.getByRole('dialog', { name: /AAROH Prism/ });
  await expect(overview.getByText('Meet AAROH.')).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(overview.getByText('Meet AAROH.')).toBeVisible();
  await expect(overview.getByRole('button', { name: /Pause the welcome/ })).toHaveCount(0);
  await overview.getByRole('button', { name: 'Continue' }).click();
  await expect(overview.getByText('Controlled iridescence behind a lenticular screen.')).toBeVisible();
  await overview.getByRole('button', { name: 'Continue' }).click();
  await expect(overview.getByText('One physical card. Multiple digital experiences.')).toBeVisible();
  await overview.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(overview.getByRole('button', { name: 'Replay intro' })).toBeVisible();
  const turn = await overview.locator('.ao-object .ac-body').evaluate((el) => getComputedStyle(el).transform);
  expect(turn).toBe('none');

  // The hero intro behind it never moves by itself either.
  await overview.getByRole('button', { name: 'Close the overview' }).click();
  const hero = page.locator('#intro');
  await expect(hero.getByText('Meet AAROH.')).toBeVisible();
  await expect(hero.getByRole('button', { name: /Pause the intro|Play the intro/ })).toHaveCount(0);
  await page.waitForTimeout(4500);
  await expect(hero.getByText('Meet AAROH.')).toBeVisible();
});
