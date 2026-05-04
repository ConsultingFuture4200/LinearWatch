import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the setup wizard e2e tests (Plan 01.09 Task 3 /
 * SETUP-02 verification).
 *
 * The webServer block builds and runs the prebuilt Next.js production
 * server so the test exercises the same bundle CI ships. `reuseExistingServer`
 * is true outside CI so contributors can iterate without restarting on
 * every run.
 *
 * The wizard does NOT require the linearwatch server to be reachable for
 * the AgentSession-warning step (the modal is purely client UI). The other
 * steps (workspace creation, seed) require LINEARWATCH_INTERNAL_URL to
 * point at a running server; those tests skip cleanly when it is not set.
 */
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @linearwatch/web start',
    port: 3000,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      // Build-time env values; the warning step does not call the server,
      // so a placeholder is sufficient for SETUP-02 verification.
      LINEARWATCH_INTERNAL_URL: process.env.LINEARWATCH_INTERNAL_URL ?? 'http://localhost:8080',
      LINEARWATCH_INTERNAL_API_KEY:
        process.env.LINEARWATCH_INTERNAL_API_KEY ?? 'test-internal-key-1234567890',
    },
  },
});
