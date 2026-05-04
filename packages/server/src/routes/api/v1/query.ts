import { QueryRequest } from '@agentwatch/shared';
import type { FastifyInstance } from 'fastify';
import { dispatchQuery } from '../../../query/dispatcher.js';

/**
 * `POST /api/v1/query` — constrained query API (API-01..API-08).
 *
 * Bearer-authenticated (API-06) via the shared `authBearer` plugin from
 * Plan 01.04. Body is parsed via `QueryRequest.safeParse` — closed Zod enums
 * (`MetricName`, `DimensionName`, `FilterField`, `FilterOp`) reject any
 * value outside the documented set BEFORE the dispatcher runs (T-07-01).
 *
 * `req.workspaceId` is set by `authBearer` and is the only source of the
 * `workspace_id` parameter bound into every metric SQL function. Each
 * metric file lives at `src/query/metrics/<metric>.ts` and is a STATIC SQL
 * function — adding a metric requires touching `dispatcher.ts` AND a new
 * metric file (API-03).
 */
export default async function queryRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/v1/query', { preHandler: fastify.authBearer }, async (req, reply) => {
    const parsed = QueryRequest.safeParse(req.body); // allow-req-body: Zod-validated parse boundary; closed enums gate SQL dispatch
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.format() };
    }
    const wsId = req.workspaceId;
    if (!wsId) {
      // authBearer should have set this; defensive 401.
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const rows = await dispatchQuery(parsed.data, { workspaceId: wsId, db: fastify.db });
    return {
      metric: parsed.data.metric,
      dimension: parsed.data.dimension,
      window: parsed.data.window,
      rows,
    };
  });
}
