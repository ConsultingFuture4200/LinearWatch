import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import agentsConfirmRoute from '../../src/routes/api/v1/agents-confirm.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_confirm');

const PLAINTEXT_KEY = 'lw_test_confirm_key_xyz';
const KEY_HASH = createHash('sha256').update(PLAINTEXT_KEY).digest('hex');
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

async function makeApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  // biome-ignore lint/suspicious/noExplicitAny: minimal env decoration for tests
  app.decorate('env', {} as any);
  app.decorate('db', db);
  // biome-ignore lint/suspicious/noExplicitAny: ServerDb type structural
  await app.register(authPlugin, { db: db as any });
  await app.register(agentsConfirmRoute);
  return app;
}

describe.skipIf(!dbReachable)('POST /api/v1/agents/:id/confirm', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_confirm');
    await admin.query('CREATE DATABASE linearwatch_confirm');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt) VALUES ($1, 'test', $2, 'salt-1')`,
      [WS, KEY_HASH],
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('401 without bearer', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${randomUUID()}/confirm`,
      headers: { 'content-type': 'application/json' },
      payload: { linear_app_user_id: 'lap-X' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('400 on missing body', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${randomUUID()}/confirm`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {},
    });
    expect(r.statusCode).toBe(400);
  });

  it('flips PENDING_CONFIRMATION → CONFIRMED, sets confirmed_at, sets agent_id', async () => {
    const app = await makeApp(db);
    const agentId = randomUUID();
    const linearAppUserId = `lap-${randomUUID()}`;
    await pool.query(
      `INSERT INTO agents (id, workspace_id, name, linear_app_user_id) VALUES ($1, $2, 'cursor-demo', $3)`,
      [agentId, WS, linearAppUserId],
    );
    // Insert a PENDING mapping with NO agent_id yet
    const mappingId = randomUUID();
    await pool.query(
      `INSERT INTO identity_mappings
        (id, workspace_id, raw_event_id, linear_app_user_id, confidence, signal_weights, state)
       VALUES ($1, $2, 1, $3, 0.5, '{}'::jsonb, 'PENDING_CONFIRMATION')`,
      [mappingId, WS, linearAppUserId],
    );

    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/confirm`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { linear_app_user_id: linearAppUserId },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; confirmed_count: number };
    expect(body.ok).toBe(true);
    expect(body.confirmed_count).toBeGreaterThanOrEqual(1);

    const after = await pool.query(
      'SELECT state, confirmed_at, agent_id FROM identity_mappings WHERE id=$1',
      [mappingId],
    );
    expect(after.rows[0].state).toBe('CONFIRMED');
    expect(after.rows[0].confirmed_at).not.toBeNull();
    expect(after.rows[0].agent_id).toBe(agentId);
  });

  it('does NOT flip an already-CONFIRMED mapping back to PENDING (T-07-07)', async () => {
    const app = await makeApp(db);
    const agentId = randomUUID();
    const linearAppUserId = `lap-${randomUUID()}`;
    await pool.query(
      `INSERT INTO agents (id, workspace_id, name, linear_app_user_id) VALUES ($1, $2, 'devin-demo', $3)`,
      [agentId, WS, linearAppUserId],
    );
    const otherAgentId = randomUUID();
    await pool.query(`INSERT INTO agents (id, workspace_id, name) VALUES ($1, $2, 'other-agent')`, [
      otherAgentId,
      WS,
    ]);
    const mappingId = randomUUID();
    const initialConfirmedAt = new Date('2026-01-01T00:00:00Z');
    await pool.query(
      `INSERT INTO identity_mappings
        (id, workspace_id, raw_event_id, linear_app_user_id, agent_id, confidence, signal_weights, state, confirmed_at)
       VALUES ($1, $2, 2, $3, $4, 0.5, '{}'::jsonb, 'CONFIRMED', $5)`,
      [mappingId, WS, linearAppUserId, otherAgentId, initialConfirmedAt],
    );

    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/confirm`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { linear_app_user_id: linearAppUserId },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { confirmed_count: number };
    expect(body.confirmed_count).toBe(0);

    const after = await pool.query(
      'SELECT state, confirmed_at, agent_id FROM identity_mappings WHERE id=$1',
      [mappingId],
    );
    expect(after.rows[0].state).toBe('CONFIRMED');
    expect(after.rows[0].agent_id).toBe(otherAgentId);
  });

  it('404 on non-existent agent id', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${randomUUID()}/confirm`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { linear_app_user_id: 'lap-nonexistent' },
    });
    expect(r.statusCode).toBe(404);
  });

  it('404 on soft-deleted agent', async () => {
    const app = await makeApp(db);
    const agentId = randomUUID();
    await pool.query(
      `INSERT INTO agents (id, workspace_id, name, deleted_at) VALUES ($1, $2, 'gone', now())`,
      [agentId, WS],
    );
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentId}/confirm`,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { linear_app_user_id: 'lap-X' },
    });
    expect(r.statusCode).toBe(404);
  });
});
