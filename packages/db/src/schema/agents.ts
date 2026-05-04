import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaces } from './workspaces';

/**
 * `agents` — dimension table.
 *
 * `deleted_at` exists in P1 schema so the P2 PRIV-04 GDPR purge ships without a
 * migration. P1 never writes to it; it's a reservation, not a feature.
 */
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  name: text('name').notNull(),
  vendor: text('vendor'),
  linearAppUserId: text('linear_app_user_id'),
  githubLogin: text('github_login'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // P2 PRIV-04 soft delete — column reserved in P1 to avoid future schema migration.
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
