# Project Research Summary

**Project:** linearwatch
**Domain:** Self-hosted AI agent observability (Linear + GitHub + vendor API ingestion → Postgres → dashboard + CLI + SDKs)
**Researched:** 2026-05-03
**Confidence:** HIGH

---

## Executive Summary

linearwatch is APM for AI agents anchored on Linear — a self-hosted analytics layer that ingests Linear Agent Session webhooks, GitHub PR outcomes, and vendor cost APIs; resolves them into a unified cross-vendor agent identity; and exposes cost, reliability, and lineage views through a dashboard, CLI, and YAML-defined alert rules. The closest existing analogs are Langfuse (LLM cost tracking), Sleuth (DORA metrics), and Definity (data pipeline lineage) — none of which cross vendor boundaries or tie cost to issue outcomes. linearwatch's core IP is the identity resolver that stitches `linear_app_user_id`, `github_login`, and `vendor_session_id` into a single `agent_id`. Everything else is downstream of that.

The recommended approach is a TypeScript-throughout monorepo: Fastify for the webhook receiver and query API, Drizzle ORM with a star schema on Postgres 16, Graphile Worker for background job scheduling (enrichment, alerts, telemetry), and Next.js 15 App Router for the dashboard. The CLI is built with commander and compiled to a self-contained binary via Bun. No Redis, no Kafka, no TSDB — Postgres only. Two containers in the default compose file (`web`, `worker`, `postgres`) achieves the `docker compose up` in 5 minutes constraint. This is the Langfuse v2 architecture pattern before they split at scale; it is the right call for a 90-day solo build targeting sub-100k sessions/month.

The dominant risks concentrate in three areas. First, correctness: without idempotency on webhook delivery IDs, any Linear retry inflates every metric; without constant-time HMAC comparison on GitHub webhooks, attacker-supplied payloads inject false revert data; without a single shared `hashTitle()` utility enforced at the type level, one code path leaks issue titles and destroys the privacy guarantee. These are Day 1 schema and handler decisions that cannot be retrofitted. Second, identity resolution: a shared Linear OAuth app across two agents silently merges their data with no warning — the highest-trust-cost failure mode in the product. Third, telemetry: if `TELEMETRY_OPT_IN` is checked anywhere but the first line of the daily rollup job, data leaves the instance before consent is evaluated — a community-ending mistake with two documented real-world precedents (Claude Code, AWS CDK).

---

## Key Findings

### Recommended Stack

TypeScript throughout is the correct call: the Node SDK is a first-class deliverable, and a split-language repo (Go server + Node SDK) doubles CI pipelines, contributor onboarding, and identity resolver logic for no performance gain at linearwatch's scale. Fastify's p99 of 15-30ms on the raw HTTP path leaves 10x headroom under the 200ms webhook ack SLA. Drizzle's `sql` escape hatch is essential for the rolling-window analytics queries the dashboard needs; Prisma's migration UX and lack of clean window-function access makes it the wrong choice here. Bun `--compile` solves the single-binary CLI requirement without leaving the TypeScript ecosystem.

**Core technologies:**

- **Node.js 22 LTS + TypeScript 5.x** — single language across server, CLI, and SDK; eliminates the split-language cost
- **Fastify 5.8.x** — webhook receiver and query API; 2-3x faster than Express; schema-based validation built-in; 45-55k req/s on Node 22
- **Drizzle ORM 0.45.x** — star-schema migrations + `sql` escape hatch for window functions; 2x faster than Prisma on simple selects
- **Postgres 16** — sole data store; no Redis, no Kafka, no TSDB; Postgres-only is a deployment-simplicity constraint, not a performance compromise at target scale
- **Graphile Worker** — Postgres-native job queue + cron; LISTEN/NOTIFY for sub-5ms job pickup; catches up on missed schedules at startup; no Redis required
- **Next.js 15.5 App Router** — dashboard; RSC + Suspense streaming for progressive chart rendering; shadcn/ui compatible
- **Bun 1.x `--compile`** — self-contained CLI binary (no Node runtime on target); 95-98% Node API compat; used by Anthropic for Claude Code CLI
- **prom-client 15.x** — Prometheus `/metrics` endpoint; zero-config scraping for self-hosters running k8s or Grafana stacks
- **pino 9.x** — structured JSON logging; 5x faster than Winston; native Fastify integration

