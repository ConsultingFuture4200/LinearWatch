import type { Task } from 'graphile-worker';

/**
 * D-06 + Pitfall 8 — monthly partition rotation for `events.raw_event`.
 *
 * Two responsibilities:
 *   1. Ensure the **current** and **next** month partitions exist
 *      (CREATE TABLE IF NOT EXISTS PARTITION OF events.raw_event ...).
 *   2. DROP partitions whose upper bound is more than 30 days in the past
 *      (the retention boundary). Past-retention data is intentionally
 *      destroyed; that's the whole point of the 30-day partition strategy.
 *
 * Design choice: plain DROP TABLE rather than DETACH CONCURRENTLY + DROP.
 * DETACH CONCURRENTLY exists for partitions you intend to ARCHIVE and reuse
 * the data; here we are deliberately discarding past-retention data, so the
 * extra ceremony just slows the cron run without buying anything. (Any
 * future retention-extension feature would revisit this.)
 *
 * Cron schedule (registered in `crontab.ts`): `0 0 1 * *` with a
 * `backfillPeriod` of 24h. The backfill is the Pitfall 8 mitigation: if the
 * worker is down at 00:00 on the 1st of the month, Graphile Worker's
 * missed-schedule catchup runs the task as soon as the worker comes back up,
 * up to 24h late. This guarantees the rotation runs even during a brief
 * outage at the month boundary.
 */
export const rotateRawEventPartitions: Task = async (_payload, helpers) => {
  await helpers.withPgClient(async (pg) => {
    // 1. Ensure current + next month partitions exist.
    //
    // We use an anonymous DO block so the partition names (which depend on
    // `now()`) are computed server-side. CREATE TABLE IF NOT EXISTS makes
    // this safe to re-run — it's the same pattern the initial migration
    // (0000_init.sql) uses.
    await pg.query(`
      DO $$
      DECLARE
        cur_start  date := date_trunc('month', now())::date;
        next_start date := (date_trunc('month', now()) + interval '1 month')::date;
        after_next date := (date_trunc('month', now()) + interval '2 month')::date;
        cur_name   text := 'raw_event_' || to_char(cur_start, 'YYYY_MM');
        next_name  text := 'raw_event_' || to_char(next_start, 'YYYY_MM');
      BEGIN
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event FOR VALUES FROM (%L) TO (%L)',
          cur_name, cur_start, next_start
        );
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event FOR VALUES FROM (%L) TO (%L)',
          next_name, next_start, after_next
        );
      END $$;
    `);

    // 2. Find existing partitions and their upper-bound (the TO clause).
    //
    // pg_inherits + pg_get_expr exposes the partition bound expression as
    // SQL text we can regex; the upper bound is the second date literal in
    // `FOR VALUES FROM ('YYYY-MM-DD') TO ('YYYY-MM-DD')`. The partition's
    // identifier comes through pg_class.oid::regclass which Postgres
    // server-side-escapes — there is no path for arbitrary user input to
    // become an identifier here (T-06-06).
    const r = await pg.query<{ partition: string; upper_bound: string | null }>(`
      SELECT
        child.oid::regclass::text AS partition,
        (regexp_match(pg_get_expr(child.relpartbound, child.oid), 'TO \\(''([0-9-]+)''\\)'))[1] AS upper_bound
      FROM pg_inherits i
      JOIN pg_class child  ON child.oid  = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace n  ON n.oid      = parent.relnamespace
      WHERE n.nspname = 'events' AND parent.relname = 'raw_event'
    `);

    // 3. Drop any partition whose upper bound is more than 30 days old.
    //
    // The retention boundary is computed in JS (not SQL) so the same value
    // is used for the comparison and the log line — easier debugging when a
    // partition lingers a tick past midnight UTC.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 30);

    for (const row of r.rows) {
      if (!row.upper_bound) continue;
      const upper = new Date(row.upper_bound);
      if (Number.isNaN(upper.getTime())) continue;
      if (upper < cutoff) {
        // `partition` is `events.raw_event_YYYY_MM` produced by ::regclass —
        // already escaped server-side. Safe to interpolate directly.
        await pg.query(`DROP TABLE IF EXISTS ${row.partition}`);
        helpers.logger.info('rotate_raw_event_partitions: dropped past-retention partition', {
          partition: row.partition,
          upper_bound: row.upper_bound,
        });
      }
    }
  });
};
