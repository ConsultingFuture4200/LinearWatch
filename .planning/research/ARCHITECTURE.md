# Architecture Research

**Domain:** Self-hosted AI agent observability platform (webhook ingestion → identity resolution → enrichment → analytics)
**Researched:** 2026-05-03
**Confidence:** HIGH (design questions, not capability questions — patterns are well-established in comparable systems)

---

## System Overview

```
External sources         Ingest layer              Storage         Surfaces
────────────────         ────────────              ───────         ────────

Linear webhooks ─┐
GitHub webhooks ─┤──► POST /webhooks/*  ──┐
                 │    (HMAC verify,     │
Vendor APIs ─────┤     enqueue, ack)    │
                 │                      ▼
SDK clients ─────┘    events.raw_event (Postgres)
                              │
                              │  Graphile Worker job queue
                              ▼
                       Identity Resolver ──► agents + identity_mappings
                              │
                              ▼
                       Enrichment Worker ──► agent_sessions (fact)
                         (60s cycle)         issues/repos/teams/cycles (dims)
                              │
                              ▼
                         Alert Engine ──► Slack / email / webhook
                         (5min cron)
                              │
                         Telemetry ─────► hosted aggregator
                         (daily cron,     (opt-in only)
                          if opted in)
                              │
                       Postgres ──────────────────────────────────────────┐
                                                                          │
                                                                          ▼
                                                          Next.js dashboard (POST /api/v1/query)
                                                          CLI binary (same API, API key auth)
```

---

## Component Boundaries

### Q1: One Process or Three?

**Recommendation: Two containers in v0. One process is fine at this scale; split only if benchmarks demand it.**

Reference comparisons:
- **Umami** (Next.js + Postgres, Prisma) ships as a single container for web + API. Zero worker separation. Handles moderate analytics load fine.
- **Langfuse v2** started as a single Next.js process. Only split to a separate worker container in v3 after hitting CPU-heavy enrichment blocking the event loop at scale.
- **Plausible** runs a single Elixir process that handles both ingestion and serving; ClickHouse is the only separate concern.
- **Sentry self-hosted** requires 20+ containers including Kafka, Snuba, Redis, ClickHouse. This is the anti-target — exactly the complexity to avoid for a v0 that must `docker compose up` in 5 minutes.

**v0 layout:**

| Container | What runs inside |
|-----------|-----------------|
| `web` | Next.js server: dashboard UI, `/api/v1/query`, `/webhooks/*`, `/api/v1/sdk/event` |
| `worker` | Graphile Worker process: identity resolver jobs, enrichment loop, alert cron, telemetry cron |
| `postgres` | Postgres 16 |
| `caddy` (optional) | Reverse proxy, TLS termination |

The webhook receiver lives in `web` (Next.js API routes). It does exactly: verify HMAC → `INSERT INTO events.raw_event` → respond 200. Estimated < 5ms Postgres write. p99 < 200ms is trivially achievable with no queue hop.

**When to split webhook receiver into its own container:** Only if load testing shows the Next.js server is saturating under concurrent webhook delivery and it affects dashboard responsiveness. Not needed in v0. Not needed until benchmarked.

**Inter-component contract:**

```
web → postgres:        Direct pg connection (Postgres.js or node-postgres)
worker → postgres:     Graphile Worker connection pool
web ↛ worker:         No direct RPC. Worker picks up jobs inserted by web into
                       graphile_worker.jobs table. LISTEN/NOTIFY wakes worker.
worker → vendor APIs:  HTTP polling (Cursor API, Devin API) on 60s cycle
worker → notify:       HTTP POST to Slack/email relay/generic webhook on alert fire
worker → aggregator:   HTTP POST daily rollup if TELEMETRY_OPT_IN=true
```

---

## Data Flow

### Raw Event → agent_sessions: Detailed Flow

