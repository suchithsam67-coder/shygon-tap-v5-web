import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, server, stayLocal } from './stack';

/**
 * Accessibility (V6 Stage 6; V6-039): WCAG 2.2 AA, checked with axe-core on
 * every page a visitor or a customer can reach (contrast, labels, names,
 * landmarks, target size), plus what axe cannot see: keyboard order with a
 * visible focus ring, and no motion when the visitor asks for less.
 * Serious and critical violations fail; anything lesser is printed for the
 * report.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

// The production CSP blocked nothing on any page of the journey.
test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

async function audit(page: Page, label: string): Promise<string[]> {
  await page.waitForLoadState('networkidle');
  // Measure the page as a visitor sees it: after entrance fades and reveals
  // finish (mid-fade, text blends into its background and reads as no
  // contrast). Infinite animations such as spinners are left running.
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity),
    undefined,
    { timeout: 5000 },
  );
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const describe = (v: (typeof violations)[number]) =>
    `${label}: ${v.id} (${v.impact}, ${v.nodes.length}) ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}` +
    ` — ${(v.nodes[0]?.any?.[0]?.message ?? v.nodes[0]?.failureSummary ?? '').slice(0, 220)} — ${(v.nodes[0]?.html ?? '').slice(0, 160)}`;
  for (const v of violations) console.log(`[a11y] ${describe(v)}`);
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map(describe);
}

async function publishedTap(name: string, experience: string) {
  const owner = await apiCustomer(name);
  await buyExperience(owner, experience);
  const { error } = await owner.client
    .from('tap_profiles')
    .update({ status: 'active', selected_ui_tier: experience, headline: 'Founder', bio: 'Building things that last.' })
    .eq('user_id', owner.userId);
  expect(error).toBeNull();
  const { data } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();
  return { owner, slug: data!.slug as string };
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

test('public pages: no serious or critical WCAG 2.2 AA violation', async ({ page }) => {
  const { slug } = await publishedTap('Axe Visitor View', 'business');
  await page.goto('/shygontap');
  await dismissCookieNotice(page);
  const product = await page.locator('a[href^="/shygontap/store/aaroh"]').first().getAttribute('href');
  const pages = [
    '/shygontap', '/shygontap/store', product!, '/shygontap/store/aaroh', '/shygontap/auth', '/shygontap/privacy-policy', '/no-such-page',
    `/t/${slug}`, '/t/no-such-tap',
    // The AAROH showroom's modes, and the demo showroom with its emergency walkthrough.
    `/t/${slug}?mode=identity`, `/t/${slug}?mode=business`, `/t/${slug}?mode=contact`, `/t/${slug}?mode=owner`,
    '/aaroh/experience', '/aaroh/experience?mode=emergency', '/aaroh/experience?mode=links',
  ];
  const blocking: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    blocking.push(...(await audit(page, path)));
  }
  expect(blocking).toEqual([]);
});

test('signed-in pages: no serious or critical WCAG 2.2 AA violation', async ({ page }) => {
  const { owner } = await publishedTap('Axe Account Owner', 'premium');
  await signIn(page, owner.email, owner.password);
  const pages = [
    '/shygontap/account', '/shygontap/tap', '/shygontap/tiers', '/shygontap/customize', '/shygontap/qr', '/shygontap/cards',
    '/shygontap/customizations', '/shygontap/orders', '/shygontap/analytics', '/shygontap/notifications', '/shygontap/support',
    '/shygontap/settings', '/shygontap/experience', '/shygontap/emergency', '/shygontap/return-to-owner', '/shygontap/connections',
  ];
  const blocking: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    blocking.push(...(await audit(page, path)));
  }
  expect(blocking).toEqual([]);
});

test('keyboard: the sign-in form is reached in order, and focus is always visible', async ({ page }) => {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  const reached: string[] = [];
  for (let i = 0; i < 40 && !reached.includes('Log in'); i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const ring = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none';
      const label = el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.textContent?.trim() || el.tagName;
      return { label: label.slice(0, 40), ring };
    });
    if (!focus) continue;
    expect(focus.ring, `no visible focus on "${focus.label}"`).toBe(true);
    reached.push(focus.label);
  }
  const at = (name: string) => reached.findIndex((label) => label.startsWith(name));
  expect(at('Email')).toBeGreaterThanOrEqual(0);
  expect(at('Email')).toBeLessThan(at('Password'));
  expect(at('Password')).toBeLessThan(at('Log in'));
});

test('reduced motion: nothing animates when the visitor asks for less', async ({ page }) => {
  const { slug } = await publishedTap('Calm Visitor View', 'goat');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const path of [`/t/${slug}`, '/aaroh/experience', '/shygontap']) {
    await page.goto(path);
    await dismissCookieNotice(page);
    await page.waitForTimeout(1200);
    const moving = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => {
          const timing = a.effect?.getComputedTiming();
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return { duration: Number(timing?.duration ?? 0), iterations: timing?.iterations ?? 1, on: target?.className?.toString().slice(0, 40) ?? '?' };
        })
        .filter((a) => a.duration > 1 || a.iterations === Infinity),
    );
    expect(moving, `${path} animates under reduced motion`).toEqual([]);
  }
});

test('landmarks: every page has one main region and a page heading', async ({ page }) => {
  const { owner, slug } = await publishedTap('Landmark Owner', 'business');
  for (const path of ['/shygontap', '/shygontap/store', '/shygontap/auth', `/t/${slug}`, `/t/${slug}?mode=owner`, `/t/${slug}?mode=identity`, '/aaroh/experience']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('main').count(), `${path}: main regions`).toBe(1);
    expect(await page.locator('h1').count(), `${path}: h1`).toBeGreaterThanOrEqual(1);
  }
  await signIn(page, owner.email, owner.password);
  for (const path of ['/shygontap/account', '/shygontap/settings', '/shygontap/experience', '/shygontap/emergency', '/shygontap/return-to-owner', '/shygontap/connections', `/shygontap/connect/${slug}`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await page.locator('main').count(), `${path}: main regions`).toBe(1);
    expect(await page.locator('h1').count(), `${path}: h1`).toBeGreaterThanOrEqual(1);
  }
});
