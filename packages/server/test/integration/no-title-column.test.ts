import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Schema invariant — D-26 / Pitfall 13.
 *
 * Confirms via Postgres `information_schema` that the `issues` table has a
 * `title_hash` column and NO `title` column after a fresh migration apply.
 * Acts as the runtime complement to `scripts/check-no-title-leak.sh` (static
 * grep): if anyone ships a migration that adds a `title` column, this test
 * fails the build.
 */

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_no_title');

async function adminReachable(): Promise<boolean> {
  const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
  const admin = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  try {
    await admin.query('SELECT 1');
    await admin.end();
    return true;
  } catch {
    try {
      await admin.end();
    } catch {
      /* noop */
    }
    return false;
  }
}

const dbReachable = await adminReachable();

describe.skipIf(!dbReachable)('issues table has no title column (D-26, Pitfall 13)', () => {
  let pool: PoolInstance;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_no_title');
    await admin.query('CREATE DATABASE linearwatch_no_title');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('information_schema confirms title_hash but not title', async () => {
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='issues'`,
    );
    const cols = r.rows.map((row) => row.column_name);
    expect(cols).toContain('title_hash');
    expect(cols).not.toContain('title');
  });
});
