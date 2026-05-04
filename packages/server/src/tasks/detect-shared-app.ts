import type { Task } from 'graphile-worker';

/**
 * D-18 + Pitfall 6 — `detect_shared_app` heuristic.
 *
 * Pitfall 6 in full: a self-hoster who registers a single Linear OAuth app
 * and uses the same `linear_app_user_id` for two different agent integrations
 * (e.g. one Cursor and one Devin both authenticated as the same Linear app)
 * would silently merge metrics for both vendors. The dashboard would show one
 * agent doing impossible parallel work. The data corruption is permanent —
 * raw events have one identifier, no way to demerge after the fact.
 *
 * Mitigation strategy: surface a workspace-level WARNING the moment we see
 * evidence of this misconfiguration, so the operator can split the OAuth app
 * before too much data lands under the merged identity.
 *
 * P1 heuristic (D-18, research-flagged): inspect `events.raw_event` payloads
 * from the last 24h. For each Linear app user id, count distinct vendor
 * "contexts" approximated by `agentSession.sessionId` substring patterns:
 *
 *   /^cursor-/i  → 'cursor'
 *   /^devin-/i   → 'devin'
 *   /^codex-/i   → 'codex'
 *   default       → 'internal'
 *
 * If one `linear_app_user_id` shows ≥2 distinct vendor contexts within the
 * 24h rolling window, write a WARNING row to `workspace_warnings`. The
 * dashboard banner (P1) and the side panel (D-17) surface it.
 *
 * P2 sharpens this heuristic with real vendor signals from the enrichment
 * workers; this P1 implementation is intentionally simple and over-flags
 * rather than under-flags (false positives are a banner the operator can
 * dismiss; false negatives are silent data corruption).
 *
 * Idempotency: at most ONE active warning per (workspace_id,
 * linear_app_user_id) within the rolling 24h window. We achieve this by
 * checking for an existing non-dismissed warning whose message contains the
 * Linear app user id within the last 24h before inserting a new one. This
 * is a substring check rather than a separate index column because the
 * P1 schema for `workspace_warnings` (0000_init.sql section 5) was
 * intentionally minimal; the next iteration of this heuristic in P2 will add
 * a structured `subject` column.
 */
export const detectSharedApp: Task = async (_payload, helpers) => {
  await helpers.withPgClient(async (pg) => {
    // 1. Find candidates: linear_app_user_ids with ≥2 vendor contexts in 24h.
    //
    // The CROSS JOIN with workspaces is correct for P1's single-tenant
    // constraint (one workspace per Postgres instance — see PROJECT.md
    // "single-tenant in v0"). When P2 relaxes single-tenancy, the raw event
    // payload will need a workspace correlation — for now there is exactly
    // one workspace row, and every raw event belongs to it.
    const candidates = await pg.query<{
      workspace_id: string;
      linear_app_user_id: string;
      vendor_contexts: string[];
    }>(`
      WITH recent AS (
        SELECT
          w.id AS workspace_id,
          raw.payload->'actor'->>'id' AS linear_app_user_id,
          CASE
            WHEN raw.payload->'agentSession'->>'sessionId' ~* '^cursor-' THEN 'cursor'
            WHEN raw.payload->'agentSession'->>'sessionId' ~* '^devin-'  THEN 'devin'
            WHEN raw.payload->'agentSession'->>'sessionId' ~* '^codex-'  THEN 'codex'
            ELSE 'internal'
          END AS vendor_context
        FROM events.raw_event raw
        CROSS JOIN workspaces w
        WHERE raw.source = 'linear'
          AND raw.received_at > now() - interval '24 hours'
          AND raw.payload->'actor'->>'id' IS NOT NULL
      )
      SELECT
        workspace_id,
        linear_app_user_id,
        array_agg(DISTINCT vendor_context) AS vendor_contexts
      FROM recent
      GROUP BY workspace_id, linear_app_user_id
      HAVING count(DISTINCT vendor_context) >= 2
    `);

    for (const c of candidates.rows) {
      // 2. Idempotency check. Skip if we already wrote an active warning for
      //    this user in the last 24h. The LIKE on the message is acceptable
      //    here because (a) linear_app_user_id is opaque (no LIKE wildcards)
      //    and (b) the rate of inserts is hourly, so the cost is negligible.
      const existing = await pg.query<{ id: string }>(
        `SELECT id FROM workspace_warnings
          WHERE workspace_id = $1
            AND source = 'detect_shared_app'
            AND message LIKE $2
            AND dismissed_at IS NULL
            AND created_at > now() - interval '24 hours'
          LIMIT 1`,
        [c.workspace_id, `%${c.linear_app_user_id}%`],
      );
      if (existing.rows.length > 0) continue;

      const message = `Shared Linear OAuth app detected: linear_app_user_id ${c.linear_app_user_id} shows multiple vendor contexts (${c.vendor_contexts.join(', ')}) within 24h. Each agent integration should use a distinct Linear OAuth application — metrics for these agents will be merged until you separate them.`;

      await pg.query(
        `INSERT INTO workspace_warnings (workspace_id, severity, message, source)
         VALUES ($1, 'WARNING', $2, 'detect_shared_app')`,
        [c.workspace_id, message],
      );
      helpers.logger.warn('detect_shared_app: warning emitted', {
        workspace_id: c.workspace_id,
        linear_app_user_id: c.linear_app_user_id,
        vendor_contexts: c.vendor_contexts,
      });
    }
  });
};
