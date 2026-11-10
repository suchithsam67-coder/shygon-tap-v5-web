import { randomBytes } from 'node:crypto';
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

/**
 * Verified Tap (v0.11 §10d) on the stack: the host switch on, and TEST keys made
 * fresh for this run, never written anywhere. They go to the stack and, through
 * the environment the test workers inherit, to e2e/verified-tap.spec.ts, which
 * simulates a chip with them. A stack started by hand needs the same four.
 */
for (const name of ['VERIFY_META_MASTER_1', 'VERIFY_FILE_MASTER_1']) process.env[name] ??= randomBytes(16).toString('hex');
process.env.VERIFY_UID_PEPPER ??= randomBytes(32).toString('hex');
process.env.VERIFIED_TAP ??= 'on';

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
    // The local host reports the visitor's address from the connection (B-9);
    // journeys that need distinct visitors name them with x-shygon-sim-client,
    // which the host honours only with this flag (documentation addresses only).
    // The stack's build keeps the unreleased owner pages reachable (Q-C), as a
    // test build should; a production build redirects them. When the stack is
    // started by hand, start it with the same variables (and the Verified Tap ones above).
    env: {
      STACK_SIM_CLIENT_ADDRESS: '1',
      VITE_AAROH_PREVIEW_PAGES: 'on',
      VERIFIED_TAP: process.env.VERIFIED_TAP,
      VERIFY_META_MASTER_1: process.env.VERIFY_META_MASTER_1!,
      VERIFY_FILE_MASTER_1: process.env.VERIFY_FILE_MASTER_1!,
      VERIFY_UID_PEPPER: process.env.VERIFY_UID_PEPPER,
    },
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
