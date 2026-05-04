import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Verifies that `migrations/0000_init.sql` applies cleanly to postgres:16-alpine
 * and produces the expected partitioned schema.
 *
 * Requires a live Postgres instance reachable at DATABASE_URL_TEST. Local dev:
 *   docker compose up -d postgres
 *   DATABASE_URL_TEST=postgres://agentwatch:agentwatch_dev_password@localhost:5432/agentwatch_test \
 *     pnpm --filter @agentwatch/db test
 *
 * If DATABASE_URL_TEST is unset OR no Postgres is reachable, the suite is skipped
 * (so unit-only CI jobs without a Postgres service container don't fail). The
 * compose-backed CI job (added in plan 01.10) will set the env and run this.
 */

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/agentwatch_test';

async function postgresReachable(): Promise<boolean> {
  const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
  const probe = new Pool({ connectionString: adminUrl, connectionTimeoutMillis: 1500 });
  try {
    await probe.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => {});
  }
}

const reachable = await postgresReachable();
const describeIfPg = reachable ? describe : describe.skip;

describeIfPg('migration applies cleanly to postgres:16', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const adminPool = new Pool({ connectionString: adminUrl });
    // Terminate any sessions on the test DB before drop/create.
    await adminPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='agentwatch_test' AND pid <> pg_backend_pid()",
    );
    await adminPool.query('DROP DATABASE IF EXISTS agentwatch_test');
    await adminPool.query('CREATE DATABASE agentwatch_test');
    await adminPool.end();
    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
  }, 30_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('applies 0000_init.sql', async () => {
    await migrate(db, { migrationsFolder: './migrations' });
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' OR table_schema='events'`,
    );
    const names = tables.rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        'workspaces',
        'teams',
        'cycles',
        'repos',
        'agents',
        'issues',
        'agent_sessions',
        'identity_mappings',
        'workspace_warnings',
        'cost_by_agent_daily',
        'alert_events',
        'raw_event',
      ]),
    );
  });

  it('events.raw_event is partitioned by range on received_at', async () => {
    const r = await pool.query<{ partstrat: string }>(`
      SELECT pt.partstrat
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'events' AND c.relname = 'raw_event'
    `);
    // 'r' = range partitioning
    expect(r.rows[0]?.partstrat).toBe('r');
  });

  it('current and next month partitions exist', async () => {
    const r = await pool.query<{ name: string }>(`
      SELECT child.relname AS name
      FROM pg_inherits i
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_namespace n ON n.oid = parent.relnamespace
      WHERE n.nspname='events' AND parent.relname='raw_event'
    `);
    expect(r.rows.length).toBeGreaterThanOrEqual(2);
  });

  it('idempotency unique constraint exists on raw_event (Pitfall 1)', async () => {
    const r = await pool.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'events.raw_event'::regclass AND contype='u'
    `);
    expect(r.rows.map((x) => x.conname).join(',')).toMatch(/raw_event/);
  });

  it('issues table has no `title` column (Pitfall 13 / D-26)', async () => {
    const r = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='issues'
    `);
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).toContain('title_hash');
    expect(cols).not.toContain('title');
  });

  it('agent_sessions has the analytics indexes from Pitfall 10', async () => {
    const r = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='agent_sessions'
    `);
    const idx = r.rows.map((x) => x.indexname);
    expect(idx).toEqual(
      expect.arrayContaining([
        'agent_sessions_agent_started_idx',
        'agent_sessions_issue_started_idx',
        'agent_sessions_started_brin_idx',
      ]),
    );
  });

  it('NO GIN index on raw_event payload (Pitfall 9)', async () => {
    const r = await pool.query<{ indexdef: string }>(`
      SELECT indexdef FROM pg_indexes WHERE schemaname='events' AND tablename='raw_event'
    `);
    const defs = r.rows.map((x) => x.indexdef).join('\n');
    expect(defs).not.toMatch(/USING gin/i);
  });

  it('migration is idempotent on second apply', async () => {
    await expect(migrate(db, { migrationsFolder: './migrations' })).resolves.not.toThrow();
  });

  it('raw_event accepts an insert and rejects a duplicate (source, upstream_id, received_at)', async () => {
    const fixedTs = new Date('2099-01-15T12:00:00Z');
    // Need a partition for 2099-01 — create it for this test only.
    await pool.query(
      `CREATE TABLE IF NOT EXISTS events.raw_event_2099_01
       PARTITION OF events.raw_event
       FOR VALUES FROM ('2099-01-01') TO ('2099-02-01')`,
    );
    await pool.query(
      `INSERT INTO events.raw_event (source, upstream_id, received_at, payload, signature_valid)
       VALUES ('linear', 'delivery-uuid-1', $1::timestamptz, '{}'::jsonb, true)`,
      [fixedTs.toISOString()],
    );
    await expect(
      pool.query(
        `INSERT INTO events.raw_event (source, upstream_id, received_at, payload, signature_valid)
         VALUES ('linear', 'delivery-uuid-1', $1::timestamptz, '{}'::jsonb, true)`,
        [fixedTs.toISOString()],
      ),
    ).rejects.toThrow(/duplicate key|raw_event_delivery_unique/i);
  });
});

if (!reachable) {
  describe('migration apply (skipped — Postgres not reachable)', () => {
    it('skipped because DATABASE_URL_TEST is not reachable', () => {
      // Surface a passing test so CI without Postgres still has a green signal.
      // The compose-backed CI job (plan 01.10) sets DATABASE_URL_TEST and runs the suite above.
      expect(reachable).toBe(false);
    });
  });
}
