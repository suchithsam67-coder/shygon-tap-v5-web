import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, cspViolations, dismissCookieNotice, stack, stayLocal } from './stack';

/**
 * The 18+ confirmation for accounts from before the gate (V01 T-13; AAROH-API
 * v0.17 §4c; DEC-2026-048), end to end on the local stack with Session A's
 * real function and migration 044. New sign-ups are covered in
 * journeys.spec.ts (recorded at sign-up, no prompt).
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

/** What the server says, read with the owner's own token. */
async function ageStatus(token: string) {
  const response = await fetch(`${stack().appUrl}/api/account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: 'age.status' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { confirmed: boolean; confirmedAt: string | null; source: string | null };
}

test('an account from before the gate is asked once, the server records it, and it is not asked again', async ({ page }) => {
  const owner = await apiCustomer('Age Prompt Owner', { adult: false });
  expect(await ageStatus(owner.token)).toEqual({ confirmed: false, confirmedAt: null, source: null });

  await signIn(page, owner.email, owner.password);
  const dialog = page.getByRole('dialog', { name: 'Confirm your age' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('SHYGON Tap is for adults only.');
  const confirm = dialog.getByRole('button', { name: 'Confirm' });
  await expect(confirm).toBeDisabled();
  // Focus starts on the box and stays in the dialog: box, email link, Sign out, then the box again.
  const box = dialog.getByRole('checkbox', { name: 'I am 18 or older.' });
  await expect(box).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(box).toBeFocused();

  await dialog.getByRole('checkbox', { name: 'I am 18 or older.' }).check();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  const recorded = await ageStatus(owner.token);
  expect(recorded).toMatchObject({ confirmed: true, source: 'reconfirm' });
  expect(Date.now() - Date.parse(recorded.confirmedAt!)).toBeLessThan(60_000);

  // Another page, and a fresh load: the server says confirmed, so nothing asks.
  await page.goto('/shygontap/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByTestId('age-confirmation')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByTestId('age-confirmation')).toHaveCount(0);
});

test('an account from before the gate can sign out instead of confirming; nothing is recorded', async ({ page }) => {
  const owner = await apiCustomer('Age Prompt Leaver', { adult: false });
  await signIn(page, owner.email, owner.password);
  const dialog = page.getByRole('dialog', { name: 'Confirm your age' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/shygontap/auth');
  // Signing out ended every session of the account, so read it back with a new one.
  const { data, error } = await owner.client.auth.signInWithPassword({ email: owner.email, password: owner.password });
  expect(error).toBeNull();
  expect(await ageStatus(data.session!.access_token)).toMatchObject({ confirmed: false });
});

test('an account confirmed at sign-up is never asked', async ({ page }) => {
  const owner = await apiCustomer('Age Confirmed Owner');
  expect(await ageStatus(owner.token)).toMatchObject({ confirmed: true, source: 'signup' });
  await signIn(page, owner.email, owner.password);
  await page.goto('/shygontap/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByTestId('age-confirmation')).toHaveCount(0);
});
