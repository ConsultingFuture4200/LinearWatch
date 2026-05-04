/**
 * `/metrics` route — re-export from the metrics plugin module.
 *
 * The actual route registration lives in `plugins/metrics.ts` so the route's
 * handler can share the prom-client registry with the metric definitions.
 * This file exists for clarity in the routes directory listing — Wave 2 plans
 * adding `/webhooks/linear` and `/api/v1/query` find their `metrics.ts`
 * neighbour here without spelunking through `plugins/`.
 */
export { registerMetricsRoute } from '../plugins/metrics.js';
