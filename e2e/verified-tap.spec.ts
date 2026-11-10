import crypto from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, server, stayLocal } from './stack';
// The chip simulation uses the server's own SUN primitives (AN10922, AN12196), as test:verified-tap does.
import { diversifyKey, sdmMac, sdmSessionMacKey } from '../netlify/lib/sun.mjs';

/**
 * Verified Tap (AAROH-API v0.11 §10d) in a real browser on the local stack:
 * a simulated NTAG 424 DNA chip, keyed with this run's TEST keys
 * (playwright.config.ts), taps the card's /d/ address. Every claim that
 * depends on the server reads the verification log back.
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

/** An owner with a published Tap and an active card whose chip is personalised with this run's keys. */
async function personalisedCard(name: string) {
  const owner = await apiCustomer(name);
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const db = server();
  const { data: tap } = await db.from('tap_profiles').select('id').eq('user_id', owner.userId).single();
  const serial = 1 + crypto.randomInt(99);
  const { data: card, error } = await db
    .from('cards')
    .insert({
      user_id: owner.userId,
      tap_profile_id: tap!.id,
      card_id: `E2E-VERIFY-${hex(4)}`,
      activation_code: `SHY-E2E-${hex(4)}`,
      sku: 'aaroh-test',
      card_slot: 1,
      status: 'active',
      // Edition numbers are unique per design, so this run's card has a design of its own.
      edition_design: `E2E ${hex(3)}`,
      edition_serial: serial,
      edition_count: 100,
      edition_chapter_size: 100,
    })
    .select('id')
    .single();
  expect(error).toBeNull();
  const uid = `04${hex(6)}`;
  const code = Array.from(crypto.randomBytes(16), (b) => BASE32[b % 32]).join('');
  const uidHmac = crypto.createHmac('sha256', PEPPER).update(uid).digest('hex');
  const { error: registered } = await db.rpc('verify_register_device', { p_card: card!.id, p_code: code, p_key_epoch: 1, p_uid_hmac: uidHmac });
  expect(registered).toBeNull();

  // The chip: PICC data = AES-128-CBC (zero IV) of C7 || UID || counter (LSB first) || padding; the MAC over an empty input.
  const input = Buffer.from(String(card!.id).replace(/-/g, ''), 'hex');
  const metaKey = diversifyKey(META, input);
  const fileKey = diversifyKey(FILE, input);
  const read = (counter: number) => {
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
    return { e, c, url: `/d/${code}?e=${e}&c=${c}` };
  };
  return { owner, name, code, serial, tap: read };
}

const verdicts = async (code: string) =>
  ((await server().from('tap_verify_events').select('verdict, created_at').eq('public_code', code).order('created_at')).data ?? []).map(
    (row) => row.verdict as string,
  );

/** Opens a card address and waits for the Tap underneath, past its opening. */
async function open(page: Page, url: string, owner: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: owner })).toBeAttached();
  await page.keyboard.press('Escape');
}

test('verified tap: genuine once with its edition, a re-opened link not new, a wrong MAC not verified, a plain link nothing; e and c never stay', async ({ page }) => {
  const card = await personalisedCard('Verified Card Owner');
  const verifyRequests: Request[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/verify')) verifyRequests.push(request);
  });

  // 1. A real tap: accepted, with the card's place in its edition, above the owner's own page.
  const first = card.tap(1);
  await open(page, first.url, card.name);
  await expect(page.getByTestId('vt-verdict')).toHaveText(
    `Verified tap. This card's secure tap was accepted.No. ${String(card.serial).padStart(3, '0')} of 100`,
  );
  await expect(page).toHaveURL(new RegExp(`/d/${card.code}$`));
  // The check: a POST after load, its values in the body only, sent with no referrer.
  expect(verifyRequests).toHaveLength(1);
  expect(verifyRequests[0]!.method()).toBe('POST');
  expect(verifyRequests[0]!.url()).not.toContain(first.e);
  expect(await verifyRequests[0]!.headerValue('referer')).toBeNull();
  expect(await verdicts(card.code)).toEqual(['genuine']);

  // 2. The same read again (a copied or re-opened link): not new, and never "verified".
  await open(page, first.url, card.name);
  await expect(page.getByTestId('vt-verdict')).toHaveText("We couldn't confirm this tap as new. Please tap the card again.");

  // 3. A read whose MAC does not match: not verified, without saying why.
  const second = card.tap(2);
  const wrong = second.c.slice(0, -1) + (second.c.endsWith('0') ? '1' : '0');
  await open(page, `/d/${card.code}?e=${second.e}&c=${wrong}`, card.name);
  await expect(page.getByTestId('vt-verdict')).toHaveText("We couldn't verify this tap. Please tap the card again or contact SHYGON support.");

  // 4. The address with no chip values (a QR, a typed or shared link): the Tap, and nothing about authenticity.
  await open(page, `/d/${card.code}`, card.name);
  await expect(page.getByTestId('vt-verdict')).toHaveCount(0);
  expect(await verdicts(card.code)).toEqual(['genuine', 'already_checked', 'not_confirmed']);
  expect(await page.content()).not.toMatch(/fake|counterfeit/i);

  // 5. A card SHYGON does not know: the neutral "Tap not found".
  const unknown = Array.from(crypto.randomBytes(16), (b) => BASE32[b % 32]).join('');
  await page.goto(`/d/${unknown}?e=${second.e}&c=${second.c}`);
  await expect(page.getByText('Tap not found')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/d/${unknown}$`));
});

test('the verified tap page: no serious or critical WCAG 2.2 AA violation', async ({ page }) => {
  const card = await personalisedCard('Axe Verified Owner');
  await open(page, card.tap(1).url, card.name);
  await expect(page.getByTestId('vt-verdict')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);
  expect(blocking).toEqual([]);
});
