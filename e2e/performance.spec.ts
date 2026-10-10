import { expect, test, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, server, stayLocal } from './stack';

/**
 * Performance (V6 Stage 6), on a phone-like connection: slow 4G (150 ms,
 * 1.6 Mb/s down) and a CPU four times slower, through Edge's DevTools
 * protocol. The local host compresses text with brotli, as the hosts do, but
 * has no CDN, so these numbers are not better than production's. Thresholds
 * are Core Web Vitals "good": largest paint
 * under 2.5 s and layout shift under 0.1 for the public Tap, the page a tap
 * or a scan opens; the landing page must stay under 4 s.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

// The production CSP blocked nothing on any page of the journey.
test.afterEach(async ({ context }) => {
  expect(cspViolations(context)).toEqual([]);
});

async function slowPhone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
}

/** Largest paint and layout shift (observer-only entries in Chromium) once the largest paint has settled. */
async function vitals(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ lcp: number; cls: number; scripts: number; scriptBytes: number }>((resolve) => {
        let lcp = NaN;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        const finish = () => {
          const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter(
            (entry) => entry.initiatorType === 'script' || entry.name.endsWith('.js'),
          );
          resolve({
            lcp: Math.round(lcp),
            cls: Number(cls.toFixed(3)),
            scripts: scripts.length,
            scriptBytes: scripts.reduce((sum, entry) => sum + (entry.encodedBodySize || entry.transferSize || 0), 0),
          });
        };
        // Settled: no new largest-paint candidate for a second.
        let timer = setTimeout(finish, 1500);
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          lcp = entries[entries.length - 1].startTime;
          clearTimeout(timer);
          timer = setTimeout(finish, 1000);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      }),
  );
}

test('the public Tap is fast on a slow phone: largest paint under 2.5 s, no layout shift', async ({ page }) => {
  const owner = await apiCustomer('Speedy Owner');
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active', headline: 'Founder' }).eq('user_id', owner.userId);
  const { data } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();

  await slowPhone(page);
  await page.goto(`/t/${data!.slug}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Speedy Owner' })).toBeVisible();
  const result = await vitals(page);
  console.log(`[perf] /t/<slug> on slow 4G, 4x CPU: ${JSON.stringify(result)}`);
  test.info().annotations.push({ type: 'perf', description: `public Tap ${JSON.stringify(result)}` });
  expect(result.lcp).toBeLessThan(2500);
  expect(result.cls).toBeLessThan(0.1);
});

test('the landing page stays usable on a slow phone: largest paint under 4 s', async ({ page }) => {
  await slowPhone(page);
  await page.goto('/shygontap', { waitUntil: 'domcontentloaded' });
  await dismissCookieNotice(page);
  const result = await vitals(page);
  console.log(`[perf] /shygontap on slow 4G, 4x CPU: ${JSON.stringify(result)}`);
  test.info().annotations.push({ type: 'perf', description: `landing ${JSON.stringify(result)}` });
  expect(result.lcp).toBeLessThan(4000);
  expect(result.cls).toBeLessThan(0.25);
});
