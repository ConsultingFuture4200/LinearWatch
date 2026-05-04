import { createHmac, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
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
// `linearwatch_webhook` for this file.
const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_webhook');
const SECRET = 'test-webhook-secret';

interface FakeEnv {
  LINEAR_WEBHOOK_SECRET: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: FakeEnv;
    db: Db;
  }
}

function sign(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
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

async function makeApp(db: Db): Promise<FastifyInstance> {
  __resetWorkspaceIdCacheForTests();
  const app = Fastify();
  app.decorate('env', { LINEAR_WEBHOOK_SECRET: SECRET } satisfies FakeEnv);
  app.decorate('db', db);
  await app.register(rawBody);
  await app.register(metricsPlugin, { db });
  await app.register(linearWebhookRoute);
  return app;
}

describe.skipIf(!dbReachable)('POST /webhooks/linear', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_webhook');
    await admin.query('CREATE DATABASE linearwatch_webhook');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    // Install graphile_worker schema so the webhook handler's add_job call
    // succeeds (production: plan 01.06 installs this at worker startup).
    await runGraphileMigrations({ connectionString: TEST_DB_URL });

    // Seed a workspaces row so the resolver enqueue path can resolve workspace_id.
    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt)
       VALUES ('00000000-0000-4000-8000-000000000001', 'test', 'placeholder-hash', 'salt-1')`,
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('200 on valid HMAC + valid Linear-Delivery; row inserted; raw bytes preserved', async () => {
    const app = await makeApp(db);
    const body = JSON.stringify({
      type: 'AgentSession',
      actor: { id: 'lap-1' },
      issue: { title: 'PROBE' },
    });
    const did = randomUUID();
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: {
        'content-type': 'application/json',
        'linear-delivery': did,
        'linear-signature': sign(body),
      },
      payload: body,
    });
    expect(r.statusCode).toBe(200);
    const rows = await pool.query(
      `SELECT id, signature_valid, payload::text AS payload_text
       FROM events.raw_event
       WHERE source='linear' AND upstream_id=$1`,
      [did],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].signature_valid).toBe(true);
    // Raw-body integrity: parsing the stored payload yields the same logical
    // object as the sent body (jsonb may reorder keys; structural equality is
    // the right check).
    expect(JSON.parse(rows.rows[0].payload_text)).toEqual(JSON.parse(body));
    await app.close();
  });

  it('401 on invalid HMAC', async () => {
    const app = await makeApp(db);
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: {
        'content-type': 'application/json',
        'linear-delivery': randomUUID(),
        'linear-signature': '00'.repeat(32), // wrong sig, right length
      },
      payload: JSON.stringify({ a: 1 }),
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('400 on missing Linear-Delivery (D-09)', async () => {
    const app = await makeApp(db);
    const body = JSON.stringify({ a: 1 });
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: {
        'content-type': 'application/json',
        'linear-signature': sign(body),
      },
      payload: body,
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toBe('missing_or_invalid_linear_delivery');
    await app.close();
  });

  it('400 on malformed (non-UUID) Linear-Delivery', async () => {
    const app = await makeApp(db);
    const body = JSON.stringify({ a: 1 });
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: {
        'content-type': 'application/json',
        'linear-delivery': 'not-a-uuid',
        'linear-signature': sign(body),
      },
      payload: body,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it('handler does NOT contain a synchronous resolveIdentity call (Pitfall 2)', async () => {
    const fs = await import('node:fs/promises');
    const handlerPath = resolve(__dirname, '..', '..', 'src', 'routes', 'webhooks', 'linear.ts');
    const src = await fs.readFile(handlerPath, 'utf8');
    const callMatches = src.match(/resolveIdentity\s*\(/g) ?? [];
    expect(callMatches.length).toBe(0);
  });

  it('handler source contains NO req.body reference (OBS-04)', async () => {
    const fs = await import('node:fs/promises');
    const handlerPath = resolve(__dirname, '..', '..', 'src', 'routes', 'webhooks', 'linear.ts');
    const src = await fs.readFile(handlerPath, 'utf8');
    expect(/\breq\.body\b/.test(src)).toBe(false);
    expect(/\brequest\.body\b/.test(src)).toBe(false);
  });
});
