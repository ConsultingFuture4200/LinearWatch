import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces.js';

/**
 * `workspace_warnings` — D-18 detect_shared_app heuristic output.
 *
 * `severity` is constrained via SQL CHECK in 0000_init.sql to:
 * 'INFO', 'WARNING', 'CRITICAL'.
 */
export const workspaceWarnings = pgTable('workspace_warnings', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  severity: text('severity').notNull(),
  message: text('message').notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});
