import { sql } from 'drizzle-orm';
import fp from 'fastify-plugin';
import client from 'prom-client';
import type { ServerDb } from '../db.js';

// Minimal Fastify shape needed by `registerMetricsRoute`. Using a structural
// type instead of FastifyInstance avoids the pino-Logger generic mismatch when
// the caller's instance was constructed with a custom loggerInstance.
interface MinimalFastify {
  get: (
    path: string,
    handler: (_req: unknown, reply: { type: (t: string) => void }) => Promise<string>,
  ) => unknown;
}

/**
 * Prom-client metrics (D-30 / RESEARCH Pattern 7).
 *
 * Five named metrics, exported for direct use by Wave-2 routes:
 * - `eventsReceived`            — counter on every webhook/SDK insert
 * - `webhookAckSeconds`         — histogram of webhook ack latency (200ms SLA)
 * - `jobsQueueDepth`            — gauge populated by the periodic scrape below
 * - `resolverConfidenceHistogram` — histogram observed every resolver run
 * - `enrichmentLagSeconds`      — gauge stub (P1 returns 0; P2 worker writes)
 *
 * Why module-level singletons: prom-client's default Registry is process-wide,
 * and instantiating these once at module load means re-registering on every
 * Fastify rebuild (or test) is impossible. Tests that need a clean registry
 * call `client.register.resetMetrics()`.
 */
export const eventsReceived = new client.Counter({
  name: 'agentwatch_events_received_total',
  help: 'Number of webhook/SDK events received',
  labelNames: ['source'] as const,
});

export const webhookAckSeconds = new client.Histogram({
  name: 'agentwatch_webhook_ack_seconds',
  help: 'Time to ack a webhook (HMAC verify + INSERT + 200)',
  labelNames: ['source'] as const,
  // Buckets span 5ms to 2s so the 200ms SLA shows clearly.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2],
});

export const jobsQueueDepth = new client.Gauge({
  name: 'agentwatch_jobs_queue_depth',
  help: 'Pending Graphile Worker jobs by task identifier',
  labelNames: ['job_name'] as const,
});

export const resolverConfidenceHistogram = new client.Histogram({
  name: 'agentwatch_identity_resolver_confidence',
  help: 'Distribution of identity resolver confidence scores',
  buckets: [0, 0.25, 0.5, 0.75, 0.8, 0.9, 1.0],
});

export const enrichmentLagSeconds = new client.Gauge({
  name: 'agentwatch_enrichment_lag_seconds',
  help: 'Lag between source event and enrichment completion (P1 stub: 0)',
  labelNames: ['source'] as const,
});

// Initialise default 0 values so the gauge is always present in /metrics.
enrichmentLagSeconds.labels('linear').set(0);
enrichmentLagSeconds.labels('sdk').set(0);

interface MetricsPluginOptions {
  db: ServerDb;
}

/**
 * Periodic queue-depth scrape.
 *
 * Graphile Worker 0.16.x stores pending jobs in `graphile_worker._private_jobs`
 * (the `jobs` view is a SECURITY DEFINER wrapper). On first boot the schema
 * may not exist yet; we ignore the error until the worker has run at least
 * once.
 */
export default fp<MetricsPluginOptions>(async (fastify, opts) => {
  const tick = async (): Promise<void> => {
    try {
      // Graphile Worker 0.16+ schema: _private_jobs.task_id is an FK to
      // _private_tasks.id, with the human-readable name on _private_tasks.identifier.
      const r = await opts.db.execute(sql`
        SELECT t.identifier AS job_name, COUNT(*)::int AS depth
        FROM graphile_worker._private_jobs j
        JOIN graphile_worker._private_tasks t ON t.id = j.task_id
        GROUP BY t.identifier
      `);
      jobsQueueDepth.reset();
      for (const row of r.rows as Array<{ job_name: string; depth: number }>) {
        jobsQueueDepth.labels(row.job_name).set(row.depth);
      }
    } catch {
      // Schema not yet present (first boot before worker registers tasks).
      // Silent — `jobs_queue_depth` reports 0 for unknown task names anyway.
    }
  };

  const interval = setInterval(tick, 5_000);
  // Don't keep the process alive just for the scrape interval.
  if (typeof interval.unref === 'function') interval.unref();
  fastify.addHook('onClose', async () => {
    clearInterval(interval);
  });
});

/**
 * Register the `/metrics` route. Kept separate from the plugin so the route
 * can be wired up after auth without leaking through `authBearer`.
 */
export async function registerMetricsRoute(fastify: MinimalFastify): Promise<void> {
  fastify.get('/metrics', async (_req, reply) => {
    reply.type(client.register.contentType);
    return client.register.metrics();
  });
}
