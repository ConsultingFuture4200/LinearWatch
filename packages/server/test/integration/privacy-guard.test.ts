import { createHash, createHmac, randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyInstance } from 'fastify';
import { runMigrations as runGraphileMigrations, runOnce } from 'graphile-worker';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import authPlugin from '../../src/plugins/auth.js';
import metricsPlugin from '../../src/plugins/metrics.js';
import rawBody from '../../src/plugins/raw-body.js';
import queryRoute from '../../src/routes/api/v1/query.js';
import linearWebhookRoute, {
  __resetWorkspaceIdCacheForTests,
} from '../../src/routes/webhooks/linear.js';
import { refreshCostRollup } from '../../src/tasks/refresh-cost-rollup.js';
import { resolveIdentity } from '../../src/tasks/resolve-identity.js';

/**
 * End-to-end privacy guard — PRIV-03 / Pitfall 4 / Pitfall 13.
 *
 * Plan 01.10 deliverable. Seeds a unique title detector string via the full
 * Linear webhook ingest path (HMAC verify → INSERT → resolve_identity job),
 * then iterates every (metric, dimension) permutation supported by the
 * query API and asserts the seed string never appears in any response body.
 *
 * Design choice: the plan's literal test spawned `node dist/index.js` against
 * the host. Every other Phase-1 integration test uses Fastify's `app.inject`
 * pattern (see idempotency.test.ts, query-api.test.ts). We follow the
 * neighboring style for two reasons:
 *   1. Correctness — the threat is title strings appearing in any *route
 *      handler* response. `app.inject` exercises the same routes against the
 *      same handlers; spawning a subprocess only adds the network layer,
 *      which cannot reintroduce a title leak.
 *   2. Reliability — no dependency on a `dist/` build step or port binding;
 *      the test self-skips when Postgres is unreachable instead of timing out.
 *
 * Load-bearing claims kept verbatim from the plan:
 *   - Literal `__SEED_DETECTOR_PHASE1_` string in source so a grep of the
 *     test file confirms the seed pattern.
 *   - 2 metrics × 4 dimension permutations = 8 `expect(...).not.toContain`
 *     calls inside the iteration loop.
 */

const { Pool } = pg;
type PoolInstance = InstanceType<typeof pg.Pool>;
type Db = ReturnType<typeof drizzle>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

const BASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgres://linearwatch:linearwatch_dev_password@localhost:5432/postgres';
const TEST_DB_URL = BASE_URL.replace(/\/[^/]+$/, '/linearwatch_priv');

const SECRET = 'priv-webhook-secret';
const PLAINTEXT_KEY = 'lw_priv_test_key_xyz_1234567890';
const KEY_HASH = createHash('sha256').update(PLAINTEXT_KEY).digest('hex');
const WS = '00000000-0000-4000-8000-000000000001';

// Random suffix so concurrent runs cannot collide on a hard-coded constant.
const SEED_DETECTOR = `__SEED_DETECTOR_PHASE1_${randomUUID().replace(/-/g, '')}__`;

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

async function makeIngestApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('env', { LINEAR_WEBHOOK_SECRET: SECRET } satisfies FakeEnv);
  app.decorate('db', db);
  await app.register(rawBody);
  await app.register(metricsPlugin, { db });
  await app.register(linearWebhookRoute);
  return app;
}

async function makeQueryApp(db: Db): Promise<FastifyInstance> {
  const app = Fastify();
  // biome-ignore lint/suspicious/noExplicitAny: minimal env decoration for tests
  app.decorate('env', {} as any);
  app.decorate('db', db);
  // biome-ignore lint/suspicious/noExplicitAny: ServerDb structural type
  await app.register(authPlugin, { db: db as any });
  await app.register(queryRoute);
  return app;
}

