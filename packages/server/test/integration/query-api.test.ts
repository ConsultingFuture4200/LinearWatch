import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import queryRoute from '../../src/routes/api/v1/query.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

// Each integration test uses its own dedicated database.
const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_query');

const PLAINTEXT_KEY = 'lw_test_query_key_xyz';
const KEY_HASH = createHash('sha256').update(PLAINTEXT_KEY).digest('hex');
const WS = '00000000-0000-4000-8000-000000000001';

const SEED_TITLE_HASH = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

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

interface SeedResult {
  teamA: string;
  teamB: string;
  cycle: string;
  agentCursor: string;
  agentDevin: string;
  agentInternal: string;
}

async function makeApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  // biome-ignore lint/suspicious/noExplicitAny: minimal env decoration for tests
  app.decorate('env', {} as any);
  app.decorate('db', db);
  // biome-ignore lint/suspicious/noExplicitAny: ServerDb type structural
  await app.register(authPlugin, { db: db as any });
  await app.register(queryRoute);
  return app;
}

describe.skipIf(!dbReachable)('POST /api/v1/query', () => {
  let pool: PoolInstance;
  let db: Db;
  let seed: SeedResult;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_query');
    await admin.query('CREATE DATABASE linearwatch_query');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    // Seed: 1 workspace, 2 teams, 1 cycle, 3 agents, 10 sessions, 1 issue with hashed title
    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt) VALUES ($1, 'test', $2, 'salt-1')`,
      [WS, KEY_HASH],
    );
    const teamA = randomUUID();
    const teamB = randomUUID();
    await pool.query(
      `INSERT INTO teams (id, workspace_id, linear_id, key, name)
       VALUES ($1, $2, 't-a', 'ENG', 'Eng'), ($3, $2, 't-b', 'OPS', 'Ops')`,
      [teamA, WS, teamB],
    );
    const cycle = randomUUID();
    await pool.query(
      `INSERT INTO cycles (id, workspace_id, team_id, linear_id, name)
       VALUES ($1, $2, $3, 'c-1', 'Cycle 1')`,
      [cycle, WS, teamA],
    );
    const agentCursor = randomUUID();
    const agentDevin = randomUUID();
    const agentInternal = randomUUID();
    await pool.query(
      `INSERT INTO agents (id, workspace_id, name)
       VALUES ($1, $2, 'cursor-demo'), ($3, $2, 'devin-demo'), ($4, $2, 'internal-bot')`,
      [agentCursor, WS, agentDevin, agentInternal],
    );

    // 5 sessions in last 14 days for cursor-demo team A; 3 for devin-demo team B; 2 for internal-bot team A
    const insertSession =
      'INSERT INTO agent_sessions (workspace_id, agent_id, team_id, cycle_id, cost_usd, started_at) VALUES ($1, $2, $3, $4, $5, $6)';
    const since14 = new Date(Date.now() - 14 * 86_400_000 + 60_000); // 60s buffer to keep within window
    for (let i = 0; i < 5; i++) {
      await pool.query(insertSession, [
        WS,
        agentCursor,
        teamA,
        cycle,
        1.5,
        new Date(since14.getTime() + i * 86_400_000),
      ]);
    }
    for (let i = 0; i < 3; i++) {
      await pool.query(insertSession, [
        WS,
        agentDevin,
        teamB,
        null,
        2.0,
        new Date(since14.getTime() + i * 86_400_000),
      ]);
    }
    for (let i = 0; i < 2; i++) {
      await pool.query(insertSession, [
        WS,
        agentInternal,
        teamA,
        cycle,
        null,
        new Date(since14.getTime() + i * 86_400_000),
      ]);
    }

    // Issue with hashed title — proves no raw title leaks through query API.
    await pool.query(
      `INSERT INTO issues (workspace_id, linear_id, title_hash) VALUES ($1, 'LIN-1', $2)`,
      [WS, SEED_TITLE_HASH],
    );

    seed = { teamA, teamB, cycle, agentCursor, agentDevin, agentInternal };
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('401 without bearer', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: { 'content-type': 'application/json' },
      payload: { metric: 'cost_by_agent', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(401);
  });

  it('401 on bad bearer', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
      payload: { metric: 'cost_by_agent', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(401);
  });

  it('400 on unknown metric (API-02)', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'sql_drop_table', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(400);
  });

  it('400 on unknown dimension (API-05)', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'cost_by_agent', dimension: 'repo', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(400);
  });

  it('cost_by_agent dimension=agent returns rows summed correctly', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'cost_by_agent', dimension: 'agent', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      metric: string;
      dimension: string;
      rows: Array<{ key: string; value: number; count: number }>;
    };
    expect(body.metric).toBe('cost_by_agent');
    expect(body.dimension).toBe('agent');
    const byKey = Object.fromEntries(body.rows.map((row) => [row.key, row]));
    expect(byKey['cursor-demo'].value).toBeCloseTo(7.5, 2); // 5 * 1.5
    expect(byKey['cursor-demo'].count).toBe(5);
    expect(byKey['devin-demo'].value).toBeCloseTo(6.0, 2); // 3 * 2.0
    expect(byKey['devin-demo'].count).toBe(3);
    expect(byKey['internal-bot'].value).toBe(0); // NULL costs → 0
    expect(byKey['internal-bot'].count).toBe(2);
  });

  it('cost_by_agent dimension=team returns rows keyed by team key', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'cost_by_agent', dimension: 'team', window: { last: '30d' } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      rows: Array<{ key: string; value: number; count: number }>;
    };
    const byKey = Object.fromEntries(body.rows.map((row) => [row.key, row]));
    // ENG = teamA = cursor (5 * 1.5) + internal (2 * 0) = 7.5
    expect(byKey.ENG.value).toBeCloseTo(7.5, 2);
    expect(byKey.ENG.count).toBe(7);
    // OPS = teamB = devin (3 * 2.0) = 6.0
    expect(byKey.OPS.value).toBeCloseTo(6.0, 2);
    expect(byKey.OPS.count).toBe(3);
  });

  it('agent_session_count without dimension returns single all-row', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'agent_session_count', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { rows: Array<{ key: string; value: number }> };
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].key).toBe('all');
    expect(body.rows[0].value).toBe(10);
  });

  it('agent_session_count dimension=agent returns row per agent', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'agent_session_count', dimension: 'agent', window: { last: '14d' } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { rows: Array<{ key: string; value: number }> };
    const byKey = Object.fromEntries(body.rows.map((row) => [row.key, row]));
    expect(byKey['cursor-demo'].value).toBe(5);
    expect(byKey['devin-demo'].value).toBe(3);
    expect(byKey['internal-bot'].value).toBe(2);
  });

  it('filter team_id=eq narrows result to a single team', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {
        metric: 'cost_by_agent',
        dimension: 'agent',
        filters: [{ field: 'team_id', op: 'eq', value: seed.teamB }],
        window: { last: '14d' },
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as {
      rows: Array<{ key: string; value: number; count: number }>;
    };
    const byKey = Object.fromEntries(body.rows.map((row) => [row.key, row]));
    expect(byKey['devin-demo'].value).toBeCloseTo(6.0, 2);
    expect(byKey['cursor-demo']).toBeUndefined();
    expect(byKey['internal-bot']).toBeUndefined();
  });

  it('response does not contain title or title_hash fields (Pitfall 13 sanity)', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/query',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { metric: 'cost_by_agent', dimension: 'agent', window: { last: '14d' } },
    });
    const json = r.body;
    expect(json).not.toMatch(/"title"/);
    expect(json).not.toMatch(/title_hash/);
    expect(json).not.toContain(SEED_TITLE_HASH);
  });
});
