import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * - `dialect: 'postgresql'` — Postgres 16 target.
 * - `schema` — barrel file at `src/schema/index.ts`.
 * - `out` — migration directory; `0000_init.sql` is hand-authored to add the
 *   `PARTITION BY RANGE (received_at)` DDL Drizzle cannot generate (Pattern 2).
 * - `strict: true` — drizzle-kit asks before destructive changes.
 *
 * Server bootstrap (plan 01.04) runs `drizzle-kit migrate` against this folder
 * before Fastify accepts connections.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://localhost/linearwatch',
  },
  verbose: true,
  strict: true,
});
