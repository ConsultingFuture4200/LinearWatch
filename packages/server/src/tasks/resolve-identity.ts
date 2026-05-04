import type { Task } from 'graphile-worker';
import { resolverConfidenceHistogram } from '../plugins/metrics.js';

/**
 * D-15 / D-16 / ID-01..ID-03 / ID-06 — `resolve_identity` Graphile Worker task.
 *
 * Triggered by the Linear webhook handler (plan 01.05) after the raw INSERT.
 *
 * Idempotency (D-15): the UNIQUE (workspace_id, raw_event_id) constraint plus
 * `ON CONFLICT (workspace_id, raw_event_id) DO NOTHING` makes re-running the
 * job on the same raw event a safe no-op. This is what enables the
 * "replay-from-raw" capability: a future bug fix can re-enqueue the same
 * raw_event_ids without producing duplicate identity_mappings rows.
 *
 * Confidence formula (D-16, P1 only):
 *   confidence = 0.5 * has_linear_app_user_id  (binary 0 or 1)
 *
 * GitHub and vendor signals contribute 0 in P1 (those signals don't exist yet
 * — INGEST-02/07/08 land in P2). Therefore every P1 row with a
 * `linear_app_user_id` lands at confidence 0.5, which is below the default
 * IDENTITY_CONFIDENCE_THRESHOLD of 0.8 (ID-06). The dashboard's confirm UI
 * (D-17, plan 01.09) is the unblocker until P2 cross-source signals lift
 * confidence above the threshold.
 *
 * State machine:
 *   no actor.id        → NEW_AGENT (confidence 0)
 *   actor.id present + confidence < threshold → PENDING_CONFIRMATION
 *   actor.id present + confidence >= threshold → AUTO_PROMOTED
 *   (CONFIRMED is set by the human-confirm endpoint in plan 01.09, not here.)
 *
 * Observability: every run observes resolverConfidenceHistogram so the
 * /metrics endpoint surfaces the confidence distribution (D-30).
 */
type Payload = {
  raw_event_id: string | number;
  workspace_id: string;
};

type State = 'NEW_AGENT' | 'PENDING_CONFIRMATION' | 'AUTO_PROMOTED' | 'CONFIRMED';

type RawEventRow = { payload: unknown };

/**
 * Inspect a Linear payload for a stable agent identifier.
 *
 * Linear's AgentSession events expose this in `actor.id`. We also tolerate
 * `actor.linearAppUserId` because Linear's GraphQL API has historically used
 * that name in some surfaces — checking both keeps us robust against minor
 * webhook payload schema drift without falsely lifting confidence.
 */
function extractLinearAppUserId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const actor = (payload as { actor?: unknown }).actor;
  if (!actor || typeof actor !== 'object') return null;
  const a = actor as { id?: unknown; linearAppUserId?: unknown };
  if (typeof a.id === 'string' && a.id.length > 0) return a.id;
  if (typeof a.linearAppUserId === 'string' && a.linearAppUserId.length > 0) {
    return a.linearAppUserId;
  }
  return null;
}

export const resolveIdentity: Task = async (rawPayload, helpers) => {
  const payload = rawPayload as Payload;
  const threshold = Number.parseFloat(process.env.IDENTITY_CONFIDENCE_THRESHOLD ?? '0.8');

  await helpers.withPgClient(async (pg) => {
    // 1. Load the raw event by id.
    //
    // Note: events.raw_event is partitioned on received_at. The PRIMARY KEY
    // (id, received_at) means an `id`-only lookup scans every partition; the
    // partitions are small (one month each, retention is 30 days), so this
    // is acceptable in P1. If the row is missing — e.g. the partition rotated
    // mid-job between enqueue and run — return cleanly (don't fail the job).
    const ev = await pg.query<RawEventRow>(
      'SELECT payload FROM events.raw_event WHERE id = $1 LIMIT 1',
      [payload.raw_event_id],
    );
    if (ev.rows.length === 0) {
      helpers.logger.warn('resolve_identity: raw_event missing (likely partition rotated)', {
        raw_event_id: payload.raw_event_id,
        workspace_id: payload.workspace_id,
      });
      return;
    }

    const firstRow = ev.rows[0];
    if (!firstRow) return;
    const rawJson = firstRow.payload;
    const linearAppUserId = extractLinearAppUserId(rawJson);

    // 2. D-16 P1 confidence formula.
    const hasLinear = linearAppUserId ? 1 : 0;
    const confidence = 0.5 * hasLinear;
    const signalWeights = { linear: 0.5, github: 0, vendor: 0 };

    let state: State;
    if (hasLinear === 1) {
      state = confidence >= threshold ? 'AUTO_PROMOTED' : 'PENDING_CONFIRMATION';
    } else {
      state = 'NEW_AGENT';
    }

    // 3. Idempotent INSERT.
    //
    // The UNIQUE (workspace_id, raw_event_id) constraint guarantees only the
    // first runner produces a row; re-runs hit ON CONFLICT DO NOTHING. We
    // intentionally do NOT update existing rows: the resolver is the source
    // of P1 confidence, and human confirmation (plan 01.09) writes the row
    // through a different code path. Updating from this task would race with
    // the dashboard's confirm action.
    await pg.query(
      `INSERT INTO identity_mappings
          (workspace_id, raw_event_id, linear_app_user_id, confidence, signal_weights, state)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (workspace_id, raw_event_id) DO NOTHING`,
      [
        payload.workspace_id,
        payload.raw_event_id,
        linearAppUserId,
        confidence,
        JSON.stringify(signalWeights),
        state,
      ],
    );

    // 4. Observe confidence for /metrics (D-30 identity_resolver_confidence).
    resolverConfidenceHistogram.observe(confidence);

    helpers.logger.info('resolve_identity: completed', {
      workspace_id: payload.workspace_id,
      raw_event_id: payload.raw_event_id,
      linear_app_user_id: linearAppUserId,
      confidence,
      state,
    });
  });
};
