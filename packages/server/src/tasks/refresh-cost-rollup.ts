import type { Task } from 'graphile-worker';

/**
 * `refresh_cost_rollup` — P1 stub.
 *
 * The `cost_by_agent_daily` rollup table exists in the P1 schema (see
 * 0000_init.sql section 6) but its refresh job is intentionally a no-op in
 * P1: the cost columns on `agent_sessions` (`cost_usd`, `tokens_in`,
 * `tokens_out`) are all NULL until P2 vendor enrichment populates them
 * (INGEST-07/08). Refreshing the rollup against an empty fact table would
 * produce an empty rollup — there's nothing to roll up.
 *
 * Why ship it now:
 *   - The cron entry exists in `crontab.ts` so the daily 02:00 schedule is
 *     a non-event in P2: P2 only changes the function body, not the
 *     schedule registration or the worker container's task list.
 *   - Adding cron items at runtime in Graphile Worker requires a worker
 *     restart anyway, so pre-registering with a stub avoids that operational
 *     change in P2.
 *   - The `/metrics` queue-depth scrape (plugins/metrics.ts) treats unknown
 *     task identifiers as 0; pre-registering means the gauge has the
 *     `refresh_cost_rollup` label populated from day 1.
 */
export const refreshCostRollup: Task = async (_payload, helpers) => {
  helpers.logger.info('refresh_cost_rollup_stub: noop in P1; populates cost_by_agent_daily in P2');
};
