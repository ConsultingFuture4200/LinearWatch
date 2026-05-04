import { createHash, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ServerDb } from '../db.js';

/**
 * Bearer-token auth (RESEARCH Pattern 5 / API-06).
 *
 * - Header MUST be `Authorization: Bearer <plaintext-key>`.
 * - We sha256 the presented key and compare in constant time against the
 *   stored hash on `workspaces.api_key_hash`.
 * - P1 is single-tenant: one workspaces row, one key. The plaintext key is
 *   shown once at setup wizard time (D-14) and stored hashed only.
 * - On success, `req.workspaceId` is set so downstream handlers can scope
 *   queries without re-fetching the workspace row.
 */
declare module 'fastify' {
  interface FastifyRequest {
    workspaceId?: string;
  }
  interface FastifyInstance {
    authBearer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

interface AuthPluginOptions {
  db: ServerDb;
}

interface WorkspaceRow {
  id: string;
  api_key_hash: string;
}

export default fp<AuthPluginOptions>(async (fastify, opts) => {
  fastify.decorate('authBearer', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const presented = auth.slice('Bearer '.length).trim();
    if (presented.length === 0) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const presentedHash = createHash('sha256').update(presented).digest();

    const r = await opts.db.execute(sql`
      SELECT id, api_key_hash FROM workspaces LIMIT 1
    `);
    const ws = r.rows[0] as WorkspaceRow | undefined;
    if (!ws) {
      return reply.code(401).send({ error: 'no_workspace' });
    }
    const stored = Buffer.from(ws.api_key_hash, 'hex');
    // Constant-time compare; length precheck prevents the side channel from
    // mismatched-length comparisons.
    if (presentedHash.length !== stored.length || !timingSafeEqual(presentedHash, stored)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    req.workspaceId = ws.id;
  });
});
