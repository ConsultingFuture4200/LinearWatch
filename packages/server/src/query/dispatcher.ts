import type { MetricName, QueryRequest, QueryRow } from '@agentwatch/shared';
import type { ServerDb } from '../db.js';
import { agentSessionCount } from './metrics/agent-session-count.js';
import { costByAgent } from './metrics/cost-by-agent.js';

/**
 * SqlFn — every metric is a STATIC function with this exact signature
 * (API-03). Adding a metric is a one-line change to the `handlers` map below
 * AND a new file under `src/query/metrics/`.
 */
type SqlFn = (req: QueryRequest, ctx: { workspaceId: string; db: ServerDb }) => Promise<QueryRow[]>;

/**
 * Static metric → SQL function map.
 *
 * `Record<MetricName, SqlFn>` is the load-bearing type: the TypeScript
 * compiler refuses to compile if a `MetricName` enum value is missing here,
 * and `MetricName` is a CLOSED Zod enum so unknown values are rejected at
 * the route layer (Plan 01.07's `query.ts`) by `QueryRequest.safeParse(...)`
 * BEFORE the dispatcher runs. There is no path from a user-supplied string
 * to dynamic SQL.
 */
const handlers: Record<MetricName, SqlFn> = {
  cost_by_agent: costByAgent,
  agent_session_count: agentSessionCount,
};

export async function dispatchQuery(
  req: QueryRequest,
  ctx: { workspaceId: string; db: ServerDb },
): Promise<QueryRow[]> {
  const fn = handlers[req.metric];
  // Unreachable when the route handler validates req.body via QueryRequest
  // first — but defense in depth.
  if (!fn) throw new Error('unknown_metric');
  return fn(req, ctx);
}
