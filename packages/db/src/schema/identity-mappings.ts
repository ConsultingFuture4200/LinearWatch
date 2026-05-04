import {
  bigint,
  doublePrecision,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { workspaces } from './workspaces.js';

/**
 * `identity_mappings` — resolver state machine output (D-15, D-16, ID-02).
 *
 * Idempotency key in migration SQL: UNIQUE (workspace_id, raw_event_id) so the
 * `resolve_identity` Graphile job is safely re-runnable.
 *
 * `raw_event_id` does NOT have a foreign-key constraint here: `events.raw_event`
 * is partitioned, and Postgres does not allow FKs from a non-partitioned table
 * to a partitioned parent. The application layer enforces referential integrity.
 *
 * `state` is checked via SQL CHECK constraint in 0000_init.sql for one of:
 * 'NEW_AGENT', 'PENDING_CONFIRMATION', 'AUTO_PROMOTED', 'CONFIRMED'.
 */
export const identityMappings = pgTable('identity_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  rawEventId: bigint('raw_event_id', { mode: 'bigint' }).notNull(),
  agentId: uuid('agent_id').references(() => agents.id),
  linearAppUserId: text('linear_app_user_id'),
  githubLogin: text('github_login'),
  vendorSessionPattern: text('vendor_session_pattern'),
  confidence: doublePrecision('confidence').notNull(),
  signalWeights: jsonb('signal_weights').notNull(),
  state: text('state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});
