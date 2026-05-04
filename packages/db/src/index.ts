/**
 * `@agentwatch/db` package entry.
 *
 * Exports:
 * - `schema` — namespace import of every Phase-1 table for query construction.
 * - `createDb()` — Drizzle pg client factory used by server (plan 01.04) and
 *   worker (plan 01.05). Each process owns its own pool.
 *
 * Migration application is the responsibility of the server bootstrap
 * (plan 01.04 runs `drizzle-kit migrate` before Fastify accepts connections).
 * This package ships the schema artifact only.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

// pg ships as CommonJS — destructure from the default import so this file is
// importable from both Node ESM at runtime and vitest's ESM-via-bundler at
// test time.
const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

export { schema };
export * from './schema/index.js';

export interface DbHandle {
  pool: PoolInstance;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = DbHandle['db'];
