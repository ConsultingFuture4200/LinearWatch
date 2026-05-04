import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { eventsReceived, webhookAckSeconds } from '../../plugins/metrics.js';
import { logWebhookReceipt } from '../../plugins/request-logger.js';

/**
 * Linear webhook receiver — Phase 1, Plan 05.
 *
 * D-04 (Pitfall 2): handler does exactly four things synchronously:
 *   1. Validate Linear-Delivery (400 on missing/malformed — D-09)
 *   2. HMAC verify against LINEAR_WEBHOOK_SECRET (401 on failure)
 *   3. INSERT ... ON CONFLICT DO NOTHING into events.raw_event using
 *      req.rawBody bytes cast to jsonb in SQL via ($N::text)::jsonb
 *      (so the hashed bytes and the stored bytes are byte-identical)
 *   4. Enqueue Graphile Worker resolve_identity job (only on new insert)
 * Returns 200. NO DB joins, vendor calls, or resolver runs here.
 *
 * D-20: webhooks are HMAC-authenticated, NOT Bearer-authenticated.
 * OBS-04: this file MUST NOT reference the parsed body — only req.rawBody.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface InsertResultRow {
  id: string;
  is_new: boolean;
}

interface WorkspaceRow {
  id: string;
}

let workspaceIdCache: string | null = null;

async function getOrCacheWorkspaceId(fastify: FastifyInstance): Promise<string | null> {
  if (workspaceIdCache) return workspaceIdCache;
  const r = await fastify.db.execute(sql`SELECT id FROM workspaces LIMIT 1`);
  const rows = r.rows as unknown as WorkspaceRow[];
  const id = rows[0]?.id ?? null;
  workspaceIdCache = id;
  return id;
}

/** Test-only hook: reset module-level cache so each integration test sees a fresh lookup. */
export function __resetWorkspaceIdCacheForTests(): void {
  workspaceIdCache = null;
}

export default async function linearWebhookRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post('/webhooks/linear', async (req, reply) => {
    logWebhookReceipt(req, reply, 'linear');
    const stop = webhookAckSeconds.startTimer({ source: 'linear' });
    try {
      // === 1. Linear-Delivery validation (D-09) ===
      const deliveryRaw = req.headers['linear-delivery'];
      const deliveryId =
        typeof deliveryRaw === 'string'
          ? deliveryRaw
          : Array.isArray(deliveryRaw)
            ? deliveryRaw[0]
            : undefined;
      if (!deliveryId || !UUID_RE.test(deliveryId)) {
        reply.code(400);
        return { error: 'missing_or_invalid_linear_delivery' };
      }

      // === 2. HMAC verify (INGEST-01) ===
      const sigRaw = req.headers['linear-signature'];
      const signature =
        typeof sigRaw === 'string' ? sigRaw : Array.isArray(sigRaw) ? sigRaw[0] : undefined;
      if (!signature || !req.rawBody) {
        reply.code(401);
        return { error: 'missing_signature' };
      }
      // Linear's signature is hex(HMAC-SHA256(secret, rawBody)).
      const expected = createHmac('sha256', fastify.env.LINEAR_WEBHOOK_SECRET)
        .update(req.rawBody)
        .digest('hex');
      let valid = false;
      try {
        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expected, 'hex');
        if (sigBuf.length === expBuf.length) {
          valid = timingSafeEqual(sigBuf, expBuf);
        }
      } catch {
        valid = false;
      }
      if (!valid) {
        reply.code(401);
        return { error: 'invalid_signature' };
      }

      // === 3. INSERT idempotently (INGEST-05, Pitfall 1, D-08) ===
      // The raw bytes (UTF-8 string of req.rawBody) are bound as a TEXT
      // parameter and cast to jsonb inside SQL — guarantees byte-identity
      // between hashed and stored payload.
      //
      // Idempotency contract: two requests carrying the same `Linear-Delivery`
      // produce exactly one stored row regardless of how many replays arrive.
      // The partitioned `events.raw_event` constraint includes `received_at`
      // (Postgres requires partition keys in unique indexes), so a plain
      // `ON CONFLICT (source, upstream_id, received_at)` never fires for
      // replays whose `received_at = now()` is each different.
      //
      // The CTE below performs an atomic check-and-insert:
      //   - `existing` looks up any prior row with the same (source, upstream_id)
      //   - the INSERT fires only when `existing` is empty
      //   - the final SELECT returns the existing or newly-inserted id, plus a
      //     boolean flag the handler uses to gate the resolver enqueue.
      //
      // The `ON CONFLICT (source, upstream_id, received_at) DO NOTHING` on the
      // INSERT is defense-in-depth: under tight concurrency two requests could
      // both pass `NOT EXISTS`, but if their `received_at` collides at
      // microsecond precision the constraint catches it. The `(xmax = 0)`
      // trick is unavailable on partitioned tables ("cannot retrieve a system
      // column in this context"), so the CTE returns `is_new` explicitly.
      const rawBodyText = req.rawBody.toString('utf8');
      const result = await fastify.db.execute(sql`
        WITH existing AS (
          SELECT id
          FROM events.raw_event
          WHERE source = 'linear' AND upstream_id = ${deliveryId}
          ORDER BY received_at DESC
          LIMIT 1
        ), inserted AS (
          INSERT INTO events.raw_event (source, upstream_id, payload, signature_valid)
          SELECT 'linear', ${deliveryId}, (${rawBodyText}::text)::jsonb, true
          WHERE NOT EXISTS (SELECT 1 FROM existing)
          ON CONFLICT (source, upstream_id, received_at) DO NOTHING
          RETURNING id
        )
        SELECT id, true AS is_new FROM inserted
        UNION ALL
        SELECT id, false AS is_new FROM existing
        LIMIT 1
      `);
      const rows = result.rows as unknown as InsertResultRow[];
      const row = rows[0];
      const isNewInsert = row?.is_new === true;
      eventsReceived.inc({ source: 'linear' });

      // === 4. Enqueue resolver job ONLY on new inserts ===
      if (isNewInsert && row) {
        const ws = await getOrCacheWorkspaceId(fastify);
        if (ws) {
          const payload = JSON.stringify({
            raw_event_id: row.id,
            workspace_id: ws,
          });
          // graphile_worker.add_job(identifier text, payload json) — note
          // `json` (NOT jsonb): Graphile Worker's installed signature is
          // `(text, json)`. The string literal carries an explicit ::text cast
          // so Postgres can resolve the overload without an `unknown`-typed
          // first argument.
          await fastify.db.execute(sql`
            SELECT graphile_worker.add_job('resolve_identity'::text, ${payload}::json)
          `);
        }
      }

      // === 5. Always 200 (Pitfall 1: never let Linear retry once we've durably stored or de-duped) ===
      reply.code(200);
      return { ok: true };
    } finally {
      stop();
    }
  });
}
