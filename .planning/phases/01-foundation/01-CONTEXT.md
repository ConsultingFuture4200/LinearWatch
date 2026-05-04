# Phase 1: Foundation - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning
**Mode:** `--auto` (Claude selected recommended defaults; all decisions logged below)

<domain>
## Phase Boundary

Phase 1 delivers the **non-retrofittable foundation** for linearwatch: a correct Postgres schema, an idempotent Linear webhook receiver, identity resolver v0 (Linear-only), the constrained query API skeleton, a cost dashboard view that consumes the API, and a `linearwatch setup` first-run wizard. **All 8 CRITICAL pitfalls from `.planning/research/PITFALLS.md` must be eliminated in this phase** because every one of them is a Day-1 schema or handler decision that cannot be retrofitted on a live table without truncate-and-replay.

**In scope:**
- Postgres schema (star: `agent_sessions` fact + `agents`/`issues`/`repos`/`teams`/`cycles` dims), `events.raw_event` with **monthly declarative partitioning** from the first migration, `identity_mappings`, `cost_by_agent_daily` rollup table (refresh stub OK; rollup population is P2), `alert_events` table reserved.
- Linear webhook receiver: HMAC verify → single INSERT → 200; ack p99 < 200ms.
- Graphile Worker scaffolded with `resolve_identity` job type; cron stubs for jobs that fire in P2.
- Identity resolver v0: Linear-only signal (`linear_app_user_id`); state machine `NEW_AGENT → PENDING_CONFIRMATION → AUTO_PROMOTED / CONFIRMED`; confidence weights wired but only Linear weight (0.5) contributes in P1.
- Query API: `POST /api/v1/query` with Zod-enumerated `MetricName` and `DimensionName`; metrics shipped: `cost_by_agent`, `agent_session_count`; dimensions shipped: `agent`, `team`, `cycle`.
- Internal SDK endpoint (`POST /api/v1/sdk/event`) with Bearer workspace API key — accepts the three event types but does not need a published SDK package in P1 (SDK packages are P2).
- Cost dashboard view (Next.js App Router) reading exclusively through query API.
- `linearwatch setup` wizard (dashboard-first; CLI parity in P2 is fine — see decisions): Linear OAuth, GitHub PAT (collected but unused until P2), AgentSession UI visibility warning, `--seed` flag for synthetic data.
- Privacy: `hashTitle()` utility and ORM-level enforcement that `issues` has no `title: string` field.
- Observability: pino structured logs, Prometheus `/metrics` with event count, queue depth, enrichment lag (stubbed, populated in P2), `identity_resolver_confidence` histogram, fail-fast env-var validation at startup.
- Docker Compose: `web` + `worker` + `postgres:16-alpine`; `docker compose up` reaches dashboard within 5 minutes.
- CI guards: `grep -r 'req.body' src/` returns empty; raw title strings never appear in any query API response.

**Out of scope (deferred to Phase 2 or later, per ROADMAP.md and research):**
- GitHub webhook receiver (P2 — INGEST-02)
- Vendor API enrichment workers (P2 — INGEST-07/08)
- GitHub PR outcome enrichment / `outcome` column population (P2 — INGEST-09)
- Cross-source resolver signals (`github_login`, `vendor_session_pattern`) — P2 (ID-04)
- CLI binary (P2) — only the SDK endpoint exists in P1; the `linearwatch` CLI itself ships in P2
- SDK packages (`@linearwatch/sdk`, PyPI `linearwatch`) — P2; the **endpoint** is in P1, the **packages** are not
- Reliability + Lineage dashboard views (P2 — DASH-02/03)
- Alert engine (P2 — ALERT-01..07)
- Helm chart, telemetry pipeline, docs site — P3
- Materialized views except `cost_by_agent_daily` (out of scope project-wide in v0)

