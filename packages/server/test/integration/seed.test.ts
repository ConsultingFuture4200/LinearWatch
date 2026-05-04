import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import seedRoutes from '../../src/routes/api/v1/seed.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_seed');

const PLAINTEXT_KEY = 'lw_test_seed_key_xyz';
const KEY_HASH = createHash('sha256').update(PLAINTEXT_KEY).digest('hex');
const WS = '00000000-0000-4000-8000-000000000001';
const SALT = 'a'.repeat(64);

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
  await app.register(seedRoutes);
  return app;
}

describe.skipIf(!dbReachable)('Seed endpoints (POST /api/v1/seed, /admin/clear-seed)', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_seed');
    await admin.query('CREATE DATABASE linearwatch_seed');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt) VALUES ($1, 'test', $2, $3)`,
      [WS, KEY_HASH, SALT],
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('401 without bearer', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(r.statusCode).toBe(401);
  });

  it('inserts ~50 sessions, 3 *-demo agents, 2 demo teams, 3 issues with hashed titles', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { inserted: number };
    expect(body.inserted).toBe(50);

    const agents = await pool.query(
      `SELECT name FROM agents WHERE workspace_id=$1 AND name LIKE '%-demo' ORDER BY name`,
      [WS],
    );
    expect(agents.rows.map((row) => row.name)).toEqual([
      'cursor-demo',
      'devin-demo',
      'internal-bot-demo',
    ]);

    const teams = await pool.query(
      `SELECT count(*)::int AS n FROM teams WHERE workspace_id=$1 AND linear_id LIKE 'demo-%'`,
      [WS],
    );
    expect(teams.rows[0].n).toBe(2);

    const issues = await pool.query(
      `SELECT title_hash FROM issues WHERE workspace_id=$1 AND linear_id LIKE 'DEMO-%'`,
      [WS],
    );
    expect(issues.rows.length).toBe(3);
    // Title hashes are deterministic sha256 hex (64 chars).
    for (const row of issues.rows) {
      expect(row.title_hash).toMatch(/^[a-f0-9]{64}$/);
    }
    // Pitfall 13: there is no `title` column on issues — verifying that the
    // INSERT used `title_hash` is implicit (the schema would reject otherwise).

    const sessions = await pool.query(
      'SELECT count(*)::int AS n FROM agent_sessions WHERE workspace_id=$1',
      [WS],
    );
    expect(sessions.rows[0].n).toBe(50);
  });

  it('idempotent — second call returns inserted=0', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/seed',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { inserted: number };
    expect(body.inserted).toBe(0);
  });

  it('admin/clear-seed removes every demo row (agents, sessions, issues, teams, cycles)', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/clear-seed',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {},
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      deleted_agents: number;
      deleted_sessions: number;
      deleted_issues: number;
      deleted_cycles: number;
      deleted_teams: number;
    };
    expect(body.deleted_agents).toBe(3);
    expect(body.deleted_sessions).toBe(50);
    expect(body.deleted_issues).toBe(3);
    expect(body.deleted_cycles).toBe(1);
    expect(body.deleted_teams).toBe(2);

    const remaining = await pool.query(
      `SELECT count(*)::int AS n FROM agents WHERE workspace_id=$1 AND name LIKE '%-demo'`,
      [WS],
    );
    expect(remaining.rows[0].n).toBe(0);
  });

  it('admin/clear-seed 401 without bearer', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/clear-seed',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(r.statusCode).toBe(401);
  });
});
