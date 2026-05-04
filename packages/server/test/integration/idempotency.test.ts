import { createHmac, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify from 'fastify';
import { runMigrations as runGraphileMigrations } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import metricsPlugin from '../../src/plugins/metrics.js';
import rawBody from '../../src/plugins/raw-body.js';
import linearWebhookRoute, {
  __resetWorkspaceIdCacheForTests,
} from '../../src/routes/webhooks/linear.js';

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

// Each integration test uses its own dedicated database so concurrent or
// sequential test files don't trample each other. We honour DATABASE_URL_TEST
// only for host/credentials; the path component (DB name) is always
// `agentwatch_idem` for this file.
const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://agentwatch:agentwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/agentwatch_idem');
const SECRET = 'test-webhook-secret';

interface FakeEnv {
  LINEAR_WEBHOOK_SECRET: string;
}

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

describe.skipIf(!dbReachable)('idempotency (INGEST-05, Pitfall 1)', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS agentwatch_idem');
    await admin.query('CREATE DATABASE agentwatch_idem');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    // Install graphile_worker schema so the webhook handler's add_job call
    // succeeds (production: plan 01.06 installs this at worker startup).
    await runGraphileMigrations({ connectionString: TEST_DB_URL });

    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt)
       VALUES ('00000000-0000-4000-8000-000000000001', 'test', 'placeholder-hash', 'salt-1')`,
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('same signed delivery sent 5x → exactly 1 row', async () => {
    __resetWorkspaceIdCacheForTests();
    const app = Fastify();
    app.decorate('env', { LINEAR_WEBHOOK_SECRET: SECRET } satisfies FakeEnv);
    app.decorate('db', db);
    await app.register(rawBody);
    await app.register(metricsPlugin, { db });
    await app.register(linearWebhookRoute);

    const body = JSON.stringify({ type: 'AgentSession', actor: { id: 'lap-1' } });
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    const did = randomUUID();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/webhooks/linear',
        headers: {
          'content-type': 'application/json',
          'linear-delivery': did,
          'linear-signature': sig,
        },
        payload: body,
      });
      expect(r.statusCode).toBe(200);
    }
    const rows = await pool.query(
      `SELECT count(*)::int AS n
       FROM events.raw_event
       WHERE source='linear' AND upstream_id=$1`,
      [did],
    );
    expect(rows.rows[0].n).toBe(1);
    await app.close();
  });
});
