# Requirements: agentwatch

**Defined:** 2026-05-03
**Core Value:** Cross-agent attribution — for any issue, any team, any cycle, show which agent did what, what it cost, and whether the change held up.

## v1 Requirements

Requirements for the v0.1 release (90-day plan). Each maps to a roadmap phase.

### Ingestion (`INGEST`)

- [ ] **INGEST-01**: Webhook endpoint `POST /webhooks/linear` accepts Linear Agent Session events and rejects non-`X-Linear-Signature-256` HMAC payloads with 401
- [ ] **INGEST-02**: Webhook endpoint `POST /webhooks/github` accepts GitHub `pull_request`, `push`, and `status` events; verifies `X-Hub-Signature-256` with constant-time compare; rejects SHA-1 payloads with 401
- [ ] **INGEST-03**: Internal SDK endpoint `POST /api/v1/sdk/event` authenticates via workspace API key (Bearer header) and accepts `session_start`, `session_end`, `cost_recorded` events
- [ ] **INGEST-04**: Webhook handler does exactly three things synchronously: HMAC verify → single INSERT to `events.raw_event` → respond 200; webhook ack p99 < 200ms under 200 concurrent payloads
- [ ] **INGEST-05**: Idempotency enforced via unique constraint `(source, upstream_id)` on `events.raw_event`; duplicate Linear/GitHub deliveries are no-ops
- [ ] **INGEST-06**: Raw event store retains payloads for 30 days; older partitions dropped via monthly declarative partitioning
- [ ] **INGEST-07**: Vendor API enrichment worker polls Cursor on a 60-second cycle and writes `cost_usd`, `tokens_in`, `tokens_out`, `model_tier` back to `agent_sessions`
- [ ] **INGEST-08**: Vendor API enrichment worker polls one additional vendor (Devin or Codex) on a 60-second cycle
- [ ] **INGEST-09**: GitHub PR outcome enrichment marks `agent_sessions.outcome` as `closed`/`reverted`/`failed` based on PR merge status, force-push events, and merged revert PRs within a 14-day window

### Identity Resolution (`ID`)

- [ ] **ID-01**: Resolver accepts `(linear_app_user_id, github_login, vendor_session_pattern)` signals and produces a single `agent_id` per workspace
- [ ] **ID-02**: New unmatched signals create rows in state `NEW_AGENT`, transition to `PENDING_CONFIRMATION` once partial signals match, and to `AUTO_PROMOTED` or `CONFIRMED` once confidence ≥ `IDENTITY_CONFIDENCE_THRESHOLD` (default 0.8)
- [ ] **ID-03**: Confidence score is a weighted sum: `linear_app_user_id` (0.5), `github_login` (0.3), `vendor_session_pattern` (0.2)
- [ ] **ID-04**: Low-confidence resolutions (< 0.8) surface in dashboard with one-click human confirmation that locks the row to `CONFIRMED`
- [ ] **ID-05**: Detect shared Linear OAuth app: if one `linear_app_user_id` shows sessions with multiple distinct vendor contexts within 24h, surface a workspace warning
- [ ] **ID-06**: `IDENTITY_CONFIDENCE_THRESHOLD` is a runtime env var; auto-promotion threshold is configurable without redeploy

### Data Model (`DATA`)

- [ ] **DATA-01**: Star schema migration creates `agent_sessions` (fact) with PRD §6.1 columns
- [ ] **DATA-02**: Dimension tables `agents`, `issues`, `repos`, `teams`, `cycles` created with PRD §6.2 columns
- [ ] **DATA-03**: `events.raw_event` is monthly-partitioned (declarative) from the first migration with `(source, upstream_id)` unique constraint
- [ ] **DATA-04**: Indexes: `agent_sessions(agent_id, started_at DESC)`, `agent_sessions(issue_id, started_at)`, BRIN on `agent_sessions(started_at)`, plus dimension foreign-key indexes
- [ ] **DATA-05**: `identity_mappings` table tracks resolver state with `(workspace_id, linear_app_user_id)`-keyed rows, confidence score, signal weights, and confirmation timestamps
- [ ] **DATA-06**: `cost_by_agent_daily` rollup table refreshed by daily cron; alert engine reads from it instead of scanning `agent_sessions` directly