**Explicit avoid:** Redis (Postgres-only constraint), Prisma (window-function UX), BullMQ (needs Redis), oclif (120ms cold start vs commander's 22ms), `vercel/pkg` (unmaintained; 90MB+ binary), Winston, any TSDB.

### Expected Features

Self-hosters in this space (Plausible, Langfuse, PostHog self-hosted) have formed hard expectations: two containers max, no cloud dependency, env vars for all config, README as the product, source code they will read. Missing table-stakes features is a Show HN comment, not a polite suggestion.

**Must-have (table stakes) — missing any one of these is Show HN liability:**

- Cost per agent / team / cycle + cost-per-closed-issue — the product's thesis in one view
- Reliability: success rate + revert-within-14d + TTR distribution (p50/p95)
- Per-issue agent timeline / lineage view — the cross-vendor differentiator; nothing else ships this
- Identity resolver confidence surfaced in dashboard — low-confidence attribution erodes all trust
- `docker compose up` in < 5 min, Postgres only
- Two default YAML alert rules (cost spike + revert-rate spike)
- CLI `query`, `report`, `lineage`, `tail` — self-hosters check for CLI before installing
- Slack + generic webhook notifications
- Issue title hashing by default — privacy default must ship before public launch
- Prometheus `/metrics` endpoint
- Opt-in anonymized telemetry (`TELEMETRY_OPT_IN=true` env var, off by default)
- `linearwatch setup` first-run wizard

**Should-have (differentiators):**

- Cross-source identity resolver (Linear + GitHub + vendor) — the core IP; no other tool ships it
- Model-tier cost breakdown (frontier/mid/small) — more stable than per-model tracking across vendor version changes
- `linearwatch lineage LIN-1234` CLI command — one command, every agent that touched an issue
- Two default rule packs shipped in-box — lowers time-to-first-alert from hours to minutes

**Defer to v2+:**

- Period-over-period cost delta (WoW/MoM) — no value until 14+ days of data per workspace
- Top-N cost consumers ranked table — needs identity resolver confidence > 95% first
- Discord/Teams notifications — generic webhook covers it; community PRs in v0.2
- Natural language query — deferred to v0.2 per PRD; NL translates to DSL, not raw SQL
- GitHub App (replace PAT) — PAT is fine for v0 single-tenant evaluation installs

**Hard anti-features (actively refuse):**

- Embedded LLM for auto-remediation — observability tool, not a control plane; one wrong remediation exceeds the value of many correct ones
- Multi-tenancy in v0 — tenant isolation multiplies every other problem; one Postgres = one workspace
- Custom SQL in rule engine — DSL in version-controlled YAML + SQL injection = bad combination
- Real-time WebSocket dashboard — 60-second enrichment lag is the real bottleneck; sub-second UI does not help
- SSO/SAML/OIDC — reverse-proxy auth covers single-tenant self-hosting; SSO belongs in a future hosted tier

### Architecture Approach

Two containers (`web`, `worker`) + `postgres:16-alpine` is the correct v0 layout. The web container runs Next.js (dashboard + query API + webhook receiver). The worker container runs Graphile Worker (identity resolver jobs, enrichment cron, alert cron, telemetry cron). The webhook handler does exactly three things synchronously: verify HMAC, single INSERT to `events.raw_event`, respond 200. Everything else is async in the worker. All dashboard reads go through `POST /api/v1/query`, which the CLI also uses. This boundary is load-bearing: dashboard bypassing the query API causes CLI and dashboard to drift, and the query API becomes vestigial.

**Major components:**

1. **Webhook receiver** (`web` container, Next.js API routes) — HMAC verify → single INSERT → 200 → enqueue job; target p99 < 200ms
2. **Identity resolver** (Graphile Worker job type) — maps `(linear_app_user_id, github_login, vendor_session_id)` → `agent_id` with confidence scoring; state machine: `NEW_AGENT → PENDING_CONFIRMATION → AUTO_PROMOTED / CONFIRMED`
3. **Enrichment worker** (Graphile Worker, 60s cron + triggered jobs) — vendor API cost polling, GitHub PR outcome enrichment, `cost_by_agent_daily` rollup refresh
4. **Alert engine** (Graphile Worker, 5-min cron) — YAML rule evaluation; notification dispatch; dedup via `alert_events` table
5. **Query API** (`POST /api/v1/query`) — constrained DSL with enumerated metrics/dimensions; no arbitrary SQL; used by dashboard and CLI alike
6. **Star schema** — `agent_sessions` (fact) + `agents`/`issues`/`teams`/`cycles`/`repos` (dimensions) + `events.raw_event` (raw store, monthly partitioned) + `identity_mappings` (resolver state)
7. **CLI binary** (`packages/cli/`, commander, Bun-compiled) — thin HTTP client against query API; no direct DB access
8. **SDKs** — Node (`packages/sdk-node/`, tsup → ESM+CJS+d.ts); Python (`packages/sdk-python/`, uv+httpx); both post to `/api/v1/sdk/event`

**Schema-first constraint:** `events.raw_event` must use declarative monthly partitioning from the first migration. Retrofitting partitioning on a live table requires a migration + downtime, and the vacuum/bloat problem hits without it at ~100k rows.

**Query API constraint:** `MetricName` is a Zod enum. Each metric maps to a static SQL function in `src/query/metrics.ts`. Unknown metric/dimension combinations return 400. This is a safety property enforced at the type level.

### Critical Pitfalls

Eight pitfalls carry CRITICAL severity and all map to Phase 1 Foundation. They cannot be retrofitted:

1. **Webhook deduplication missing** — Linear at-least-once delivery with 3 retries silently doubles every metric without `INSERT ... ON CONFLICT (source, upstream_id) DO NOTHING` as the first write. Add the unique constraint before the first ingestion commit.

2. **Synchronous processing in webhook handler** — Any identity resolution, DB join, or vendor API call before returning 200 causes redelivery storms to exhaust the connection pool and trigger Linear's webhook-disable. Handler does exactly: HMAC verify → single INSERT → return 200. Verify: 200 concurrent payloads, p99 < 200ms.

3. **GitHub SHA-256 signature not enforced** — Old tutorial code uses `X-Hub-Signature` (SHA-1). Correct header is `X-Hub-Signature-256`. Absence = hard 401. Non-constant-time comparison leaks timing oracle. Verify: SHA-1-only request returns 401.

4. **Issue title hashing has multiple code paths** — Normalization inconsistency across ingest paths produces different hashes for the same title. Enforce via a single `hashTitle(raw: string): string` utility; no `title: string` field in the `issues` ORM type. Verify: CI asserts raw title string never appears in any returned row.

5. **`LOG_LEVEL=debug` leaks raw webhook payloads** — Debug logging of `req.body` before HMAC verification puts issue titles and signature values into log aggregators. Structured log fields only: `delivery_id`, `source`, `event_type`, `bytes_received`. Verify: `grep -r 'req.body' src/` returns empty.

6. **Shared Linear OAuth app across multiple agents** — Two agents on the same `linear_app_user_id` are silently merged by the resolver. Add a detection heuristic in P1: if one `linear_app_user_id` shows sessions with multiple distinct vendor contexts, surface a low-confidence resolver warning. Expose `resolver_confidence` as a Prometheus metric.

7. **Telemetry opt-in evaluated too late** — `TELEMETRY_OPT_IN` must be the first line of the daily rollup job, before any data is read. Real-world precedents: Claude Code bypassed `DISABLE_TELEMETRY`; AWS CDK telemetry controversy. Verify: mock HTTP interceptor asserts zero outbound calls when flag is unset.

8. **`events.raw_event` vacuum starvation** — Unpartitioned jsonb table with daily DELETE cron accumulates dead tuples. Default `autovacuum_vacuum_scale_factor = 0.2` means vacuum does not fire until 20% of the table is dead. Use monthly declarative partitioning with `DROP PARTITION` for retention instead. No GIN index on payload. Schema-first decision.

---

## Implications for Roadmap

The three PRD phases (Foundation 1-21, Enrichment 22-60, Launch 61-90) map cleanly to the architecture build order. The single non-obvious constraint: **schema, idempotency, HMAC verification, and title hashing are all Phase 1 decisions that cannot be retrofitted.** The identity resolver is the spine — Phase 2 cannot ship cross-source attribution without Phase 1's Linear-only resolver working.

### Phase 1: Foundation (Days 1-21)

**Rationale:** Schema bugs, missing idempotency, or wrong HMAC verification produce permanently corrupt data requiring truncate-and-replay. These decisions cannot be deferred.

**Delivers:**
- Postgres schema with partitioned `events.raw_event`, star schema tables, all indexes from ARCHITECTURE.md
- Webhook receiver: Linear HMAC verify → single INSERT → 200 → enqueue (async only, no sync processing)
- Graphile Worker scaffolded with `resolve_identity` job type
- Identity resolver v0: Linear-only, confidence scoring, `identity_mappings` state machine
- Query API skeleton: 2-3 metrics, `agent` + `team` dimensions
- Cost dashboard view consuming query API (not direct DB)
- `linearwatch setup` wizard with explicit warning about AgentSession UI visibility toggle
- Issue title hashing enforced at ORM type level

**CRITICAL pitfalls to eliminate in P1:** all 8 listed above (deduplication, async-only handler, SHA-256 enforcement, title hashing completeness, debug log discipline, shared-app detection, telemetry guard pattern established early, partitioned schema).

**Research flag:** Standard patterns — Graphile Worker, Fastify, Drizzle star schema, Postgres webhook idempotency all well-documented. Skip `/gsd-research-phase` for P1.

### Phase 2: Enrichment (Days 22-60)

**Rationale:** Cross-source attribution is the core IP and requires P1's Linear-only resolver as a foundation. GitHub enrichment, vendor API cost enrichment, and the cross-source resolver are all prerequisites for cost-per-outcome, revert-rate, and lineage. None of these metrics is meaningful until all three are stable.

**Delivers:**
- GitHub webhook receiver (established SHA-256 pattern from P1)
- Cross-source identity resolver (extends P1 resolver with `github_login` + `vendor_session_pattern` signals)
- Vendor API enrichment worker: Cursor first, `enrich_session` job type with composite key `(vendor, workspace_id, session_id, started_at_date)` and 14-day re-poll
- `cost_by_agent_daily` rollup table + daily refresh job (alert engine prerequisite)
- Remaining query metrics: `revert_rate`, `success_rate`, TTR distributions
- Reliability + Lineage dashboard views
- Alert engine: YAML rule evaluation, two default rule packs, Slack + generic webhook notifications
- CLI binary: `query`, `report`, `lineage`, `tail` (all via query API)
- Node SDK + Python SDK (parallel with CLI, no shared code)
- `watch_revert_window` cron: three-signal revert detection (merged revert PR + force-push + `forced: true` push event)
- GDPR `agent purge` CLI command + soft-delete + `REFRESH MATERIALIZED VIEW CONCURRENTLY` on deletion

**Pitfalls to handle in P2:**
- Revert detection: implement all three signal types with test fixtures for each (Pitfall 5)
- Vendor session ID reuse: composite vendor key enforced (Pitfall 7)
- Analytics query performance: 100k synthetic row benchmark before P3 handoff (Pitfall 10)
- GDPR delete propagation to rollup views (Pitfall 15)

**Research flag:** Vendor API enrichment (Cursor + Devin) has LOW confidence — both APIs are rapidly evolving. Cursor changed pricing retroactively in June 2025; Devin reduced pagination limit in January 2026. Build enrichment worker with graceful degradation from the start. Plan a P2 mid-phase check against current vendor API docs before building the pagination loop.

### Phase 3: Launch (Days 61-90)

**Rationale:** Telemetry pipeline, production hardening, and documentation are the final gate before Show HN. The benchmark blog post requires real opt-in data from design partners, which requires the telemetry pipeline to ship with privacy guarantee confirmed in code.

**Delivers:**
- Telemetry pipeline: anonymizer + daily Graphile Worker job with `TELEMETRY_OPT_IN` as first conditional
- Telemetry aggregator: minimal Fly.io service, single `/v1/ingest` endpoint, Postgres storage (< $5/month at launch scale)
- Helm chart + production docker-compose hardening (review against Prequel 2025 checklist: resource limits, liveness probes, PodDisruptionBudgets)
- Documentation site: quickstart, SDK reference, configuration reference
- CI: 100k-row seed + `p95 < 1s` assertion on dashboard queries; cold-start `docker compose up` smoke test on clean image
- Public benchmark blog post drafted from opt-in data

**Pitfalls to eliminate in P3:**
- Telemetry opt-in guard: integration test with mock HTTP interceptor, zero calls when unset (Pitfall 14)
- PgBouncer transaction-mode breakage: documented in README, `?pgbouncer=true` flag documented (Pitfall 11)
- Analytics performance cliff: CI benchmark assertion before launch (Pitfall 10)
- Privacy audit: `grep -r 'title' src/` and `grep -r 'req.body' src/` both return clean

**Research flag:** Helm chart quality is a known gap category (Prequel 2025 analysis). Schedule an explicit Helm chart review against that checklist as a P3 exit criterion.

### Phase Ordering Rationale

- Schema-first is non-negotiable: `events.raw_event` partitioning and `agent_sessions` indexes cannot be retrofitted onto a live table without migration and downtime.
- Identity resolver is P1 exit criteria for P2: cross-source resolver requires Linear-only resolver as foundation; this is a hard build-order dependency.
- `cost_by_agent_daily` rollup precedes alert engine: anomaly detection reads from the rollup, not live `agent_sessions`. ARCHITECTURE.md node [14] (alert engine) depends on [11] (rollup table).
- CLI and SDKs are parallel-safe with P2 dashboard views: both consume the same query API; no shared code. They must ship in P2, not P3 — they are Show HN table stakes.
- Telemetry ships last: requires enrichment worker to populate the `outcome` column and privacy controls confirmed working in code. Shipping before both holds is the trust-destroying scenario.

### Cross-Cutting Decisions (Span Multiple Research Dimensions)

| Decision | Spans | Recommendation |
|----------|-------|----------------|
| **Identity resolver confidence threshold** | ARCHITECTURE (signal weights) + FEATURES (confidence in dashboard) + PITFALLS (mis-attribution) | Default `IDENTITY_CONFIDENCE_THRESHOLD=0.8` env var; `resolver_confidence` as Prometheus metric; validate with design partners in P2; do not hardcode |
| **Idempotency key composition** | ARCHITECTURE (idempotency strategy) + PITFALLS (duplicate delivery) | Linear: `Linear-Delivery` header; GitHub: `X-GitHub-Delivery` UUID; SDK: caller-supplied key or `sha256(session_id + event_type + timestamp_bucket)`; unique constraint in DB, not application-layer dedup |
| **Telemetry opt-in placement** | FEATURES (opt-in telemetry) + PITFALLS (flag checked too late) + ARCHITECTURE (telemetry job) | `TELEMETRY_OPT_IN` is the first conditional in the Graphile Worker `emit_telemetry` task; if false, return before any DB read; integration test validates zero-call behavior |
| **Query API constraint enforcement** | ARCHITECTURE (constrained DSL) + FEATURES (anti-feature: custom SQL) + STACK (Zod) | `MetricName` and `DimensionName` are Zod enums; each metric maps to a named SQL function in `src/query/metrics.ts`; unknown combinations return 400 with clear error |
| **Sample data / first-install UX** | FEATURES (self-hoster empty-dashboard problem) + ARCHITECTURE (replay model) | Ship a `--seed` flag on `linearwatch setup` that inserts synthetic sessions; validate hypothesis with P1 design partners before investing in a full demo workspace |

### Open Questions for Design Partners

These require real data — research cannot resolve them:

1. **Confidence threshold validation:** Is 0.8 the right auto-promotion threshold? Review `resolver_confidence` distribution across design partners in P2 before hardening.
2. **Revert window default:** PRD has `revert-within-7d` in one place and 14d elsewhere. Confirm with design partners before finalizing `watch_revert_window` cron interval and schema column name.
3. **Vendor API stability:** Cursor pricing changed retroactively in June 2025; Devin pagination changed in January 2026. Design partners with Cursor installed can validate whether the 14-day re-poll window is sufficient.
4. **Sample data adequacy:** A `--seed` flag with synthetic sessions is the hypothesis for the empty-dashboard problem. P1 design partner feedback will confirm or refute.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core choices verified against official docs; version compatibility confirmed; Node vs Go decision is definitive at linearwatch's scale |
| Features | MEDIUM-HIGH | Adjacent spaces well-documented; agent-specific patterns extrapolated; confidence threshold tuning needs real-world validation |
| Architecture | HIGH | Design questions resolved against documented comparable systems (Langfuse, Umami, Graphile Worker); idempotency and schema strategies are proven patterns |
| Pitfalls | HIGH (webhook/Postgres) / MEDIUM (identity resolver) / LOW (vendor APIs) | Webhook and Postgres pitfalls verified against official docs and community incidents; vendor API stability is a known unknown |

**Overall confidence:** HIGH for P1 and P3 decisions; MEDIUM for P2 vendor API enrichment specifics.

### Gaps to Address

- **Vendor API stability (LOW confidence):** Cursor and Devin APIs are rapidly evolving. Build enrichment worker with graceful degradation from day one. Plan a P2 mid-phase check against current vendor changelogs before finalizing the pagination loop.
- **Identity resolver threshold tuning (needs real data):** The 0.8 auto-promotion threshold is an informed starting point. Expose as `IDENTITY_CONFIDENCE_THRESHOLD` env var; review with design partners in P2 before hardening.
- **Revert window inconsistency in PRD:** `revert-within-7d` appears in one PRD location, 14d in another. Resolve before `agent_sessions.reverted_at` column and `watch_revert_window` cron window are finalized.
- **Sample data / first-install UX:** Research confirms empty dashboards cause tab-closes. Validate `--seed` flag hypothesis in P1 with design partners.
- **Devin API pagination:** Changed from 1000 to 200 items per page in January 2026. Verify current state against Devin API docs before building the enrichment worker pagination loop.

---

## Sources

### Primary (HIGH confidence)

- Linear Webhooks Developer Docs — at-least-once delivery, retry semantics, 5s timeout, webhook disable behavior, AgentSession category, OAuth scope constraints
- GitHub Webhooks Docs — `X-Hub-Signature-256` vs SHA-1, `X-GitHub-Delivery` UUID, body serialization requirement before HMAC verification
- Fastify benchmarks (fastify.dev) — 45-55k req/s on Node 22; p99 headroom under 200ms SLA verified
- Drizzle ORM docs + northwind benchmarks — window function escape hatch; 2x vs Prisma confirmed
- Graphile Worker docs — LISTEN/NOTIFY, SKIP LOCKED, cron scheduling, missed-schedule catchup behavior
- Bun executables docs — `--compile` flag, cross-compile targets, 95-98% Node API compat
- Langfuse v3 infrastructure blog — single-container to split-container evolution; authoritative reference for when to split
- PostHog ethical telemetry guide — 90% opt-out finding; default-off requirement confirmed

### Secondary (MEDIUM confidence)

- Langfuse, Helicone, Arize Phoenix, Definity, LinearB/Sleuth feature surveys — table-stakes baseline and feature expectations
- Plausible/Umami self-hosted community comparisons — two-container max expectation; env-var config expectation
- DORA metrics 2025-2026 guide — revert-rate as change failure rate analog
- Prometheus Alertmanager docs — YAML rule format; group_wait/group_interval patterns for alert dedup

### Tertiary (LOW confidence — validate before building)

- Cursor pricing change June 2025 (Vantage blog) — retroactive billing model change; confirms re-poll requirement; Cursor API docs not directly reviewed
- Devin API release notes January 2026 — pagination limit reduction 1000 to 200; verify current state before building enrichment worker
- Prequel Helm chart reliability 2025 — resource limit and liveness probe omissions; reference for P3 Helm review checklist

---
*Research completed: 2026-05-03*
*Ready for roadmap: yes*
