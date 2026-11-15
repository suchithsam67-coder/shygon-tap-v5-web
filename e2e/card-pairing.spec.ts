import crypto from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, server, stayLocal } from './stack';
// The chip simulation uses the server's own SUN primitives, as verified-tap.spec.ts and test:verified-tap do.
import { diversifyKey, sdmMac, sdmSessionMacKey } from '../netlify/lib/sun.mjs';

/**
 * Card pairing and report stolen (V01 T-08/T-09; AAROH-API v0.15 §10d and §7
 * C-6 to C-8; DEC-2026-047), in a real browser on the local stack with Session
 * A's functions and migration 041. A simulated MIFARE DESFire EV3 chip, keyed
 * with this run's TEST keys (playwright.config.ts), taps a card that was
 * shipped to its owner but is not active yet. Every claim that depends on the
 * server reads the database back.
 */

const META = process.env.VERIFY_META_MASTER_1 ?? '';
const FILE = process.env.VERIFY_FILE_MASTER_1 ?? '';
const PEPPER = process.env.VERIFY_UID_PEPPER ?? '';
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const hex = (n: number) => crypto.randomBytes(n).toString('hex');

test.skip(!META || !FILE || !PEPPER, 'the stack was started without the Verified Tap test keys (playwright.config.ts)');

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

/** An owner with a published Tap, and an AAROH card shipped to them: chip personalised, not active yet. */
async function shippedCard(name: string) {
  const owner = await apiCustomer(name);
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const db = server();
  const { data: tap } = await db.from('tap_profiles').select('id').eq('user_id', owner.userId).single();
  const label = `E2E-PAIR-${hex(3).toUpperCase()}`;
  const { data: card, error } = await db
    .from('cards')
    .insert({
      user_id: owner.userId,
      tap_profile_id: tap!.id,
      card_id: label,
      activation_code: `SHY-E2E-${hex(4)}`,
      card_uid: label,
      sku: 'aaroh-test',
      card_slot: 1,
      status: 'shipped',
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  const uid = `04${hex(6)}`;
  const code = Array.from(crypto.randomBytes(16), (b) => BASE32[b % 32]).join('');
  const uidHmac = crypto.createHmac('sha256', PEPPER).update(uid).digest('hex');
  const { error: registered } = await db.rpc('verify_register_device', { p_card: card!.id, p_code: code, p_key_epoch: 1, p_uid_hmac: uidHmac });
  expect(registered).toBeNull();

  const input = Buffer.from(String(card!.id).replace(/-/g, ''), 'hex');
  const metaKey = diversifyKey(META, input);
  const fileKey = diversifyKey(FILE, input);
  let counter = 0;
  /** The chip's next read: a new counter each time, as a real tap. */
  const tapUrl = () => {
    counter += 1;
    const block = Buffer.concat([
      Buffer.from([0xc7]),
      Buffer.from(uid, 'hex'),
      Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]),
      crypto.randomBytes(5),
    ]);
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(metaKey, 'hex'), Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(block), cipher.final()]).toString('hex').toUpperCase();
    const c = sdmMac(sdmSessionMacKey(fileKey, uid, counter), '').toUpperCase();
    return `/d/${code}?e=${e}&c=${c}`;
  };
  const status = async () => (await db.from('cards').select('status').eq('id', card!.id).single()).data?.status as string;
  return { owner, name, label, code, cardId: card!.id as string, tapUrl, status };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