### Query API (`API`)

- [ ] **API-01**: `POST /api/v1/query` accepts JSON `{metric, dimension, filters, window}` and returns rows in normalized format
- [ ] **API-02**: `MetricName` and `DimensionName` are Zod enums; unknown values return 400 with clear error
- [ ] **API-03**: Each metric maps to a static SQL function in `src/query/metrics.ts`; no arbitrary SQL is constructible
- [ ] **API-04**: Metrics shipped in v1: `cost_by_agent`, `cost_per_closed_issue`, `revert_rate`, `success_rate`, `time_to_resolution_p50_p95`, `agent_session_count`
- [ ] **API-05**: Dimensions shipped in v1: `agent`, `team`, `cycle`, `repo`, `model_tier`
- [ ] **API-06**: Query API requires Bearer workspace API key auth (same auth as SDK endpoint)
- [ ] **API-07**: Dashboard reads exclusively through query API; no direct Postgres access from React/Next.js components
- [ ] **API-08**: Query API p95 < 1s on a 100k-session workspace over a 90-day window

### Dashboard (`DASH`)

- [ ] **DASH-01**: Cost view shows spend per agent broken down by team and cycle with cost-per-closed-issue and anomaly highlights
- [ ] **DASH-02**: Reliability view shows success rate, revert-within-14d, and time-to-resolution distributions per agent
- [ ] **DASH-03**: Lineage view shows per-issue agent timeline: enter `LIN-1234`, see every agent that touched it, in order, with outcome
- [ ] **DASH-04**: Identity resolver confidence is visible in dashboard; low-confidence rows have one-click confirm UI
- [ ] **DASH-05**: First-run setup wizard configures Linear OAuth, GitHub PAT, and warns explicitly about Linear AgentSession category UI visibility
- [ ] **DASH-06**: Setup wizard offers `--seed` flag to insert synthetic sessions for empty-dashboard hypothesis validation

### CLI (`CLI`)

- [ ] **CLI-01**: `agentwatch query "<DSL fragment>"` parses the constrained DSL and prints results as JSON or table
- [ ] **CLI-02**: `agentwatch report cost --team ENG --window 14d` calls the query API and prints a formatted cost report
- [ ] **CLI-03**: `agentwatch report reliability --agent cursor` prints success rate, revert rate, TTR
- [ ] **CLI-04**: `agentwatch lineage LIN-1234` prints the per-issue agent timeline
- [ ] **CLI-05**: `agentwatch tail` streams live agent activity events
- [ ] **CLI-06**: `agentwatch rules test rules/cost-spike.yaml` validates a YAML rule against current data without firing notifications
- [ ] **CLI-07**: `agentwatch setup` runs the same first-run flow as the dashboard wizard
- [ ] **CLI-08**: CLI is distributed as a single self-contained binary per platform (linux/x64, linux/arm64, darwin/arm64) via `bun build --compile` in CI
- [ ] **CLI-09**: CLI uses the same `POST /api/v1/query` endpoint as the dashboard; no separate CLI-only API

### Alerts (`ALERT`)

- [ ] **ALERT-01**: YAML rule format with `name`, `description`, `when`, `window`, `notify` fields parses cleanly and fails closed on syntax errors
- [ ] **ALERT-02**: Rule engine evaluates all rules on a 5-minute cron and dispatches notifications for matches
- [ ] **ALERT-03**: Cost-anomaly rule type fires when an agent's `weekly_spend > 3 * agent.rolling_avg(28d)`
- [ ] **ALERT-04**: Reliability-regression rule type fires when revert rate or failure rate breaches a threshold over a window
- [ ] **ALERT-05**: Notification channels: Slack webhook, email (SMTP), generic webhook
- [ ] **ALERT-06**: Two default rule packs (`cost-spike.yaml`, `revert-rate-spike.yaml`) ship in-box under `rules/`
- [ ] **ALERT-07**: Alert dedup via `alert_events` table; same `(rule_name, agent_id, window_bucket)` does not refire within the window

### SDK (`SDK`)

