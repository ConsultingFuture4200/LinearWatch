# Pitfalls Research

**Domain:** Self-hosted AI agent observability platform (Linear + GitHub + vendor API ingestion)
**Researched:** 2026-05-03
**Confidence:** HIGH (webhook/Postgres specifics verified against official docs); MEDIUM (identity resolver and privacy failure modes based on verified patterns + first-principles reasoning); LOW (vendor API stability — Cursor/Devin APIs are rapidly evolving)

---

## Critical Pitfalls

### Pitfall 1: Linear at-least-once delivery — duplicate `AgentSession` events silently inflate metrics

**What goes wrong:**
Linear guarantees at-least-once webhook delivery with up to 3 retries (at 1 min, 1 hour, 6 hours). If the receiver returns a non-200 or times out, the same event arrives again. Without idempotency on the `Linear-Delivery` UUID, a single session-end event is processed twice, doubling the reported cost and session count for that agent.

**Why it happens:**
Developers assume "one event = one write" and build a simple `INSERT`. The retry scenario only surfaces under load or after a brief outage window, not during local development. By launch the data is already dirty.

**How to avoid:**
- Use `Linear-Delivery` header UUID as a deduplication key in `events.raw_event`. Use `INSERT ... ON CONFLICT (delivery_id) DO NOTHING` as the first write in every ingestion path.
- Ack 200 within 5 seconds (Linear's hard timeout); enqueue processing out-of-band. Never do identity resolution, DB joins, or vendor calls synchronously in the webhook handler.
- Integration test: replay the same signed payload twice, assert exactly one row in `agent_sessions`.

**Warning signs:**
- `agent_sessions` rows where `cost_usd` is double the vendor API value for the same session ID.
- `events.raw_event` row count diverges from distinct `delivery_id` count by more than 0.1%.
- Prometheus metric `webhook_duplicate_deliveries_total > 0` during soak test.

**Phase to address:** P1 Foundation — deduplication must be in the first commit that touches the ingestion path. Retro-fitting it after data exists requires a migration and a data quality sweep.

**Severity if missed:** CRITICAL — every metric shown to design partners is wrong; trust destroyed before launch.

---

### Pitfall 2: AgentSession UI immediately visible to workspace users upon OAuth category enablement

**What goes wrong:**
Enabling the "agent session events" webhook category in your Linear OAuth application immediately activates the Agent Session UI for all workspace members — even if the sole intent is debugging. This is documented but easy to miss. A design partner workspace operator enables the category for testing and suddenly all their users see an agent-facing UI they did not expect.

**Why it happens:**
Developers treat "enable webhook category" as a receiver-side config change. Linear treats it as a feature gate toggle for the entire workspace UI. The coupling is not obvious from the webhook configuration screen.

**How to avoid:**
- Document this behavior prominently in the agentwatch setup wizard and quickstart guide: "Enabling this category will change your Linear workspace UI."
- In the setup wizard step for OAuth app configuration, show an explicit warning checkbox before proceeding.
- Use a dedicated test workspace (not a design partner's production workspace) for all initial development.

**Warning signs:**
- Design partner reports unexpected Linear UI changes after following the setup guide.
- Any test that validates webhook receipt also validates that the Linear OAuth app is configured with `app:assignable` scope — if that scope is set in a production org during testing, the UI change fires.

**Phase to address:** P1 Foundation — the setup wizard is a Phase 1 deliverable; this warning must be in the first draft of setup documentation.

**Severity if missed:** DEGRADED (for design partner trust) — wrong first impression; not a data correctness issue, but a relationship cost during the critical first-installation window.

---

### Pitfall 3: Linear webhook auto-disabled after endpoint downtime

**What goes wrong:**
If the agentwatch receiver is unresponsive for all three retry attempts (1 min, 1 hour, 6 hours — roughly 7 hours of total window), Linear silently disables the webhook. There is no outbound notification to the workspace operator. The agentwatch instance continues running but receives nothing. Dashboard shows no new activity. Operators assume no agents are active.

**Why it happens:**
Self-hosters take their container down for updates or a VPS goes offline. The 7-hour retry window is long enough that a routine maintenance window exhausts all retries.

**How to avoid:**
- Expose a Prometheus metric `linear_webhook_last_received_at` (epoch timestamp). Alert when `time.now - last_received_at > 2h` during business hours.
- Document the re-enable step in the runbook: "If no events received for 2+ hours, check Linear workspace settings → Webhooks → re-enable."
- In the setup wizard, include a connectivity test that fires a synthetic ping and validates round-trip.

**Warning signs:**
- Prometheus alert `AgentWatchIngestSilent`: no webhook received for > 2h during a window where Linear activity is expected.
- Dashboard "last event" timestamp in the header is stale.

**Phase to address:** P2 Enrichment — alerting infrastructure exists by P2; the liveness metric should be among the first Prometheus metrics added in P1.

**Severity if missed:** DEGRADED — silent data gap; operator does not know the tool has stopped working.

---

### Pitfall 4: GitHub webhook signature header mismatch — `X-Hub-Signature` vs `X-Hub-Signature-256`

**What goes wrong:**
GitHub sends both `X-Hub-Signature` (SHA-1, legacy) and `X-Hub-Signature-256` (SHA-256, current) when a webhook secret is configured. Code that reads the wrong header or falls back to SHA-1 silently accepts any payload without a valid SHA-256 signature. Worse: if the webhook secret is not configured, neither header is present, and naive code that checks `if header exists` rather than `if header is valid` passes all payloads.

**Why it happens:**
Tutorial code from 2021-2022 uses `X-Hub-Signature`. The newer SHA-256 variant arrived later. Copy-paste from old examples introduces the wrong header name. The error is silent in the happy path — verification "succeeds" when it should reject.

**How to avoid:**
- Verify `X-Hub-Signature-256` exclusively. Treat absence of the header as a hard 401, not a soft warning.
- Require the webhook secret to be configured before the receiver will start (fail-fast at boot with a clear error).
- Use constant-time comparison (`crypto.timingSafeEqual` in Node, `hmac.Equal` in Go). Never `===`.
- Test: assert that a request with a valid SHA-1 sig but no SHA-256 sig is rejected 401.

**Warning signs:**
- `events.raw_event` rows with `signature_valid = false` that weren't generated by the test suite.
- Any test or startup log that says "signature verification skipped in dev mode" — that flag should not exist.

**Phase to address:** P1 Foundation — signature verification is Day 1 code, not a later hardening pass.

**Severity if missed:** CRITICAL (security) — unsigned payloads accepted, enabling spoofed GitHub events that could inject false revert data or corrupt agent attribution.

---

### Pitfall 5: GitHub push/force-push ambiguity breaks revert detection

**What goes wrong:**
The revert-within-14d reliability signal depends on detecting when a commit introducing an agent's PR is later removed from the default branch. Force-push, squash-merge followed by `git revert`, and interactive rebase all produce different webhook events with different payloads. A squash merge of the revert PR looks identical to any other merge. A force-push does not emit a `pull_request.closed` event at all — only a `push` event where `before` != `forced`. Counting only `pull_request` closed events with `merged: false` misses the force-push case, inflating apparent reliability scores.

**Why it happens:**
Developers test the happy path (open PR, merge PR, open revert PR, merge revert PR) but not force-push. Force-push is common in fast-moving startups ("just rebase and push").

**How to avoid:**
- Implement revert detection as a three-signal vote: (1) a `pull_request` merged whose title matches `revert "..."`, (2) a `push` event to the default branch where `forced: true` and the `before` SHA matches the agent PR's merge commit, (3) a `push` event where the agent PR's commit SHA disappears from `compare` commits list.
- Any one signal within 14 days of the original merge sets `outcome = reverted`. No single signal is sufficient alone; require at least one.
- Test fixture set: one test per signal type. Integration test with a GitHub API mock that replays each scenario.
- Document the limitation: "squash-revert without PR title convention is undetectable without code diff analysis."

**Warning signs:**
- Design partner reports a reverted change not reflected in the dashboard.
- `reverted_at` null for sessions where the design partner knows a revert happened.

**Phase to address:** P2 Enrichment — revert detection is a P2 feature; this edge case handling must be scoped into the initial implementation, not added later.

**Severity if missed:** DEGRADED — reliability scores overstate agent quality; erodes trust once a design partner notices.

---

### Pitfall 6: Identity resolver silent mis-attribution — multiple agents sharing one Linear app user

**What goes wrong:**
Two agents (e.g., Cursor and an internal agent) are both installed using the same Linear OAuth application — a shortcut some teams take to avoid creating multiple apps. Both share the same `linear_app_user_id`. The identity resolver treats them as one agent. Every metric (cost, reliability, lineage) for one agent is polluted with the other's activity.

**Why it happens:**
Teams setting up agentwatch often have agents configured by different people with different levels of Linear admin access. Reusing an existing OAuth app is the path of least resistance.

**How to avoid:**
- In P1, add a detection heuristic: if a single `linear_app_user_id` is seen making sessions across what appear to be multiple vendor contexts (detected via SDK `session_start` events from different vendor fields, or via significantly different GitHub login patterns), surface this as a low-confidence resolver warning in the dashboard.
- Expose `resolver_confidence` as a Prometheus metric per `agent_id`. A shared-app case will show mixed vendor data that breaks expected patterns.
- Document in setup: "Each agent integration should use a distinct Linear OAuth application."

**Warning signs:**
- Single `agent_id` row in `agents` table with multiple distinct `vendor` values that shouldn't coexist (e.g., `cursor` and `internal`).
- `resolver_confidence` metric drops below 0.7 for an agent soon after a new agent is added to the workspace.
- Lineage view shows impossible parallel sessions (same `linear_app_user_id`, two simultaneous open sessions on different issues with different vendor cost patterns).

**Phase to address:** P1 Foundation (detection heuristic and confidence metric); P2 Enrichment (cross-source stitching makes the misattribution worse when GitHub is added).

**Severity if missed:** CRITICAL — incorrect attribution is the stated highest-risk failure mode in PRD §11. A metric that's confidently wrong is worse than a metric that's absent.

---

### Pitfall 7: Vendor session ID reuse and cost data staleness

**What goes wrong:**
Vendor session IDs (Cursor `session_id`, Devin `run_id`) are not globally unique across all time — they are sequential or short-UUIDs that can be reused across workspace resets or API key rotations. If agentwatch's vendor polling worker encounters a session ID it has already seen but from a different time window, it either deduplicates silently (missing the new session) or merges the cost data (inflating the old session's cost).

Additionally, vendor APIs publish cost data with lag. Cursor updated its billing model with a retroactive pricing change in June 2025 without advance notice. Stale cached cost values in `agent_sessions.cost_usd` that aren't refreshed within the 14-day enrichment window become permanently wrong.

**How to avoid:**
- Compose vendor session keys as `(vendor, workspace_id, session_id, started_at_date)` — the date component breaks ID reuse across time.
- For cost enrichment, store `cost_enriched_at` on `agent_sessions`. Re-poll vendor API for any session where `cost_enriched_at < now() - 1 day AND ended_at > now() - 14d`.
- Test: assert that two different sessions with the same raw vendor session ID but different `started_at` dates map to two distinct `agent_session_id` rows.
- Document vendor API risk in the runbook: "Vendor pricing APIs are unstable. If cost data looks wrong, check vendor changelog and re-run enrichment worker."

**Warning signs:**
- `cost_usd` values that are round numbers (e.g., exactly $0.00 or exactly matching a default) across many sessions from one vendor — signals enrichment worker silently deduplicating.
- Prometheus metric `enrichment_vendor_errors_total` spiking after a vendor billing model change.

**Phase to address:** P2 Enrichment — vendor API enrichment is a P2 deliverable; this must be designed into the enrichment worker's data model before the first vendor integration ships.

**Severity if missed:** DEGRADED — cost dashboard is wrong per-vendor; degrades trust but doesn't destroy the whole product if flagged.

---

### Pitfall 8: Synchronous processing in the webhook receiver breaks the p99 < 200ms target

**What goes wrong:**
The webhook receiver does HMAC verification, parses the payload, runs the identity resolver (which may query the DB), writes to `events.raw_event`, and returns 200 — all in the request handler. Under a Linear redelivery storm (Linear retries the same event at 1-minute backoff for all webhooks simultaneously after a brief outage), the connection pool is exhausted. DB write latency spikes. p99 goes from 40ms to 2+ seconds. Linear marks the receiver as unresponsive. The webhook is disabled. Repeat.

**Why it happens:**
The happy path (one event at a time) passes the 200ms target. Load testing is skipped because "it's a small-scale tool." Redelivery storms are not simulated.

**How to avoid:**
- The webhook handler must do exactly three things synchronously: verify HMAC, write the raw payload to an in-memory or DB queue (single fast `INSERT`), return 200. Identity resolution and enrichment are deferred to background workers.
- Set DB connection pool size explicitly. Default ORM pool sizes (Prisma defaults to 5 connections in some configs) are insufficient under burst. Add a Prometheus metric for pool wait time.
- Load test: simulate 200 concurrent identical payloads (the redelivery storm scenario). Assert p99 < 200ms.
- GitHub's hard timeout is 10 seconds (not 5 like Linear). Linear's is 5 seconds. Write tests against both.

**Warning signs:**
- Webhook handler code that calls `resolveIdentity()`, `fetchVendorCost()`, or any HTTP client before returning the response.
- ORM query appearing in the webhook handler other than the single raw event `INSERT`.
- `pg_stat_activity` shows webhook handler connections in `idle in transaction` state.

**Phase to address:** P1 Foundation — architectural decision about async processing must be made before the first line of webhook handler code.

**Severity if missed:** CRITICAL — triggers the webhook-disabled cascade; data collection stops under load.

---

### Pitfall 9: `events.raw_event` jsonb bloat and vacuum starvation at high ingestion rates

**What goes wrong:**
`events.raw_event` is an append-only table with `payload jsonb`. At high ingestion rates, PostgreSQL's HOT update optimization does not apply to jsonb-indexed columns, so any GIN index on `payload` generates one new index entry per insert, never pruning stale ones. The 30-day retention implementation via `DELETE WHERE received_at < now() - interval '30 days'` run as a cron job creates a wave of dead tuples. If autovacuum's default `scale_factor = 0.2` applies, vacuum does not trigger until 20% of the table is dead — at 1M rows, that's 200k dead tuples accumulating before vacuum fires.

**Why it happens:**
`events.raw_event` is treated as a log table, not a hot table. DBA-level settings are left at defaults. The problem is invisible at development scale (< 10k rows) and emerges between 100k and 1M rows.

**How to avoid:**
- Use monthly declarative partitioning on `events.raw_event` (partition by `received_at`). Drop the oldest partition instead of running `DELETE` cron jobs — no dead tuples, no vacuum, instant reclaim.
- If partitioning is deferred, set table-level autovacuum overrides on creation: `autovacuum_vacuum_scale_factor = 0.02`, `autovacuum_vacuum_cost_limit = 800`.
- Avoid GIN index on `payload jsonb` in v0. The raw event store exists for replay, not querying. A simple `btree` index on `(source, received_at)` is sufficient.
- Add a migration test that validates the partition pruning strategy by inserting 1000 rows in an "old" partition and asserting `DROP PARTITION` reclaims them.

**Warning signs:**
- `pg_stat_user_tables` shows `n_dead_tup > 100000` on `events.raw_event` without a recent vacuum.
- `pg_relation_size('events.raw_event') > 2 * pg_total_relation_size('events.raw_event') / 1.1` (over 10% bloat).
- Slow `SELECT` on `events.raw_event` for recent events despite a timestamp index — signals index bloat from dead GIN entries.

**Phase to address:** P1 Foundation — schema design must include partitioning strategy before first migration is committed. Retro-fitting partitioning on a live table is expensive.

**Severity if missed:** DEGRADED (initially) → CRITICAL (at scale) — self-hosters with busy workspaces report disk filling up and query performance degrading with no obvious cause.

---

### Pitfall 10: Postgres analytics query performance cliff at 100k sessions

**What goes wrong:**
Dashboard queries aggregate `agent_sessions` across 90-day windows grouped by `(agent_id, team_id, cycle_id)`. At 10k sessions, a sequential scan with a filtered sort completes in 80ms. At 100k sessions (roughly a team of 5 running 5 agents for 3 months), the same query takes 3-8 seconds — the p95 < 1s target is missed. The ORM generates N+1 queries when fetching agent dimension rows to hydrate the result set. A `REFRESH MATERIALIZED VIEW` on a 500k-row rollup table takes 45 seconds and blocks reads.

**Why it happens:**
Analytics workloads need different index strategies than OLTP. The fact table needs a composite index on `(agent_id, started_at DESC)` plus partial indexes per `outcome`. The ORM's default behavior is to lazy-load dimension data, generating N+1. Materialized view refresh is implemented as a cron job without `CONCURRENTLY`.

**How to avoid:**
- Design indexes at schema creation: `CREATE INDEX ON agent_sessions (started_at DESC)`, `CREATE INDEX ON agent_sessions (agent_id, team_id, started_at DESC)`, `CREATE INDEX ON agent_sessions (outcome) WHERE outcome = 'reverted'`.
- Always use `REFRESH MATERIALIZED VIEW CONCURRENTLY` in cron jobs (requires a unique index on the view).
- Benchmark with 100k synthetic rows before P3 Launch. Load the seed script in CI.
- For the dashboard query API, use a single SQL query with window functions rather than ORM joins.
- If `EXPLAIN ANALYZE` on the 90-day window query shows sequential scan on `agent_sessions`, add the index immediately — don't wait for "real traffic."

**Warning signs:**
- CI contains no performance benchmark test (query time assertions against seeded data).
- Dashboard queries use ORM methods like `findMany` with `include: { agent: true }` — this produces N+1.
- `pg_stat_statements` shows `agent_sessions` queries with `mean_exec_time > 500ms`.

**Phase to address:** P2 Enrichment — dashboard views are P2; index strategy must be finalized when the Reliability and Lineage views are built. P3 Launch should include a benchmark assertion in CI before launch.

**Severity if missed:** DEGRADED — dashboard becomes unusable for any design partner with a busy workspace; blocks launch.

---

### Pitfall 11: PgBouncer transaction-mode breakage from DATABASE_URL poolers

**What goes wrong:**
Self-hosters who already run PgBouncer in transaction mode (common in Supabase-style setups and Heroku-derived configs) point `DATABASE_URL` at the pooler. ORMs like Prisma use prepared statements by default. In PgBouncer transaction mode (versions before 1.21), prepared statements fail with `ERROR: prepared statement "s0" already exists` or silently execute the wrong statement. The error is intermittent — it only fires when two connections from different sessions happen to use the same statement name.

**Why it happens:**
The user's existing DATABASE_URL points at PgBouncer, not Postgres directly. The agentwatch docker-compose.yml points at its own Postgres container, which works fine in testing. The self-hoster overrides `DATABASE_URL` without reading the connection pooler compatibility note. The error is intermittent, so it doesn't appear during initial setup testing.

**How to avoid:**
- In the docker-compose.yml, use a `DATABASE_URL` that points to the bundled Postgres container (not a pooler). Document clearly: "If you use an external Postgres with PgBouncer, add `?pgbouncer=true` to the connection string or ensure PgBouncer >= 1.21 with `max_prepared_statements > 0`."
- If using Prisma, add `?pgbouncer=true&connection_limit=1` to the URL when a pooler is detected (can be hinted via env var `AGENTWATCH_USE_PGBOUNCER=true`).
- Add a startup health check that runs a prepared-statement smoke test and logs a clear warning if it fails.

**Warning signs:**
- `ERROR: prepared statement "s0" already exists` in logs after a few hours of operation.
- Errors are intermittent under concurrent load but absent in single-request testing.
- User reports "works fine on first request, fails on concurrent requests."

**Phase to address:** P3 Launch — deployment hardening phase; but document the risk in README as early as P1 when docker-compose is first published.

**Severity if missed:** DEGRADED (for some self-hosters) — subset of users with PgBouncer poolers report random failures; creates support burden.

---

### Pitfall 12: `LOG_LEVEL=debug` prints raw webhook payloads containing secrets

**What goes wrong:**
Debug logging in the webhook receiver logs the full request body before HMAC verification (to aid debugging). The raw GitHub `push` payload contains commit messages. The raw Linear `AgentSessionEvent` payload contains issue titles. In many setups, `LOG_LEVEL=debug` is set during initial deployment for troubleshooting and never turned off. The logs are shipped to a logging service (Grafana Loki, Datadog, Papertrail). Issue titles — which may contain customer names, internal project codenames, or security-sensitive descriptions — are now outside the instance.

A worse variant: if the HMAC verification step logs the raw `X-Hub-Signature-256` header value in an error traceback, the webhook secret is exposed in the log.

**Why it happens:**
Debug log everything early, clean it up later. "Later" never comes. The privacy guarantees in the PRD are enforced in code for the data path (title hashing) but not for the observability path (logs).

**How to avoid:**
- Structured logging rule: never log `req.body` or `event.payload` at any level. Log only `{ source, delivery_id, event_type, bytes_received }`.
- Log the HMAC check result (`valid: true/false`) not the secret or signature value.
- Add a linter rule or test: scan log output from the test suite for any string matching `sha256=` or `sha1=` — should be zero.
- In the README's self-hosting section: "Do not set LOG_LEVEL=debug in production. Debug logs do not redact webhook payloads."

**Warning signs:**
- Log output in CI/CD tests contains `payload:` followed by a JSON object.
- Structured log fields include `body`, `raw`, `headers`, or `signature`.
- `grep -r 'req.body' src/` finds any logger call.

**Phase to address:** P1 Foundation — logging discipline must be set in the first PR. It is far harder to audit and remove than to establish up front.

**Severity if missed:** CRITICAL (privacy/security) — violates the core privacy guarantee; potential GDPR issue if issue titles contain PII; trust-destroying if discovered after launch.

---

### Pitfall 13: Issue title hashing missed in a code path — a privacy guarantee that isn't

**What goes wrong:**
The PRD and privacy spec state that issue titles are hashed by default. The identity resolver, the enrichment worker, and the SDK ingest path each receive issue title strings. If any one of these paths writes `issues.title_hash` as `sha256(title.toLowerCase().trim())` but a different path writes it as `sha256(title)` (no normalization), two events for the same issue produce different hashes — the title appears twice with different pseudonyms, leaking comparative information. Worse, if a code path writes `issues.title` directly (even as a temporary debug field), the privacy guarantee is void.

**How to avoid:**
- Implement title hashing as a single pure function `hashTitle(raw: string): string` in a shared utility module. Every path that touches an issue title must call this function and nothing else.
- Add a type-level guard: the `issues` table type should have no `title: string` field — only `title_hash: string`. ORM schema enforces this.
- CI test: insert an issue with a known title, read back the row, assert that the raw title string does not appear anywhere in the returned data (even in JSONB columns or raw_event).
- Privacy audit checklist item for P3 Launch: `grep -r 'title' src/` and review every hit.

**Warning signs:**
- `issues` table schema has a `title` column that is nullable — "optional" fields become populated fields.
- Two rows in `issues` for the same `linear_id` with different `title_hash` values.
- Any log line containing `issue:` followed by a text string that looks like natural language.

**Phase to address:** P1 Foundation — the data model enforces this at schema definition time. If the column doesn't exist, it can't be populated.

**Severity if missed:** CRITICAL (privacy) — the project's stated privacy guarantee is a lie; any design partner who discovers this will revoke access and tell others.

---

### Pitfall 14: Telemetry opt-in flag checked too late — data sent before consent evaluated

**What goes wrong:**
The anonymized telemetry pipeline sends a daily rollup to the hosted aggregator. If the `TELEMETRY_OPT_IN` check is performed inside the aggregation function (after data has already been assembled) rather than at the point of deciding whether to assemble it, a code path exists where data is assembled and then discarded — but if a bug silences the discard, or if the discard is after network transmission, data has already left the instance. Real-world precedents: Claude Code's `DISABLE_TELEMETRY` flag was found to not prevent feature-flag evaluation calls; AWS CDK shipped a telemetry change and had to retract it after community pushback.

**How to avoid:**
- The `TELEMETRY_OPT_IN=true` check is the first line of the daily rollup job. If false, the job exits immediately without reading any data.
- Never assemble telemetry data "just to check if it's worth sending" before evaluating the flag.
- Integration test: start the service with `TELEMETRY_OPT_IN` unset (default), run the daily rollup job, assert zero outbound HTTP calls to the aggregator endpoint (intercept with a mock HTTP server).
- Test: start with `TELEMETRY_OPT_IN=true`, run rollup, assert exactly one call to the aggregator with the expected payload shape.

**Warning signs:**
- Rollup function accepts data as a parameter (meaning data was fetched before the function was called).
- Any network call in telemetry code before `if (!TELEMETRY_OPT_IN) return`.
- Telemetry test only checks the `true` case, not the `false`/unset case.

**Phase to address:** P3 Launch — telemetry pipeline is a P3 deliverable; but the opt-in check pattern should be established in P2 as soon as the telemetry module is scaffolded.

**Severity if missed:** CRITICAL (trust/privacy) — if users discover data left their instance without consent, the project's reputation is destroyed before it has a community. Open-source projects do not recover from this.

---

### Pitfall 15: GDPR delete not propagated to materialized rollups

**What goes wrong:**
If a workspace operator requests deletion of a specific agent's data (e.g., a terminated employee's internal agent, or a vendor agent removed from the workspace), a `DELETE FROM agents WHERE id = ?` plus cascading deletes on `agent_sessions` will remove the fact data but will not update materialized views. The deleted agent's cost and session data persists in rollup tables until the next scheduled `REFRESH MATERIALIZED VIEW`. In a weekly refresh schedule, data persists for up to 7 days after deletion.