test('tap to activate: never the Tap before; the owner signs in and taps; then it opens the Tap; report stolen then opens nothing', async ({ page }) => {
  const card = await shippedCard('Pairing Owner');
  const pairing = page.getByTestId('vt-pairing');

  // 1. Signed out, a genuine tap: not active, no owner page, asked to sign in. Nothing changes.
  await page.goto(card.tapUrl());
  await expect(pairing).toHaveAttribute('data-state', 'signed-out');
  await expect(page.getByRole('heading', { name: "This card isn't active yet" })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: card.name })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/d/${card.code}$`));
  expect(await card.status()).toBe('shipped');

  // 2. The owner signs in on this phone, then taps again: "Activate this card".
  await signIn(page, card.owner.email, card.owner.password);
  await page.goto(card.tapUrl());
  await page.getByRole('button', { name: 'Activate this card' }).click();
  await expect(page.getByRole('heading', { name: 'Card activated' })).toBeVisible();
  expect(await card.status()).toBe('active');
  const { data: events } = await server().from('card_events').select('to_status, actor, reason').eq('card_id', card.cardId);
  expect(events).toContainEqual({ to_status: 'active', actor: 'owner', reason: 'tap to activate' });

  // 3. The next tap opens the owner's Tap, verified.
  await page.goto(card.tapUrl());
  await expect(page.getByRole('heading', { level: 1, name: card.name })).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vt-verdict')).toHaveAttribute('data-verdict', 'genuine');

  // 4. Your cards: a card with a chip gets no code buttons; report it stolen.
  await page.goto('/shygontap/cards');
  const row = page.locator('li', { hasText: `Card ${card.label}` });
  await expect(row.getByText('Secure chip')).toBeVisible();
  await expect(row.getByRole('button', { name: /Activate|Renew activation|Deactivate/ })).toHaveCount(0);
  await row.getByRole('button', { name: 'Report stolen' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Report this card stolen?' });
  await expect(dialog).toContainText('tapping it will open nothing');
  await dialog.getByRole('button', { name: 'Switch it off for good' }).click();
  await expect(row.getByText('Switched off')).toBeVisible();
  expect(await card.status()).toBe('retired');

  // 5. A tap now opens nothing: the neutral "Tap not found", never the owner's page.
  await page.goto(card.tapUrl());
  await expect(page.getByText('Tap not found')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: card.name })).toHaveCount(0);
});

test('tap to activate needs the owner: another signed-in account cannot activate the card', async ({ page }) => {
  const card = await shippedCard('Pairing Real Owner');
  const someoneElse = await apiCustomer('Pairing Someone Else');
  await signIn(page, someoneElse.email, someoneElse.password);
  await page.goto(card.tapUrl());
  await expect(page.getByTestId('vt-pairing')).toHaveAttribute('data-state', 'not-yours');
  await expect(page.getByRole('button', { name: 'Activate this card' })).toHaveCount(0);
  expect(await card.status()).toBe('shipped');
});

test("v0.18, the proof alone: an account with its own card waiting cannot activate another account's card, and its own still activates", async ({ page }) => {
  const theirs = await shippedCard('Pairing Card Holder');
  const mine = await shippedCard('Pairing Other Holder');
  await signIn(page, mine.owner.email, mine.owner.password);

  // Another account's card: offered (this account has a card waiting), refused by the server, nothing changed.
  await page.goto(theirs.tapUrl());
  await page.getByRole('button', { name: 'Activate this card' }).click();
  await expect(page.getByTestId('vt-pairing')).toHaveAttribute('data-state', 'not-yours');
  await expect(page.getByRole('alert')).toContainText('This card is not on the account you are signed in with.');
  expect(await theirs.status()).toBe('shipped');
  expect(await mine.status()).toBe('shipped');

  // Its own card, tapped: activated from the proof alone.
  await page.goto(mine.tapUrl());
  await page.getByRole('button', { name: 'Activate this card' }).click();
  await expect(page.getByRole('heading', { name: 'Card activated' })).toBeVisible();
  expect(await mine.status()).toBe('active');
  expect(await theirs.status()).toBe('shipped');
});

test('the pairing page: no serious or critical WCAG 2.2 AA violation', async ({ page }) => {
  const card = await shippedCard('Axe Pairing Owner');
  await signIn(page, card.owner.email, card.owner.password);
  await page.goto(card.tapUrl());
  await expect(page.getByRole('button', { name: 'Activate this card' })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);
  expect(blocking).toEqual([]);
});
