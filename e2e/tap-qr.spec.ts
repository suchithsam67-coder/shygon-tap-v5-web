import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, server, stayLocal } from './stack';

/**
 * The QR page's "Download PNG" (/shygontap/qr). The page draws the code as
 * SVG; the download must rasterise it to a PNG at the size picked on the
 * slider (180–1024px), and the file must hold the code, not a blank square.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

// The production CSP blocked nothing the download needs.
test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

/** Width and height from a PNG's IHDR chunk, after checking the signature. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Decodes the PNG in the page and counts its dark and light pixels. */
async function inkCoverage(page: Page, bytes: Buffer) {
  return page.evaluate(async (base64) => {
    // Decoded from bytes, not fetched: the page's CSP (connect-src) blocks data: URLs.
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let dark = 0;
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
      if (data[i + 3]! > 200 && luma < 64) dark++;
      else if (data[i + 3]! > 200 && luma > 192) light++;
    }
    return { dark: dark / (data.length / 4), light: light / (data.length / 4) };
  }, bytes.toString('base64'));
}

async function downloadAt(page: Page, slug: string, sizeLabel: string) {
  await expect(page.getByText(`Size · ${sizeLabel}`)).toBeVisible();
  // Either the file arrives or the page shows an error toast instead (before
  // the fix it looked for a <canvas>, found none and said "Nothing to download").
  const failure = page.locator('.toast[role="alert"]').first();
  const outcome = Promise.race([
    page.waitForEvent('download', { timeout: 15_000 }),
    failure.waitFor({ timeout: 15_000 }).then(async () => {
      throw new Error(`no download; the page said: ${await failure.innerText()}`);
    }),
  ]);
  await page.getByRole('button', { name: 'Download PNG' }).click();
  const file = await outcome;
  expect(file.suggestedFilename()).toBe(`shygon-tap-${slug}.png`);
  return fs.readFileSync((await file.path())!);
}

test('the QR downloads as a PNG at the size chosen on the slider', async ({ page }) => {
  // Set-up: a customer with a published Tap, signed in.
  const owner = await apiCustomer('QR Owner');
  await buyExperience(owner, 'business');
  const { error } = await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  expect(error).toBeNull();
  const { data: tap } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();
  expect(tap?.slug).toBeTruthy();

  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(owner.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');

  await page.goto('/shygontap/qr');
  const slider = page.getByRole('slider');

  // The default size, a size picked with the keyboard (4px steps), and both
  // ends of the slider: the smallest, and the largest print size.
  const picks: [string[], number][] = [
    [[], 280],
    [Array(5).fill('ArrowRight'), 300],
    [['Home'], 180],
    [['End'], 1024],
  ];
  for (const [keys, size] of picks) {
    for (const key of keys) await slider.press(key);
    const png = await downloadAt(page, tap!.slug, `${size}px`);
    expect(pngSize(png)).toEqual({ width: size, height: size });
    if (size === 1024) await test.info().attach('qr-1024.png', { body: png, contentType: 'image/png' });
    const ink = await inkCoverage(page, png);
    expect(ink.dark).toBeGreaterThan(0.2); // modules drawn
    expect(ink.light).toBeGreaterThan(0.3); // background and quiet zone drawn
  }
  await expect(page.getByRole('status').filter({ hasText: 'QR downloaded' }).first()).toBeVisible();
});