```
1. POST /webhooks/linear  (or /github, /api/v1/sdk/event)
   │
   ├─ Verify HMAC (Linear-Signature, X-Hub-Signature-256, or Bearer API key)
   ├─ On failure: 401, log, done
   │
   ├─ INSERT INTO events.raw_event
   │    ON CONFLICT (source, upstream_id) DO NOTHING   ← idempotency
   │    RETURNING id, is_new
   │
   ├─ If is_new = false: respond 200 ("already processed")
   │
   ├─ Enqueue Graphile Worker job: { task: 'resolve_identity', raw_event_id: id }
   │
   └─ Respond 200 immediately

2. Graphile Worker picks up resolve_identity job (LISTEN/NOTIFY, sub-5ms latency)
   │
   ├─ Load raw_event.payload
   ├─ Extract (linear_app_user_id, github_login, vendor_session_pattern)
   ├─ Lookup identity_mappings table
   │   ├─ Exact match: use existing agent_id
   │   ├─ Partial match (1 of 3 signals): assign existing agent_id, set confidence
   │   └─ No match: INSERT into agents (new agent detected), confidence = LOW
   │
   ├─ INSERT INTO agent_sessions (id, agent_id, issue_id, linear_app_user_id, started_at, outcome='open')
   │    ON CONFLICT (linear_app_user_id, issue_id, started_at_bucket)
   │    DO UPDATE SET ... ← idempotent merge on re-delivery
   │
   └─ Enqueue: { task: 'enrich_session', session_id: ... }

3. Enrichment worker (60s cycle OR triggered job)
   │
   ├─ Fetch vendor cost data for sessions enriched_at IS NULL
   ├─ UPDATE agent_sessions SET cost_usd, tokens_in, tokens_out, model_tier
   ├─ Check GitHub PR status for sessions with pr_url and outcome = 'open'
   │   ├─ Merged: set outcome = 'closed' or 'reverted' if revert detected
   │   └─ If within 14d window: schedule re-check
   └─ UPDATE enriched_at = now()

4. Alert engine (5min cron, Graphile Worker scheduled job)
   │
   ├─ Load YAML rules from rules/ directory
   ├─ For each rule: execute constrained metric query via query API internals
   ├─ If threshold breached: fire notification, INSERT into alert_events
   └─ Dedup: skip if same rule fired within cooldown window (alert_events lookup)

5. Dashboard / CLI reads
   └─ POST /api/v1/query → query service → Postgres (views or direct queries)
```

### Idempotency Strategy

Every ingest path is idempotent on `(source, upstream_id)`. The `upstream_id` is:
- Linear: the webhook `id` field from the delivery envelope
- GitHub: `X-GitHub-Delivery` header UUID
- SDK: caller-supplied idempotency key, falls back to `sha256(session_id + event_type + timestamp_bucket)`

```sql
-- events.raw_event unique constraint
UNIQUE (source, upstream_id)

-- Insert pattern (webhook handler)
INSERT INTO events.raw_event (source, upstream_id, received_at, payload, signature_valid)
VALUES ($1, $2, now(), $3, $4)
ON CONFLICT (source, upstream_id) DO NOTHING
RETURNING id, xmax = 0 AS is_new;
-- xmax = 0 means it was a fresh insert, not a conflict update
```

### Replay / Reprocessing Model

`events.raw_event` is the source of truth. Any derived table (`agent_sessions`, `identity_mappings`) can be rebuilt from it. Reprocessing procedure:

1. `TRUNCATE agent_sessions, identity_mappings CASCADE` (behind a `--hard-reset` flag)
2. Re-enqueue all raw_event IDs as `resolve_identity` jobs
3. Worker processes in insertion order

For partial reprocessing (e.g., re-run enrichment after a vendor API fix):
- `UPDATE agent_sessions SET enriched_at = NULL WHERE agent_id = $1` then let enrichment cycle pick them up.

30-day retention enforced by a daily `pg_cron` job (or equivalent Graphile Worker cron):
```sql
DELETE FROM events.raw_event WHERE received_at < now() - interval '30 days';
```

---

## Identity Resolver Design

### State Machine

Each row in `identity_mappings` (one row per `(linear_app_user_id, workspace_id)`) moves through states:

```
NEW_AGENT ──► PENDING_CONFIRMATION ──► CONFIRMED
                     │
                     └──► AUTO_PROMOTED (confidence >= threshold without human action)
```

| State | Trigger | Dashboard surface |
|-------|---------|-------------------|
| `NEW_AGENT` | First event from an unknown linear_app_user_id | "New agent detected" banner |
| `PENDING_CONFIRMATION` | >= 1 signal matched but < confidence_threshold | Surfaces in identity review panel |
| `AUTO_PROMOTED` | All 3 signals matched OR single exact vendor_session_pattern match | Silent, confidence = HIGH |
| `CONFIRMED` | Human clicked "confirm" in dashboard | Locked, never auto-demoted |

### Confidence Score Computation

Signals and weights:

