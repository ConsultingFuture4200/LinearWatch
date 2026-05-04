import { type ParsedCronItem, parseCronItems } from 'graphile-worker';

/**
 * Cron schedule registration for Graphile Worker (D-06, D-18, RESEARCH
 * Pattern 3).
 *
 * Schedules:
 *   - `rotate_raw_event_partitions` — `0 0 1 * *` (00:00 UTC on the 1st of
 *     each month) with `backfillPeriod: 86_400_000` (24h). The backfill is
 *     the Pitfall 8 mitigation: if the worker is down at the scheduled
 *     instant, Graphile Worker runs the missed schedule on next startup as
 *     long as the gap is ≤ 24h. This is what makes "rotation must run on
 *     the 1st" robust to maintenance restarts.
 *   - `detect_shared_app` — `0 * * * *` (top of every hour). Hourly is fast
 *     enough that a misconfiguration is surfaced before the dashboard's
 *     first cycle review, and slow enough that the heuristic's substring
 *     scan over 24h of raw events stays well under the queue concurrency
 *     budget.
 *   - `refresh_cost_rollup` — `0 2 * * *` (02:00 UTC daily). P1 stub. The
 *     2 AM slot keeps it out of the way of the partition rotation that
 *     fires at midnight on the 1st (no contention).
 *
 * Note on the API: Graphile Worker's `CronItem` field is `match` (the
 * `pattern` alias is deprecated since 0.16). We pass items through
 * `parseCronItems()` so any malformed expression fails fast at startup
 * rather than silently never firing.
 */
export const cronItems: ParsedCronItem[] = parseCronItems([
  {
    task: 'rotate_raw_event_partitions',
    match: '0 0 1 * *',
    options: { backfillPeriod: 86_400_000 },
  },
  {
    task: 'detect_shared_app',
    match: '0 * * * *',
  },
  {
    task: 'refresh_cost_rollup',
    match: '0 2 * * *',
  },
]);
