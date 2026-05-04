import { doublePrecision, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { cycles } from './cycles';
import { issues } from './issues';
import { repos } from './repos';
import { teams } from './teams';
import { workspaces } from './workspaces';

/**
 * `agent_sessions` — fact table per PRD §6.1.
 *
 * Indexes are declared in `migrations/0000_init.sql` (Pitfall 10), not in this file.
 * Drizzle's index DSL is not used here because the migration SQL is the source of
 * truth and includes BRIN + partial indexes Drizzle does not express natively.
 *
 * Notable columns:
 * - `cost_usd`, `tokens_in`, `tokens_out`: null in P1; populated by P2 vendor enrichment.
 * - `outcome`: 'closed' | 'reverted' | 'failed' | null. Null in P1; populated by P2 GitHub PR enrichment.
 * - `reverted_at`: column unbounded; the "reverted within N days" window is configurable
 *   at query time (RESEARCH Open Q3).
 * - `cost_enriched_at`: P2 vendor re-poll guard (Pitfall 7) — column reserved in P1.
 */
export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  issueId: uuid('issue_id').references(() => issues.id),
  teamId: uuid('team_id').references(() => teams.id),
  cycleId: uuid('cycle_id').references(() => cycles.id),
  repoId: uuid('repo_id').references(() => repos.id),
  vendorSessionId: text('vendor_session_id'),
  modelTier: text('model_tier'),
  costUsd: doublePrecision('cost_usd'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  outcome: text('outcome'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  costEnrichedAt: timestamp('cost_enriched_at', { withTimezone: true }),
});