| Signal | Weight | How matched |
|--------|--------|-------------|
| `linear_app_user_id` exact match | 0.5 | Exact string from webhook `actor.id` |
| `github_login` pattern match | 0.3 | Regex `*-bot[bot]` or exact match in known-bots table; also checks `Co-authored-by:` and `Signed-off-by:` commit trailers |
| `vendor_session_pattern` match | 0.2 | Vendor session ID correlation via vendor API (Cursor session_id, Devin run_id) |

```
confidence = sum(matched_signal_weights) / sum(all_signal_weights_present)
```

Auto-promotion threshold: `confidence >= 0.8` (configurable via `IDENTITY_CONFIDENCE_THRESHOLD` env var).

Signals present but unmatched count against confidence. A session with `linear_app_user_id` present but unmatched scores lower than one with only `linear_app_user_id` and it matches exactly — this prevents phantom low-confidence rows from bubbling up when signals are simply absent.

### Identity Mappings Table

```sql
CREATE TABLE identity_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          text NOT NULL,        -- single-tenant v0: constant
  agent_id              uuid NOT NULL REFERENCES agents(id),
  linear_app_user_id    text,
  github_login          text,
  vendor_session_pattern text,               -- regex or exact string
  confidence            numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  state                 text NOT NULL DEFAULT 'NEW_AGENT'
                          CHECK (state IN ('NEW_AGENT','PENDING_CONFIRMATION','AUTO_PROMOTED','CONFIRMED')),
  confirmed_by          text,                -- user who confirmed, null = auto
  confirmed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON identity_mappings (linear_app_user_id) WHERE linear_app_user_id IS NOT NULL;
CREATE INDEX ON identity_mappings (github_login) WHERE github_login IS NOT NULL;
CREATE INDEX ON identity_mappings (state) WHERE state IN ('NEW_AGENT','PENDING_CONFIRMATION');
```

### When Low-Confidence Becomes High-Confidence

**Auto-promotion path:** When the enrichment worker observes a new signal that pushes `confidence >= 0.8`, it updates `state = 'AUTO_PROMOTED'`, logs the promotion, and emits a Prometheus counter (`identity_resolver_auto_promotions_total`).

**Human confirmation path:** Dashboard surfaces all rows in `NEW_AGENT` or `PENDING_CONFIRMATION` state. Operator clicks "confirm" → `PATCH /api/v1/agents/:id/confirm` → sets `state = 'CONFIRMED'`, `confirmed_by`, `confirmed_at`.

**Demotion:** CONFIRMED rows are never auto-demoted. If a new conflicting signal arrives for a CONFIRMED mapping, it creates a new PENDING_CONFIRMATION row linked to the same agent_id with a warning flag. Human resolves the conflict.

---

## Enrichment Worker Scheduling

### Recommendation: Single Worker Process, Graphile Worker for Scheduling

**Do not use separate worker processes for each cron type in v0.** One `worker` container running Graphile Worker handles all scheduled and queue-based work. Rationale:

- Graphile Worker uses Postgres advisory locks + `FOR UPDATE SKIP LOCKED` — safe to run in a single process or scale to multiple instances without double-processing.
- It has built-in cron scheduling (graphile-scheduler), fault tolerance (retry + exponential backoff), and LISTEN/NOTIFY for sub-5ms job pickup.
- node-cron (in-process scheduler) has two fatal flaws for production: only one process can safely run the schedule, and if that process is down at fire time the job is skipped. Graphile Worker catches up on missed schedules at startup.
- pg_cron is viable as an alternative for the scheduled portions but requires a Postgres extension that may not be available on all Postgres images. Graphile Worker requires no Postgres extensions — just tables and functions, which it installs itself.

**Worker job types:**

| Job type | Trigger | Concurrency | Notes |
|----------|---------|-------------|-------|
| `resolve_identity` | Enqueued by webhook handler | 5 concurrent | CPU-light, mostly Postgres lookups |
| `enrich_session` | Enqueued by identity resolver | 3 concurrent | Makes vendor API calls; rate-limit aware |
| `poll_vendor_apis` | Cron every 60s | 1 | Fetches cost data for all un-enriched sessions |
| `evaluate_alerts` | Cron every 5min | 1 | Runs rule evaluations |
| `watch_revert_window` | Cron every 60min | 1 | Checks merged PRs within 14d window |
| `emit_telemetry` | Cron daily at 00:00 UTC | 1 | Only if TELEMETRY_OPT_IN=true |
| `prune_raw_events` | Cron daily at 01:00 UTC | 1 | DELETE WHERE received_at < 30d |

