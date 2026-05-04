import { date, doublePrecision, integer, pgTable, uuid } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { workspaces } from './workspaces.js';

/**
 * `cost_by_agent_daily` — DATA-06 rollup table.
 *
 * Exists in P1 schema only. The refresh job is a P2 stub. The composite primary
 * key (workspace_id, agent_id, day) declared in 0000_init.sql provides the unique
 * index needed for future REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 15).
 *
 * Note: Drizzle's `pgTable` definition cannot express a composite PRIMARY KEY
 * cleanly without `primaryKey({ columns: [...] })` from `drizzle-orm/pg-core`;
 * the migration SQL is the source of truth for the constraint.
 */
export const costByAgentDaily = pgTable('cost_by_agent_daily', {
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  day: date('day').notNull(),
  totalCostUsd: doublePrecision('total_cost_usd').notNull().default(0),
  sessionCount: integer('session_count').notNull().default(0),
});
