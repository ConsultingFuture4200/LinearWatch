import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { teams } from './teams';
import { workspaces } from './workspaces';

export const cycles = pgTable('cycles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id),
  linearId: text('linear_id').notNull(),
  name: text('name').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
});
