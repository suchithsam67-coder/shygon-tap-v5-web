import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, eventually, server, stack, stayLocal } from './stack';

/**
 * The AAROH experience on the local stack (brief "Complete Interactive OS
 * Experience" §12): the real schema, the real functions, a real browser.
 *
 *   Public:   NFC → browser → SHYGON opening → showroom → each mode → back
 *   Owner:    sign in → owner opening → dashboard → AAROH experience → change
 *             a published detail → preview → the public page reflects it →
 *             sign out → protected pages refuse
 *   Security: no owner controls without a session, nothing private in the
 *             page, no unavailable mode reachable by address, the demo calls
 *             no backend
 *
 * Every check reads the page; the database is read back where a claim
 * depends on it.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

const slide = (page: Page, name: string) => page.getByRole('group', { name: new RegExp(`^${name}, \\d+ of \\d+$`) });

test('public: a tap opens the SHYGON opening, then the showroom; every live mode opens and comes back', async ({ page }) => {
  const owner = await apiCustomer('Showroom Visitor View');
  await buyExperience(owner, 'premium');
  // Published with a role and company; the phone is stored but switched off.
  const { error } = await owner.client
    .from('tap_profiles')
    .update({
      status: 'active',
      designation: 'Principal architect',
      company: 'Rao Studio',
      headline: 'Architect',
      phone: '+919822222222',
      email: 'showroom.owner@example.test',
      enabled_customizations: ['email'],
    })
    .eq('user_id', owner.userId);
  expect(error).toBeNull();
  const db = server();
  const { data: tap } = await db.from('tap_profiles').select('id, slug').eq('user_id', owner.userId).single();

  await page.goto(`/t/${tap!.slug}?src=nfc`);

  // The opening plays over a showroom that is already there.
  const opening = page.getByTestId('tap-opening');
  await expect(opening).toBeVisible();
  await expect(opening).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Showroom Visitor View' })).toBeAttached();
  await expect(opening).toHaveCount(0, { timeout: 6000 });

  // Only live modes with something published: no planned, blocked or demo card on a person's Tap.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Profile', 'Business', 'Contact', 'Owner access']);
  await expect(page.getByText(/Coming soon|Emergency|Demo/)).toHaveCount(0);
  // The switched-off phone is not on the page; the published email is.
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('a[href="mailto:showroom.owner@example.test"]')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Browse: the arrows move the rail and the active card.
  await page.getByRole('button', { name: 'Next card' }).click();
  await expect(page.getByRole('button', { name: 'Show Business' })).toHaveAttribute('aria-current', 'true');

  // Each mode opens on its own address and Back returns to the same card.
  for (const [button, heading, mode] of [
    ['Open profile', 'Showroom Visitor View', 'identity'],
    ['Business details', 'Business', 'business'],
    ['All contact options', 'Contact', 'contact'],
    ['Owner access', 'Owner access', 'owner'],
  ] as const) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`mode=${mode}`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await page.getByRole('button', { name: 'Showroom' }).click();
    await expect(page).not.toHaveURL(/mode=/);
    await expect(page.locator(`#sr-open-${mode}`)).toBeFocused();
  }
  // The phone's own back button does the same.
  await page.getByRole('button', { name: 'Business details' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Business' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Showroom Visitor View' })).toBeVisible();

  // The landing counted one view and one NFC tap, and nothing else was invented.
  const events = await eventually(async () => {
    const { data } = await db.from('tap_events').select('event_type').eq('tap_profile_id', tap!.id);
    return (data?.length ?? 0) >= 2 ? data : null;
  }, 'view and nfc recorded');
  expect(events!.map((e) => e.event_type).sort()).toEqual(['nfc', 'view']);
});

test('public: nothing private reaches the page, and an unavailable mode cannot be opened by address', async ({ page }) => {
  const owner = await apiCustomer('Private Owner');
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active', email: null }).eq('user_id', owner.userId);
  const { data: tap } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();

  for (const mode of ['', '?mode=identity', '?mode=owner', '?mode=emergency', '?mode=connect', '?mode=business']) {
    await page.goto(`/t/${tap!.slug}${mode}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const html = await page.content();
    expect(html, `${mode}: the account id`).not.toContain(owner.userId);
    expect(html, `${mode}: the login email`).not.toContain(owner.email);
  }
  // Emergency, Connect and a Business mode with nothing published all fall back to the showroom.
  await page.goto(`/t/${tap!.slug}?mode=emergency`);
  await expect(page.getByRole('heading', { level: 1, name: 'Private Owner' })).toBeVisible();
  await expect(page.getByText(/emergency/i)).toHaveCount(0);

  // Owner access is the ordinary sign-in, and does not sign anyone in.
  await page.goto(`/t/${tap!.slug}?mode=owner`);
  await page.getByRole('link', { name: /I’m the owner: sign in/ }).click();
  await expect(page).toHaveURL(/\/shygontap\/auth$/);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();

  // Without a session, the owner pages refuse and send the visitor to sign in.
  for (const path of ['/shygontap/experience', '/shygontap/emergency', '/shygontap/tap', '/shygontap/account']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/shygontap\/auth$/);
  }
});

test('demo: the AAROH demo showroom is labelled, sends nothing to the backend, and the emergency walkthrough sends nothing', async ({ page }) => {
  const { gatewayUrl } = stack();
  const backend: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.startsWith(gatewayUrl) || url.includes('/api/') || url.includes('/.netlify/')) backend.push(url);
  });

  await page.goto('/aaroh/experience');
  await expect(page.getByRole('note').first()).toContainText('not a real person’s card');
  await expect(page.getByRole('heading', { level: 1, name: 'Sample Profile' })).toBeVisible();
  await expect(page.getByTestId('tap-opening')).toHaveCount(0, { timeout: 6000 });
  await expect(slide(page, 'Return to Owner')).toContainText('Coming soon');
  await expect(slide(page, 'Return to Owner').getByRole('button')).toHaveCount(0);
  await expect(slide(page, 'Emergency Profile')).toContainText('Demo');

  await slide(page, 'Emergency Profile').getByRole('button', { name: 'Try the demo' }).click();
  await expect(page.getByText('Nothing here is sent to anyone.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Call 112/ })).toHaveAttribute('href', 'tel:112');
  await page.getByRole('button', { name: 'Walk through an alert' }).click();
  const review = page.getByRole('button', { name: /review \(demo\)/ });
  await expect(review).toBeDisabled();
  await page.getByLabel('I am with the owner and they need help').check();
  await page.getByLabel(/I understand a real alert/).check();
  await review.click();
  await expect(page.getByRole('heading', { name: 'Demo finished. No alert was sent.' })).toBeVisible();
  await expect(review).toHaveCount(0);

  expect(backend).toEqual([]);
});

test('owner: sign in, the SHYGON OS opening, the AAROH experience page, a change that reaches the public page, sign out', async ({ page, browser }) => {
  const owner = await apiCustomer('Owner Journey');
  await buyExperience(owner, 'business');
  // Published as provisioned (no role or company); only the status changes, so the
  // owner's first content edit is still theirs to make in the editor.
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const { data: tap } = await server().from('tap_profiles').select('slug, company, designation').eq('user_id', owner.userId).single();
  expect([tap!.company, tap!.designation]).toEqual([null, null]);

  await signIn(page, owner.email, owner.password);
  // The owner's opening, once per session, over the dashboard.
  await expect(page.getByTestId('tap-opening')).toBeVisible();
  await expect(page.getByTestId('tap-opening')).toContainText('OS');
  await expect(page.getByTestId('tap-opening')).toHaveCount(0, { timeout: 6000 });
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: /Hello/ })).toBeVisible();
  await expect(page.getByTestId('tap-opening')).toHaveCount(0);

  // The AAROH experience page reads the live public page: Business is not shown yet.
  await page.getByRole('link', { name: 'AAROH experience' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your AAROH experience' })).toBeVisible();
  const modes = page.locator('section', { has: page.getByRole('heading', { name: 'Modes on your card' }) });
  await expect(modes.getByText('Profile · Shown')).toBeVisible();
  await expect(modes.getByText('Business · Not shown')).toBeVisible();
  await expect(page.getByRole('link', { name: /Preview your public experience/ })).toHaveAttribute('href', `/t/${tap!.slug}`);

  // Publish a company in the Tap editor (the server enforces the rules).
  await page.goto('/shygontap/tap');
  await page.getByLabel('Company').fill('Journey Works');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your Tap profile has been updated.')).toBeVisible();

  await page.goto('/shygontap/experience');
  await expect(modes.getByText('Business · Shown')).toBeVisible();

  // The public page reflects it.
  const visitor = await browser.newPage();
  await stayLocal(visitor.context());
  await visitor.goto(`/t/${tap!.slug}`);
  await expect(slide(visitor, 'Business')).toContainText('Journey Works');
  await visitor.close();

  // Emergency Profile, Return to Owner and SHYGON Connect read "Coming soon" and are not linked
  // until released (owner, 2026-10-20); the page itself is reachable for verification.
  for (const name of ['Emergency Profile', 'Return to Owner', 'SHYGON Connect']) {
    const panel = page.locator('section', { has: page.getByRole('heading', { level: 2, name }) });
    await expect(panel.getByText('Coming soon')).toBeVisible();
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Account' }).getByRole('link', { name })).toHaveCount(0);
  }
  await page.goto('/shygontap/emergency');
  await expect(page.getByRole('heading', { level: 1, name: 'Emergency Profile' })).toBeVisible();

  // Sign out: the owner pages refuse again.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/shygontap/experience');
  await expect(page).toHaveURL(/\/shygontap\/auth$/);
});

test('owner emergency contacts on the real backend, with no text-message provider: stored masked, nothing claimed as sent', async ({ page }) => {
  const owner = await apiCustomer('Emergency Owner');
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const db = server();
  const { data: tap } = await db.from('tap_profiles').select('slug').eq('user_id', owner.userId).single();
  const number = '+919811100001';

  await signIn(page, owner.email, owner.password);
  await page.goto('/shygontap/emergency');
  // The provider state comes from the server, and the page says what it means.
  await expect(page.getByRole('heading', { name: 'Text messages are not set up yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Alert my emergency contacts/ })).toBeDisabled();

  // Invalid input is refused by the server and nothing is added.
  await page.getByLabel('Name').fill('Ravi');
  await page.getByLabel(/^Mobile number/).fill('12');
  await page.getByRole('button', { name: 'Add contact' }).click();
  await expect(page.locator('#em-form-error')).toBeVisible();
  expect((await db.from('emergency_contacts').select('id').eq('user_id', owner.userId)).data ?? []).toHaveLength(0);

  // A valid contact is stored by the server and shown masked, unverified.
  await page.getByLabel(/^Mobile number/).fill(number);
  await page.getByRole('button', { name: 'Add contact' }).click();
  const row = page.locator('li', { hasText: 'Ravi' });
  await expect(row.getByText('Not verified')).toBeVisible();
  await expect(row).toContainText('•');
  expect(await page.content()).not.toContain('9811100001');
  const stored = await eventually(async () => {
    const { data } = await db.from('emergency_contacts').select('id, verified_at').eq('user_id', owner.userId);
    return data?.length === 1 ? data : null;
  }, 'contact stored');
  expect(stored![0]!.verified_at).toBeNull();

  // Verification cannot send a code without a provider, and says so.
  await row.getByRole('button', { name: 'Verify number' }).click();
  await expect(page.getByText(/Text messages are not set up for SHYGON yet, so nothing can be sent/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Alert my emergency contacts/ })).toBeDisabled();

  // Visitors still see no emergency mode: the owner has not opted in and the host switch is off.
  const visitor = await page.context().browser()!.newPage();
  await stayLocal(visitor.context());
  await visitor.goto(`/t/${tap!.slug}`);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Emergency Owner' })).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 2, name: 'Emergency Profile' })).toHaveCount(0);
  await visitor.close();

  // Remove: asked first, then gone from the server.
  await row.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Ravi was removed.')).toBeVisible();
  await eventually(async () => ((await db.from('emergency_contacts').select('id').eq('user_id', owner.userId)).data?.length ?? -1) === 0, 'contact removed');
});

test('return to owner: the owner can opt in, and the relay stays off on the public Tap while SHYGON has not switched it on', async ({ page }) => {
  const owner = await apiCustomer('Relay Owner');
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const { data: tap } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();

  await signIn(page, owner.email, owner.password);
  await page.goto('/shygontap/return-to-owner');
  await expect(page.getByText(/SHYGON has not switched the relay on yet/)).toBeVisible();
  await expect(page.getByText('No messages.')).toBeVisible();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText('Saved. Finders can message you once SHYGON enables the relay.')).toBeVisible();

  const visitor = await page.context().browser()!.newPage();
  await stayLocal(visitor.context());
  await visitor.goto(`/t/${tap!.slug}`);
  await expect(visitor.getByRole('heading', { level: 1, name: 'Relay Owner' })).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 2, name: 'Return to Owner' })).toHaveCount(0);
  await visitor.close();
});
