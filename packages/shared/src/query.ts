import { z } from 'zod';

/**
 * P1 query API metrics. (API-02 / API-04)
 *
 * Closed enum: parse() throws on any string outside this set, which makes
 * arbitrary-SQL injection a runtime impossibility before the dispatcher even
 * runs (Pitfall: anti-feature "custom SQL in rule engine").
 *
 * Adding a metric here is a one-line change; the dispatcher (Plan 01.06)
 * maps each enum value to a STATIC SQL function in
 * `packages/server/src/query/metrics/<metric>.ts` — no string concatenation.
 */
export const MetricName = z.enum(['cost_by_agent', 'agent_session_count']);
export type MetricName = z.infer<typeof MetricName>;

/**
 * P1 query API dimensions. (API-05)
 *
 * `repo` and `model_tier` are deferred to P2 once GitHub + vendor enrichment
 * land (CONTEXT.md `<deferred>`). Same closed-enum guarantee as MetricName.
 */
export const DimensionName = z.enum(['agent', 'team', 'cycle']);
export type DimensionName = z.infer<typeof DimensionName>;

export const FilterOp = z.enum(['eq', 'in', 'neq']);
export type FilterOp = z.infer<typeof FilterOp>;

export const FilterField = z.enum(['agent_id', 'team_id', 'cycle_id']);
export type FilterField = z.infer<typeof FilterField>;

export const Filter = z.object({
  field: FilterField,
  op: FilterOp,
  value: z.union([z.string(), z.array(z.string())]),
});
export type Filter = z.infer<typeof Filter>;

/**
 * Query window: either relative ("last: 14d" / "last: 168h") or absolute
 * (from/to ISO timestamps). Required on every query (API-01) — bounded
 * windows are the only way to keep p95 < 1s on a 100k-session workspace.
 */
export const Window = z
  .object({
    last: z
      .string()
      .regex(/^\d+(d|h)$/)
      .optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .refine((w) => Boolean(w.last) || (Boolean(w.from) && Boolean(w.to)), {
    message: 'window must specify either `last` or both `from` and `to`',
  });
export type Window = z.infer<typeof Window>;

/**
 * Query API request body. The dispatcher (Plan 01.06) calls
 * `QueryRequest.parse(req.body)` and routes by `metric` enum value.
 */
export const QueryRequest = z.object({
  metric: MetricName,
  dimension: DimensionName.optional(),
  filters: z.array(Filter).optional(),
  window: Window,
});
export type QueryRequest = z.infer<typeof QueryRequest>;

/**
 * Query API response envelope.
 *
 * Each `row.key` is the dimension value (agent name, team key, cycle name)
 * or `'all'` if no dimension was requested. `bucket_at` is set on
 * time-series shapes (e.g., the cost-over-time stacked bar in the dashboard).
 */
export const QueryRow = z.object({
  key: z.string(),
  value: z.number(),
  count: z.number().optional(),
  bucket_at: z.string().datetime().optional(),
});
export type QueryRow = z.infer<typeof QueryRow>;

export const QueryResponse = z.object({
  metric: MetricName,
  dimension: DimensionName.optional(),
  window: Window,
  rows: z.array(QueryRow),
});
export type QueryResponse = z.infer<typeof QueryResponse>;
