import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `workspaces` — single-tenant in P1, but the table exists for:
 * - D-14 workspace API key (sha256 hash; plaintext shown once at setup)
 * - D-27 per-workspace salt for `hashTitle()`
 * - PRIV-02 per-workspace `store_titles_plain` opt-in
 */
export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull(),
  workspaceSalt: text('workspace_salt').notNull(),
  storeTitlesPlain: boolean('store_titles_plain').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