The `poll_vendor_apis` cron and individual `enrich_session` jobs can coexist. The cron is a sweep for sessions that fell through (e.g., enrichment job failed); individual jobs handle newly resolved sessions immediately without waiting for the cron tick.

---

## Schema Design

### Full Schema

```sql
-- Schema separation: raw events isolated from processed data
CREATE SCHEMA events;
CREATE SCHEMA public;  -- dimensions and facts live here

-- Raw event store
CREATE TABLE events.raw_event (
  id             bigserial PRIMARY KEY,
  source         text NOT NULL CHECK (source IN ('linear','github','vendor','sdk')),
  upstream_id    text NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  payload        jsonb NOT NULL,
  signature_valid boolean NOT NULL
);
CREATE UNIQUE INDEX ON events.raw_event (source, upstream_id);
CREATE INDEX ON events.raw_event (received_at);  -- for 30d pruning

-- Dimension: agents
CREATE TABLE agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  vendor              text,          -- 'cursor', 'devin', 'codex', 'seer', 'internal', 'unknown'
  linear_app_user_id  text UNIQUE,
  github_login        text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Dimension: teams
CREATE TABLE teams (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_id    text UNIQUE NOT NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Dimension: cycles
CREATE TABLE cycles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_id    text UNIQUE NOT NULL,
  team_id      uuid REFERENCES teams(id),
  name         text,
  starts_at    timestamptz,
  ends_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Dimension: repos
CREATE TABLE repos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_owner_repo text UNIQUE NOT NULL,
  linear_team_id    uuid REFERENCES teams(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Dimension: issues
CREATE TABLE issues (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_id    text UNIQUE NOT NULL,
  team_id      uuid REFERENCES teams(id),
  cycle_id     uuid REFERENCES cycles(id),
  title_hash   text NOT NULL,   -- sha256 of title by default
  title_plain  text,            -- populated if STORE_ISSUE_TITLES=true
  created_at   timestamptz,
  closed_at    timestamptz
);

-- Fact: agent_sessions
CREATE TABLE agent_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            uuid NOT NULL REFERENCES agents(id),
  issue_id            uuid NOT NULL REFERENCES issues(id),
  linear_app_user_id  text NOT NULL,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  cost_usd            numeric(10,4),
  tokens_in           bigint,
  tokens_out          bigint,
  outcome             text CHECK (outcome IN ('open','closed','abandoned','reverted','failed')),
  pr_url              text,
  reverted_at         timestamptz,
  model_tier          text CHECK (model_tier IN ('frontier','mid','small')),
  enriched_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### Indexing Strategy

**Core indexes for the three dashboard query patterns:**

```sql
-- Cost by agent over window
CREATE INDEX idx_sessions_agent_started ON agent_sessions (agent_id, started_at DESC)
  WHERE outcome != 'open';

-- Revert rate by agent
CREATE INDEX idx_sessions_agent_outcome ON agent_sessions (agent_id, outcome)
  WHERE outcome IS NOT NULL;

-- Issue lineage (all agents that touched an issue)
CREATE INDEX idx_sessions_issue ON agent_sessions (issue_id, started_at);

-- Enrichment sweep (find un-enriched sessions)
CREATE INDEX idx_sessions_enriched ON agent_sessions (enriched_at) 
  WHERE enriched_at IS NULL;

-- Time range scans (BRIN appropriate here: append-heavy, temporally ordered)
CREATE INDEX idx_sessions_started_brin ON agent_sessions USING BRIN (started_at);