**The phase boundary anchor**: a real Linear workspace's agent activity is visible in the cost dashboard, schema is correct, ingest is idempotent, privacy defaults are enforced at the type level, and **no CRITICAL pitfall can corrupt data**. (ROADMAP.md Phase 1 success criteria 1-5.)
</domain>

<decisions>
## Implementation Decisions

### Stack & Project Structure (carried forward from initialization — locked)
- **D-01:** TypeScript throughout. Single language: server, query API, dashboard, future CLI, Node SDK. (Locked in `.planning/PROJECT.md` Key Decisions; CLAUDE.md Backend Language Verdict.)
- **D-02:** Fastify 5.8.x for webhook receiver and query API; Drizzle ORM 0.45.x; Postgres 16; Graphile Worker (Postgres-native, **not** pg-boss — research SUMMARY.md picks Graphile for LISTEN/NOTIFY + missed-schedule catchup); Next.js 15.5 App Router; pino 9.x; prom-client 15.x; Zod 3.x; Bun for future CLI compile (P2).
   - **Note on prior CLAUDE.md drift:** earlier scaffolding doc lists `pg-boss`. Research SUMMARY.md (`.planning/research/SUMMARY.md` §Recommended Stack and §Architecture Approach) explicitly chose **Graphile Worker** over pg-boss for cron catchup behavior and LISTEN/NOTIFY. **Use Graphile Worker.** Update CLAUDE.md drift in a separate Scribe pass; do not block this phase.
- **D-03:** Two containers in `compose.yml`: `web` (Next.js: dashboard + API routes + webhook receiver) and `worker` (Graphile Worker process), plus `postgres:16-alpine`. **No Redis, no Kafka, no TSDB.**
- **D-04:** Webhook handler is **async-only**: HMAC verify → single INSERT to `events.raw_event` → return 200 → enqueue Graphile job. No DB joins, vendor calls, or resolver runs synchronously inside the handler. (Pitfall 2.)

### Migration & Seed Strategy
- **D-05:** Use **drizzle-kit `generate`** to produce SQL migration files checked into `migrations/`; **drizzle-kit `migrate`** runs at app startup before the server starts accepting connections. Migrations are SQL files, not TypeScript — easier to audit and replay manually if a startup migration fails. (Auto-recommended over runtime migration libraries because self-hosters expect to read SQL.)
- **D-06:** `events.raw_event` partitioning is created **in the very first migration** as `PARTITION BY RANGE (received_at)`, with the current month's partition + the next month's partition pre-created. A Graphile cron job `rotate_raw_event_partitions` (registered in P1, scheduled monthly) creates next-month partitions and `DROP PARTITION`s anything older than 30 days. (Pitfall 8.)
- **D-07:** `--seed` flag inserts **~50 synthetic agent sessions** spanning 14 days, 3 fake agents (with names suggestive of real vendors but clearly synthetic — e.g., `cursor-demo`, `devin-demo`, `internal-bot-demo`), 2 teams, 1 cycle, distributed across cost buckets so the cost dashboard renders all states (high spend, low spend, anomaly highlight). Seed runs via `linearwatch setup --seed` and via a `worker` one-shot job for the docker-compose `--seed` env var path. **Synthetic data is clearly labelled in the dashboard with a "synthetic data — remove via `linearwatch admin clear-seed`" banner** when seed rows exist.

### Webhook Idempotency
- **D-08:** Idempotency key for Linear is the **`Linear-Delivery` UUID** from the webhook header, stored as `events.raw_event.upstream_id` with unique constraint `(source, upstream_id)`. (Pitfall 1; research SUMMARY.md §Cross-Cutting Decisions row 2.)
- **D-09:** **If the `Linear-Delivery` header is missing or unparseable, the request is rejected with 400** (not 401 — 401 is reserved for HMAC failure). Linear always sends this header per official docs; absence indicates a misconfigured proxy or non-Linear caller. **Do not synthesize a fallback key.** A composite fallback would defeat the dedup guarantee. (Auto-recommended: hard-fail over silent fallback.)
- **D-10:** Idempotency for the SDK endpoint (`POST /api/v1/sdk/event`) requires the caller to supply an `idempotency_key` in the request body; if absent, the server synthesizes `sha256(workspace_id + session_id + event_type + minute_bucket(occurred_at))`. SDK clients (P2) supply explicit keys.