- [ ] **SDK-01**: `@agentwatch/sdk` Node package emits `session_start`, `session_end`, `cost_recorded` events to `/api/v1/sdk/event`
- [ ] **SDK-02**: `agentwatch` PyPI package emits the same three events with the same wire format
- [ ] **SDK-03**: SDK accepts a workspace API key and a server URL; nothing else required to start emitting
- [ ] **SDK-04**: SDK batches events with a configurable flush interval; falls back to disk buffer if endpoint is unreachable for > 60s
- [ ] **SDK-05**: SDK ships ESM + CJS + `.d.ts` for Node; type-checked py3.10+ for Python
- [ ] **SDK-06**: SDK adds < 5MB to a Node bundle and < 50ms to startup

### Deployment (`DEPLOY`)

- [ ] **DEPLOY-01**: `git clone && docker compose up` produces a running dashboard reachable at `http://localhost:3000` within 5 minutes on a clean developer laptop
- [ ] **DEPLOY-02**: docker-compose stack contains exactly: `web`, `worker`, `postgres:16-alpine`. No Redis, Kafka, or TSDB.
- [ ] **DEPLOY-03**: Required env vars (`LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `DATABASE_URL`) fail-fast at startup with a readable error
- [ ] **DEPLOY-04**: Helm chart for Kubernetes deploys the same three services with resource limits, liveness probes, and PodDisruptionBudgets per Prequel 2025 checklist
- [ ] **DEPLOY-05**: Reverse-proxy auth is supported (no built-in SSO); README documents nginx and Caddy examples
- [ ] **DEPLOY-06**: PgBouncer transaction-mode is documented with `?pgbouncer=true` flag guidance in README

### Observability (`OBS`)

- [ ] **OBS-01**: Structured JSON logs (pino) by default; one log line per webhook receipt, one per worker job, no `req.body` ever logged
- [ ] **OBS-02**: Prometheus `/metrics` endpoint exposes event counts, queue depth, enrichment lag, and `identity_resolver_confidence` histogram
- [ ] **OBS-03**: `LOG_LEVEL` env var controls verbosity (`debug`/`info`/`warn`/`error`); even `debug` never logs raw payloads or signature values
- [ ] **OBS-04**: CI asserts `grep -r 'req.body' src/` returns empty in production code paths
- [ ] **OBS-05**: Performance benchmark in CI: 100k seeded sessions, dashboard query p95 < 1s; webhook ack p99 < 200ms under 200 concurrent payloads

### Privacy (`PRIV`)

- [ ] **PRIV-01**: Issue titles hashed by default via a single `hashTitle()` utility; the `issues` ORM type has no raw `title: string` field — only `title_hash`
- [ ] **PRIV-02**: Workspace setting can opt in to storing full titles; setting is per-workspace and explicit (not default)
- [ ] **PRIV-03**: CI assertion: raw title strings never appear in any query API response when hashing is enabled
- [ ] **PRIV-04**: `agentwatch agent purge <id>` CLI command soft-deletes an agent and propagates deletion to `cost_by_agent_daily` rollup via `REFRESH MATERIALIZED VIEW CONCURRENTLY`

### Telemetry (`TELE`)

- [ ] **TELE-01**: `TELEMETRY_OPT_IN` env var defaults to `false`; never sends data when unset
- [ ] **TELE-02**: `TELEMETRY_OPT_IN` is the first conditional in the daily rollup job — checked before any database read
- [ ] **TELE-03**: When opted in, daily rollup emits only `(agent_name, cost_bucket, outcome, model_tier, workspace_size_bucket)`. No issue content, no code, no identifying strings, no workspace identifiers.
- [ ] **TELE-04**: Anonymization spec lives in `docs/telemetry.md` and is enforced in code via a Zod schema, not policy
- [ ] **TELE-05**: Hosted aggregator service (separate Fly.io deploy) accepts daily rollups at `POST /v1/ingest` and stores in its own Postgres
- [ ] **TELE-06**: Integration test: with `TELEMETRY_OPT_IN` unset, mock HTTP interceptor records zero outbound calls during a full daily cron run

### Setup & Onboarding (`SETUP`)

- [ ] **SETUP-01**: First-run wizard collects Linear OAuth credentials, GitHub PAT (optional), and persists to env-var-overridable config
- [ ] **SETUP-02**: Wizard surfaces explicit warning that enabling Linear AgentSession category modifies the workspace UI for all users
- [ ] **SETUP-03**: `docker compose up` shows a "waiting for first webhook" onboarding state with a copy-paste webhook URL and test cURL command
- [ ] **SETUP-04**: `--seed` flag inserts ~50 synthetic agent sessions covering all three dashboard views for empty-state validation

### Launch (`LAUNCH`)

- [ ] **LAUNCH-01**: Documentation site (docs.agentwatch.dev or equivalent) ships with quickstart, configuration reference, and SDK reference
- [ ] **LAUNCH-02**: `CONTRIBUTING.md` documents dev setup and conventions
- [ ] **LAUNCH-03**: Discord server live with at least one community-contributed rule pack at launch
- [ ] **LAUNCH-04**: Public benchmark blog post drafted from at least 14 days of opt-in telemetry data from 3+ design partners
- [ ] **LAUNCH-05**: Show HN launch on a Tuesday or Wednesday morning; repo public from Day 1 with strong README and architecture diagram
- [ ] **LAUNCH-06**: Cold-start `docker compose up` smoke test runs in CI on a clean image and asserts dashboard is reachable

## v2 Requirements

Deferred to v0.2 or later. Tracked but not in 90-day roadmap.

### Sources

- **SRC-V2-01**: Jira as a primary issue source (per PRD §3 non-goals)
- **SRC-V2-02**: GitHub Issues beyond just PR outcome enrichment
- **SRC-V2-03**: Asana / Linear Triage Automations as observability sources

### Query

- **QRY-V2-01**: LLM-powered natural language query that translates to the constrained DSL (per PRD §7.2)
- **QRY-V2-02**: Custom dimensions for multi-product workspaces

### Auth

- **AUTH-V2-01**: SSO / SAML / OIDC for hosted commercial tier
- **AUTH-V2-02**: Audit logs for compliance scenarios
- **AUTH-V2-03**: GitHub App distribution with `installation_id` for stronger identity disambiguation

### Notifications

- **NOTIF-V2-01**: Discord channel notifications
- **NOTIF-V2-02**: Microsoft Teams notifications
- **NOTIF-V2-03**: PagerDuty integration

### Analytics

- **ANL-V2-01**: Period-over-period cost deltas (WoW/MoM)
- **ANL-V2-02**: Top-N cost consumers ranked tables
- **ANL-V2-03**: Real-time WebSocket dashboard streaming

### Hosted

- **HOSTED-V2-01**: Multi-tenant SaaS hosting tier
- **HOSTED-V2-02**: SOC 2 attestation
- **HOSTED-V2-03**: Per-agent or per-event pricing model

## Out of Scope

| Feature | Reason |
|---------|--------|
| Embedded LLM for auto-remediation | Observability tool, not a control plane; one wrong remediation exceeds the value of many correct ones |
| Multi-tenancy in v0 | Tenant isolation multiplies every other problem; one Postgres = one workspace |
| Custom SQL in rule engine | DSL in version-controlled YAML + SQL injection = bad combination |
| Real-time WebSocket dashboard | 60-second enrichment lag is the real bottleneck; sub-second UI does not help |
| Built-in SSO/SAML/OIDC in v0 | Reverse-proxy auth covers single-tenant self-hosting; SSO belongs in a future hosted tier |
| Mobile / native applications | Web dashboard + CLI cover the use case |
| Redis, Kafka, time-series DB | Postgres-only is the deployment-simplicity constraint, not a performance compromise |
| Materialized views in v0 | Direct queries with proper indexes hit p95 targets; defer materialization until measured data demands it (the one exception is `cost_by_agent_daily`) |
| Per-issue telemetry granularity | Privacy-conservative default is per-day rollup; revisit for v0.2 only if benchmark questions require |
| GitHub App in v0 (PAT used instead) | App requires admin install approval; PAT with documented minimal scopes is the right v0 onboarding path |

## Traceability

Updated by roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INGEST-01 | Phase 1 | Pending |
| INGEST-02 | Phase 2 | Pending |
| INGEST-03 | Phase 1 | Pending |
| INGEST-04 | Phase 1 | Pending |
| INGEST-05 | Phase 1 | Pending |
| INGEST-06 | Phase 1 | Pending |
| INGEST-07 | Phase 2 | Pending |
| INGEST-08 | Phase 2 | Pending |
| INGEST-09 | Phase 2 | Pending |
| ID-01 | Phase 1 | Pending |
| ID-02 | Phase 1 | Pending |
| ID-03 | Phase 1 | Pending |
| ID-04 | Phase 2 | Pending |
| ID-05 | Phase 1 | Pending |
| ID-06 | Phase 1 | Pending |
| DATA-01 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-03 | Phase 1 | Pending |
| DATA-04 | Phase 1 | Pending |
| DATA-05 | Phase 1 | Pending |
| DATA-06 | Phase 1 | Pending |
| API-01 | Phase 1 | Pending |
| API-02 | Phase 1 | Pending |
| API-03 | Phase 1 | Pending |
| API-04 | Phase 1 | Pending |
| API-05 | Phase 1 | Pending |
| API-06 | Phase 1 | Pending |
| API-07 | Phase 1 | Pending |
| API-08 | Phase 1 | Pending |
| DASH-01 | Phase 1 | Pending |
| DASH-02 | Phase 2 | Pending |
| DASH-03 | Phase 2 | Pending |
| DASH-04 | Phase 1 | Pending |
| DASH-05 | Phase 1 | Pending |
| DASH-06 | Phase 1 | Pending |
| CLI-01 | Phase 2 | Pending |
| CLI-02 | Phase 2 | Pending |
| CLI-03 | Phase 2 | Pending |
| CLI-04 | Phase 2 | Pending |
| CLI-05 | Phase 2 | Pending |
| CLI-06 | Phase 2 | Pending |
| CLI-07 | Phase 2 | Pending |
| CLI-08 | Phase 2 | Pending |
| CLI-09 | Phase 2 | Pending |
| ALERT-01 | Phase 2 | Pending |
| ALERT-02 | Phase 2 | Pending |
| ALERT-03 | Phase 2 | Pending |
| ALERT-04 | Phase 2 | Pending |
| ALERT-05 | Phase 2 | Pending |
| ALERT-06 | Phase 2 | Pending |
| ALERT-07 | Phase 2 | Pending |
| SDK-01 | Phase 2 | Pending |
| SDK-02 | Phase 2 | Pending |
| SDK-03 | Phase 2 | Pending |
| SDK-04 | Phase 2 | Pending |
| SDK-05 | Phase 2 | Pending |
| SDK-06 | Phase 2 | Pending |
| DEPLOY-01 | Phase 1 | Pending |
| DEPLOY-02 | Phase 1 | Pending |
| DEPLOY-03 | Phase 1 | Pending |
| DEPLOY-04 | Phase 3 | Pending |
| DEPLOY-05 | Phase 1 | Pending |
| DEPLOY-06 | Phase 1 | Pending |
| OBS-01 | Phase 1 | Pending |
| OBS-02 | Phase 1 | Pending |
| OBS-03 | Phase 1 | Pending |
| OBS-04 | Phase 1 | Pending |
| OBS-05 | Phase 2 | Pending |
| PRIV-01 | Phase 1 | Pending |
| PRIV-02 | Phase 1 | Pending |
| PRIV-03 | Phase 1 | Pending |
| PRIV-04 | Phase 2 | Pending |
| TELE-01 | Phase 3 | Pending |
| TELE-02 | Phase 3 | Pending |
| TELE-03 | Phase 3 | Pending |
| TELE-04 | Phase 3 | Pending |
| TELE-05 | Phase 3 | Pending |
| TELE-06 | Phase 3 | Pending |
| SETUP-01 | Phase 1 | Pending |
| SETUP-02 | Phase 1 | Pending |
| SETUP-03 | Phase 1 | Pending |
| SETUP-04 | Phase 1 | Pending |
| LAUNCH-01 | Phase 3 | Pending |
| LAUNCH-02 | Phase 3 | Pending |
| LAUNCH-03 | Phase 3 | Pending |
| LAUNCH-04 | Phase 3 | Pending |
| LAUNCH-05 | Phase 3 | Pending |
| LAUNCH-06 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 80 total
- Mapped to phases: 80
- Unmapped: 0

---
*Requirements defined: 2026-05-03*
*Last updated: 2026-05-03 after roadmap creation*
