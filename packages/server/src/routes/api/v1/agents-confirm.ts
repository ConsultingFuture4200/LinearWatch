import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * `POST /api/v1/agents/:id/confirm` — DASH-04 / ID-04 dashboard half.
 *
 * The confirmation UI is a side panel on the cost dashboard (D-17). When a
 * user clicks "Confirm this agent" next to an unconfirmed row, the dashboard
 * calls this endpoint with the `linear_app_user_id` that was surfaced as a
 * candidate signal.
 *
 * Effect:
 *   UPDATE identity_mappings
 *      SET state = 'CONFIRMED', confirmed_at = now(), agent_id = :id
 *    WHERE workspace_id      = req.workspaceId
 *      AND linear_app_user_id = :linear_app_user_id
 *      AND state              = 'PENDING_CONFIRMATION'
 *
 * The state predicate is the load-bearing safeguard (T-07-07): an
 * already-CONFIRMED row is never flipped back, regardless of which
 * agent the caller passes in. The endpoint reports `confirmed_count` so
 * the dashboard can show a no-op when the operation matched zero rows
 * (already confirmed, or wrong linear_app_user_id).
 *
 * 404 semantics: a missing or soft-deleted agent rejects with 404. The
 * dashboard should never reach this state (the side panel only opens for
 * agents the user can see), but a stale tab + DELETE race is defensible.
 */
const ConfirmBody = z.object({ linear_app_user_id: z.string().min(1) });

export default async function agentsConfirmRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/api/v1/agents/:id/confirm',
    { preHandler: fastify.authBearer },
    async (req, reply) => {
      const params = req.params as { id: string };
      const parsed = ConfirmBody.safeParse(req.body); // allow-req-body: Zod-validated parse boundary
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_request', details: parsed.error.format() };
      }
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const agentRow = await fastify.db.execute(sql`
        SELECT id FROM agents
         WHERE id = ${params.id}
           AND workspace_id = ${wsId}
           AND deleted_at IS NULL
      `);
      if (agentRow.rows.length === 0) {
        reply.code(404);
        return { error: 'agent_not_found' };
      }

      const r = await fastify.db.execute(sql`
        UPDATE identity_mappings
           SET state = 'CONFIRMED',
               confirmed_at = now(),
               agent_id = ${params.id}
         WHERE workspace_id = ${wsId}
           AND linear_app_user_id = ${parsed.data.linear_app_user_id}
           AND state = 'PENDING_CONFIRMATION'
        RETURNING id
      `);
      return { ok: true, confirmed_count: r.rows.length };
    },
  );
}
