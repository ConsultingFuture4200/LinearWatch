import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import sdkEventRoute from '../../src/routes/api/v1/sdk-event.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/agentwatch_sdk');

const PLAINTEXT_KEY = 'agw_test_sdk_key_xyz';
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
  await app.register(sdkEventRoute);
  return app;
}

async function countRawEvents(pool: PoolInstance, sessionId?: string): Promise<number> {
  const r = sessionId
    ? await pool.query(
        `SELECT COUNT(*)::int AS c FROM events.raw_event WHERE source='sdk' AND payload->>'session_id' = $1`,
        [sessionId],
      )
    : await pool.query(`SELECT COUNT(*)::int AS c FROM events.raw_event WHERE source='sdk'`);
  return Number(r.rows[0].c);
}

describe.skipIf(!dbReachable)('POST /api/v1/sdk/event', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_sdk');
    await admin.query('CREATE DATABASE agentwatch_sdk');
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
      url: '/api/v1/sdk/event',
      headers: { 'content-type': 'application/json' },
      payload: {
        event_type: 'session_start',
        session_id: 'sess-noauth',
        occurred_at: new Date().toISOString(),
        agent_name: 'cursor-demo',
      },
    });
    expect(r.statusCode).toBe(401);
  });

  it('200 with valid bearer + session_start; row inserted with source=sdk', async () => {
    const app = await makeApp(db);
    const sessionId = `sess-${randomUUID()}`;
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {
        event_type: 'session_start',
        session_id: sessionId,
        occurred_at: new Date().toISOString(),
        idempotency_key: `idemp-${sessionId}`,
        agent_name: 'cursor-demo',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; idempotency_key: string };
    expect(body.ok).toBe(true);
    expect(body.idempotency_key).toBe(`idemp-${sessionId}`);
    expect(await countRawEvents(pool, sessionId)).toBe(1);
  });

  it('caller-supplied idempotency_key dedupes — two sends → one row', async () => {
    const app = await makeApp(db);
    const sessionId = `sess-${randomUUID()}`;
    const idem = `idemp-dup-${sessionId}`;
    const payload = {
      event_type: 'session_end' as const,
      session_id: sessionId,
      occurred_at: new Date().toISOString(),
      idempotency_key: idem,
    };
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload,
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload,
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(await countRawEvents(pool, sessionId)).toBe(1);
  });

  it('synthesized idempotency_key dedupes within same minute_bucket', async () => {
    const app = await makeApp(db);
    const sessionId = `sess-${randomUUID()}`;
    const occurredAt = new Date().toISOString();
    // Same session_id + event_type + occurred_at within the same minute → one row
    const payload = {
      event_type: 'cost_recorded' as const,
      session_id: sessionId,
      occurred_at: occurredAt,
      cost_usd: 0.42,
    };
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload,
    });
    const r2 = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: { ...payload, occurred_at: occurredAt }, // same minute bucket
    });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const b1 = r1.json() as { idempotency_key: string };
    const b2 = r2.json() as { idempotency_key: string };
    expect(b1.idempotency_key).toBe(b2.idempotency_key);
    expect(await countRawEvents(pool, sessionId)).toBe(1);
  });

  it('400 on invalid event_type', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/sdk/event',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PLAINTEXT_KEY}`,
      },
      payload: {
        event_type: 'agent_attempted_takeover',
        session_id: 'whatever',
        occurred_at: new Date().toISOString(),
      },
    });
    expect(r.statusCode).toBe(400);
  });
});
