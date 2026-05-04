import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { runMigrations as runGraphileMigrations, runOnce } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCostRollup } from '../../src/tasks/refresh-cost-rollup.js';
import { resolveIdentity } from '../../src/tasks/resolve-identity.js';

/**
 * Integration tests for the `resolve_identity` Graphile Worker task.
 *
 * Verifies:
 * - D-15 idempotency on (workspace_id, raw_event_id) — re-running the same
 *   payload yields exactly one identity_mappings row.
 * - D-16 P1 confidence formula `0.5 * has_linear_app_user_id` and the resulting
 *   PENDING_CONFIRMATION / NEW_AGENT state mapping.
 * - The refresh_cost_rollup stub is callable without error (P1 no-op).
 */

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/agentwatch_resolver');
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

describe.skipIf(!dbReachable)('resolve_identity job (D-15, D-16, ID-01..03)', () => {
  let pool: PoolInstance;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_resolver');
    await admin.query('CREATE DATABASE agentwatch_resolver');
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

  async function insertRawEvent(payload: unknown): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO events.raw_event (source, upstream_id, payload, signature_valid)
         VALUES ('linear', $1, $2::jsonb, true) RETURNING id`,
      [randomUUID(), JSON.stringify(payload)],
    );
    return r.rows[0].id;
  }

  async function runResolveJob(rawEventId: string): Promise<void> {
    await pool.query(`SELECT graphile_worker.add_job('resolve_identity'::text, $1::json)`, [
      JSON.stringify({ raw_event_id: rawEventId, workspace_id: WS }),
    ]);
    await runOnce({
      connectionString: TEST_DB_URL,
      concurrency: 1,
      taskList: {
        resolve_identity: resolveIdentity,
        refresh_cost_rollup: refreshCostRollup,
      },
    });
  }

  it('PENDING_CONFIRMATION at confidence 0.5 when actor.id present', async () => {
    const id = await insertRawEvent({ type: 'AgentSession', actor: { id: 'lap-A' } });
    await runResolveJob(id);
    const r = await pool.query<{
      linear_app_user_id: string;
      confidence: string | number;
      state: string;
      signal_weights: { linear: number; github: number; vendor: number };
    }>(
      `SELECT linear_app_user_id, confidence, state, signal_weights
         FROM identity_mappings WHERE workspace_id=$1 AND raw_event_id=$2`,
      [WS, id],
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].linear_app_user_id).toBe('lap-A');
    expect(Number(r.rows[0].confidence)).toBe(0.5);
    expect(r.rows[0].state).toBe('PENDING_CONFIRMATION');
    expect(r.rows[0].signal_weights).toEqual({ linear: 0.5, github: 0, vendor: 0 });
  });

  it('idempotent: re-running the same payload yields exactly one row', async () => {
    const id = await insertRawEvent({ type: 'AgentSession', actor: { id: 'lap-B' } });
    await runResolveJob(id);
    await runResolveJob(id);
    await runResolveJob(id);
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity_mappings
        WHERE workspace_id=$1 AND raw_event_id=$2`,
      [WS, id],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it('NEW_AGENT at confidence 0 when actor.id is missing', async () => {
    const id = await insertRawEvent({ type: 'AgentSession', issue: { id: 'x' } });
    await runResolveJob(id);
    const r = await pool.query<{ confidence: string | number; state: string }>(
      `SELECT confidence, state FROM identity_mappings
        WHERE workspace_id=$1 AND raw_event_id=$2`,
      [WS, id],
    );
    expect(Number(r.rows[0].confidence)).toBe(0);
    expect(r.rows[0].state).toBe('NEW_AGENT');
  });
});