-- Dashboard filters by team (join path: sessions → issues → teams)
CREATE INDEX idx_issues_team ON issues (team_id);
CREATE INDEX idx_issues_cycle ON issues (cycle_id);
```

**BRIN vs BTREE rationale:** `started_at` on `agent_sessions` is a write-once append column — rows are inserted in roughly temporal order and never updated on that column. BRIN is ~1/100th the size of BTREE for this pattern and performs well for range scans over 90d windows. Use BTREE for `(agent_id, started_at)` composite index because `agent_id` breaks physical ordering.

### Materialized Views vs Raw Rollups

**Recommendation: No materialized views in v0. Use indexed raw queries + one pre-aggregated summary table refreshed by the worker.**

Reasoning:
- `REFRESH MATERIALIZED VIEW` in Postgres rebuilds from scratch — it does not track changed rows. A refresh of a 90d/100k-session aggregate takes several seconds, blocking or requiring `CONCURRENTLY` (which needs a unique index and still holds a lock).
- For 100k sessions over 90 days, properly indexed queries hit Postgres buffer cache and return in < 200ms without materialization. p95 < 1s is achievable with the indexes above.
- If specific dashboard queries prove slow (verify with `EXPLAIN ANALYZE`), promote them to materialized views one at a time — don't pre-optimize.

**One exception:** The `cost_by_agent_daily` rollup table, refreshed by the daily worker cron, provides the baseline for anomaly detection in the alert engine:

```sql
CREATE TABLE cost_by_agent_daily (
  agent_id    uuid NOT NULL REFERENCES agents(id),
  day         date NOT NULL,
  total_cost  numeric(12,4),
  session_count int,
  PRIMARY KEY (agent_id, day)
);
```

This avoids full scans on `agent_sessions` every 5 minutes for alert evaluation. Rolling-average anomaly detection reads from this table directly.

---

## Query API Contract

### POST /api/v1/query

**Principle: Constrained DSL, not a generic SQL generator.** The API accepts a known enumeration of metrics and dimensions. Any metric/dimension combination outside the allowed set returns 400 with a clear error. This is not a limitation — it is the safety property that prevents this from becoming a "build your own OLAP engine" project.

**Request schema:**

```typescript
interface QueryRequest {
  metric: MetricName;       // enumerated below
  dimension?: DimensionName; // optional grouping
  filters?: Filter[];
  window: WindowSpec;
}

type MetricName =
  | 'cost_total'
  | 'cost_per_issue'
  | 'session_count'
  | 'revert_rate'
  | 'success_rate'
  | 'time_to_resolution_p50'
  | 'time_to_resolution_p95'
  | 'enrichment_lag';

type DimensionName =
  | 'agent'
  | 'team'
  | 'cycle'
  | 'outcome'
  | 'model_tier'
  | 'vendor';

interface Filter {
  field: 'agent_id' | 'team_id' | 'cycle_id' | 'vendor' | 'outcome' | 'model_tier';
  op: 'eq' | 'in' | 'neq';
  value: string | string[];
}

