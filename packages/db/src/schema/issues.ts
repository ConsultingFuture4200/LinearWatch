import type { TitleHash } from '@agentwatch/shared';
import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { cycles } from './cycles';
import { teams } from './teams';
import { workspaces } from './workspaces';

/**
 * `issues` — dimension table for Linear issues.
 *
 * D-26 / Pitfall 13: there is NO `title` column. The only title surface is
 * `title_hash`, branded as `TitleHash` so accidentally storing a raw string is a
 * TypeScript compile error, not a runtime test failure.
 *
 * `hashTitle(raw, workspaceSalt)` (lands in plan 01.03 in `@agentwatch/shared`)
 * is the only function permitted to produce a `TitleHash`.
 */
const titleHashColumn = customType<{ data: TitleHash; driverData: string }>({
  dataType: () => 'text',
  toDriver: (v) => v,
  fromDriver: (v) => v as TitleHash,
});

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  linearId: text('linear_id').notNull(),
  teamId: uuid('team_id').references(() => teams.id),
  cycleId: uuid('cycle_id').references(() => cycles.id),
  // NO `title: text('title')` field anywhere — title_hash is the only title surface.
  titleHash: titleHashColumn('title_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});
