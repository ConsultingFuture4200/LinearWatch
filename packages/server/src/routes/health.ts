import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ServerDb } from '../db.js';

/**
 * Health route.
 *
 * - 200 `{status:'ok'}` when the DB pool answers `SELECT 1` within the
 *   handler timeout. The migrations-on-startup gate has already proven
 *   schema reachability before the server bound the listener; this check
 *   covers the case where the pool drops mid-flight (e.g., Postgres
 *   restart behind the server).
 * - 503 `{status:'degraded', error:'db_unreachable'}` otherwise.
 *
 * Compose smoke test (`scripts/smoke-compose.sh`) hits this on :8080.
 */
interface HealthRoutesOptions {
  db: ServerDb;
}

export default async function healthRoutes(
  fastify: FastifyInstance,
  opts: HealthRoutesOptions,
): Promise<void> {
  fastify.get('/health', async (_req, reply) => {
    try {
      await opts.db.execute(sql`SELECT 1`);
      return { status: 'ok' };
    } catch {
      reply.code(503);
      return { status: 'degraded', error: 'db_unreachable' };
    }
  });
}
