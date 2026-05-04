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
import { Pool } from 'pg';
import * as schema from './schema';

export { schema };
export * from './schema';

export interface DbHandle {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

export function createDb(connectionString: string): DbHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = DbHandle['db'];
