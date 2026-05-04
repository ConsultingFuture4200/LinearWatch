import { createHash } from 'node:crypto';
import { SdkEventBody } from '@agentwatch/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { eventsReceived, webhookAckSeconds } from '../../../plugins/metrics.js';
import { logWebhookReceipt } from '../../../plugins/request-logger.js';

/**
 * `POST /api/v1/sdk/event` — INGEST-03 (D-10, D-19).
 *
 * Bearer-authenticated SDK ingestion endpoint. Accepts the three event
 * types defined by `SdkEventBody`: `session_start`, `session_end`,
 * `cost_recorded` (Plan 01.03). The published Node + Python SDK packages
 * arrive in P2; the endpoint exists in P1 so early adopters posting raw
 * HTTP can validate the contract end-to-end.
 *
 * Idempotency (D-10):
 * - Caller MAY supply `idempotency_key` in the body.
 * - Otherwise the server synthesizes
 *   `sha256(workspace_id|session_id|event_type|minute_bucket(occurred_at))`.
 * - The same key on a second request is a no-op via the CTE check-and-insert
 *   pattern (mirrors the Linear webhook handler in Plan 01.05).
 *
 * Notes:
 * - We reuse `webhookAckSeconds` and `eventsReceived` with `source='sdk'`
 *   so the SDK path shares the same observability surface as the webhook
 *   path; the histogram bucket is the same 200ms p99 SLA target.
 * - `req.workspaceId` is set by `authBearer`. The synthesized key includes
 *   it so two workspaces sending the same `session_id` never collide.
 */
export default async function sdkEventRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post('/api/v1/sdk/event', { preHandler: fastify.authBearer }, async (req, reply) => {
    logWebhookReceipt(req, reply, 'sdk');
    const stop = webhookAckSeconds.startTimer({ source: 'sdk' });
    try {
      const parsed = SdkEventBody.safeParse(req.body); // allow-req-body: Zod-validated parse boundary; discriminated union closes the input set
      if (!parsed.success) {
        reply.code(400);
        return { error: 'invalid_event', details: parsed.error.format() };
      }
      const ev = parsed.data;
      const wsId = req.workspaceId;
      if (!wsId) {
        reply.code(401);
        return { error: 'unauthorized' };
      }

      const idempotencyKey =
        ev.idempotency_key ?? synthesizeKey(wsId, ev.session_id, ev.event_type, ev.occurred_at);

      // Idempotent INSERT — same CTE pattern as the Linear webhook handler.
      // The unique constraint `(source, upstream_id, received_at)` requires
      // received_at as part of the index (Postgres partition rule), so a
      // plain ON CONFLICT only catches microsecond-collision replays.
      // The CTE's `NOT EXISTS` is the load-bearing dedup; ON CONFLICT is
      // defense-in-depth against tight concurrency races.
      const payloadJson = JSON.stringify(ev);
      await fastify.db.execute(sql`
          WITH existing AS (
            SELECT id
              FROM events.raw_event
             WHERE source = 'sdk' AND upstream_id = ${idempotencyKey}
             ORDER BY received_at DESC
             LIMIT 1
          ), inserted AS (
            INSERT INTO events.raw_event (source, upstream_id, payload, signature_valid)
            SELECT 'sdk', ${idempotencyKey}, (${payloadJson}::text)::jsonb, true
             WHERE NOT EXISTS (SELECT 1 FROM existing)
            ON CONFLICT (source, upstream_id, received_at) DO NOTHING
            RETURNING id
          )
          SELECT id FROM inserted
          UNION ALL
          SELECT id FROM existing
          LIMIT 1
        `);
      eventsReceived.inc({ source: 'sdk' });
      return { ok: true, idempotency_key: idempotencyKey };
    } finally {
      stop();
    }
  });
}

/**
 * Synthesize an idempotency key when the caller didn't supply one.
 *
 * The `minute_bucket` truncates the ISO timestamp to YYYY-MM-DDTHH:MM, so
 * two events for the same session+event_type within the same minute collapse
 * to one row. Tighter resolution would let clock skew across SDK retries
 * produce duplicates; looser resolution would dedupe legitimate distinct
 * events. One minute matches Linear's webhook delivery jitter.
 */
function synthesizeKey(
  workspaceId: string,
  sessionId: string,
  eventType: string,
  occurredAt: string,
): string {
  const minuteBucket = new Date(occurredAt).toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
  return createHash('sha256')
    .update(`${workspaceId}|${sessionId}|${eventType}|${minuteBucket}`)
    .digest('hex');
}
