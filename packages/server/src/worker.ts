import { run, runMigrations as runGraphileMigrations } from 'graphile-worker';
import pino from 'pino';
import { cronItems } from './crontab.js';
import { loadEnv, logBootBanner } from './env.js';
import { detectSharedApp } from './tasks/detect-shared-app.js';
import { refreshCostRollup } from './tasks/refresh-cost-rollup.js';
import { resolveIdentity } from './tasks/resolve-identity.js';
import { rotateRawEventPartitions } from './tasks/rotate-raw-event-partitions.js';

/**
 * Graphile Worker entry point — D-03 separate process.
 *
 * Runs in its own container alongside the `web` container (compose.yml).
 * Both containers share the same `@linearwatch/server` source tree because
 * the tasks reuse `env.ts`, `plugins/metrics.ts` (resolverConfidenceHistogram),
 * and the Drizzle schema — bundling them into a single image is the simplest
 * deployment for a self-hoster.
 *
 * Bootstrap order:
 *   1. Load + validate env (same fail-fast contract as the web container).
 *   2. Construct pino logger with the same redact paths so worker log lines
 *      match web log lines field-for-field.
 *   3. `runMigrations` for the graphile_worker schema. This is idempotent
 *      with the web container's call (plan 01.05 / index.ts) — whichever
 *      starts first wins, the other is a no-op. Without this call, a
 *      worker brought up before the web container would crash on its first
 *      LISTEN/NOTIFY query.
 *   4. `run({ taskList, parsedCronItems })` — registers all four P1 tasks
 *      and the three cron schedules. `concurrency: 5` is generous for P1's
 *      load (resolver is one row per webhook, partition rotation is monthly,
 *      detect_shared_app is hourly, cost rollup is a daily noop).
 *   5. `await runner.promise` — keeps the process alive until SIGTERM.
 *      Graphile Worker handles SIGINT/SIGTERM via `noHandleSignals: false`
 *      so docker-compose stop drains in-flight jobs cleanly.
 */
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
  });

  logBootBanner(env, logger);
  logger.info('worker: starting');

  // Idempotent: web container also calls this. Whichever wins the race wins.
  await runGraphileMigrations({ connectionString: env.DATABASE_URL });
  logger.info('worker: graphile-worker schema ready');

  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    noHandleSignals: false,
    pollInterval: 1_000,
    taskList: {
      resolve_identity: resolveIdentity,
      rotate_raw_event_partitions: rotateRawEventPartitions,
      detect_shared_app: detectSharedApp,
      refresh_cost_rollup: refreshCostRollup,
    },
    parsedCronItems: cronItems,
  });

  logger.info('worker: ready, awaiting jobs');
  await runner.promise;
}

main().catch((err: unknown) => {
  // Last-resort: pino may not have been constructed yet.
  console.error('FATAL: worker', err);
  process.exit(1);
});
