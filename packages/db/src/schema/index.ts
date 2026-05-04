/**
 * `@agentwatch/db` schema barrel.
 *
 * Re-exports every Phase-1 table definition. Server, worker, and web packages
 * import from here. The drizzle-kit config (`drizzle.config.ts`) points at this
 * file so future `drizzle-kit generate` runs see the full schema in one place.
 *
 * Note: `events.raw_event` partition DDL lives in `migrations/0000_init.sql`,
 * NOT in any of these schema files (Drizzle has no partition DSL).
 */
export * from './workspaces.js';
export * from './teams.js';
export * from './cycles.js';
export * from './repos.js';
export * from './agents.js';
export * from './issues.js';
export * from './agent-sessions.js';
export * from './identity-mappings.js';
export * from './workspace-warnings.js';
export * from './cost-by-agent-daily.js';
export * from './alert-events.js';
export * from './raw-event.js';
