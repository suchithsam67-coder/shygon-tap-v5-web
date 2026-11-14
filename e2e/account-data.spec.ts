import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, dismissCookieNotice, server, stayLocal, cspViolations } from './stack';

/**
 * A customer's own data (V6-072), on the local stack: they download a copy of
 * it, built by the server (AAROH-API v0.12 §4a), with their Business profile
 * as a contact card, and ask for their account to be deleted. The copy holds
 * only their rows; the request is a privacy ticket that a person handles, and
 * deletes nothing by itself (docs/runbooks/RUNBOOK-account-deletion.md).
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

async function askForDeletion(page: Page) {
  await page.goto('/shygontap/settings');
  await page.getByRole('button', { name: 'Ask us to delete your account' }).click();
  await page.getByRole('button', { name: 'Send the request' }).click();
  await page.waitForURL('**/shygontap/support');
}

// The production CSP blocked nothing on any page of the journey.
test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

test('a customer downloads their own data, then asks for deletion; nothing is deleted yet', async ({ page }) => {
  const someoneElse = await apiCustomer('Someone Else');
  await buyExperience(someoneElse, 'premium');
  const me = await apiCustomer('Data Owner');
  await buyExperience(me, 'business');
  await signIn(page, me.email, me.password);

  // The download: the server's export (AAROH-API v0.12 §4a), saved as JSON on the click.
  await page.goto('/shygontap/settings');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download your data' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^shygon-account-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'));

  expect(data.format).toBe('shygon-account-export/2');
  expect(data.accountId).toBe(me.userId);
  expect(data.taps).toHaveLength(1);
  expect(data.orders).toHaveLength(1);
  expect(data.orders[0].items.map((item: { sku: string }) => item.sku)).toEqual(['plan-business']);
  expect(data.entitlements.map((e: { key: string }) => e.key)).toEqual(['business']);
  expect(data.notifications.length).toBeGreaterThan(0);
  // The closed AAROH sections are there too, which the old browser export could not read.
  for (const section of ['modes', 'emergency', 'returnToOwner', 'connect', 'cards']) expect(data).toHaveProperty(section);
  // The 18+ confirmation recorded at sign-up (v0.17 §4c), so the owner can see it.
  expect(data.ageConfirmation).toMatchObject({ confirmed: true, source: 'signup', policiesVersion: 'e2e' });
  const text = JSON.stringify(data);
  expect(text).not.toContain(someoneElse.userId);
  expect(text).not.toContain(someoneElse.email);
  // Security values are left out by rule, and the page says what is left out, and why.
  expect(text).not.toMatch(/activation_?code|card_?uid/i);
  expect(data.excluded.length).toBeGreaterThan(0);
  await expect(page.getByText('What the file leaves out, and why')).toBeVisible();
  await expect(page.getByText(`${data.excluded[0].what}.`)).toBeVisible();

  // The Business profile as a contact card: its own click.
  const card = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save your Business profile as a contact card (.vcf)' }).click();
  const vcf = await card;
  expect(vcf.suggestedFilename()).toMatch(/^shygon-tap-\d{4}-\d{2}-\d{2}\.vcf$/);
  const vcard = fs.readFileSync((await vcf.path())!, 'utf8');
  expect(vcard.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
  expect(vcard.trimEnd().endsWith('END:VCARD')).toBe(true);

  // Each export is recorded in the account's own history (the format and counts only).
  const { data: exports } = await server().from('account_events').select('detail').eq('user_id', me.userId).eq('event_type', 'data_export');
  expect(exports).toHaveLength(1);
  expect(exports![0].detail.format).toBe('shygon-account-export/2');

  // The deletion request: one privacy ticket, with the customer's message.
  await askForDeletion(page);
  const db = server();
  const { data: tickets } = await db
    .from('support_tickets')
    .select('id, reference, category, subject, status')
    .eq('user_id', me.userId);
  expect(tickets).toHaveLength(1);
  expect(tickets![0]).toMatchObject({ category: 'privacy', subject: 'Account deletion request', status: 'open' });
  const { data: messages } = await db.from('support_messages').select('author_role, body').eq('ticket_id', tickets![0].id);
  expect(messages).toHaveLength(1);
  expect(messages![0].body).toContain('Please delete my SHYGON account');
  await expect(page.getByText('Account deletion request').first()).toBeVisible();

  // Asking again finds the open request instead of opening a second one.
  await askForDeletion(page);
  const { count } = await db.from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', me.userId);
  expect(count).toBe(1);

  // The request deletes nothing: a person does that, after confirming it.
  const { data: tap } = await db.from('tap_profiles').select('id').eq('user_id', me.userId);
  expect(tap).toHaveLength(1);
  const { data: orders } = await db.from('orders').select('id').eq('user_id', me.userId);
  expect(orders).toHaveLength(1);
});
