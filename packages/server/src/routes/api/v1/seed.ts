import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { clearSyntheticData, insertSyntheticData } from '../../../seed/synthetic.js';

/**
 * `POST /api/v1/seed` (D-07 / SETUP-04) — seed synthetic data.
 * `POST /api/v1/admin/clear-seed` — remove every demo row.
 *
 * Both Bearer-protected via the existing `authBearer` plugin. The wizard's
 * "Try with synthetic data" CTA POSTs to /seed; the future P2 CLI command
 * `linearwatch admin clear-seed` POSTs to /admin/clear-seed.
 *
 * The `seed` endpoint is idempotent: if the workspace already has *-demo
 * agents, it returns `{ inserted: 0 }` without touching the database.
 */
interface WorkspaceRow {
  id: string;
  workspace_salt: string;
}

export default async function seedRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/v1/seed', { preHandler: fastify.authBearer }, async (req, reply) => {
    const wsId = req.workspaceId;
    if (!wsId) {
      reply.code(401);
      return { error: 'unauthorized' };
    }
    const ws = await fastify.db.execute(sql`
      SELECT id, workspace_salt FROM workspaces WHERE id = ${wsId} LIMIT 1
    `);
    const row = ws.rows[0] as WorkspaceRow | undefined;
    if (!row) {
      reply.code(404);
      return { error: 'workspace_not_found' };
    }
    const result = await insertSyntheticData(fastify.db, row.id, row.workspace_salt);
    return result;
  });

  fastify.post(
    '/api/v1/admin/clear-seed',
    { preHandler: fastify.authBearer },
    async (req, reply) => {
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const result = await clearSyntheticData(fastify.db, wsId);
      return result;
    },
  );
}
