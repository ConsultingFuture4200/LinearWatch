import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations as runGraphileMigrations, runOnce } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rotateRawEventPartitions } from '../../src/tasks/rotate-raw-event-partitions.js';

/**
 * Integration tests for the `rotate_raw_event_partitions` Graphile cron task.
 *
 * Verifies:
 * - Idempotency on first run: current + next partitions exist (the migration
 *   pre-creates them); the task must not error.
 * - Past-retention partitions get DROPPED — manually fabricate one for "3
 *   months ago", run the task, assert the partition no longer exists in
 *   pg_class.
 * - This implements the Pitfall 8 mitigation that must persist forever, not
 *   just on Day 1.
 */

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_partition');

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

describe.skipIf(!dbReachable)('rotate_raw_event_partitions (D-06, Pitfall 8)', () => {
  let pool: PoolInstance;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_partition');
    await admin.query('CREATE DATABASE linearwatch_partition');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await runGraphileMigrations({ connectionString: TEST_DB_URL });
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function runJob(): Promise<void> {
    await pool.query(
      `SELECT graphile_worker.add_job('rotate_raw_event_partitions'::text, '{}'::json)`,
    );
    await runOnce({
      connectionString: TEST_DB_URL,
      concurrency: 1,
      taskList: { rotate_raw_event_partitions: rotateRawEventPartitions },
    });
  }

  async function listPartitions(): Promise<string[]> {
    const r = await pool.query<{ name: string }>(`
      SELECT child.relname AS name
      FROM pg_inherits i
      JOIN pg_class child  ON child.oid  = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace n  ON n.oid      = parent.relnamespace
      WHERE n.nspname = 'events' AND parent.relname = 'raw_event'
    `);
    return r.rows.map((row) => row.name);
  }

  it('is idempotent on first run (current + next partitions already exist from migration)', async () => {
    await expect(runJob()).resolves.toBeUndefined();
    const names = await listPartitions();
    // The migration pre-creates current + next; the task ensures both exist again.
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('drops partitions whose upper bound is more than 30 days in the past', async () => {
    // Manually fabricate a partition for 3 months ago (well past the 30-day
    // retention boundary). Use the same naming convention as the migration.
    await pool.query(`
      DO $$
      DECLARE
        old_start date := (date_trunc('month', now()) - interval '3 month')::date;
        old_end   date := (date_trunc('month', now()) - interval '2 month')::date;
        old_name  text := 'raw_event_' || to_char(old_start, 'YYYY_MM');
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event FOR VALUES FROM (%L) TO (%L)',
          old_name, old_start, old_end
        );
      END $$;
    `);

    const before = await listPartitions();
    const oldName = before.find((n) => {
      // The partition we just created is the smallest YYYY_MM in the list.
      const m = n.match(/^raw_event_(\d{4})_(\d{2})$/);
      if (!m) return false;
      const cutoff = new Date();
      cutoff.setUTCDate(cutoff.getUTCDate() - 30);
      // Upper bound = first of next month after the partition start.
      const year = Number.parseInt(m[1] as string, 10);
      const month = Number.parseInt(m[2] as string, 10); // 1-12
      // Partition NAME encodes the START month. Upper bound = next month's 1st.
      const upper = new Date(Date.UTC(year, month, 1));
      return upper < cutoff;
    });
    expect(oldName).toBeDefined();

    await runJob();

    // The old partition should no longer be a regclass (DROPped).
    const after = await pool.query<{ r: string | null }>('SELECT to_regclass($1) AS r', [
      `events.${oldName}`,
    ]);
    expect(after.rows[0]?.r).toBeNull();

    // Re-run is still idempotent (no errors when the row is already gone).
    await expect(runJob()).resolves.toBeUndefined();
  });
});
