import { expect, test, type Page } from '@playwright/test';
import { cspViolations, dismissCookieNotice, stayLocal } from './stack';

/**
 * The landing's static first paint (V01 T-14, OC-4): /shygontap's HTML already
 * holds the page's real header and hero, rendered at build time from the same
 * components (vite.config.ts, src/seo/landingStatic.tsx), and the live page
 * takes its place in the same frame (src/lib/staticLanding.ts).
 *
 * What must hold: without JavaScript the hero is there; with it, the live page
 * replaces the copy, once, and every part of the header and hero is exactly
 * where the copy had it, so the switch cannot be seen.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

/** Where the header and hero's parts are on screen, rounded to the pixel. */
async function layout(page: Page) {
  const box = async (selector: string) => {
    const b = await page.locator(selector).first().boundingBox();
    expect(b, selector).not.toBeNull();
    return [Math.round(b!.x), Math.round(b!.y), Math.round(b!.width), Math.round(b!.height)];
  };
  return {
    header: await box('header.site-header'),
    title: await box('#home-title'),
    tagline: await box('.hero-aaroh-tagline'),
    explore: await box('.hero-actions a.button >> nth=0'),
    stage: await box('.hero-aaroh-stage'),
  };
}

test('without JavaScript, /shygontap already shows its header and hero, and no loading screen', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/shygontap');
  await expect(page.locator('#landing-static')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'SHYGON AAROH' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Explore the collection/ })).toHaveAttribute('href', '/shygontap/store/aaroh');
  const card = page.locator('#landing-static img[src*="obsidian-premium-front"]');
  await expect(card).toHaveAttribute('fetchpriority', 'high');
  await expect(card).toHaveJSProperty('complete', true);
  await expect(page.locator('.boot')).toHaveCount(0);
  await expect(page.locator('#root')).toBeEmpty();
  await context.close();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) test(`with JavaScript, the live page replaces the copy once, with every part of the hero exactly where it was (${viewport.width} px)`, async ({ browser, page }) => {

  // The copy alone, once its entrance has played.
  const still = await browser.newContext({ javaScriptEnabled: false, viewport });
  const staticPage = await still.newPage();
  await staticPage.goto('/shygontap');
  await staticPage.waitForTimeout(1500);
  const before = await layout(staticPage);
  await still.close();

  // The live page: the copy is gone, one hero, one main, and nothing has moved.
  await page.setViewportSize(viewport);
  await page.goto('/shygontap');
  await expect(page.locator('#landing-static')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'SHYGON AAROH' })).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('#cards')).toBeAttached(); // the rest of the page arrived with it
  await dismissCookieNotice(page);
  expect(await layout(page)).toEqual(before);
  // The live hero did not play its entrance again.
  expect(await page.locator('.hero-aaroh-stage').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
});

test('other pages keep the loading screen and carry no copy of the landing', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/shygontap/store');
  await expect(page.locator('#landing-static')).toHaveCount(0);
  await expect(page.locator('.boot')).toHaveCount(1);
  await context.close();
});
