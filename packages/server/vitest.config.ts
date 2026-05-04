import { defineConfig } from 'vitest/config';

/**
 * Per-package vitest config (mirrors @agentwatch/db and @agentwatch/shared
 * convention from plans 01.02 and 01.03). The root `vitest.config.ts` discovers
 * tests via `pnpm test` from the repo root; this config drives
 * `pnpm --filter @agentwatch/server test`.
 *
 * Integration tests under `test/integration/**` require a live Postgres and
 * a built `dist/` tree — they self-skip when those are not available so the
 * unit-test gate stays green for contributors without Docker.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'test/perf/**'],
  },
});
