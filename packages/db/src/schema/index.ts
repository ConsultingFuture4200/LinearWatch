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
export * from './workspaces';
export * from './teams';
export * from './cycles';
export * from './repos';
export * from './agents';
export * from './issues';
export * from './agent-sessions';
export * from './identity-mappings';
export * from './workspace-warnings';
export * from './cost-by-agent-daily';
export * from './alert-events';
export * from './raw-event';