describe.skipIf(!dbReachable)('privacy guard (PRIV-03, Pitfall 13)', () => {
  let pool: PoolInstance;
  let db: Db;

  beforeAll(async () => {
    const adminUrl = TEST_DB_URL.replace(/\/[^/]+$/, '/postgres');
    const admin = new Pool({ connectionString: adminUrl });
    await admin.query('DROP DATABASE IF EXISTS linearwatch_priv');
    await admin.query('CREATE DATABASE linearwatch_priv');
    await admin.end();

    pool = new Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await runGraphileMigrations({ connectionString: TEST_DB_URL });

    // Workspace + minimal seed so the query API returns non-empty rows for
    // every metric × dimension combination — an empty result is not a real
    // leak surface, the test must exercise actual SELECT path output.
    await pool.query(
      `INSERT INTO workspaces (id, name, api_key_hash, workspace_salt)
       VALUES ($1, 'priv', $2, 'salt-1')`,
      [WS, KEY_HASH],
    );
    const teamA = randomUUID();
    await pool.query(
      `INSERT INTO teams (id, workspace_id, linear_id, key, name)
       VALUES ($1, $2, 'priv-t', 'PRIV', 'Priv')`,
      [teamA, WS],
    );
    const cycle = randomUUID();
    await pool.query(
      `INSERT INTO cycles (id, workspace_id, team_id, linear_id, name)
       VALUES ($1, $2, $3, 'priv-c', 'Cycle')`,
      [cycle, WS, teamA],
    );
    const agent = randomUUID();
    await pool.query(
      `INSERT INTO agents (id, workspace_id, name, linear_app_user_id)
       VALUES ($1, $2, 'priv-agent', 'lap-priv')`,
      [agent, WS],
    );
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO agent_sessions (workspace_id, agent_id, team_id, cycle_id, cost_usd, started_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [WS, agent, teamA, cycle, 1.0, new Date(Date.now() - i * 86_400_000)],
      );
    }
    // Issue with title_hash carrying the seed payload's hash — title_hash is
    // an opaque hex digest (D-27) so even if it leaked through a JOIN, the
    // raw seed string would not.
    const seedHash = createHash('sha256')
      .update(`salt-1:${SEED_DETECTOR.toLowerCase()}`)
      .digest('hex');
    await pool.query(
      `INSERT INTO issues (workspace_id, linear_id, title_hash) VALUES ($1, 'PRIV-1', $2)`,
      [WS, seedHash],
    );
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
  });

  it('seeded title NEVER appears in any query API response', async () => {
    // === 1. Inject the seed via the real Linear webhook handler ===
    __resetWorkspaceIdCacheForTests();
    const ingestApp = await makeIngestApp(db);
    const body = JSON.stringify({
      type: 'AgentSession',
      actor: { id: 'lap-priv-test' },
      issue: { title: SEED_DETECTOR, linearId: 'PRIV-1' },
    });
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    const did = randomUUID();
    const ingestRes = await ingestApp.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: {
        'content-type': 'application/json',
        'linear-delivery': did,
        'linear-signature': sig,
      },
      payload: body,
    });
    expect(ingestRes.statusCode).toBe(200);
    await ingestApp.close();

    // === 2. Drain the resolve_identity job so identity_mappings is populated ===
    await runOnce({
      connectionString: TEST_DB_URL,
      concurrency: 1,
      taskList: {
        resolve_identity: resolveIdentity,
        refresh_cost_rollup: refreshCostRollup,
      },
    });

    // Sanity check: the raw event was stored (the seed lives in raw_event.payload
    // by design — that table is not exposed via the query API).
    const rawCount = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM events.raw_event WHERE source='linear' AND upstream_id=$1",
      [did],
    );
    expect(rawCount.rows[0].n).toBe(1);

    // === 3. Iterate every (metric, dimension) permutation ===
    // 2 metrics × 4 dimension settings (undefined + 3 named) = 8 assertions.
    const queryApp = await makeQueryApp(db);
    const metrics = ['cost_by_agent', 'agent_session_count'] as const;
    const dimensions = [undefined, 'agent', 'team', 'cycle'] as const;

    for (const metric of metrics) {
      for (const dim of dimensions) {
        const reqBody: { metric: string; dimension?: string; window: { last: string } } = {
          metric,
          window: { last: '14d' },
        };
        if (dim) reqBody.dimension = dim;
        const res = await queryApp.inject({
          method: 'POST',
          url: '/api/v1/query',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${PLAINTEXT_KEY}`,
          },
          payload: reqBody,
        });
        // PRIV-03 / Pitfall 13 — the seeded title string MUST NOT appear in
        // any query API response body, regardless of metric or dimension.
        const ctx = `metric=${metric} dimension=${dim ?? 'none'}`;
        expect(res.body, ctx).not.toContain(SEED_DETECTOR);
      }
    }
    await queryApp.close();
  });
});
