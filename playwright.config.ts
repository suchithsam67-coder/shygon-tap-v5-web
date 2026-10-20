import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys on the local stack (V6 Stage 5; decision D-4).
 *
 *   npm run test:e2e
 *
 * Playwright starts the stack itself (supabase/local/serve.mjs): the real
 * schema in PGlite behind the local Supabase gateway, the real server
 * functions, and the Razorpay stand-in. It drives a browser that is already
 * installed (Edge by default; E2E_BROWSER_CHANNEL=chrome in CI), so nothing
 * is downloaded. Every request that would leave the machine is blocked.
 */
const APP = `http://127.0.0.1:${process.env.STACK_APP_PORT ?? 4173}`;
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'msedge';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: APP,
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node supabase/local/serve.mjs',
    url: `${APP}/shygontap`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel } },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], channel },
      // The public Tap and the AAROH experience are phone-first, so they also run as a phone.
      testMatch: /(public-tap-mobile|aaroh-experience)\.spec\.ts/,
    },
  ],
});