interface WindowSpec {
  last?: string;   // '7d', '30d', '90d'
  from?: string;   // ISO 8601
  to?: string;     // ISO 8601
}
```

**Response:**

```typescript
interface QueryResponse {
  metric: MetricName;
  dimension?: DimensionName;
  window: { from: string; to: string };
  rows: Array<{
    label: string;   // dimension value (agent name, team name, etc.)
    value: number;
    count?: number;  // session count for rate metrics
  }>;
  generated_at: string;
}
```

**How to constrain:** Each `MetricName` maps to a static SQL template in `src/query/metrics.ts`. The query builder substitutes only validated filter values (parameterized). No string interpolation of metric names into SQL — each metric has an explicit implementation function.

**CLI uses the same API as the dashboard.** No separate CLI-only endpoint. Auth is the same workspace API key used by the SDK. The key is passed as `Authorization: Bearer <key>` header. Dashboard uses it server-side (never exposed to browser). CLI reads it from `~/.config/linearwatch/config.yaml` or `LINEARWATCH_API_KEY` env var.

---

## Docker Compose Layout

```yaml
# docker-compose.yml (v0 canonical layout)
services:
  postgres:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: linearwatch
      POSTGRES_USER: linearwatch
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "linearwatch"]

  web:
    build: .
    command: node dist/server.js
    depends_on:
      postgres: { condition: service_healthy }
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://linearwatch:${POSTGRES_PASSWORD}@postgres:5432/linearwatch
      LINEAR_WEBHOOK_SECRET: ${LINEAR_WEBHOOK_SECRET}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      LINEARWATCH_API_KEY: ${LINEARWATCH_API_KEY}
      STORE_ISSUE_TITLES: ${STORE_ISSUE_TITLES:-false}

  worker:
    build: .
    command: node dist/worker.js
    depends_on:
      postgres: { condition: service_healthy }
    environment:
      DATABASE_URL: postgres://linearwatch:${POSTGRES_PASSWORD}@postgres:5432/linearwatch
      CURSOR_API_KEY: ${CURSOR_API_KEY:-}
      DEVIN_API_KEY: ${DEVIN_API_KEY:-}
      TELEMETRY_OPT_IN: ${TELEMETRY_OPT_IN:-false}
      TELEMETRY_AGGREGATOR_URL: ${TELEMETRY_AGGREGATOR_URL:-https://telemetry.linearwatch.dev}

volumes:
  postgres_data:
```

**No separate ingest container in v0.** The `web` container handles webhook acks. Rationale: Next.js API routes are single-purpose handlers that write one row and respond. The cold path (enrichment, vendor API calls) is fully async in `worker`. The 200ms p99 target is achievable with this layout on any VPS with 2 vCPUs.

**When to add an `ingest` container:** Only if load testing shows webhook ack latency degrading because Next.js server threads are saturated by concurrent dashboard requests + webhook delivery simultaneously. Likely not needed until thousands of agent events per minute.

---

## Postgres Advisory Locks and LISTEN/NOTIFY

### Where to Use Advisory Locks

| Use case | Lock type | Rationale |
|----------|-----------|-----------|
| Materialized view refresh (if added later) | Session-level advisory lock | Prevent concurrent refresh storms |
| `emit_telemetry` cron job | Session-level advisory lock | Single-run guarantee even with multiple worker replicas |
| `evaluate_alerts` cron | Session-level advisory lock | Prevent double-firing of notifications |

Graphile Worker handles its own internal locking via `FOR UPDATE SKIP LOCKED` — no manual advisory locks needed for queue processing.

### LISTEN/NOTIFY

Graphile Worker uses LISTEN/NOTIFY to wake workers when a new job is inserted, achieving sub-5ms job pickup latency. The webhook handler does not call `NOTIFY` directly — the Graphile Worker `addJob()` function handles that internally when inserting into `graphile_worker.jobs`.

Do not add a separate LISTEN/NOTIFY mechanism. Let Graphile Worker own this entirely.

---

## Build Order (Component Dependency Graph)

```
Phase 1 (Days 1-21)
─────────────────────────────────────────────────────
[1] Schema + migrations (blocks everything)
        │
        ├──► [2a] events.raw_event table + idempotency constraint
        │
        ├──► [2b] agents + issues + teams + cycles + repos dimensions
        │
        └──► [2c] agent_sessions fact table + indexes

[3] Graphile Worker setup (worker container, job types scaffolded)
        │
        └──► [4] Identity resolver v0 (Linear-only, confidence scoring, identity_mappings table)
                │
                └──► [5] Webhook receiver (Linear webhooks → raw_event → enqueue resolve_identity)

[6] Query API skeleton (POST /api/v1/query, 2-3 metrics, agent + team dimensions)
        │
        └──► [7] Dashboard Cost view (consumes /api/v1/query, one chart, no auth yet)

Phase 2 (Days 22-60)
─────────────────────────────────────────────────────
[8] GitHub webhook receiver (separate from [5], parallel build)
[9] Cross-source identity resolver (extends [4] with github_login signals)
[10] Vendor API enrichment worker (Cursor first, enrich_session job type)
        │
        └── [11] cost_by_agent_daily rollup table + refresh job

[12] Remaining query metrics (revert_rate, success_rate, TTR distributions)
[13] Reliability + Lineage dashboard views (parallel with [12])

[14] Alert engine (YAML rules → evaluate_alerts cron → notifications)
[15] CLI binary (linearwatch query/report/lineage/tail — all via /api/v1/query)

[16] SDK (Node + Python thin clients) — parallel with [14], [15]

Phase 3 (Days 61-90)
─────────────────────────────────────────────────────
[17] Telemetry pipeline (anonymizer + daily rollup + opt-in guard)
[18] Telemetry aggregator (separate hosted service — see below)
[19] Helm chart, production docker-compose hardening
[20] Documentation site
```

**Hard dependencies:**
- [2a/2b/2c] must land before [3] (worker needs tables)
- [4] must land before [5] (can't process what you can't store)
- [6] must land before [7] (dashboard has no direct DB access)
- [10] depends on [9] (enrichment writes to sessions created by resolver)
- [11] depends on [10] (no data to roll up without enrichment)
- [14] depends on [11] (alert anomaly detection reads rollup table)
- [15] is parallel-safe with [13] (both consume same API)

**Parallelizable in Phase 2:**
- [8] + [9] in parallel (GitHub receiver and cross-source resolver share no code)
- [12] + [13] in parallel (new metrics and new views can be built simultaneously)
- [15] + [16] in parallel (CLI and SDK have no shared code)

---

## Anonymized Telemetry Architecture

### Rollup Computation (in main worker)

The `emit_telemetry` job runs as a Graphile Worker scheduled job at 00:00 UTC daily, guarded by an advisory lock. It computes the rollup entirely in-process (no separate service needed):

```typescript
// Aggregation: no raw session data leaves; only bucketed summary
const rollup = await db.query(`
  SELECT
    a.name                                           AS agent_name,
    width_bucket(s.cost_usd, 0, 10, 10)             AS cost_bucket,  -- $0-$10 in 10 buckets
    s.outcome                                        AS outcome,
    s.model_tier                                     AS model_tier,
    width_bucket(count(*) OVER (), 1, 1000, 5)       AS workspace_size_bucket,
    count(*)                                         AS session_count
  FROM agent_sessions s
  JOIN agents a ON a.id = s.agent_id
  WHERE s.created_at >= now() - interval '1 day'
    AND s.outcome IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
`);
```

This runs locally; only the aggregated rows are transmitted. No issue IDs, no PR URLs, no cost_usd values — only bucketed counts.

### Telemetry Aggregator (hosted service)

The aggregator is a minimal Node.js (or Go) HTTP server with a single endpoint:

```
POST /v1/ingest
Authorization: Bearer <workspace_token>
Content-Type: application/json

{
  "schema_version": "1",
  "date": "2026-05-03",
  "workspace_token": "<opaque>",   // hash of workspace UUID — not reversible
  "rows": [...]
}
```

Storage: Postgres table `telemetry_events(id, workspace_token, date, payload jsonb, received_at)`. No ClickHouse needed at launch scale (< 1000 workspaces × 365 days = 365k rows/year). Revisit at 10k+ active workspaces.

Workspace token generation on the user's side: `sha256(LINEARWATCH_API_KEY + "telemetry")` — not reversible, not linkable across datasets.

The aggregator runs as a single Fly.io app (or equivalent) with a small Postgres instance. Cost at launch: < $5/month.

---

## Architecture Anti-Patterns for This Project

### Anti-Pattern 1: Dashboard Querying Postgres Directly

**What:** React server components or API routes with raw SQL or Prisma calls returning to the UI directly, bypassing the query API.

**Why bad:** The CLI depends on the query API. If dashboard views make direct queries, the CLI and dashboard drift. The query API becomes vestigial. You end up maintaining two query layers.

**Instead:** All reads go through `POST /api/v1/query`. The query API's internal functions can call Postgres directly; the boundary is the HTTP contract.

### Anti-Pattern 2: Cron in the Web Container

**What:** Using `setInterval` or `node-cron` in the Next.js server process for the 60s enrichment sweep or 5min alert evaluation.

**Why bad:** Next.js serverless/edge model (and cold starts on restarts) makes in-process cron unreliable. Two web replicas double-fire. If the web container is scaled to zero, crons don't fire. Graphile Worker catches up on missed schedules at startup; in-process cron does not.

**Instead:** All periodic work lives in the `worker` container under Graphile Worker scheduling.

### Anti-Pattern 3: Logging Identity Mappings as Events

**What:** Treating identity resolution decisions as webhook events, sending them through the raw_event pipeline.

**Why bad:** Identity mappings have their own lifecycle (state machine, human confirmation, demotion logic) that doesn't fit the append-only event model. Mixing them creates replay complexity where replaying enrichment would re-run identity decisions.

**Instead:** Identity mappings live in their own `identity_mappings` table with explicit state transitions. The resolver writes directly to this table, not through the event pipeline.

### Anti-Pattern 4: Adding Redis "Just for Caching"

**What:** Adding a Redis container to cache dashboard query results or vendor API responses.

**Why bad:** Violates the "Postgres-only in v0" constraint. Adds operational surface (Redis restart, eviction, persistence). At 100k sessions, Postgres with proper indexes is fast enough; measured p95 < 200ms is achievable without caching.

**Instead:** Cache in-process (Map with TTL) for vendor API rate limiting. Cache dashboard results via HTTP `Cache-Control` headers at the CDN/reverse proxy layer if needed. Add Redis only after benchmarked query latency proves Postgres insufficient.

### Anti-Pattern 5: Generic OLAP Query Engine

**What:** Designing `/api/v1/query` to accept arbitrary dimension/metric combinations, user-defined SQL fragments, or a full filter expression language.

**Why bad:** The project charter explicitly defers natural-language query and custom SQL. A generic query layer requires the same engineering effort as building a mini-BI tool. It also creates SQL injection surface in the rules engine.

**Instead:** Enumerate allowed metrics and dimensions. Each metric maps to one SQL function. Return 400 for unknown combinations. Add new metric implementations explicitly, not generically.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Linear webhooks | `POST /webhooks/linear` with HMAC-SHA256 (Linear-Signature header) | Requires Business/Enterprise plan; secret in env |
| GitHub webhooks | `POST /webhooks/github` with HMAC-SHA256 (X-Hub-Signature-256 header) | Fine-grained PAT or GitHub App installation |
| Cursor API | Polling from worker on 60s cycle; session ID correlation | API availability not guaranteed — degrade gracefully |
| Devin API | Same polling pattern as Cursor | Devin run_id as correlation key |
| Slack notifications | Simple HTTP POST to incoming webhook URL | No OAuth required |
| Email notifications | SMTP relay (configurable in .env) | Resend or SMTP-compatible |
| Telemetry aggregator | `POST https://telemetry.linearwatch.dev/v1/ingest` | Opt-in only; workspace token is opaque hash |

### Internal Boundaries

| Boundary | Communication | Contract |
|----------|---------------|----------|
| web → postgres | `postgres.js` connection pool | Direct SQL; query service validates all inputs |
| worker → postgres | Graphile Worker pool | Job definitions in `src/worker/tasks/` |
| web → worker | Via `graphile_worker.jobs` INSERT | `addJob(taskName, payload)` — no direct RPC |
| CLI → web | `POST /api/v1/query` over HTTP | Same JSON contract as dashboard; API key auth |
| SDK clients → web | `POST /api/v1/sdk/event` | Bearer API key; same raw_event pipeline |
| worker → aggregator | `POST https://telemetry.linearwatch.dev/v1/ingest` | Daily, opt-in, no PII |

---

## Scaling Considerations

| Scale | Architecture | Notes |
|-------|-------------|-------|
| 1-3 workspaces, < 10k sessions/month | v0 as designed | Single `docker compose up`, 2GB RAM VPS |
| 5-20 workspaces (design partner scale) | v0 as designed | Postgres on 4 vCPU, 8GB RAM. Index tuning if needed. |
| 50+ workspaces (post-launch growth) | Add read replica for dashboard queries | Worker writes to primary; dashboard reads from replica |
| 500+ workspaces or high-frequency agents | Consider ClickHouse for `agent_sessions` — same path Langfuse took | Langfuse hit this threshold at "billions of rows"; linearwatch at 100 workspaces × 100k sessions = 10M rows. Monitor; don't pre-optimize. |

**First bottleneck:** Enrichment lag on vendor API rate limits. Mitigation: per-vendor rate-limit tracking in worker (token bucket in Postgres row), exponential backoff on 429s.

**Second bottleneck:** `evaluate_alerts` scanning `agent_sessions` every 5 minutes. Mitigation: `cost_by_agent_daily` rollup table (already in design).

**Third bottleneck (if it ever comes):** Dashboard query latency on large `agent_sessions` tables. Mitigation: materialized views for the top-N most expensive queries, identified by actual slow-query logging before adding them.

---

## Sources

- Langfuse architecture blog: https://langfuse.com/blog/2024-12-langfuse-v3-infrastructure-evolution
- Langfuse architecture handbook: https://langfuse.com/handbook/product-engineering/architecture
- Graphile Worker performance: https://worker.graphile.org/docs/performance
- Graphile Worker GitHub: https://github.com/graphile/worker
- pg-boss GitHub: https://github.com/timgit/pg-boss
- Postgres BRIN indexing: https://www.crunchydata.com/blog/postgresql-brin-indexes-big-data-performance-with-minimal-storage
- Postgres advisory locks: https://flaviodelgrosso.com/blog/postgresql-advisory-locks
- Webhook idempotency patterns: https://hookdeck.com/webhooks/guides/implement-webhook-idempotency
- Cybertec BRIN vs BTree: https://www.cybertec-postgresql.com/en/btree-vs-brin-2-options-for-indexing-in-postgresql-data-warehouses/
- Sentry self-hosted (what to avoid): https://github.com/getsentry/self-hosted
- Umami architecture reference: https://github.com/umami-software/umami

---

*Architecture research for: linearwatch — self-hosted AI agent observability*
*Researched: 2026-05-03*
