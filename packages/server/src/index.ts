import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify from 'fastify';
import { runMigrations as runGraphileMigrations } from 'graphile-worker';
import pino from 'pino';
import { createServerDb } from './db.js';
import { type Env, loadEnv, logBootBanner } from './env.js';
import authPlugin from './plugins/auth.js';
import metricsPlugin, { registerMetricsRoute } from './plugins/metrics.js';
import rawBody from './plugins/raw-body.js';
import healthRoutes from './routes/health.js';
import linearWebhookRoute from './routes/webhooks/linear.js';

/**
 * Server entry — Phase 1, Plan 04.
 *
 * Bootstrap order (BLOCKING per D-05):
 *   1. Load + validate env (fail fast — DEPLOY-03 / D-24).
 *   2. Configure pino with redact paths (Pitfalls 5, 12).
 *   3. Print boot banner so users see TELEMETRY_OPT_IN status (Pitfall 7).
 *   4. Open the DB pool and run migrations BEFORE binding the listener.
 *      A migration failure exits non-zero with a logged FATAL line — the
 *      server NEVER accepts connections against a stale schema.
 *   5. Construct Fastify with `disableRequestLogging: true` so we control
 *      every log line (Wave-2 webhook routes call logWebhookReceipt).
 *   6. Register plugins (raw-body, metrics, auth) and decorate fastify
 *      with env / db / pgPool for Wave-2 routes.
 *   7. Register /health (DB ping) and /metrics (Prometheus exposition).
 *   8. fastify.listen() — only now do we accept connections.
 */
declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    db: ReturnType<typeof createServerDb>['db'];
    pgPool: ReturnType<typeof createServerDb>['pool'];
  }
}

async function main(): Promise<void> {
  const env = loadEnv();

  const logger = pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        'req.body', // allow-req-body: pino redact path string (Pitfall 5)
        'req.headers.authorization',
        'req.headers["linear-signature"]',
        'req.headers["x-hub-signature-256"]',
        'res.body',
        '*.payload',
        '*.signature',
        'workspace_salt',
        'api_key_hash',
      ],
      censor: '[REDACTED]',
      remove: false,
    },
    serializers: {
      req: (r) => ({ id: r.id, method: r.method, url: r.url }),
      res: (r) => ({ statusCode: r.statusCode }),
    },
  });

  logBootBanner(env, logger);

  // === BLOCKING: migrations apply BEFORE server accepts connections (D-05) ===
  const { db, pool } = createServerDb(env.DATABASE_URL);
  // Migrations folder: packages/db/migrations.
  // Resolved from this file's location so it works in both
  //   - dev (tsx, src/index.ts) → ../../db/migrations
  //   - prod (built, dist/index.js) → ../../db/migrations
  // Both layouts collapse to the same relative offset because tsc preserves the
  // directory structure under dist/.
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = resolve(here, '..', '..', 'db', 'migrations');
  try {
    logger.info({ migrationsFolder }, 'running migrations');
    await migrate(db, { migrationsFolder });
    logger.info('migrations applied');
    // Graphile Worker schema (graphile_worker.add_job, _private_jobs, etc.)
    // must exist before the webhook handler can enqueue resolve_identity
    // jobs. The worker process (plan 01.06) also calls runMigrations on its
    // own startup; this call is idempotent so dual-installation is safe.
    // Without it, the webhook handler returns 500 on every request that
    // tries to enqueue (because graphile_worker.add_job does not exist).
    logger.info('running graphile-worker migrations');
    await runGraphileMigrations({ connectionString: env.DATABASE_URL });
    logger.info('graphile-worker schema ready');
  } catch (err) {
    logger.fatal({ err }, 'FATAL: migration failed at startup');
    process.exit(1);
  }
  // === END BLOCKING ===

  const fastify = Fastify({
    loggerInstance: logger,
    // Pitfall 12: disable Fastify's default per-request logger; Wave-2
    // webhook handlers emit their own D-29 whitelist log lines.
    disableRequestLogging: true,
  });

  fastify.decorate('env', env);
  fastify.decorate('db', db);
  fastify.decorate('pgPool', pool);

  await fastify.register(rawBody);
  await fastify.register(metricsPlugin, { db });
  await fastify.register(authPlugin, { db });
  await fastify.register(healthRoutes, { db });
  await registerMetricsRoute(fastify);

  // Wave 2 routes — registered against the decorated Fastify instance.
  await fastify.register(linearWebhookRoute);
  // /api/v1/query, /api/v1/sdk/event, /api/v1/agents/[id]/confirm land in
  // plans 01.07-01.09.

  fastify.addHook('onClose', async () => {
    await pool.end();
  });

  await fastify.listen({ port: env.PORT, host: '0.0.0.0' });
  logger.info(`listening on :${env.PORT}`);
}

main().catch((err) => {
  // Last-resort logger: pino may not have been constructed yet.
  console.error('FATAL:', err);
  process.exit(1);
});
