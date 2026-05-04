import { defineConfig } from 'vitest/config';

/**
 * Per-package vitest config (mirrors @linearwatch/db and @linearwatch/shared
 * convention from plans 01.02 and 01.03). The root `vitest.config.ts` discovers
 * tests via `pnpm test` from the repo root; this config drives
 * `pnpm --filter @linearwatch/server test`.
 *
 * Integration tests under `test/integration/**` require a live Postgres and
 * a built `dist/` tree — they self-skip when those are not available so the
 * unit-test gate stays green for contributors without Docker.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**', 'test/perf/**'],
    // Integration tests under test/integration/** each spin up their own
    // Postgres database, run drizzle + Graphile migrations, and exercise the
    // server. When two such files run in parallel forks against the same
    // Postgres instance, concurrent CREATE SCHEMA / CREATE TYPE statements
    // hit the system catalog and produce duplicate-key races
    // (`pg_namespace_nspname_index`, `pg_type_typname_nsp_index`). Serialise
    // file execution to avoid the race; per-test parallelism inside a file
    // remains the default.
    fileParallelism: false,
  },
});
