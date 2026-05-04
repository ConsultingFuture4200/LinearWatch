-- 0000_init.sql — agentwatch Phase 1 foundation schema (HAND-AUTHORED)
--
-- This migration is the source of truth for the partitioned `events.raw_event`
-- and the analytics indexes Drizzle cannot express. drizzle-kit generated a
-- non-partitioned scaffold; this file replaces it.
--
-- Sources:
--   * Postgres 16 partitioning docs — https://www.postgresql.org/docs/16/ddl-partitioning.html
--   * PRD §6.1 (agent_sessions columns), §6.2 (dimensions)
--   * PITFALLS.md Pitfalls 1, 8, 9, 10, 13
--   * RESEARCH.md Pattern 2 (declarative monthly partitioning)
--
-- All tables use `IF NOT EXISTS` and indexes use `IF NOT EXISTS` so re-applying
-- the migration is a no-op (drizzle-kit's journal also tracks idempotency).
--> statement-breakpoint

-- =========================================================================
-- 1. Schemas
-- =========================================================================
CREATE SCHEMA IF NOT EXISTS events;
--> statement-breakpoint

-- =========================================================================
-- 2. Dimension tables (no partitioning; small)
-- =========================================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  api_key_hash        text NOT NULL,
  workspace_salt      text NOT NULL,
  store_titles_plain  boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  linear_id     text NOT NULL,
  key           text NOT NULL,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT teams_workspace_linear_unique UNIQUE (workspace_id, linear_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS teams_workspace_idx ON teams(workspace_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS cycles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  team_id       uuid NOT NULL REFERENCES teams(id),
  linear_id     text NOT NULL,
  name          text NOT NULL,
  starts_at     timestamptz,
  ends_at       timestamptz,
  CONSTRAINT cycles_workspace_linear_unique UNIQUE (workspace_id, linear_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cycles_team_idx ON cycles(team_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS repos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id),
  github_full_name  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT repos_workspace_full_name_unique UNIQUE (workspace_id, github_full_name)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id),
  name                text NOT NULL,
  vendor              text,
  linear_app_user_id  text,
  github_login        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agents_workspace_idx
  ON agents(workspace_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agents_linear_app_user_idx
  ON agents(workspace_id, linear_app_user_id) WHERE linear_app_user_id IS NOT NULL;
--> statement-breakpoint

-- D-26 / Pitfall 13: NO `title` column. title_hash only.
CREATE TABLE IF NOT EXISTS issues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  linear_id     text NOT NULL,
  team_id       uuid REFERENCES teams(id),
  cycle_id      uuid REFERENCES cycles(id),
  title_hash    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  CONSTRAINT issues_workspace_linear_unique UNIQUE (workspace_id, linear_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS issues_team_idx ON issues(team_id);
--> statement-breakpoint

-- =========================================================================
-- 3. Fact table — agent_sessions (Pitfall 10 indexes)
-- =========================================================================
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id),
  agent_id           uuid NOT NULL REFERENCES agents(id),
  issue_id           uuid REFERENCES issues(id),
  team_id            uuid REFERENCES teams(id),
  cycle_id           uuid REFERENCES cycles(id),
  repo_id            uuid REFERENCES repos(id),
  vendor_session_id  text,
  model_tier         text,
  cost_usd           double precision,
  tokens_in          integer,
  tokens_out         integer,
  outcome            text,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz,
  reverted_at        timestamptz,
  cost_enriched_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_sessions_agent_started_idx
  ON agent_sessions(agent_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_sessions_issue_started_idx
  ON agent_sessions(issue_id, started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_sessions_started_brin_idx
  ON agent_sessions USING BRIN (started_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_sessions_team_started_idx
  ON agent_sessions(team_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_sessions_cycle_idx
  ON agent_sessions(cycle_id);
--> statement-breakpoint
-- Partial index for the "reverted" filter once outcome is populated in P2
CREATE INDEX IF NOT EXISTS agent_sessions_reverted_idx
  ON agent_sessions(agent_id) WHERE outcome = 'reverted';
--> statement-breakpoint

-- =========================================================================
-- 4. Identity resolver state (D-15, D-16, ID-02)
-- =========================================================================
CREATE TABLE IF NOT EXISTS identity_mappings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id),
  raw_event_id             bigint NOT NULL,
  agent_id                 uuid REFERENCES agents(id),
  linear_app_user_id       text,
  github_login             text,
  vendor_session_pattern   text,
  confidence               double precision NOT NULL,
  signal_weights           jsonb NOT NULL,
  state                    text NOT NULL CHECK (state IN ('NEW_AGENT','PENDING_CONFIRMATION','AUTO_PROMOTED','CONFIRMED')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  confirmed_at             timestamptz,
  CONSTRAINT identity_mappings_workspace_event_unique UNIQUE (workspace_id, raw_event_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS identity_mappings_state_idx
  ON identity_mappings(workspace_id, state);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS identity_mappings_linear_user_idx
  ON identity_mappings(workspace_id, linear_app_user_id)
  WHERE linear_app_user_id IS NOT NULL;
--> statement-breakpoint

-- =========================================================================
-- 5. Workspace warnings (D-18 detect_shared_app heuristic output)
-- =========================================================================
CREATE TABLE IF NOT EXISTS workspace_warnings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id),
  severity      text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  message       text NOT NULL,
  source        text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  dismissed_at  timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS workspace_warnings_active_idx
  ON workspace_warnings(workspace_id, created_at DESC)
  WHERE dismissed_at IS NULL;
--> statement-breakpoint

-- =========================================================================
-- 6. Rollup table (DATA-06 — refresh job is P2 stub)
-- =========================================================================
-- Composite PK provides the unique index needed for future
-- REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 15).
CREATE TABLE IF NOT EXISTS cost_by_agent_daily (
  workspace_id     uuid NOT NULL REFERENCES workspaces(id),
  agent_id         uuid NOT NULL REFERENCES agents(id),
  day              date NOT NULL,
  total_cost_usd   double precision NOT NULL DEFAULT 0,
  session_count    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, agent_id, day)
);
--> statement-breakpoint

-- =========================================================================
-- 7. Alert events (table reserved; ALERT-01..07 are P2)
-- =========================================================================
CREATE TABLE IF NOT EXISTS alert_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id),
  rule_name       text NOT NULL,
  agent_id        uuid REFERENCES agents(id),
  window_bucket   text NOT NULL,
  fired_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_events_dedup_unique UNIQUE (rule_name, agent_id, window_bucket)
);
--> statement-breakpoint

-- =========================================================================
-- 8. events.raw_event — DECLARATIVE MONTHLY PARTITIONING (Pitfall 8)
-- =========================================================================
-- Drizzle has no partition DSL; this is the only place the partition strategy
-- is declared. drizzle-kit's snapshot tracks the columns but not partstrat.
-- DELIBERATELY NO GIN index on payload (Pitfall 9 — raw store is for replay).
CREATE TABLE IF NOT EXISTS events.raw_event (
  id              bigserial,
  source          text NOT NULL CHECK (source IN ('linear','github','vendor','sdk')),
  upstream_id     text NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  PRIMARY KEY (id, received_at),
  CONSTRAINT raw_event_delivery_unique UNIQUE (source, upstream_id, received_at)
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS raw_event_received_idx ON events.raw_event(received_at);
--> statement-breakpoint

-- Pre-create current and next month partitions. The Graphile cron
-- `rotate_raw_event_partitions` (lands in plan 01.05) keeps these rolling and
-- DROPs anything older than the 30-day retention window. CREATE TABLE IF NOT
-- EXISTS makes this anonymous DO block idempotent.
DO $$
DECLARE
  cur_month_start  date := date_trunc('month', now())::date;
  next_month_start date := (date_trunc('month', now()) + interval '1 month')::date;
  after_next       date := (date_trunc('month', now()) + interval '2 month')::date;
  cur_name         text := 'raw_event_' || to_char(cur_month_start, 'YYYY_MM');
  next_name        text := 'raw_event_' || to_char(next_month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event FOR VALUES FROM (%L) TO (%L)',
    cur_name, cur_month_start, next_month_start
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event FOR VALUES FROM (%L) TO (%L)',
    next_name, next_month_start, after_next
  );
END $$;
