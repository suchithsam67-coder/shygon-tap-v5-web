import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Component tests (V6-083): `npm run test:components`.
 *
 * Deliberately separate from vite.config.ts, which loads .env for its dev-time
 * function runner. A test run must never see a project secret, so this config
 * has no plugin that reads .env and gives the app throwaway public settings.
 */
export default defineConfig({
  plugins: [react()],
  envDir: 'vitest-no-env', // a folder with no .env files in it: nothing is loaded
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    setupFiles: ['src/test/setup.ts'],
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:9',
      VITE_SUPABASE_ANON_KEY: 'component-test-anon-key',
    },
  },
});