### Setup Wizard Surface & Flow
- **D-11:** **Dashboard-first** wizard in P1. The CLI `linearwatch setup` command exists as a thin shell that prints a docker-compose-up message and the URL to the dashboard wizard for P1; full CLI-parity setup (SETUP-04 / CLI-07) ships in P2 alongside the CLI binary. This is consistent with the research note that CLI is P2 (FEATURES.md "Must-have" lists CLI commands but ARCHITECTURE.md build order puts the binary in P2).
- **D-12:** Wizard step order: (1) Welcome + system requirements check, (2) **AgentSession visibility warning** (full-screen modal with copy from D-13), (3) Linear OAuth flow, (4) GitHub PAT input (optional, marked "needed in Phase 2 for PR enrichment"), (5) Workspace name + initial workspace API key generation (one-click "generate and copy"), (6) `--seed` offer ("Try with synthetic data" / "Wait for real webhooks"), (7) Done — copy/paste webhook URL + cURL test command.
- **D-13:** AgentSession UI warning copy (load-bearing for SETUP-02): "**Heads up: enabling Linear's AgentSession category modifies the workspace UI for every member of your Linear workspace, not just you.** Linear shows agent activity in a dedicated UI category once an OAuth app with AgentSession scope is approved. If your team has not been told to expect this, pause and notify them before continuing." User must click "I've notified my team" before the OAuth flow proceeds. (Verbatim copy is starting point — refine with design partners in P2.)
- **D-14:** Workspace API keys are generated as `lw_` + 32 bytes base64url; stored hashed (sha256) in `workspaces.api_key_hash`; the wizard displays the plaintext key **once** with a clear "save this — it will not be shown again" affordance. CLI/SDK auth uses Bearer token compared via constant-time HMAC.

### Identity Resolver Execution Model
- **D-15:** Resolver runs **asynchronously as a Graphile Worker `resolve_identity` job**, enqueued from the webhook handler after the raw INSERT. **Not** synchronous in the handler (would violate D-04). Job is **idempotent** on `(workspace_id, raw_event_id)`: re-running the resolver on the same raw event produces the same output row in `identity_mappings`.
- **D-16:** Confidence formula in P1: `confidence = 0.5 * has_linear_app_user_id` (binary 0 or 1). GitHub and vendor signals are 0 in P1 because those signals don't exist yet. This means **every P1 resolution starts at 0.5 confidence**, which is below the default `IDENTITY_CONFIDENCE_THRESHOLD=0.8`, so **all P1 rows land in `PENDING_CONFIRMATION`** until human-confirmed via dashboard or a P2 cross-source signal lifts them. This is intentional: the resolver shouldn't auto-promote on a single signal. The dashboard's confirm UI is the unblocker until P2.
- **D-17:** Confirmation UI in the cost dashboard: an **inline "Unconfirmed" badge** next to each agent name in the cost view. Clicking the badge opens a side panel with the candidate signals + a "Confirm this agent" button. Confirming locks the row to `CONFIRMED` (state, not confidence-driven). Modal vs side panel: **side panel** because users will batch-confirm 3-5 rows at first install and a modal interrupts that flow.
- **D-18:** Shared-Linear-OAuth-app heuristic (Pitfall 6, ID-05): a Graphile cron `detect_shared_app` runs hourly. If one `linear_app_user_id` shows ≥2 distinct vendor contexts within a 24h rolling window, write a row to a new `workspace_warnings` table (`severity`, `message`, `created_at`). Dashboard surfaces a banner. **Vendor context** in P1 is approximated by `events.raw_event.payload->>'agentSession'->>'sessionId'` substring patterns (`cursor-`, `devin-`, etc.) — a research-flagged heuristic that gets sharpened in P2 when real vendor signals arrive.