**How to avoid:**
- Document the deletion contract: deletion marks the agent as `deleted_at` (soft delete), triggers an immediate `REFRESH MATERIALIZED VIEW CONCURRENTLY` on all rollup views that reference `agents`, and then physically deletes after the refresh completes.
- CLI command: `agentwatch agent purge <agent_id>` implements this sequence atomically.
- Provide a migration that adds `deleted_at` to `agents` and excludes soft-deleted agents from all materialized view definitions.
- Note: `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index on the view — establish this as a requirement when views are first created.

**Warning signs:**
- `REFRESH MATERIALIZED VIEW` called without `CONCURRENTLY` in any cron job or migration — this blocks reads.
- No `agentwatch agent purge` command exists or is tested.
- Materialized view definitions do not `WHERE deleted_at IS NULL`.

**Phase to address:** P2 Enrichment — materialized views are a P2 performance optimization; the deletion contract must be defined at the same time the views are created.

**Severity if missed:** DEGRADED (legal risk) — GDPR Article 17 (right to erasure); unlikely to be enforced against a small OSS project in v0, but becomes a blocker for any enterprise design partner.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip payload idempotency guard in dev | Faster local iteration | Silent duplicate events in production after any outage | Never — add it in P1 |
| Use ORM auto-generated schema migrations (no review) | Zero boilerplate | Missed index on `started_at`, dropped constraint causing bloat | Never for fact table; acceptable for dimension tables with review |
| GIN index on `events.raw_event.payload` | Flexible payload querying | HOT update disabled, index bloat at scale | Never in v0 — use raw table for replay only |
| In-process queue for webhook async processing | No Redis dependency | Queue lost on crash; events dropped on restart | Acceptable in v0 with a documented caveat; add persistence in v0.2 |
| `LOG_LEVEL=debug` in docker-compose.yml default | Easy onboarding debugging | Raw payloads in logs, tokens exposed | Never in shipped defaults |
| Synchronous identity resolution on ingest | Simple code path | P99 latency failure under load | Never — decouple from day 1 |
| Daily `DELETE` cron for raw event retention | Simple to implement | Dead tuple bloat, vacuum starvation | Acceptable only with aggressive autovacuum tuning + documented limit |
| Single `REFRESH MATERIALIZED VIEW` without CONCURRENTLY | Simpler query | Blocks all reads during refresh | Never in production; use CONCURRENTLY with a unique index |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Linear webhooks | Checking event type before verifying HMAC | Always verify HMAC first, reject 401 before reading payload fields |
| Linear webhooks | Processing in handler synchronously | Ack 200 in < 5s; enqueue for async processing |
| Linear OAuth | Using `admin` scope alongside `actor=app` | These scopes cannot be combined; `actor=app` requires its own distinct application |
| GitHub webhooks | Reading `X-Hub-Signature` (SHA-1) | Read `X-Hub-Signature-256` exclusively; treat absence as hard rejection |
| GitHub webhooks | Parsing body as JSON then re-serializing before verification | Verify against the raw byte buffer before any JSON parsing |
| GitHub App install | Shipping install flow in OSS requires users to create their own GitHub App | Document the GitHub App creation steps clearly; PAT is simpler to ship but weaker |
| Cursor API | Treating cost data as immutable after first fetch | Store `cost_enriched_at`; re-poll within 14-day window; Cursor changed pricing retroactively in 2025 |
| Devin API | Pagination assuming limit = 1000 | Devin reduced pagination limit from 1000 to 200 in Jan 2026; use cursor-based pagination |
| PgBouncer pooler | Pointing DATABASE_URL at transaction-mode pooler without ORM flags | Add `?pgbouncer=true` for Prisma or ensure PgBouncer >= 1.21 with prepared statement support |
| TLS / reverse proxy | Proxy strips or modifies body before HMAC verification | Verify HMAC on the raw body received before any proxy transformation; configure proxy to forward raw body |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous DB write in webhook handler | p99 > 200ms under load; Linear disables webhook | Write only raw event (single INSERT); defer all joins and enrichment | At ~50 concurrent requests or any Linear redelivery storm |
| Missing composite index on `(agent_id, started_at DESC)` | Dashboard 90-day queries take > 2s | Add index at schema creation; benchmark with 100k rows in CI | ~50k-100k rows in `agent_sessions` |
| ORM N+1 in dashboard query API | Response time grows linearly with agent count | Single SQL query with window functions; no lazy-load of dimension rows | ~20 agents in the workspace |
| `REFRESH MATERIALIZED VIEW` without CONCURRENTLY | Dashboard reads block during refresh | Add unique index on materialized views; always use CONCURRENTLY | Every refresh cycle; immediate on first use |
| Default autovacuum on insert-heavy `events.raw_event` | Table bloat, slow queries, disk pressure | Set `autovacuum_vacuum_scale_factor = 0.02` on table; prefer partitioning | ~500k rows without tuned autovacuum |
| Connection pool exhaustion (default pool = 5) | Intermittent timeouts, queue buildup | Set `DATABASE_POOL_SIZE` explicitly; expose pool wait time as Prometheus metric | ~20 concurrent webhook deliveries |
| In-memory deduplication cache for delivery IDs | Duplicate processing after pod restart | Use `events.raw_event.delivery_id` unique constraint as the authoritative guard | Any restart or multi-replica deployment |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Logging raw webhook body | Issue titles, commit messages, and tokens in log files | Structured log fields: `delivery_id`, `source`, `event_type`, `bytes` only |
| Logging signature header value in error path | Webhook secret exposed in log aggregator | Log `signature_valid: boolean` not the header value |
| Non-constant-time HMAC comparison | Timing oracle leaks whether signature is close to valid | Use `crypto.timingSafeEqual` (Node) / `hmac.Equal` (Go) |
| Default `DATABASE_URL` accessible without auth in docker-compose | Any process in the Docker network can connect to Postgres | Set `POSTGRES_PASSWORD` in docker-compose.yml; document as required, not optional |
| `TELEMETRY_OPT_IN` not evaluated at job entry point | Data leaves instance before consent check | Flag is first line of telemetry job; integration test validates zero-call behavior when unset |
| Raw webhook payloads retained indefinitely in `pg_dump` backup | 30-day retention violated in backup pipeline | Document that `pg_dump` includes `events.raw_event`; provide a `--exclude-table` flag for privacy-sensitive backups |
| Agent API key stored in plaintext in `agents` table | Leaked API key grants full agent impersonation | Store API keys as bcrypt hashes; provide key rotation CLI command |

---

## "Looks Done But Isn't" Checklist

- [ ] **Webhook idempotency:** Delivery UUID uniqueness constraint exists in `events.raw_event.delivery_id`. Verify: insert the same payload twice, assert one row.
- [ ] **HMAC rejection:** Webhook receiver returns 401 (not 400 or 200) for payloads with no signature header. Verify: send unsigned POST, assert 401.
- [ ] **Title hashing completeness:** Every code path that touches an `issues` row calls the shared `hashTitle()` function. Verify: `grep -r 'title' src/` returns only calls to `hashTitle`, no raw string assignments.
- [ ] **Telemetry off by default:** `TELEMETRY_OPT_IN` unset → zero outbound HTTP calls to aggregator. Verify: integration test with mock HTTP server.
- [ ] **Async webhook processing:** `resolveIdentity()` does not appear in the webhook handler's call stack. Verify: profiler trace or code review.
- [ ] **Revert detection multi-signal:** All three revert signals (merged revert PR, force-push removing commit, push event with `forced: true`) are tested with fixture payloads.
- [ ] **Partition drop replaces DELETE cron:** `events.raw_event` uses declarative partitioning; no `DELETE WHERE received_at < ...` cron job exists.
- [ ] **Materialized view refresh is CONCURRENTLY:** No `REFRESH MATERIALIZED VIEW` statement in codebase without `CONCURRENTLY`. Verify: `grep -r 'REFRESH MATERIALIZED VIEW' src/' | grep -v CONCURRENTLY` returns empty.
- [ ] **`docker compose up` actually works on a clean laptop:** CI runs a full `docker compose up` on a fresh image with no pre-existing volumes and validates the health endpoint responds within 5 minutes.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Duplicate events already in `agent_sessions` | HIGH | Identify affected sessions via `delivery_id` cross-reference; re-run identity resolver from `events.raw_event`; truncate and recompute `agent_sessions` for affected window |
| Webhook disabled by Linear | LOW | Re-enable webhook in Linear workspace settings; no data loss if `events.raw_event` retained events from before disable; replay from raw store |
| Issue titles leaked in logs | CRITICAL / IRREVERSIBLE | Rotate all Linear API tokens immediately; purge affected log segments; notify affected workspace operators; audit what data reached external log services |
| Telemetry sent before opt-in | HIGH / IRREVERSIBLE | Publish a post-mortem; provide a data deletion request endpoint on the aggregator; patch the opt-in check; release a hotfix version immediately |
| `events.raw_event` disk bloat | MEDIUM | If partitioned: `DROP TABLE events_raw_event_YYYY_MM`; if not: `DELETE + VACUUM FULL` (requires downtime); add partitioning going forward |
| Vendor API session ID collision causing merged costs | MEDIUM | Re-fetch raw events for affected vendor; recompute `agent_sessions.cost_usd` using composite key; add migration to enforce composite key uniqueness |
| GDPR delete not propagated to views | MEDIUM | Run `REFRESH MATERIALIZED VIEW CONCURRENTLY` on all views immediately; implement `agent purge` CLI command; verify with `SELECT` against view post-refresh |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Severity | Verification |
|---------|-----------------|----------|--------------|
| Linear at-least-once duplicate delivery | P1 Foundation | CRITICAL | Integration test: replay same payload twice, assert one row |
| AgentSession UI visible on category enable | P1 Foundation | DEGRADED | Setup wizard includes warning; documented in quickstart |
| Linear webhook auto-disabled on downtime | P1 Foundation (metric) + P2 (alerting) | DEGRADED | Prometheus alert `AgentWatchIngestSilent` fires in test |
| GitHub SHA-1 vs SHA-256 signature header | P1 Foundation | CRITICAL | Test: SHA-1-only request → 401 |
| Force-push / squash revert detection gap | P2 Enrichment | DEGRADED | Test fixture for each of 3 revert signal types |
| Multiple agents sharing one Linear app user | P1 Foundation (detection) + P2 (stitching) | CRITICAL | `resolver_confidence` metric; dashboard low-confidence row |
| Vendor session ID reuse / cost staleness | P2 Enrichment | DEGRADED | Composite vendor session key; `cost_enriched_at` re-poll |
| Synchronous processing breaks p99 target | P1 Foundation | CRITICAL | Load test: 200 concurrent payloads, assert p99 < 200ms |
| `events.raw_event` jsonb bloat + vacuum | P1 Foundation | CRITICAL at scale | Partitioned schema in first migration; no GIN index |
| Analytics query performance cliff | P2 Enrichment + P3 Launch | DEGRADED | CI benchmark: 100k row seed, assert p95 < 1s |
| PgBouncer transaction-mode breakage | P3 Launch | DEGRADED | README note + `?pgbouncer=true` ORM config doc |
| `LOG_LEVEL=debug` leaks payloads | P1 Foundation | CRITICAL | `grep -r 'req.body' src/` returns empty; log output test |
| Issue title hashing missed in code path | P1 Foundation | CRITICAL | Type-level guard; CI privacy assertion |
| Telemetry opt-in flag checked too late | P3 Launch (pipeline) | CRITICAL | Integration test: zero outbound calls when unset |
| GDPR delete not propagated to views | P2 Enrichment | DEGRADED (legal) | `agent purge` CLI command + soft-delete + CONCURRENTLY refresh |

