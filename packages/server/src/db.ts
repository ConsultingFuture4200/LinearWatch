import { schema } from '@agentwatch/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

// pg is CJS; destructure from default import for Node ESM compatibility.
const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

/**
 * Server-side Drizzle factory.
 *
 * Each process owns its own pool. `max: 20` is an explicit pool size for the
 * server container — Pitfall 8 mitigation prep (the rotation cron lives in the
 * worker's pool, not here).
 *
 * Notes:
 * - The shared `@agentwatch/db` `createDb()` factory is fine for one-off
 *   scripts, but the server needs to inject its env-loaded connection string
 *   plus its own pool sizing, so we wrap drizzle directly here.
 */
export interface ServerDbHandle {
  pool: PoolInstance;
  db: ReturnType<typeof drizzle<typeof schema>>;
}

export function createServerDb(connectionString: string): ServerDbHandle {
  const pool = new Pool({ connectionString, max: 20 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type ServerDb = ServerDbHandle['db'];