### Auth & Workspace API Keys
- **D-19:** Same Bearer workspace API key authenticates: query API (API-06), SDK endpoint (INGEST-03). One key per workspace in P1 (single-tenant constraint). Future multi-key/role expansion is a v0.2 concern.
- **D-20:** Webhook endpoints (`/webhooks/linear`, future `/webhooks/github`) are authenticated by HMAC of the request body, **not** by workspace API key. Mixing the two is a category error.

### Cost Dashboard Layout
- **D-21:** **Single page** with three filters in a top bar (`team` dropdown, `cycle` dropdown, `window` selector with 7d/14d/30d/90d). One main chart: stacked bar of cost-by-agent over time. One table below: agent | sessions | total cost | cost-per-closed-issue (P1: cost-per-closed-issue column shows `—` because the `outcome` column populates in P2; ship the column with the placeholder so the layout doesn't shift in P2). Anomaly highlights are **inline pill markers** on chart bars where an agent's daily cost > 3× its 28-day rolling average (lightweight P1 implementation; full alert engine is P2).
- **D-22:** Tabs for Reliability and Lineage exist as **stubs that say "Available in Phase 2"** with a link to ROADMAP.md. This makes the navigation in P2 a non-event — the slots are pre-cut.

### Local Dev Workflow
- **D-23:** **Hybrid recommended for contributors**: `docker compose up postgres` for the DB, then `pnpm --filter @linearwatch/server dev` and `pnpm --filter @linearwatch/worker dev` on the host for hot-reload. The full `docker compose up` is for **users** doing the 5-minute install — it must work, and CI tests it (DEPLOY-01, LAUNCH-06), but it is not the inner loop for contributors. Document both in `CONTRIBUTING.md` (a P3 deliverable, but at least mention in README in P1).
- **D-24:** All env vars in `.env.example` at repo root. App fails fast at startup if `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, or `DATABASE_URL` are missing (DEPLOY-03), printing a single readable line per missing var.

### Monorepo Layout (Phase 1 packages only)
- **D-25:** P1 packages in pnpm workspace:
   - `packages/server/` — Fastify webhook receiver + Graphile Worker host + Drizzle schema + migrations
   - `packages/web/` — Next.js dashboard + query API routes (the `web` container builds from here)
   - `packages/shared/` — Zod schemas (MetricName, DimensionName, event types) shared between server and web
   - `packages/db/` — Drizzle schema definitions + migration files (depended on by both server and web)
   - **Not in P1**: `packages/cli/`, `packages/sdk-node/`, `packages/sdk-python/`. These slots are reserved in CONTRIBUTING.md but not created until P2. Empty directories are noise.

### Privacy & Title Hashing (Pitfall 4 — load-bearing)
- **D-26:** **`hashTitle(raw: string): string` lives in `packages/shared/privacy.ts` and is the only function permitted to read raw issue titles.** It is exported with a Zod-branded return type `TitleHash = string & { readonly __brand: "TitleHash" }`. The `issues` Drizzle schema has `title_hash: TitleHash` as the column type — there is no `title: string` field anywhere on the row.
- **D-27:** Hashing algorithm: `sha256(workspace_salt + ":" + normalized(raw))` where `normalized` is `raw.trim().toLowerCase()`. `workspace_salt` is generated at workspace creation time, stored on the workspaces row. Same title under same workspace → same hash. Different workspaces → different hashes (defense against cross-workspace lookup attacks if the hosted aggregator is ever fed raw hashes by accident).
- **D-28:** CI assertion (PRIV-03 + OBS-04): `grep -r 'req.body' src/` must return empty; a separate test seeds known titles, runs the full ingest path, and greps the JSON response of every query API metric for the raw title strings — fails the build if found.

### Observability (Pitfall 5)
- **D-29:** pino logger configured to **never log `req.body`**. Webhook handler emits exactly one log line per receipt with these fields only: `delivery_id`, `source`, `event_type`, `bytes_received`, `latency_ms`. `LOG_LEVEL=debug` adds `payload_keys: string[]` (top-level keys only, never values). Implementation: a custom Fastify request logger plugin replaces the default.
- **D-30:** `/metrics` exposes: `linearwatch_events_received_total{source}` (counter), `linearwatch_webhook_ack_seconds` (histogram), `linearwatch_jobs_queue_depth{job_name}` (gauge, populated by Graphile Worker integration), `linearwatch_identity_resolver_confidence` (histogram, observed every resolve), `linearwatch_enrichment_lag_seconds{source}` (gauge, stub returning 0 in P1; P2 worker populates).

### Performance Verification (Pitfall — INGEST-04 / API-08 are deferrable to P2 OBS-05 benchmark, but design must support them in P1)
- **D-31:** P1 includes a **smoke benchmark** at `packages/server/test/perf/webhook-ack.bench.ts` that fires 200 concurrent valid Linear webhooks against a local server with `postgres:16-alpine` and asserts p99 < 200ms. This runs in CI as a gate on the foundation phase. Full 100k-row dashboard query benchmark is P2 (OBS-05).

### Claude's Discretion

These are explicitly delegated to research/planner/implementer; downstream agents should choose without re-asking:

- **Drizzle schema file layout** — split across multiple `.ts` files vs single `schema.ts`. Pick what reads best; standard convention.
- **Fastify plugin organization** — autoload vs explicit registration. Pick whatever is idiomatic for current Fastify 5.x docs.
- **Next.js App Router file layout for the dashboard** — `app/(dashboard)/cost/page.tsx` vs flatter. Pick what scales for P2 tabs.
- **Test framework** — Vitest is the default unless there's a strong reason otherwise; tests colocated with sources is fine.
- **Linting/formatting** — Biome is the project default per CLAUDE.md drift; if Biome handles both, use it. Otherwise eslint + prettier. Don't bikeshed.
- **Chart library on dashboard** — recharts is fine; shadcn/ui chart wrappers if they fit. Whatever ships fastest with shadcn/ui consistency.
- **Confirmation UI exact styling** — within the "side panel" decision (D-17), color/spacing/copy are designer's call.
- **Graphile Worker concrete cron expressions** — within the windows specified, pick crontab syntax that aligns with Graphile docs.
- **README structure** — research has rough guidance; pick what reads best for the self-hoster persona.

### Folded Todos

None. No pre-existing todos matched Phase 1 scope (project is at initialization).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner, executor) MUST read these before planning or implementing.**

### Project anchors
- `.planning/PROJECT.md` — vision, key decisions table, constraints, out-of-scope list
- `.planning/REQUIREMENTS.md` — all 80 requirements with IDs; Phase 1 covers 43 of them (see ROADMAP.md `Requirements:` line for Phase 1)
- `.planning/ROADMAP.md` — phase boundaries, success criteria 1-5 for Phase 1, depends-on graph
- `.planning/STATE.md` — current position, accumulated context, blockers

### Research outputs (load-bearing for Phase 1)
- `.planning/research/SUMMARY.md` — executive summary, recommended stack, phase ordering rationale, cross-cutting decisions table
- `.planning/research/STACK.md` — version-pinned dependency choices and rejected alternatives
- `.planning/research/ARCHITECTURE.md` — component graph, data flow, idempotency strategy, schema-first constraints
- `.planning/research/PITFALLS.md` — **all 8 CRITICAL pitfalls (1, 2, 3, 4, 5, 6, 7, 8) belong to Phase 1**; planner must verify each is eliminated by a specific task in the plan
- `.planning/research/FEATURES.md` — must-have / should-have / defer-to-v2 / hard-anti-feature lists; the cost dashboard ships Phase 1 but Reliability/Lineage are P2

### Project-level CLAUDE.md context
- `/home/bob/Linearwatch/CLAUDE.md` — full stack rationale, version pins, "what NOT to use" list, stack-patterns-by-component
   - **Drift note:** CLAUDE.md mentions `pg-boss`. Authoritative choice per research is **Graphile Worker** (SUMMARY.md §Recommended Stack). Reconcile via Scribe in a separate pass.

### External docs to consult during research/planning (not in repo)
- Linear Webhooks docs — at-least-once delivery, `Linear-Delivery` UUID header, `linear-signature` HMAC-SHA256, AgentSession category UI behavior
- Linear OAuth docs — AgentSession scope availability and approval flow
- GitHub Webhooks docs — `X-Hub-Signature-256` (NOT `X-Hub-Signature`), `X-GitHub-Delivery` UUID; cited here for context — receiver itself ships in P2
- Fastify 5.x docs — raw body access for HMAC verification, schema-based validation, Pino integration
- Drizzle ORM docs — declarative partitioning support via `sql` escape hatch (Drizzle does not have native partition DSL — use raw SQL in migrations)
- Graphile Worker docs — `cron` schedules, `SKIP LOCKED`, missed-schedule catchup, LISTEN/NOTIFY job pickup
- Postgres 16 docs — declarative `PARTITION BY RANGE`, `CREATE TABLE ... PARTITION OF`, `DROP PARTITION` for retention
- prom-client docs — histogram bucket configuration for `webhook_ack_seconds` and `identity_resolver_confidence`

### Specs/ADRs not yet authored
- No ADRs exist yet. **Recommendation for planner:** during Phase 1, write at minimum:
   - `docs/decisions/0001-postgres-only.md`
   - `docs/decisions/0002-webhook-handler-async-only.md`
   - `docs/decisions/0003-title-hashing-at-orm-type.md`
   - `docs/decisions/0004-graphile-worker-over-pg-boss.md`
- `docs/telemetry.md` is referenced in PROJECT.md constraints but is a P3 deliverable; not in P1 scope.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None.** This is a greenfield repository; `/home/bob/Linearwatch/` contains only `.planning/` and `CLAUDE.md` at present. Every component is built from scratch in Phase 1.

### Established Patterns
- **CLAUDE.md is the project's stack-pattern document.** Every component (webhook receiver, enrichment worker, query API, schema, CLI compile, SDK build) has a documented "how" in the CLAUDE.md "Stack Patterns by Component" section. Planner should treat it as project conventions.
- **Drift to reconcile:** CLAUDE.md says `pg-boss`; research authoritatively says Graphile Worker. **Trust research/SUMMARY.md.**

### Integration Points
- **No existing system to integrate into.** Phase 1 establishes:
   - The repo root (`pnpm-workspace.yaml`, `package.json` with workspaces, `tsconfig.json` base, `.env.example`, `compose.yml`)
   - The first migration that defines the partitioned schema
   - The first Drizzle schema TypeScript files in `packages/db/`
   - The Fastify server entry point in `packages/server/`
   - The Graphile Worker entry point (separate process in `packages/server/` with its own `bin` script)
   - The Next.js dashboard in `packages/web/`
   - These become the integration surface for Phase 2.

### Creative Options the Architecture Enables
- **Replay-from-raw**: because `events.raw_event` retains 30 days of raw payloads with idempotency keys, any resolver bug can be fixed and replayed without re-fetching from Linear. Planner should design `resolve_identity` to be safely re-runnable (D-15) so a future "replay last 7d" command is a one-liner in P2.
- **Synthetic-first dashboard**: `--seed` data flowing through the same query API as real data means the dashboard is testable end-to-end on Day 1 without a Linear OAuth approval. CI can run the full dashboard against seeded data.
- **Branded types over runtime guards**: D-26's `TitleHash` branded type makes title leakage a TypeScript compile error rather than a runtime test failure. The CI grep is the second line of defense, not the first.

</code_context>

<specifics>
## Specific Ideas

- **AgentSession warning copy** (D-13) is the **highest-stakes UX moment in Phase 1**. Design partners report Linear UI changes as a "did you ask me about this?" failure mode. The verbatim copy in D-13 is the starting point; refine with first design partner feedback in early P2, but ship something explicit in P1 — not a checkbox-and-link.
- **`--seed` data should look real but unmistakably synthetic.** Agent names like `cursor-demo` and `devin-demo` (D-07), issue titles like `[DEMO] Investigate flaky test in payment service`, costs in plausible ranges ($0.40-$8.00 per session). Dashboard banner makes the data origin explicit so a self-hoster doesn't accidentally take a screenshot of demo data and put it in their first internal report.
- **The cost-per-closed-issue column ships as `—` in P1** (D-21). This is intentional: laying out the column in P1 means P2 lights it up by populating `agent_sessions.outcome`, not by changing the dashboard layout. The header tooltip says "Available once GitHub PR enrichment is configured (Phase 2)."
- **Reliability and Lineage tabs as P2-stubs** (D-22) is the same idea applied to navigation: the slot is cut in P1 so P2 doesn't restructure.
- **Bench-as-CI-gate for webhook ack p99** (D-31): the 200ms SLA is a load-bearing claim in the README and the hosted aggregator pitch. Having it be a CI gate from Day 1 means a regression at any future commit is a red build, not a customer-reported issue.

</specifics>

<deferred>
## Deferred Ideas

These came up during analysis but belong to other phases. Captured so they aren't lost.

### Belongs in Phase 2
- **CLI binary `linearwatch`** with `query`, `report`, `lineage`, `tail`, `rules test`, `setup` commands (CLI-01..09). P1 ships only the SDK endpoint and a placeholder `linearwatch` binary that prints "use the dashboard wizard at http://localhost:3000".
- **Published SDK packages** `@linearwatch/sdk` (Node) and `linearwatch` (PyPI). The endpoint is in P1 (INGEST-03); the published packages are P2 (SDK-01..06).
- **GitHub webhook receiver** with `X-Hub-Signature-256` enforcement (INGEST-02). The pattern is established in P1 (Linear), so P2 reuses the same constant-time-compare helper.
- **Vendor API enrichment** for Cursor + one other vendor (INGEST-07/08). Mid-P2 vendor-doc check is research-flagged.
- **`outcome` column population** via GitHub PR merge/revert/force-push detection (INGEST-09). The column exists in the P1 schema but is NULL until P2.
- **Identity resolver cross-source** (`github_login`, `vendor_session_pattern`) (ID-04). P1 lays the weighted-confidence formula; P2 adds the other two terms.
- **`cost_by_agent_daily` rollup population** + auto-refresh. Table exists in P1 schema; refresh job is a stub. P2 wires the alert engine to read from it (DASH/ALERT requirements).
- **Reliability + Lineage dashboard views** (DASH-02/03). P1 stub-tabs guide users to ROADMAP.md.
- **Alert engine + YAML rule packs** (ALERT-01..07).
- **`agent purge` GDPR command** (PRIV-04). The `agents.deleted_at` soft-delete column should exist in P1 schema (so we don't migrate later), but the command itself ships in P2.

### Belongs in Phase 3
- **Telemetry pipeline** (TELE-01..06). The `TELEMETRY_OPT_IN` env var is **read** at startup and printed in the boot log in P1 (so users can verify it's off), but the daily rollup job that respects it is P3.
- **Helm chart** (DEPLOY-04).
- **Docs site** (LAUNCH-01).
- **Benchmark blog post** (LAUNCH-04).

### Reviewed Todos (not folded)
None — no pre-existing todos to review.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-05-03*
*Mode: --auto (Claude selected recommended defaults; rationale logged inline above)*