---

## Sources

- [Linear Webhooks — Developer Docs](https://linear.app/developers/webhooks) (delivery, retry, at-least-once semantics, OAuth scope requirement, webhook disable behavior)
- [Linear Agent Interaction — Developer Docs](https://linear.app/developers/agent-interaction) (AgentSession event types, 5-second timeout, category-enables-UI gotcha, Developer Preview status)
- [Linear Getting Started — Agent Docs](https://linear.app/developers/agents) (plan requirements: Agent/Skills on all plans; Automations/Code Intelligence on Business/Enterprise)
- [GitHub — Validating Webhook Deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) (X-Hub-Signature-256 vs X-Hub-Signature, HMAC verification, body serialization warning)
- [GitHub — Webhook Events and Payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) (push event structure, forced flag, 25 MB payload cap, 20-commit truncation)
- [GitHub — Deciding When to Build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app) (App vs PAT tradeoffs)
- [PgBouncer FAQ](https://www.pgbouncer.org/faq.html) (transaction mode prepared statement incompatibility)
- [Crunchy Data — Prepared Statements in Transaction Mode for PgBouncer](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer) (PgBouncer 1.21 fix, max_prepared_statements)
- [Prisma — Configure with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer) (pgbouncer=true connection string flag)
- [DEV Community — No HOT updates on JSONB](https://dev.to/mongodb/no-hot-updates-on-jsonb-13k7) (write amplification on jsonb indexes)
- [Tembo — Optimizing Postgres Autovacuum for High-Churn Tables](https://www.tembo.io/blog/optimizing-postgres-auto-vacuum) (scale_factor tuning)
- [Tinybird — Outgrowing Postgres: OLAP Workloads](https://www.tinybird.co/blog/outgrowing-postgres-how-to-run-olap-workloads-on-postgres) (when Postgres stops being enough)
- [Hookdeck — Why Stop Processing Webhooks Synchronously](https://hookdeck.com/webhooks/guides/why-you-should-stop-processing-your-webhooks-synchronously) (ack-first pattern)
- [Cursor Pricing Change — Community Backlash Jun/Jul 2025](https://www.vantage.sh/blog/cursor-pricing-explained) (retroactive billing model change)
- [Devin API Release Notes](https://docs.devin.ai/api-reference/release-notes) (pagination limit reduced 1000 → 200, Jan 2026; cursor-based pagination)
- [GDPR Right to Erasure — DEV Community](https://dev.to/custodiaadmin/gdpr-right-to-erasure-what-the-right-to-be-forgotten-actually-requires-493n) (materialized view propagation requirement)
- [GitHub — Telemetry opt-in flag checked too late — Claude Code issue](https://github.com/anthropics/claude-code/issues/10494) (real-world example of telemetry opt-out bypass)
- [AWS CDK — Telemetry controversy Dec 2025](https://github.com/aws/aws-cdk/issues/34892) (opt-in vs opt-out community expectation)
- [Prequel — Real State of Helm Chart Reliability 2025](https://www.prequel.dev/blog-post/the-real-state-of-helm-chart-reliability-2025-hidden-risks-in-100-open-source-charts) (Helm chart quality gaps, resource limit omissions)

---

*Pitfalls research for: agentwatch — self-hosted AI agent observability platform*
*Researched: 2026-05-03*
