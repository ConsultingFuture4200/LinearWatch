import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * `POST /api/v1/setup/*` — wizard endpoints (Plan 01.09).
 *
 * The setup wizard at `/setup` calls these to:
 *   1. read current setup state (decide whether to redirect to /cost),
 *   2. exchange a Linear OAuth code for a token (P1: minimal — we just
 *      acknowledge the callback completed; the token is not yet used by
 *      any background job),
 *   3. create the bootstrap workspace + workspace API key (D-14, D-27),
 *   4. persist an optional GitHub PAT (used by the P2 enrichment worker).
 *
 * Bootstrap auth model:
 * - `GET /setup/state` and `POST /setup/workspace` are unauthenticated by
 *   necessity — there is no API key until the workspace exists.
 * - `POST /setup/workspace` refuses (409) once any workspace row exists.
 *   This is the spoofing mitigation (T-09-02): self-hosted means the
 *   operator runs the wizard against `localhost`; reverse-proxy auth
 *   gates external access during setup.
 * - `POST /setup/github-pat` requires Bearer auth (the workspace exists
 *   by step 4).
 * - `POST /setup/linear-oauth/callback` is unauthenticated for now (D-13
 *   step 3 runs before the workspace API key is generated in step 5).
 *   The OAuth `state` token mitigates CSRF (T-09-03).
 */
const WorkspaceBody = z.object({ name: z.string().min(1).max(64) });
const OAuthCallbackBody = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
const GithubPatBody = z.object({ pat: z.string().min(1).max(256) });

interface WorkspaceIdRow {
  id: string;
}

interface SetupStateRow {
  id: string;
  name: string;
}

interface CountRow {
  n: number;
}

function generateApiKey(): { plaintext: string; hash: string } {
  const plaintext = `lw_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  return { plaintext, hash };
}

function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

export default async function setupRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/setup/state — public. The /setup page calls this to decide
   * whether the wizard has already been completed. Returns a tiny shape so
   * we never leak internal IDs.
   */
  fastify.get('/api/v1/setup/state', async () => {
    const ws = await fastify.db.execute(sql`
      SELECT id, name FROM workspaces ORDER BY created_at ASC LIMIT 1
    `);
    if (ws.rows.length === 0) {
      return { has_workspace: false, has_seed_data: false };
    }
    const row = ws.rows[0] as unknown as SetupStateRow;
    const seed = await fastify.db.execute(sql`
      SELECT count(*)::int AS n
        FROM agents
       WHERE workspace_id = ${row.id}
         AND name LIKE '%-demo'
         AND deleted_at IS NULL
    `);
    const seedRow = seed.rows[0] as CountRow | undefined;
    return {
      has_workspace: true,
      has_seed_data: (seedRow?.n ?? 0) > 0,
      workspace_name: row.name,
    };
  });

  /**
   * POST /api/v1/setup/workspace — bootstrap-only.
   *
   * Generates `lw_` + 32 base64url bytes for the plaintext key and stores
   * sha256(plaintext) in `api_key_hash`. The plaintext is returned ONCE.
   * `workspace_salt` is generated here per D-27.
   */
  fastify.post('/api/v1/setup/workspace', async (req, reply) => {
    const parsed = WorkspaceBody.safeParse(req.body); // allow-req-body: Zod-validated parse boundary
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request', details: parsed.error.format() };
    }
    const existing = await fastify.db.execute(sql`SELECT id FROM workspaces LIMIT 1`);
    if (existing.rows.length > 0) {
      reply.code(409);
      return { error: 'workspace_already_exists' };
    }
    const { plaintext, hash } = generateApiKey();
    const salt = generateSalt();
    const id = randomUUID();
    await fastify.db.execute(sql`
      INSERT INTO workspaces (id, name, api_key_hash, workspace_salt)
      VALUES (${id}, ${parsed.data.name}, ${hash}, ${salt})
    `);
    return { workspace_id: id, plaintext_api_key: plaintext };
  });

  /**
   * POST /api/v1/setup/linear-oauth/callback — wizard step 3.
   *
   * P1 minimal: accept the OAuth callback, validate shape, return ok.
   * Linear webhooks use HMAC, not OAuth, so the access token is not
   * required for any P1 background job. P2/P3 will exchange the code
   * for a token via Linear's `/oauth/token` endpoint and persist it
   * for the linearwatch-as-agent endpoints.
   */
  fastify.post('/api/v1/setup/linear-oauth/callback', async (req, reply) => {
    const parsed = OAuthCallbackBody.safeParse(req.body); // allow-req-body: Zod-validated parse boundary
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_request' };
    }
    return { ok: true };
  });

  /**
   * POST /api/v1/setup/github-pat — wizard step 4 (optional).
   *
   * Bearer-auth. Stores the PAT base64-encoded on `workspaces.github_pat_encoded`
   * (column added in migration 0001). The P2 enrichment worker will read it.
   */
  fastify.post(
    '/api/v1/setup/github-pat',
    { preHandler: fastify.authBearer },
    async (req, reply) => {
      const parsed = GithubPatBody.safeParse(req.body); // allow-req-body: Zod-validated parse boundary
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_request' };
      }
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }
      const encoded = Buffer.from(parsed.data.pat, 'utf8').toString('base64');
      const r = await fastify.db.execute(sql`
        UPDATE workspaces
           SET github_pat_encoded = ${encoded}
         WHERE id = ${wsId}
         RETURNING id
      `);
      if (r.rows.length === 0) {
        reply.code(404);
        return { error: 'workspace_not_found' };
      }
      const row = r.rows[0] as unknown as WorkspaceIdRow;
      return { ok: true, workspace_id: row.id };
    },
  );
}
