import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

/**
 * Workspace state endpoints used by the dashboard layout (Plan 01.08).
 *
 * Both routes are Bearer-authenticated via `fastify.authBearer` (Plan 01.04).
 * They are read-only and exist purely to drive top-of-page banners on the
 * cost dashboard:
 *
 *   GET /api/v1/workspace/warnings — D-18 detect_shared_app banner data
 *   GET /api/v1/workspace/seed-status — D-07 synthetic-data banner data
 *
 * `seed-status` checks for any `agents.name LIKE '%-demo'` row scoped to the
 * workspace — the simplest signal per the plan's note. The dashboard banner
 * does not need a count, only a boolean.
 */
interface WarningRow {
  id: string;
  severity: string;
  message: string;
}

interface SeedRow {
  has_seed: boolean;
}

export default async function workspaceRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/v1/workspace/warnings',
    { preHandler: fastify.authBearer },
    async (req, reply) => {
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const r = await fastify.db.execute(sql`
        SELECT id, severity, message
          FROM workspace_warnings
         WHERE workspace_id = ${wsId}
           AND dismissed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 50
      `);
      return { warnings: r.rows as unknown as WarningRow[] };
    },
  );

  fastify.get(
    '/api/v1/workspace/seed-status',
    { preHandler: fastify.authBearer },
    async (req, reply) => {
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const r = await fastify.db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM agents
           WHERE workspace_id = ${wsId}
             AND name LIKE '%-demo'
             AND deleted_at IS NULL
        ) AS has_seed
      `);
      const row = r.rows[0] as SeedRow | undefined;
      return { has_seed: Boolean(row?.has_seed) };
    },
  );
}
