import { z } from 'zod';

/**
 * SDK event payload schemas (INGEST-03).
 *
 * D-10 idempotency contract:
 *   - The caller MAY supply an `idempotency_key` (max 128 chars).
 *   - If absent, the server synthesizes
 *     `sha256(workspace_id + session_id + event_type + minute_bucket(occurred_at))`.
 *   - Published SDK clients (P2) supply explicit keys.
 *
 * The server endpoint (`POST /api/v1/sdk/event`, Plan 01.05) calls
 * `SdkEventBody.parse(req.body)` and routes by `event_type`.
 */

const Common = {
  session_id: z.string().min(1),
  occurred_at: z.string().datetime(),
  idempotency_key: z.string().min(1).max(128).optional(),
};

export const SessionStartEvent = z.object({
  ...Common,
  event_type: z.literal('session_start'),
  agent_name: z.string().min(1), // free text; resolver maps to agent_id
  vendor: z.string().optional(),
  model_tier: z.enum(['frontier', 'mid', 'small']).optional(),
  issue_linear_id: z.string().optional(),
  team_linear_id: z.string().optional(),
});
export type SessionStartEvent = z.infer<typeof SessionStartEvent>;

export const SessionEndEvent = z.object({
  ...Common,
  event_type: z.literal('session_end'),
  outcome: z.enum(['closed', 'failed', 'unknown']).optional(),
});
export type SessionEndEvent = z.infer<typeof SessionEndEvent>;

export const CostRecordedEvent = z.object({
  ...Common,
  event_type: z.literal('cost_recorded'),
  cost_usd: z.number().nonnegative(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export type CostRecordedEvent = z.infer<typeof CostRecordedEvent>;

/**
 * Discriminated union over `event_type` — the SDK endpoint's request body.
 */
export const SdkEventBody = z.discriminatedUnion('event_type', [
  SessionStartEvent,
  SessionEndEvent,
  CostRecordedEvent,
]);
export type SdkEventBody = z.infer<typeof SdkEventBody>;
