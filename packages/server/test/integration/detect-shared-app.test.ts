import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations as runGraphileMigrations, runOnce } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { detectSharedApp } from '../../src/tasks/detect-shared-app.js';

/**
 * Integration tests for the `detect_shared_app` Graphile cron task.
 *
 * Verifies (D-18 / Pitfall 6 / ID-05):
 * - WARNING row created when one linear_app_user_id shows ≥2 distinct vendor
 *   contexts within 24h.
 * - No warning when only one vendor context observed.
 * - No warning when the two contexts are >24h apart (rolling window).
 * - Idempotent: re-running while the same warning is still active produces
 *   exactly one warning row, not duplicates.
 */

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/agentwatch_shared');
const WS = '00000000-0000-4000-8000-000000000001';

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

describe.skipIf(!dbReachable)('detect_shared_app (D-18, ID-05, Pitfall 6)', () => {
  let pool: PoolInstance;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_shared');
    await admin.query('CREATE DATABASE agentwatch_shared');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    await runGraphileMigrations({ connectionString: TEST_DB_URL });
    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt)
       VALUES ($1, 'test', 'placeholder-hash', 'salt-1')`,
      [WS],
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE workspace_warnings');
    // Truncating a partitioned parent cascades to all partitions in PG 16.
    await pool.query('TRUNCATE events.raw_event');
  });

  async function insertEv(actorId: string, sessionId: string, hoursAgo = 0): Promise<void> {
    await pool.query(
      `INSERT INTO events.raw_event (source, upstream_id, payload, signature_valid, received_at)
         VALUES ('linear', $1, $2::jsonb, true, now() - ($3 || ' hours')::interval)`,
      [
        randomUUID(),
        JSON.stringify({ actor: { id: actorId }, agentSession: { sessionId } }),
        String(hoursAgo),
      ],
    );
  }

  async function runJob(): Promise<void> {
    await pool.query(`SELECT graphile_worker.add_job('detect_shared_app'::text, '{}'::json)`);
    await runOnce({
      connectionString: TEST_DB_URL,
      concurrency: 1,
      taskList: { detect_shared_app: detectSharedApp },
    });
  }

  it('writes a WARNING when one user shows ≥2 vendor contexts in 24h', async () => {
    await insertEv('lap-shared', 'cursor-abc');
    await insertEv('lap-shared', 'devin-xyz');
    await runJob();

    const r = await pool.query<{ severity: string; message: string }>(
      'SELECT severity, message FROM workspace_warnings WHERE workspace_id=$1',
      [WS],
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.severity).toBe('WARNING');
    expect(r.rows[0]?.message).toContain('lap-shared');
    expect(r.rows[0]?.message).toContain('cursor');
    expect(r.rows[0]?.message).toContain('devin');
  });

  it('no warning when only one vendor context observed', async () => {
    await insertEv('lap-solo', 'cursor-abc');
    await insertEv('lap-solo', 'cursor-def');
    await runJob();

    const r = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM workspace_warnings WHERE workspace_id=$1',
      [WS],
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('no warning when vendor contexts are >24h apart (rolling window)', async () => {
    await insertEv('lap-old', 'cursor-abc', 30); // 30 hours ago
    await insertEv('lap-old', 'devin-xyz', 0);
    await runJob();

    const r = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM workspace_warnings WHERE workspace_id=$1',
      [WS],
    );
    expect(r.rows[0]?.n).toBe(0);
  });

  it('idempotent: re-running with the same warning active does not duplicate', async () => {
    await insertEv('lap-dup', 'cursor-abc');
    await insertEv('lap-dup', 'devin-xyz');
    await runJob();
    await runJob();
    await runJob();

    const r = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM workspace_warnings WHERE workspace_id=$1',
      [WS],
    );
    expect(r.rows[0]?.n).toBe(1);
  });
});
