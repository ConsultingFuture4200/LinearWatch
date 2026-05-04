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
  // Plan 01.09: optional GitHub PAT collected by the setup wizard step 4.
  // Used by the P2 GitHub enrichment worker (PRD §6.4). Stored base64-encoded.
  // Nullable because the wizard offers a "Skip - I'll add this later" CTA.
  githubPatEncoded: text('github_pat_encoded'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
