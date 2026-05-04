import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { workspaces } from './workspaces';

/**
 * `alert_events` — table reserved for P2 ALERT-01..07.
 *
 * Exists now to avoid a future migration ordering complication when the alert
 * engine ships in P2. P1 never writes to this table.
 */
export const alertEvents = pgTable('alert_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  ruleName: text('rule_name').notNull(),
  agentId: uuid('agent_id').references(() => agents.id),
  windowBucket: text('window_bucket').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
});
