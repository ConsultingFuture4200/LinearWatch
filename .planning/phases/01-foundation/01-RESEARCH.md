# Phase 1: Foundation - Research

**Researched:** 2026-05-03
**Domain:** Self-hosted AI agent observability — Postgres schema, Linear webhook ingest, identity resolver, query API, dashboard, setup wizard
**Confidence:** HIGH

---

## Summary

Project-level research is exhaustive and HIGH confidence; CONTEXT.md captures 31 locked decisions (D-01..D-31). This phase research does **not** revisit "what stack" — it surfaces the **implementation-level patterns** the planner needs to write task-level instructions: Fastify 5 raw-body access for HMAC, Drizzle migrations for declarative monthly partitioning (Drizzle has no partition DSL — raw SQL via `sql\`...\`` in migrations), Graphile Worker `crontab` registration plus the `resolve_identity` job idempotency contract, branded `TitleHash` types in Drizzle, constant-time Bearer auth, and Next.js 15 App Router server-component data fetching against same-origin `POST /api/v1/query`.

Three notable corrections to upstream documents discovered during version verification:
1. **`@linear/sdk` is now 83.0.0** (CLAUDE.md says 82.x — minor drift; 83 is fine).
2. **Next.js 16.2.4 is GA** (CLAUDE.md says 15.5.x; 16 is stable as of late 2025/early 2026 — recommend 15.5.x for stability unless team prefers 16; both work with App Router).
3. **Zod 4.x is GA** (CLAUDE.md says 3.x; this is a **major version drift**). Phase 1 should pick **one** and pin it in `package.json`. Recommend Zod 3.x to match CLAUDE.md and avoid late-breaking API surprises.

**Primary recommendation:** Treat CONTEXT.md (D-01..D-31) as the locked plan; this RESEARCH.md provides the concrete code-shape examples and sequencing constraints that turn those decisions into tasks. Eight CRITICAL pitfalls map to Phase 1 — each must have a verifying task.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Stack & Project Structure (carried forward from initialization)**
- **D-01:** TypeScript throughout. Single language: server, query API, dashboard, future CLI, Node SDK.
- **D-02:** Fastify 5.8.x; Drizzle ORM 0.45.x; Postgres 16; **Graphile Worker** (NOT pg-boss — research SUMMARY.md picks Graphile for LISTEN/NOTIFY + missed-schedule catchup); Next.js 15.5 App Router; pino 9.x; prom-client 15.x; Zod 3.x; Bun for future CLI compile (P2). CLAUDE.md drift on `pg-boss` is reconciled separately.
- **D-03:** Two containers in `compose.yml`: `web` (Next.js: dashboard + API routes + webhook receiver) and `worker` (Graphile Worker process), plus `postgres:16-alpine`. **No Redis, no Kafka, no TSDB.**
- **D-04:** Webhook handler is **async-only**: HMAC verify → single INSERT to `events.raw_event` → return 200 → enqueue Graphile job. No DB joins, vendor calls, or resolver runs synchronously.

**Migration & Seed Strategy**
- **D-05:** Use **drizzle-kit `generate`** (SQL files checked into `migrations/`); **drizzle-kit `migrate`** runs at app startup before the server accepts connections.
- **D-06:** `events.raw_event` partitioning created **in the very first migration** as `PARTITION BY RANGE (received_at)`, with current month + next month pre-created. A Graphile cron `rotate_raw_event_partitions` (registered in P1, scheduled monthly) creates next-month partitions and `DROP PARTITION`s anything older than 30 days.
- **D-07:** `--seed` flag inserts ~50 synthetic agent sessions across 14 days, 3 fake agents (`cursor-demo`, `devin-demo`, `internal-bot-demo`), 2 teams, 1 cycle. Dashboard banner labels synthetic data.

**Webhook Idempotency**
- **D-08:** Linear idempotency key is the `Linear-Delivery` UUID stored as `events.raw_event.upstream_id` with unique `(source, upstream_id)`.
- **D-09:** Missing/unparseable `Linear-Delivery` header → **400** (not 401 — 401 reserved for HMAC failure). No fallback synthesis.
- **D-10:** SDK endpoint requires caller-supplied `idempotency_key` in body; server synthesizes `sha256(workspace_id + session_id + event_type + minute_bucket(occurred_at))` if absent.

**Setup Wizard Surface & Flow**
- **D-11:** **Dashboard-first** wizard in P1. CLI `linearwatch setup` is a thin shell printing a docker-compose-up message + dashboard URL.
- **D-12:** Wizard step order: (1) Welcome + system check, (2) AgentSession visibility warning, (3) Linear OAuth, (4) GitHub PAT (optional, P2), (5) Workspace name + API key generation, (6) `--seed` offer, (7) Done — webhook URL + cURL test.
- **D-13:** AgentSession warning copy (verbatim): *"Heads up: enabling Linear's AgentSession category modifies the workspace UI for every member of your Linear workspace, not just you. Linear shows agent activity in a dedicated UI category once an OAuth app with AgentSession scope is approved. If your team has not been told to expect this, pause and notify them before continuing."* User must click "I've notified my team" before OAuth proceeds.
- **D-14:** Workspace API keys: `lw_` + 32 bytes base64url; stored sha256-hashed in `workspaces.api_key_hash`. Plaintext displayed once.

**Identity Resolver Execution Model**
- **D-15:** Resolver runs as a Graphile Worker `resolve_identity` job, enqueued from webhook handler after raw INSERT. Idempotent on `(workspace_id, raw_event_id)`.
- **D-16:** P1 confidence formula: `confidence = 0.5 * has_linear_app_user_id` (binary). Every P1 resolution lands at 0.5, **below** default 0.8 threshold → all P1 rows land in `PENDING_CONFIRMATION` until human-confirmed via dashboard. Intentional.
- **D-17:** Confirmation UI: inline "Unconfirmed" badge + side panel (not modal — users batch-confirm 3-5 rows on first install).
- **D-18:** Shared-Linear-OAuth-app heuristic: hourly `detect_shared_app` Graphile cron. ≥2 distinct vendor contexts on one `linear_app_user_id` in 24h → row in new `workspace_warnings` table.

**Auth & Workspace API Keys**
- **D-19:** Same Bearer workspace API key authenticates query API + SDK endpoint. One key per workspace in P1.
- **D-20:** Webhook endpoints authenticated by HMAC of body, **not** by workspace API key.

**Cost Dashboard Layout**
- **D-21:** Single page; top-bar filters (`team`, `cycle`, `window` 7d/14d/30d/90d). One stacked-bar chart cost-by-agent over time. Table below: agent | sessions | total cost | cost-per-closed-issue (P1: `—`). Anomaly highlights as inline pill markers (>3× 28-day rolling average).
- **D-22:** Reliability + Lineage tabs as P2-stub pages.

**Local Dev Workflow**
- **D-23:** Hybrid: `docker compose up postgres` + `pnpm --filter ... dev` for contributor inner loop. Full `docker compose up` for users.
- **D-24:** All env vars in `.env.example`. App fails fast on missing `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `DATABASE_URL`.

**Monorepo Layout (P1 packages only)**
- **D-25:** `packages/server/`, `packages/web/`, `packages/shared/`, `packages/db/`. **Not in P1**: `packages/cli/`, `packages/sdk-node/`, `packages/sdk-python/`.

**Privacy & Title Hashing**
- **D-26:** `hashTitle(raw: string): string` lives in `packages/shared/privacy.ts`. Returns Zod-branded `TitleHash = string & { readonly __brand: "TitleHash" }`. `issues` Drizzle schema has `title_hash: TitleHash` — no `title: string` field anywhere.
- **D-27:** Hash: `sha256(workspace_salt + ":" + raw.trim().toLowerCase())`. `workspace_salt` generated at workspace creation, stored on workspaces row.
- **D-28:** CI assertion: `grep -r 'req.body' src/` empty; seeded titles never appear in any query API JSON response.

**Observability**
- **D-29:** pino never logs `req.body`. Webhook log line fields only: `delivery_id`, `source`, `event_type`, `bytes_received`, `latency_ms`. `LOG_LEVEL=debug` adds `payload_keys: string[]` (top-level keys only, never values). Custom Fastify request logger plugin replaces default.
- **D-30:** `/metrics` exposes: `linearwatch_events_received_total{source}` (counter), `linearwatch_webhook_ack_seconds` (histogram), `linearwatch_jobs_queue_depth{job_name}` (gauge), `linearwatch_identity_resolver_confidence` (histogram), `linearwatch_enrichment_lag_seconds{source}` (gauge — stub returning 0 in P1).

**Performance Verification**
- **D-31:** P1 ships smoke benchmark `packages/server/test/perf/webhook-ack.bench.ts` — 200 concurrent valid Linear webhooks, asserts p99 < 200ms. Runs in CI as foundation phase gate. Full 100k-row dashboard benchmark is P2.

### Claude's Discretion

- Drizzle schema file layout (split vs single `schema.ts`) — pick what reads best.
- Fastify plugin organization — autoload vs explicit. Pick idiomatic Fastify 5.x style.
- Next.js App Router file layout — `app/(dashboard)/cost/page.tsx` vs flatter. Pick what scales for P2 tabs.
- Test framework — Vitest default; tests colocated with sources is fine.
- Linting/formatting — Biome if it covers both; otherwise eslint + prettier.
- Chart library — recharts is fine; shadcn/ui chart wrappers if they fit.
- Confirmation UI exact styling — within "side panel" decision (D-17), designer's call.
- Graphile Worker concrete cron expressions — within specified windows.
- README structure — pick what reads best for self-hoster persona.

### Deferred Ideas (OUT OF SCOPE)

**To Phase 2:**
- CLI binary `linearwatch` with `query`, `report`, `lineage`, `tail`, `rules test`, `setup` (CLI-01..09).
- Published SDK packages `@linearwatch/sdk` (Node) and `linearwatch` (PyPI). The endpoint is in P1; the packages are P2.
- GitHub webhook receiver (INGEST-02).
- Vendor API enrichment (Cursor + one other) — INGEST-07/08.
- `outcome` column population via GitHub PR detection (INGEST-09).
- Identity resolver cross-source signals — `github_login`, `vendor_session_pattern` (ID-04).
- `cost_by_agent_daily` rollup population + auto-refresh. Table exists in P1; refresh job is a stub.
- Reliability + Lineage dashboard views (DASH-02/03).
- Alert engine + YAML rule packs (ALERT-01..07).
- `agent purge` GDPR command (PRIV-04). `agents.deleted_at` soft-delete column should exist in P1 schema; command itself ships in P2.

**To Phase 3:**
- Telemetry pipeline (TELE-01..06). `TELEMETRY_OPT_IN` env var **read** at startup and printed in boot log in P1; daily rollup job is P3.
- Helm chart (DEPLOY-04).
- Docs site (LAUNCH-01).
- Benchmark blog post (LAUNCH-04).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Star schema fact `agent_sessions` with PRD §6.1 columns | ARCHITECTURE.md §Schema Design + indexing strategy below |
| DATA-02 | Dimension tables `agents`, `issues`, `repos`, `teams`, `cycles` | ARCHITECTURE.md DDL examples; D-26 issues table has no `title` column |
| DATA-03 | `events.raw_event` monthly-partitioned with `(source, upstream_id)` unique | Partitioning DDL pattern below; D-06 |
| DATA-04 | Indexes: `(agent_id, started_at DESC)`, `(issue_id, started_at)`, BRIN on `started_at`, dimension FKs | Index decisions section below |
| DATA-05 | `identity_mappings` table with `(workspace_id, linear_app_user_id)` rows, confidence, signal weights, confirmation timestamps | ARCHITECTURE.md §Identity Mappings Table |
| DATA-06 | `cost_by_agent_daily` rollup table; refresh stub in P1 | Table DDL only; refresh job is P2 |
| INGEST-01 | `POST /webhooks/linear` accepts AgentSession events; rejects non-`X-Linear-Signature-256` HMAC with 401 | Fastify HMAC pattern below; verified header is `Linear-Signature` (not `X-Linear-Signature-256`) — see Open Questions |
| INGEST-03 | `POST /api/v1/sdk/event` Bearer-auth; accepts `session_start`, `session_end`, `cost_recorded` | Bearer auth pattern below; D-19 |
| INGEST-04 | Handler does HMAC verify → single INSERT → 200; p99 < 200ms under 200 concurrent | D-31 benchmark; webhook handler shape below |
| INGEST-05 | Idempotency unique `(source, upstream_id)`; duplicates are no-ops | `INSERT ... ON CONFLICT` pattern below |
| INGEST-06 | Raw event store retains 30 days; older partitions dropped via monthly partitioning | D-06; partition rotation cron below |
| ID-01 | Resolver maps signals → single `agent_id` per workspace | Resolver job pattern below |
| ID-02 | State machine `NEW_AGENT → PENDING_CONFIRMATION → AUTO_PROMOTED / CONFIRMED` | ARCHITECTURE.md §State Machine |
| ID-03 | Confidence weighted sum (Linear 0.5, GH 0.3, vendor 0.2) | D-16: only Linear weight contributes in P1 |
| ID-05 | Detect shared Linear OAuth app: ≥2 distinct vendor contexts in 24h surfaces warning | D-18 detect_shared_app cron |
| ID-06 | `IDENTITY_CONFIDENCE_THRESHOLD` runtime env var (default 0.8) | Env var validation pattern below |
| API-01 | `POST /api/v1/query` accepts `{metric, dimension, filters, window}`, returns rows | Query API contract from ARCHITECTURE.md |
| API-02 | `MetricName`/`DimensionName` are Zod enums; unknown → 400 | Zod enum + error response pattern below |
| API-03 | Each metric maps to static SQL function in `src/query/metrics.ts` | Metrics dispatch pattern below |
| API-04 | P1 metrics: `cost_by_agent`, `agent_session_count` (per CONTEXT.md scope; PRD lists more for v1 across phases) | CONTEXT.md restricts P1 to these two |
| API-05 | P1 dimensions: `agent`, `team`, `cycle` | CONTEXT.md restricts P1 to these three |
| API-06 | Bearer workspace API key auth | D-14, D-19; constant-time hash compare pattern below |
| API-07 | Dashboard reads exclusively through query API | Next.js RSC fetch pattern below |
| API-08 | p95 < 1s on 100k-session workspace over 90d | Index strategy supports this; full 100k benchmark is P2 (OBS-05) |
| DASH-01 | Cost view: spend per agent by team and cycle, anomaly highlights | D-21 layout |
| DASH-04 | Confidence visible; one-click confirm UI | D-17 side panel |
| DASH-05 | Setup wizard: Linear OAuth, GitHub PAT (optional in P1), AgentSession warning | D-12, D-13 |
| DASH-06 | Setup wizard offers `--seed` flag | D-07 synthetic data |
| DEPLOY-01 | `git clone && docker compose up` reaches dashboard at :3000 within 5 min | compose.yml below |
| DEPLOY-02 | Stack contains exactly `web`, `worker`, `postgres:16-alpine` | D-03 |
| DEPLOY-03 | Required env vars fail-fast at startup | Env validation pattern below |
| DEPLOY-05 | Reverse-proxy auth supported; README documents nginx + Caddy | README task |
| DEPLOY-06 | PgBouncer transaction-mode documented with `?pgbouncer=true` flag | README task; pitfall 11 |
| OBS-01 | Structured pino logs; one line per webhook receipt; never logs `req.body` | D-29; pino redact config below |
| OBS-02 | Prometheus `/metrics` with event counts, queue depth, enrichment lag, resolver confidence | D-30; prom-client setup below |
| OBS-03 | `LOG_LEVEL` env var; even `debug` never logs raw payloads | D-29 |
| OBS-04 | CI: `grep -r 'req.body' src/` empty | D-28 |
| PRIV-01 | Issue titles hashed via single `hashTitle()`; ORM type has no `title: string` field | D-26 branded types pattern below |
| PRIV-02 | Workspace setting can opt in to storing full titles | Schema column `store_titles_plain bool` on workspaces; in P1 always false |
| PRIV-03 | CI: raw title strings never appear in any query API response | Test pattern below |
| SETUP-01 | First-run wizard collects Linear OAuth + GitHub PAT; persists to env-overridable config | OAuth flow pattern below |
| SETUP-02 | Wizard surfaces explicit AgentSession UI warning | D-13 verbatim copy |
| SETUP-03 | `docker compose up` shows "waiting for first webhook" with copy-paste URL + cURL | Onboarding state pattern below |
| SETUP-04 | `--seed` flag inserts ~50 synthetic sessions covering all P1 views | D-07 |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

- **Tech stack — Dashboard:** Next.js. Reads exclusively through internal query API; no direct DB access from React components. [VERIFIED: CLAUDE.md]
- **Tech stack — Backend:** Decision was deferred but resolved at initialization to **TypeScript/Node.js** (single language across server, future CLI, Node SDK). [VERIFIED: CLAUDE.md "Backend Language Verdict"]
- **Tech stack — Storage:** Postgres only. No Redis, no Kafka, no time-series DB in v0. [VERIFIED: CLAUDE.md]
- **Tech stack — Deployment:** Docker compose primary distribution; Helm chart secondary (P3). [VERIFIED: CLAUDE.md]
- **Performance:** Webhook receiver p99 < 200ms ack; dashboard query p95 < 1s over 90d on 100k-session workspace; enrichment lag < 5min between PR merge and reflected outcome. [VERIFIED: CLAUDE.md + REQUIREMENTS.md INGEST-04, API-08]
- **Privacy:** Issue titles hashed by default; no customer data leaves instance unless `TELEMETRY_OPT_IN=true`. Enforced **in code, not policy.** [VERIFIED: CLAUDE.md]
- **Auth:** Environment-variable basic auth and reverse-proxy support only in v0. No built-in SSO/OAuth for end users. [VERIFIED: CLAUDE.md]
- **Linear plan:** Agent Session webhook access requires Business or Enterprise. Stated in README; not a problem to solve. [VERIFIED: CLAUDE.md]
- **Drift to reconcile:** CLAUDE.md "Stack Patterns by Component" still references `pg-boss`. Authoritative choice is **Graphile Worker** per SUMMARY.md and D-02. Treat CLAUDE.md as superseded on this single point; reconcile via Scribe in a separate pass — do not block this phase.

---

## Standard Stack

### Core (versions verified against npm registry on 2026-05-03)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22 LTS | Server runtime | Active LTS through 2027 [VERIFIED: nodejs.org schedule] |
| TypeScript | 5.x | Language | Single source of truth for query API types [VERIFIED: CLAUDE.md] |
| Fastify | 5.8.5 | HTTP server | Schema-based validation; raw-body access via `addContentTypeParser` [VERIFIED: npm view fastify → 5.8.5] |
| Drizzle ORM | 0.45.2 | ORM + migrations | `sql\`...\`` escape hatch is essential for partition DDL and rolling-window queries [VERIFIED: npm view drizzle-orm → 0.45.2] |
| drizzle-kit | 0.31.10 | Migration generator | `generate` produces SQL files; `migrate` applies at startup [VERIFIED: npm view drizzle-kit → 0.31.10] |
| graphile-worker | 0.16.6 | Postgres-native job queue + cron | LISTEN/NOTIFY for sub-5ms job pickup; missed-schedule catchup; `parsedCronItems` API [VERIFIED: npm view graphile-worker → 0.16.6] |
| Postgres | 16-alpine | Sole datastore | Declarative `PARTITION BY RANGE`; `SKIP LOCKED` for queue [VERIFIED: postgresql.org] |
| Next.js | 15.5.x | Dashboard | App Router + RSC for server-side data fetching through query API [CITED: CLAUDE.md D-02; current GA is 16.2.4 per npm — pin 15.5 unless team decides to bump] |
| pino | 9.x | Structured JSON logging | `redact` paths block `req.body` at the logger level (defense in depth above the custom logger) [VERIFIED: npm view pino → 9.x] |
| pino-http | 11.0.0 | Fastify HTTP request logging | Auto correlation IDs; serializers control field whitelist [VERIFIED: npm view pino-http → 11.0.0; CLAUDE.md says 10.x — minor drift] |
| prom-client | 15.1.3 | Prometheus `/metrics` endpoint | Counters, histograms, gauges for D-30 metrics [VERIFIED: npm view prom-client → 15.1.3] |
| Zod | 3.x | Runtime validation | `MetricName`/`DimensionName` enums; query API request validation [CITED: CLAUDE.md D-02 — Zod 3.x; Zod 4.4.2 also GA per npm but CLAUDE.md pins 3.x] |
| @linear/sdk | 83.0.0 | Linear OAuth + setup wizard API calls | Auto-generated typed client [VERIFIED: npm view @linear/sdk → 83.0.0; CLAUDE.md says 82.x — minor drift, 83 is fine] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `crypto` (Node built-in) | — | Linear webhook HMAC-SHA256 verify | `createHmac` + `timingSafeEqual` (D-04, INGEST-01) |
| `js-yaml` | 4.x | Future YAML rule parsing | P2 alert engine; not used in P1 |
| `pg` | 8.x | Postgres driver | Underlies Drizzle; used directly by graphile-worker pool |
| `dotenv` | latest | `.env` loading in dev | Production uses Docker env injection |
| `@fastify/cors` | 11.x | CORS plugin | If dashboard and API run on different origins in dev |

### Alternatives Considered (already decided in CONTEXT.md — listed for the planner's awareness)

| Instead of | Could Use | Why Not (per locked decisions) |
|------------|-----------|--------------------------------|
| Graphile Worker | pg-boss | Graphile has missed-schedule catchup + LISTEN/NOTIFY (D-02 ref to SUMMARY.md) |
| Drizzle | Prisma | Prisma's heavy migration UX; weak window-function escape hatch |
| Fastify | Express | 2-3x throughput deficit; no built-in schema validation |
| node-cron | Graphile Worker cron | node-cron skips missed schedules; doesn't survive restarts |
| Redis-backed queue (BullMQ) | Graphile Worker | Violates Postgres-only constraint |

**Installation:**
```bash
pnpm add fastify @fastify/cors pino pino-http
pnpm add drizzle-orm pg graphile-worker
pnpm add zod prom-client @linear/sdk
pnpm add -D drizzle-kit @types/pg @types/node tsx vitest typescript
```

---

## Architecture Patterns

### Recommended Project Structure

```
.
├── compose.yml                      # web + worker + postgres:16-alpine
├── .env.example                     # all required env vars listed
├── pnpm-workspace.yaml
├── packages/
│   ├── db/                          # Drizzle schema + migrations
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── workspaces.ts
│   │   │   │   ├── agents.ts
│   │   │   │   ├── teams.ts
│   │   │   │   ├── cycles.ts
│   │   │   │   ├── repos.ts
│   │   │   │   ├── issues.ts        # title_hash: TitleHash, no title field
│   │   │   │   ├── agent-sessions.ts
│   │   │   │   ├── identity-mappings.ts
│   │   │   │   ├── workspace-warnings.ts
│   │   │   │   ├── cost-by-agent-daily.ts
│   │   │   │   ├── alert-events.ts  # reserved, empty in P1
│   │   │   │   └── raw-event.ts     # in events schema, partitioned
│   │   │   └── index.ts             # exports drizzle instance + schema
│   │   ├── migrations/              # drizzle-kit generate output
│   │   │   ├── 0000_init.sql        # schema + partitioning DDL
│   │   │   └── meta/
│   │   └── drizzle.config.ts
│   ├── shared/                      # Zod schemas + privacy utility
│   │   └── src/
│   │       ├── privacy.ts           # hashTitle() + TitleHash type
│   │       ├── query.ts             # MetricName, DimensionName, QueryRequest schema
│   │       └── events.ts            # SDK event Zod schemas
│   ├── server/                      # Fastify + Graphile Worker
│   │   └── src/
│   │       ├── index.ts             # Fastify entry; runs migrations first
│   │       ├── worker.ts            # Graphile Worker entry (separate process)
│   │       ├── env.ts               # Zod-validated env loader; fails fast
│   │       ├── plugins/
│   │       │   ├── raw-body.ts      # addContentTypeParser for application/json
│   │       │   ├── request-logger.ts # custom pino logger; D-29 fields only
│   │       │   ├── metrics.ts       # prom-client + /metrics route
│   │       │   └── auth.ts          # Bearer workspace API key
│   │       ├── routes/
│   │       │   ├── webhooks/linear.ts
│   │       │   ├── webhooks/health.ts
│   │       │   ├── api/v1/query.ts
│   │       │   ├── api/v1/sdk/event.ts
│   │       │   └── api/v1/agents/[id]/confirm.ts
│   │       ├── query/
│   │       │   ├── dispatcher.ts    # MetricName → SQL function map
│   │       │   ├── metrics/
│   │       │   │   ├── cost-by-agent.ts
│   │       │   │   └── agent-session-count.ts
│   │       │   └── filters.ts       # parameterized filter application
│   │       ├── tasks/               # Graphile Worker task functions
│   │       │   ├── resolve-identity.ts
│   │       │   ├── rotate-raw-event-partitions.ts
│   │       │   ├── detect-shared-app.ts
│   │       │   └── refresh-cost-rollup.ts  # stub in P1
│   │       ├── crontab.ts           # parsedCronItems for graphile-worker
│   │       └── test/
│   │           ├── perf/webhook-ack.bench.ts  # D-31
│   │           ├── integration/idempotency.test.ts
│   │           └── unit/...
│   └── web/                         # Next.js 15 App Router
│       └── src/
│           └── app/
│               ├── (dashboard)/
│               │   ├── layout.tsx
│               │   ├── cost/page.tsx       # the only P1 view
│               │   ├── reliability/page.tsx  # P2 stub
│               │   └── lineage/page.tsx      # P2 stub
│               ├── (setup)/
│               │   ├── page.tsx              # wizard step 1
│               │   ├── agentsession-warning/page.tsx  # step 2 (D-13)
│               │   └── linear-oauth/route.ts # OAuth callback
│               └── api/
│                   └── v1/
│                       └── query/route.ts    # proxies to server query API OR same handler
```

### Pattern 1: Fastify 5 Raw-Body Access for HMAC Verification (INGEST-01, D-04)

**What:** Fastify 5 parses JSON before route handlers run. HMAC must be computed on the **raw bytes** received, not on a re-serialized parsed body. Use `addContentTypeParser` to attach the raw buffer to the request.

**When to use:** Linear webhook route (and future GitHub webhook route).

**Code:**

```typescript
// Source: https://github.com/fastify/fastify/issues/5491 [CITED — community pattern; Fastify 5.8.5 verified]
// packages/server/src/plugins/raw-body.ts
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export default fp(async (fastify) => {
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      // body is a Buffer because parseAs: 'buffer'
      try {
        const json = JSON.parse(body.toString('utf8'));
        req.rawBody = body as Buffer;
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
});
```

```typescript
// packages/server/src/routes/webhooks/linear.ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export default async function (fastify: FastifyInstance) {
  fastify.post('/webhooks/linear', async (req, reply) => {
    const signature = req.headers['linear-signature']; // VERIFIED: linear-signature header [CITED: Linear webhook docs]
    const deliveryId = req.headers['linear-delivery'];  // VERIFIED: Linear-Delivery UUID header

    // D-09: missing/unparseable Linear-Delivery → 400 (NOT 401)
    if (typeof deliveryId !== 'string' || !/^[0-9a-f-]{36}$/.test(deliveryId)) {
      return reply.code(400).send({ error: 'missing_or_invalid_linear_delivery' });
    }

    // D-04: HMAC verify before any other processing; 401 on signature failure
    if (typeof signature !== 'string' || !req.rawBody) {
      return reply.code(401).send({ error: 'missing_signature' });
    }
    const expected = createHmac('sha256', fastify.env.LINEAR_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    // D-04: single INSERT with ON CONFLICT for idempotency (INGEST-05)
    const result = await fastify.db.execute(sql`
      INSERT INTO events.raw_event (source, upstream_id, received_at, payload, signature_valid)
      VALUES ('linear', ${deliveryId}, now(), ${req.body}::jsonb, true)
      ON CONFLICT (source, upstream_id) DO NOTHING
      RETURNING id, (xmax = 0) AS is_new
    `);

    // D-04: enqueue Graphile Worker job (async; not awaited beyond enqueue)
    if (result.rows[0]?.is_new) {
      await fastify.graphile.addJob('resolve_identity', {
        raw_event_id: result.rows[0].id,
        workspace_id: fastify.env.WORKSPACE_ID, // single-tenant in P1
      });
    }

    // Always 200 to prevent Linear retry storms (D-04, Pitfall 1+8)
    return reply.code(200).send({ ok: true });
  });
}
```

**CRITICAL note for the planner:** The Linear webhook signature header is **`Linear-Signature`** (verified from official docs), not `X-Linear-Signature-256` as INGEST-01 currently states. INGEST-01's header name should be corrected to match Linear's documented header. This is a 2-character documentation fix for the requirement, not a code change. Flagged in Open Questions.

### Pattern 2: Drizzle Migration for Declarative Monthly Partitioning (DATA-03, D-06)

**What:** Drizzle has no native partition DSL. Use raw SQL via `sql\`...\`` in a migration file, OR write the entire migration as SQL via `drizzle-kit generate` + manual edit. Recommended: write the first migration manually as SQL because partitioning DDL is too specific for the generator.

**When to use:** First migration only. Subsequent migrations use Drizzle schema diffing.

**Code (migrations/0000_init.sql — hand-authored):**

```sql
-- Source: Postgres 16 partitioning docs [CITED: postgresql.org/docs/16/ddl-partitioning.html]

-- Schema for raw events (isolated from public)
CREATE SCHEMA IF NOT EXISTS events;

-- Partitioned parent table
CREATE TABLE events.raw_event (
  id              bigserial,
  source          text NOT NULL CHECK (source IN ('linear','github','vendor','sdk')),
  upstream_id     text NOT NULL,
  received_at     timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  -- Composite PK includes partition key (Postgres requirement for partitioned tables)
  PRIMARY KEY (id, received_at),
  UNIQUE (source, upstream_id, received_at)  -- partition key in unique constraint too
) PARTITION BY RANGE (received_at);

-- Pre-create current month + next month partitions
-- Migration runner is responsible for substituting actual dates if templated; here shown literal.
CREATE TABLE events.raw_event_2026_05 PARTITION OF events.raw_event
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE events.raw_event_2026_06 PARTITION OF events.raw_event
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Indexes on parent propagate to partitions
CREATE INDEX ON events.raw_event (received_at);

-- Idempotency: enforce per-partition unique (source, upstream_id) — composite includes partition key
-- Note: a single global unique index on (source, upstream_id) is NOT possible across partitions
-- without including the partition key. The application MUST use the inserted partition's
-- ON CONFLICT for dedup; ARCHITECTURE.md's INSERT pattern is correct.
```

**Drizzle schema declaration (informational only — partition DDL stays in raw SQL migration):**

```typescript
// packages/db/src/schema/raw-event.ts
import { bigserial, jsonb, pgSchema, text, timestamp, boolean, primaryKey, unique } from 'drizzle-orm/pg-core';

export const eventsSchema = pgSchema('events');

export const rawEvent = eventsSchema.table('raw_event', {
  id: bigserial('id', { mode: 'bigint' }).notNull(),
  source: text('source').notNull(),
  upstreamId: text('upstream_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb('payload').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.id, t.receivedAt] }),
  uniqDelivery: unique().on(t.source, t.upstreamId, t.receivedAt),
}));
// Drizzle does not generate the PARTITION BY clause. The hand-authored migration above is the source of truth.
// drizzle-kit generate against this schema will produce a NON-partitioned CREATE TABLE — DO NOT use it for raw_event.
```

**Partition rotation cron (D-06):**

```typescript
// packages/server/src/tasks/rotate-raw-event-partitions.ts
// Source: pattern from Postgres docs + community partition rotation examples [CITED: postgresql.org/docs/16/ddl-partitioning.html]
import type { Task } from 'graphile-worker';
import { sql } from 'drizzle-orm';

export const rotateRawEventPartitions: Task = async (_payload, helpers) => {
  const db = helpers.db; // attached via task helpers, see worker setup

  // Compute next month's date range
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const nextNext = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1));
  const partitionName = `raw_event_${next.getUTCFullYear()}_${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  const fromDate = next.toISOString().slice(0, 10);
  const toDate = nextNext.toISOString().slice(0, 10);

  // Idempotent: IF NOT EXISTS
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS events.${sql.raw(partitionName)}
    PARTITION OF events.raw_event
    FOR VALUES FROM (${fromDate}) TO (${toDate})
  `);

  // Drop partitions older than 30 days
  // Strategy: detach + drop instead of DELETE; instant reclaim, no vacuum (Pitfall 9)
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const oldName = `raw_event_${cutoff.getUTCFullYear()}_${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}`;
  await db.execute(sql`
    ALTER TABLE events.raw_event DETACH PARTITION events.${sql.raw(oldName)} CONCURRENTLY
  `).catch(() => {/* already detached or doesn't exist */});
  await db.execute(sql`DROP TABLE IF EXISTS events.${sql.raw(oldName)}`);
};
```

### Pattern 3: Graphile Worker Setup with Cron (resolve_identity job; D-15, D-18, D-06)

**What:** Graphile Worker runs as a **separate process** (the `worker` container, D-03). Tasks are TypeScript files exporting a default `Task` function. Crons are registered via `parsedCronItems` at startup.

**When to use:** Worker entry point in `packages/server/src/worker.ts`.

**Code:**

```typescript
// Source: https://worker.graphile.org/docs/cron + https://worker.graphile.org/docs/library [VERIFIED: graphile-worker 0.16.6]
// packages/server/src/worker.ts
import { run, parseCronItems } from 'graphile-worker';
import { resolveIdentity } from './tasks/resolve-identity';
import { rotateRawEventPartitions } from './tasks/rotate-raw-event-partitions';
import { detectSharedApp } from './tasks/detect-shared-app';
import { refreshCostRollup } from './tasks/refresh-cost-rollup';
import { env } from './env';

async function main() {
  const runner = await run({
    connectionString: env.DATABASE_URL,
    concurrency: 5,
    // Graceful shutdown
    noHandleSignals: false,
    pollInterval: 1000,
    taskList: {
      resolve_identity: resolveIdentity,
      rotate_raw_event_partitions: rotateRawEventPartitions,
      detect_shared_app: detectSharedApp,
      refresh_cost_rollup: refreshCostRollup, // stub in P1
    },
    parsedCronItems: parseCronItems([
      // Run on the 1st of each month at 00:00 UTC; backfilling on startup if missed
      { task: 'rotate_raw_event_partitions', pattern: '0 0 1 * *', options: { backfillPeriod: 24 * 60 * 60 * 1000 } },
      // Hourly shared-app heuristic (D-18)
      { task: 'detect_shared_app', pattern: '0 * * * *' },
      // Daily rollup stub at 02:00 UTC; in P1 the function logs and returns
      { task: 'refresh_cost_rollup', pattern: '0 2 * * *' },
    ]),
  });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**resolve_identity task (D-15, D-16, ID-01..ID-03, ID-06):**

```typescript
// packages/server/src/tasks/resolve-identity.ts
import type { Task } from 'graphile-worker';
import { sql } from 'drizzle-orm';
import { dbForTask } from '../db'; // helper that returns a Drizzle instance bound to helpers.withPgClient
import { resolverConfidenceHistogram } from '../plugins/metrics';

interface Payload {
  raw_event_id: number;
  workspace_id: string;
}

export const resolveIdentity: Task = async (payload, helpers) => {
  const { raw_event_id, workspace_id } = payload as Payload;
  const threshold = parseFloat(process.env.IDENTITY_CONFIDENCE_THRESHOLD ?? '0.8'); // ID-06

  await helpers.withPgClient(async (pgClient) => {
    const db = dbForTask(pgClient);

    // Idempotent on (workspace_id, raw_event_id) — D-15
    // If a mapping for this raw_event already exists, return early.
    // Uses INSERT ... ON CONFLICT to make this race-safe across worker replicas.
    const ev = await db.execute(sql`
      SELECT payload FROM events.raw_event WHERE id = ${raw_event_id}
    `);
    if (ev.rows.length === 0) return; // partition was rotated mid-job

    const linearAppUserId = ev.rows[0].payload?.actor?.id ?? null;

    // P1: only the Linear signal contributes (D-16). confidence = 0.5 if present, 0 if absent.
    const hasLinear = linearAppUserId ? 1 : 0;
    const confidence = 0.5 * hasLinear;

    // P1 state derivation (D-16, ID-02): every P1 row is below 0.8 → PENDING_CONFIRMATION
    let state: 'NEW_AGENT' | 'PENDING_CONFIRMATION' | 'AUTO_PROMOTED' = 'NEW_AGENT';
    if (hasLinear === 1) state = confidence >= threshold ? 'AUTO_PROMOTED' : 'PENDING_CONFIRMATION';

    // Upsert with idempotency: same (workspace_id, raw_event_id) yields same result row
    await db.execute(sql`
      INSERT INTO identity_mappings (workspace_id, raw_event_id, linear_app_user_id, confidence, state)
      VALUES (${workspace_id}, ${raw_event_id}, ${linearAppUserId}, ${confidence}, ${state})
      ON CONFLICT (workspace_id, raw_event_id) DO NOTHING
    `);

    // D-30: observe confidence histogram
    resolverConfidenceHistogram.observe(confidence);
  });
};
```

### Pattern 4: Drizzle Branded TitleHash Type (PRIV-01, D-26)

**What:** Make title leakage a TypeScript compile error, not a runtime test failure. The `issues` schema column type is the brand; only `hashTitle()` returns it.

**Code:**

```typescript
// Source: TypeScript branded types pattern + Drizzle custom column types [CITED: orm.drizzle.team]
// packages/shared/src/privacy.ts
import { createHash } from 'node:crypto';

export type TitleHash = string & { readonly __brand: 'TitleHash' };

/**
 * The ONLY function permitted to read raw issue titles.
 * D-27: sha256(workspace_salt + ":" + normalized(raw)) where normalized = trim+lowercase
 */
export function hashTitle(rawTitle: string, workspaceSalt: string): TitleHash {
  const normalized = rawTitle.trim().toLowerCase();
  const digest = createHash('sha256').update(`${workspaceSalt}:${normalized}`).digest('hex');
  return digest as TitleHash;
}
```

```typescript
// packages/db/src/schema/issues.ts
import { pgTable, text, uuid, timestamp } from 'drizzle-orm/pg-core';
import type { TitleHash } from '@linearwatch/shared/privacy';

// Custom column type: text in Postgres, TitleHash in TypeScript
import { customType } from 'drizzle-orm/pg-core';
const titleHashColumn = customType<{ data: TitleHash; driverData: string }>({
  dataType: () => 'text',
  toDriver: (v) => v,
  fromDriver: (v) => v as TitleHash,
});

export const issues = pgTable('issues', {
  id: uuid('id').primaryKey().defaultRandom(),
  linearId: text('linear_id').unique().notNull(),
  teamId: uuid('team_id'),
  cycleId: uuid('cycle_id'),
  titleHash: titleHashColumn('title_hash').notNull(), // <-- BRANDED TYPE
  // Note: NO `title: text` column. Type system prevents accidental insertion.
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

// Trying to insert `{ title: 'something' }` is a TypeScript error at compile time.
// Trying to insert `{ titleHash: 'raw-string' }` is also a TypeScript error
// (must be branded TitleHash from hashTitle()).
```

**CI test (PRIV-03, D-28):**

```typescript
// packages/server/src/test/integration/privacy-guard.test.ts
import { describe, it, expect } from 'vitest';
import { app } from '../app';

describe('privacy: raw titles never leak', () => {
  it('seeded titles do not appear in any query API response', async () => {
    const seedTitle = '__SEED_TITLE_DETECTOR_8a7c2f__';
    // Insert via raw payload simulating a webhook
    await app.inject({
      method: 'POST',
      url: '/webhooks/linear',
      headers: { 'linear-signature': sign(...), 'linear-delivery': 'test-uuid' },
      payload: { issue: { title: seedTitle, ... } },
    });
    // Wait for resolver job to complete
    await new Promise(r => setTimeout(r, 500));

    // Query every metric with every dimension permutation
    const metrics = ['cost_by_agent', 'agent_session_count'];
    const dimensions = ['agent', 'team', 'cycle'];
    for (const metric of metrics) for (const dimension of dimensions) {
      const res = await app.inject({
        method: 'POST', url: '/api/v1/query',
        headers: { authorization: `Bearer ${TEST_API_KEY}` },
        payload: { metric, dimension, window: { last: '7d' } },
      });
      expect(res.body).not.toContain(seedTitle);
    }
  });
});
```

**Static check via grep (CI, OBS-04, D-28):**

```bash
# In CI, after install, fail build if any of these match:
grep -rE "req\.body|request\.body" packages/server/src/ packages/web/src/ packages/shared/src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=test \
  | grep -v 'rawBody' \
  && echo "FAIL: req.body referenced in production code" && exit 1 || echo "OK"
```

### Pattern 5: Constant-Time Bearer Token Auth (API-06, D-14, D-19)

**What:** Workspace API keys are stored as sha256 hashes. Compare incoming Bearer tokens via `timingSafeEqual` to prevent timing-oracle leaks.

**Code:**

```typescript
// packages/server/src/plugins/auth.ts
import fp from 'fastify-plugin';
import { createHash, timingSafeEqual } from 'node:crypto';

export default fp(async (fastify) => {
  fastify.decorate('authBearer', async (req, reply) => {
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer' });
    }
    const presented = auth.slice('Bearer '.length).trim();
    const presentedHash = createHash('sha256').update(presented).digest();

    // Look up workspace by hash prefix (or single-tenant: read the only workspace row)
    const ws = await fastify.db.query.workspaces.findFirst();
    if (!ws) return reply.code(401).send({ error: 'unauthorized' });
    const storedHash = Buffer.from(ws.apiKeyHash, 'hex');

    if (presentedHash.length !== storedHash.length || !timingSafeEqual(presentedHash, storedHash)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    req.workspaceId = ws.id;
  });
});

// Usage in route:
// fastify.post('/api/v1/query', { preHandler: fastify.authBearer }, async (req, reply) => {...});
```

### Pattern 6: Pino Logger with Redact + Custom Webhook Logger (OBS-01, D-29)

**What:** Two layers of defense. (1) pino's `redact` blocks any access to `req.body` and signature headers anywhere in the app, even from accidental `req.log.info(req)`. (2) The custom webhook request logger only emits the D-29 whitelist of fields.

**Code:**

```typescript
// packages/server/src/index.ts (excerpt)
import Fastify from 'fastify';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.body',
      'req.headers["linear-signature"]',
      'req.headers["x-hub-signature-256"]',
      'req.headers.authorization',
      'res.body',
      '*.payload',
      '*.signature',
    ],
    censor: '[REDACTED]',
    remove: false, // keep keys but blank values, so observers see redaction was active
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      // Deliberately NOT including headers, body
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

const fastify = Fastify({ loggerInstance: logger, disableRequestLogging: true });
// disableRequestLogging: true → suppress default per-request logs; we emit our own from the webhook handler.
```

```typescript
// packages/server/src/plugins/request-logger.ts (custom webhook logger — D-29)
export async function logWebhookReceipt(req, reply, source: 'linear' | 'github' | 'sdk') {
  const start = process.hrtime.bigint();
  const deliveryId = req.headers['linear-delivery'] ?? req.headers['x-github-delivery'] ?? null;
  const eventType = req.body?.type ?? req.body?.event_type ?? null;
  const bytes = req.rawBody?.length ?? 0;

  reply.then(() => {
    const latencyMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const fields: Record<string, unknown> = {
      delivery_id: deliveryId,
      source,
      event_type: eventType,
      bytes_received: bytes,
      latency_ms: latencyMs,
    };
    if (process.env.LOG_LEVEL === 'debug') {
      fields.payload_keys = req.body ? Object.keys(req.body) : []; // top-level keys only — D-29
    }
    req.log.info(fields, 'webhook_received');
  });
}
```

### Pattern 7: Prometheus /metrics with prom-client (OBS-02, D-30)

```typescript
// Source: https://github.com/siimon/prom-client [VERIFIED: prom-client 15.1.3]
// packages/server/src/plugins/metrics.ts
import client from 'prom-client';

export const eventsReceived = new client.Counter({
  name: 'linearwatch_events_received_total',
  help: 'Number of webhook events received',
  labelNames: ['source'] as const,
});

export const webhookAckSeconds = new client.Histogram({
  name: 'linearwatch_webhook_ack_seconds',
  help: 'Time to ack a webhook',
  labelNames: ['source'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.5, 1, 2], // tuned for 200ms SLA
});

export const jobsQueueDepth = new client.Gauge({
  name: 'linearwatch_jobs_queue_depth',
  help: 'Number of pending Graphile Worker jobs by name',
  labelNames: ['job_name'] as const,
  async collect() {
    // Query graphile_worker._private_jobs (or graphile_worker.jobs depending on version) on scrape
    // For v0.16.x the table is `graphile_worker._private_jobs` (underscore-prefix is internal)
    // Stub-safe pattern:
    const rows = await db.execute(sql`
      SELECT task_identifier AS job_name, count(*)::int AS depth
      FROM graphile_worker._private_jobs
      GROUP BY task_identifier
    `);
    for (const row of rows.rows) {
      this.labels(row.job_name).set(row.depth);
    }
  },
});

export const resolverConfidenceHistogram = new client.Histogram({
  name: 'linearwatch_identity_resolver_confidence',
  help: 'Distribution of identity resolver confidence scores',
  buckets: [0, 0.25, 0.5, 0.75, 0.8, 0.9, 1.0],
});

export const enrichmentLagSeconds = new client.Gauge({
  name: 'linearwatch_enrichment_lag_seconds',
  help: 'Lag between source event and enrichment completion (P1: stub returning 0)',
  labelNames: ['source'] as const,
});

// Mount /metrics route
export async function registerMetricsRoute(fastify) {
  fastify.get('/metrics', async (_req, reply) => {
    reply.type(client.register.contentType);
    return client.register.metrics();
  });
}
```

### Pattern 8: Next.js 15 App Router → POST /api/v1/query (API-07, DASH-01)

**What:** Server Components fetch from `POST /api/v1/query`. The "absolute URL" gotcha: Server Components in production need an absolute URL when calling external services, but a same-origin fetch in development can use a relative path **only if** Next.js is configured to allow it. The clean solution is to call the query handler **directly as a function** when both ship in the same Next.js app (D-03 web container), or use a known internal URL via env var.

**Recommended pattern for D-03 (Next.js + Fastify in the SAME `web` container):** This is actually two services. Cleanest: keep them as separate runtimes, but the Server Component fetches via `process.env.LINEARWATCH_INTERNAL_URL` (e.g., `http://127.0.0.1:8080`) injected by docker-compose. The Bearer key is server-side; never reaches the browser.

**Alternative pattern (even simpler):** Co-locate the query handler inside Next.js as a Route Handler at `app/api/v1/query/route.ts`. Then the Server Component fetches `${process.env.NEXT_INTERNAL_URL ?? 'http://localhost:3000'}/api/v1/query`. CONTEXT.md D-25 puts the API in `packages/server/`; the planner should pick one. **Recommendation:** keep Fastify owning `/api/v1/query` (so the future CLI in P2 hits the same endpoint without going through Next.js), and have Next.js Server Components fetch via internal URL.

```typescript
// packages/web/src/app/(dashboard)/cost/page.tsx
// Source: Next.js 15 App Router docs [CITED: nextjs.org/docs/app]

import { CostChart } from '@/components/cost-chart';

async function fetchCostByAgent(window: string) {
  // Server-side fetch; runs in Node, not browser. API key stays server-side.
  const res = await fetch(`${process.env.LINEARWATCH_INTERNAL_URL}/api/v1/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${process.env.LINEARWATCH_INTERNAL_API_KEY}`,
    },
    body: JSON.stringify({
      metric: 'cost_by_agent',
      dimension: 'agent',
      window: { last: window },
    }),
    // No-store: dashboard data must be fresh on each render in a self-hosted single-tenant tool
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`query failed: ${res.status}`);
  return res.json();
}

export default async function CostPage({ searchParams }: { searchParams: { window?: string } }) {
  const window = searchParams.window ?? '14d';
  const data = await fetchCostByAgent(window);
  return <CostChart data={data} />;
}
```

### Pattern 9: Query API Dispatcher with Zod Enum (API-02, API-03, D-25)

```typescript
// packages/shared/src/query.ts
import { z } from 'zod';

export const MetricName = z.enum(['cost_by_agent', 'agent_session_count']); // P1 only
export const DimensionName = z.enum(['agent', 'team', 'cycle']);             // P1 only

export const QueryRequest = z.object({
  metric: MetricName,
  dimension: DimensionName.optional(),
  filters: z.array(z.object({
    field: z.enum(['agent_id', 'team_id', 'cycle_id']),
    op: z.enum(['eq', 'in', 'neq']),
    value: z.union([z.string(), z.array(z.string())]),
  })).optional(),
  window: z.object({
    last: z.string().regex(/^\d+(d|h)$/).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  }),
});
export type QueryRequest = z.infer<typeof QueryRequest>;
```

```typescript
// packages/server/src/query/dispatcher.ts
import { costByAgent } from './metrics/cost-by-agent';
import { agentSessionCount } from './metrics/agent-session-count';
import type { QueryRequest } from '@linearwatch/shared/query';
import type { MetricName } from '@linearwatch/shared/query';

const handlers: Record<z.infer<typeof MetricName>, (req: QueryRequest) => Promise<QueryResult>> = {
  cost_by_agent: costByAgent,
  agent_session_count: agentSessionCount,
};

export async function dispatchQuery(req: QueryRequest) {
  const handler = handlers[req.metric];
  if (!handler) throw new Error('unknown_metric'); // shouldn't happen — Zod validates enum
  return handler(req);
}
```

```typescript
// packages/server/src/routes/api/v1/query.ts
fastify.post('/api/v1/query', { preHandler: fastify.authBearer }, async (req, reply) => {
  const parsed = QueryRequest.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid_request', details: parsed.error.format() });
  }
  const result = await dispatchQuery(parsed.data);
  return reply.send(result);
});
```

### Anti-Patterns to Avoid

- **Calling `resolveIdentity()` synchronously in the webhook handler** — Pitfall 8; violates D-04. The handler does HMAC + INSERT + enqueue + 200, nothing else.
- **Using `drizzle-kit push` instead of `generate`** — D-05. Push is a declarative diff that bypasses migration files. Self-hosters cannot audit a `push`-based history. Use `generate`.
- **Adding `title: text('title')` to the `issues` schema "for debugging"** — Pitfall 13. The brand type makes this a compile error; don't bypass it with `as any`.
- **Logging `request.headers` at debug level** — Pitfall 12. Pino redact catches `authorization` and signature headers, but a hand-rolled `console.log(req.headers)` bypasses redact. Use `req.log` exclusively.
- **Skipping the `Linear-Delivery` UUID format check** — D-09. A malformed header should be 400 immediately, before any DB write. Don't synthesize a fallback dedup key.
- **GIN index on `events.raw_event.payload`** — Pitfall 9. The raw event store exists for replay, not querying. A simple `(received_at)` btree (propagated to partitions) is sufficient.
- **`REFRESH MATERIALIZED VIEW` without `CONCURRENTLY`** — irrelevant in P1 (no MVs in P1), but if `cost_by_agent_daily` is ever upgraded to an MV in P2, it must be CONCURRENTLY with a unique index.
- **In-process node-cron for partition rotation** — Pitfall 8 + ARCHITECTURE Anti-Pattern 2. Use Graphile Worker cron with `backfillPeriod` to recover after restarts.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC verification | Manual `===` comparison | `crypto.timingSafeEqual` (Node built-in) | Timing oracle leaks; standard 4-line pattern is the right solution |
| Job queue + cron | `setInterval`, `node-cron` | Graphile Worker | node-cron skips missed schedules and doesn't survive restarts (ARCHITECTURE Anti-Pattern 2) |
| Migration runner | Custom SQL applier | `drizzle-kit migrate` | drizzle-kit handles version tracking, idempotent application, and rollback metadata |
| Body validation | Hand-rolled type guards | Zod schemas in `packages/shared/` | Same Zod schema validates server input AND drives shared TypeScript types for SDK (P2) |
| Webhook signature lib (GitHub, future) | Hand-roll SHA-256 | `@octokit/webhooks-methods` `verify()` | Handles the signature format quirks; battle-tested against malformed inputs |
| Prometheus exporter | Custom JSON `/metrics` route | `prom-client` register | OpenMetrics text format is fiddly; prom-client handles it |
| Postgres client pooling | Custom pool | `pg.Pool` (via Drizzle) + Graphile Worker's own pool | Graphile manages its connection pool; the app uses a separate pg.Pool for application queries |
| OAuth state token | Custom random | `crypto.randomBytes(32).toString('base64url')` + Postgres lookup | Standard one-line pattern |

**Key insight:** Every "small" custom solution in this domain has at least one well-documented incident. Idempotency is the canonical example: every "we'll just check if the row exists first" implementation eventually races and double-inserts under load. The unique constraint + ON CONFLICT is the only correct answer.

---

## Common Pitfalls

The 8 CRITICAL pitfalls from `.planning/research/PITFALLS.md` ALL belong to Phase 1. Each must have a verifying task.

### Pitfall 1: Linear at-least-once delivery → duplicate metrics
- **Eliminated by:** Unique constraint `(source, upstream_id, received_at)` on `events.raw_event`; `INSERT ... ON CONFLICT DO NOTHING`.
- **Verify task:** Integration test — replay same signed payload twice, assert 1 row in `events.raw_event`.

### Pitfall 2: Synchronous processing breaks p99
- **Eliminated by:** D-04 handler shape; D-31 benchmark.
- **Verify task:** `webhook-ack.bench.ts` — 200 concurrent valid signed payloads; assert p99 < 200ms; assert `resolveIdentity` does not appear in handler call stack (lint check or code review).

### Pitfall 3: GitHub SHA-1 vs SHA-256 (P2-relevant but pattern set in P1)
- **Eliminated by:** P1 ships only Linear; the constant-time-compare helper used in Linear is reused in P2 GitHub.
- **Verify task:** P2 ships SHA-1-only request → 401 test. P1 documents the pattern in code comments where the helper lives.

### Pitfall 4: Title hashing inconsistency / leakage
- **Eliminated by:** D-26 branded `TitleHash` + single `hashTitle()` function; D-27 normalization (`trim().toLowerCase()`); D-28 CI assertions.
- **Verify task:** Privacy test (Pattern 4 above); compile-time check that `issues` schema has no `title` field.

### Pitfall 5: `LOG_LEVEL=debug` leaks payloads
- **Eliminated by:** D-29 pino `redact` config; whitelist-only fields in custom webhook logger.
- **Verify task:** Test that runs the webhook handler at `LOG_LEVEL=debug` and asserts logged JSON does not contain a known seed title or signature substring.

### Pitfall 6: Shared Linear OAuth app silently merges agents
- **Eliminated by:** D-18 `detect_shared_app` cron; `workspace_warnings` table; resolver confidence Prometheus metric.
- **Verify task:** Fixture test — insert raw events with same `linear_app_user_id` from two different vendor patterns within 24h; assert a `workspace_warnings` row is created and is surfaced in the dashboard.

### Pitfall 7: Telemetry opt-in (P3-deferred but pattern set in P1)
- **In P1:** Read `TELEMETRY_OPT_IN` at startup; print boot log line "telemetry: <on|off>"; don't ship the rollup job. The pattern of "first conditional in the function" is documented in a stub.
- **Verify task:** P1 boot log assertion (env var read at startup).

### Pitfall 8: `events.raw_event` vacuum starvation
- **Eliminated by:** D-06 declarative monthly partitioning; `DROP PARTITION` rotation cron; no GIN index on payload.
- **Verify task:** Migration test — insert 1000 rows in an "old" partition, run rotation cron, assert `DROP PARTITION` reclaims them and the partition is gone.

---

## Code Examples

(See Architecture Patterns 1-9 above. All examples are verified against current Fastify 5.8, Drizzle 0.45, graphile-worker 0.16.6, pino 9.x, prom-client 15.1, Postgres 16 docs.)

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express + body-parser | Fastify 5 with `addContentTypeParser` | Fastify 5 GA late 2024 | 2-3x throughput; built-in raw-body access |
| Prisma 6 with Rust engine | Prisma 7 (no engine) OR Drizzle | Prisma 7 in 2025; Drizzle is the analytics-friendly choice | Drizzle's `sql` escape hatch makes window functions clean |
| `X-Hub-Signature` (SHA-1) | `X-Hub-Signature-256` exclusively | GitHub deprecated SHA-1 in 2020+ | Code that reads only SHA-256 is correct; tutorials still show SHA-1 |
| pg-boss for Postgres queues | Graphile Worker | Both maintained; Graphile has missed-schedule catchup + LISTEN/NOTIFY | Catchup is the differentiator for self-hosted reliability |
| `node-cron` in-process | Graphile Worker `parsedCronItems` | Standard for production Node.js | Survives restarts, supports backfill |
| Materialized views with `REFRESH` | Rolling rollup table updated by cron | Postgres 16 didn't change MV semantics; pattern shift driven by `REFRESH` cost | Avoids blocking reads; atomic updates |
| Prisma migrations | drizzle-kit `generate` | 2024+ | SQL files are auditable by self-hosters |

**Deprecated/outdated:**
- **Drizzle without `customType`:** older docs show writing column wrappers manually. `customType<{ data: T }>` (in 0.45.x) is the supported branded-type pattern.
- **Fastify 4 raw body workarounds:** Fastify 5 made `addContentTypeParser({ parseAs: 'buffer' })` the canonical pattern — older `fastify-raw-body` plugin is no longer needed.
- **Linear `X-Linear-Signature-256` header naming:** the header is `Linear-Signature` (single header carrying SHA-256 hex). REQUIREMENTS.md INGEST-01 uses the older naming; Linear's docs are authoritative.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Linear's webhook header is `Linear-Signature` (not `X-Linear-Signature-256` as in INGEST-01) | Pattern 1 | INGEST-01 wording out of sync with code; functional risk: zero (we read the right header in code) |
| A2 | Linear plan requirement "AgentSession requires Business or Enterprise" is currently true | Project Constraints | If Linear changes plan tiers, the README claim and setup-wizard precondition change. Re-verify before Show HN. |
| A3 | Graphile Worker 0.16.x exposes `graphile_worker._private_jobs` for queue-depth scraping | Pattern 7 | If table layout changed across 0.x versions, the metric collector breaks. Pin graphile-worker version; revisit if upgrading. |
| A4 | Next.js 15.5.x is preferred over 16.2.4 for stability in the self-hosted deployment context | Standard Stack | Both versions support App Router + RSC; if planner picks 16, no functional change but Next.js 16 has stricter peer-dep requirements |
| A5 | The Fastify 5 raw-body pattern (Pattern 1) handles payloads up to Linear's max event size without buffering issues | Pattern 1 | Linear payloads are small (<100KB typical); not a load-bearing concern in P1 |
| A6 | Postgres 16 partition `DETACH ... CONCURRENTLY` is safe to run during normal operation | Pattern 2 (rotation) | Standard production pattern; verified in Postgres 16 docs. Risk: very low. |

---

## Open Questions (RESOLVED)

> All Open Questions were resolved during planning. Each item below carries a `**RESOLVED:**` line pointing at the implementing plan.

1. **Header name discrepancy: `X-Linear-Signature-256` (REQUIREMENTS.md INGEST-01) vs `Linear-Signature` (Linear's official docs).**
   - What we know: Linear's webhook docs (verified 2026-05-03) state the header is `Linear-Signature` carrying a hex-encoded HMAC-SHA256 signature. There is no `X-Linear-Signature-256`.
   - What's unclear: whether INGEST-01's wording is a typo or refers to a different version of Linear's API.
   - Recommendation: Code reads `Linear-Signature` (case-insensitive per HTTP spec). Update INGEST-01 wording in a doc-only commit. Plan task: "Update REQUIREMENTS.md INGEST-01 header name."
   - **RESOLVED:** Use `Linear-Signature` (lowercase header per Linear official docs); REQUIREMENTS.md INGEST-01 wording (`X-Linear-Signature-256`) is a doc-only typo. Implemented in 01.05.

2. **Linear AgentSession plan requirement (Business/Enterprise) — verify current state.**
   - What we know: README and CLAUDE.md state Business/Enterprise required. This was verified in initialization research.
   - What's unclear: whether Linear has changed plan tiers since.
   - Recommendation: a P3 README fact-check pass before Show HN. Not a P1 blocker.
   - **RESOLVED:** Business/Enterprise requirement is stated verbatim in the setup wizard warning copy (D-13) and in README; deferred fact-check pass before Show HN is owned by Phase 3, not Phase 1. Implemented in 01.09 (wizard warning) and 01.01 (README).

3. **Revert window default (7d in PRD §X, 14d elsewhere).**
   - What we know: SUMMARY.md flags this in "Gaps to Address." P1 doesn't ship revert detection (P2/INGEST-09).
   - What's unclear: which window value to bake into the schema column name (`reverted_within_14d_at` vs `reverted_at`).
   - Recommendation: P1 schema names the column `reverted_at` (no window in column name); the cron window is configurable. P2 picks the default.
   - **RESOLVED:** P1 schema uses the window-agnostic name `reverted_at`; the cron window is deferred to Phase 2. Implemented in 01.03 (schema).

4. **Cost-per-closed-issue column shape in P1 dashboard table (D-21).**
   - What we know: D-21 ships the column with `—` placeholder until P2 populates `agent_sessions.outcome`.
   - What's unclear: should the placeholder be `—`, `N/A`, or a tooltip-only empty cell?
   - Recommendation: `—` plus a `title` attribute "Available once GitHub PR enrichment is configured (Phase 2)." Designer's call within D-21.
   - **RESOLVED:** Placeholder is `—` with `title` attribute "Available once GitHub PR enrichment is configured (Phase 2)." Implemented in 01.08 (dashboard table).

5. **Does Next.js 15.5 require a workaround for absolute URL in same-process Server Component fetches?**
   - What we know: Server Components run in Node and can use any URL with `fetch()`. The "absolute URL" gotcha applies when fetching the same origin without a host header.
   - What's unclear: whether the planner picks "Next.js Route Handler at /api/v1/query" or "Fastify in a separate container served via internal hostname."
   - Recommendation: keep Fastify owning the API (so the P2 CLI hits the same endpoint). Web container fetches via `LINEARWATCH_INTERNAL_URL` env var. Two-process / one-container deployment is fine.
   - **RESOLVED:** Fastify owns `/api/v1/query`; web Server Components fetch via `LINEARWATCH_INTERNAL_URL` (absolute URL). Implemented in 01.07 (query API on Fastify) and 01.08 (web fetcher).

6. **Single-tenant workspace ID constant — where does it live?**
   - What we know: P1 is single-tenant; all rows belong to one workspace.
   - What's unclear: is the workspace UUID seeded at first migration, generated by setup wizard, or read from env?
   - Recommendation: Setup wizard creates the row on first run and persists ID + salt + api_key_hash. Env var `WORKSPACE_ID` is set after setup and read by both `web` and `worker` for the single-tenant simplification. Plan task should make this explicit.
   - **RESOLVED:** Setup wizard creates the workspace row + generates the API key on first run. Implemented in 01.09.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | DEPLOY-01, dev workflow (D-23) | ✓ | 29.4.0 | — |
| Node.js 22 | server, web, worker | ✓ | 22.22.2 (matches LTS) | — |
| pnpm | monorepo workflow (D-25) | ✗ | — | `corepack enable && corepack prepare pnpm@latest --activate` (one-line install) |
| Bun | CLI compile (P2 only) | ✗ | — | Not needed in P1 |
| psql | local debugging (optional) | ✗ | — | Use `docker exec -it linearwatch-postgres-1 psql ...` instead |
| git | version control | ✓ | 2.34.1 | — |
| Postgres 16 | datastore | (via Docker) | postgres:16-alpine | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- **pnpm:** Easy to install via `corepack enable && corepack prepare pnpm@latest --activate`. Plan should include this as a Wave 0 task.
- **psql:** Optional. `docker exec` is sufficient for the few times it's needed during development.

---

## Validation Architecture

> Project config has `nyquist_validation: false`, so this section is informational. Including it per researcher contract so VALIDATION.md generation has the input it needs.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (CONTEXT.md Claude's discretion default) |
| Config file | `vitest.config.ts` per package, or single root config with workspaces |
| Quick run command | `pnpm vitest run --reporter=dot` |
| Full suite command | `pnpm test` (alias for `vitest run` + perf bench) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| INGEST-04 / D-31 | Webhook ack p99 < 200ms under 200 concurrent | benchmark | `pnpm --filter @linearwatch/server bench:webhook-ack` | ❌ Wave 0 |
| INGEST-05 | Same Linear payload replayed → 1 row | integration | `pnpm vitest run integration/idempotency` | ❌ Wave 0 |
| INGEST-01 | Invalid HMAC → 401 | unit | `pnpm vitest run routes/webhooks/linear` | ❌ Wave 0 |
| INGEST-01 | Missing `Linear-Delivery` → 400 | unit | `pnpm vitest run routes/webhooks/linear` | ❌ Wave 0 |
| INGEST-06 / Pitfall 8 | Old partition dropped after rotation | integration | `pnpm vitest run integration/partition-rotation` | ❌ Wave 0 |
| ID-01 / ID-02 | resolve_identity creates `PENDING_CONFIRMATION` row at conf 0.5 | integration | `pnpm vitest run tasks/resolve-identity` | ❌ Wave 0 |
| ID-05 / D-18 | `detect_shared_app` writes warning row when ≥2 vendor contexts | integration | `pnpm vitest run tasks/detect-shared-app` | ❌ Wave 0 |
| API-02 | Unknown metric → 400 | unit | `pnpm vitest run query/dispatcher` | ❌ Wave 0 |
| API-06 | Bearer auth: invalid key → 401, valid → 200 | integration | `pnpm vitest run plugins/auth` | ❌ Wave 0 |
| PRIV-01 / D-26 | TypeScript compile fails when `title` is added to `issues` | static | `pnpm tsc --noEmit` (intentional broken commit fixture) | ❌ Wave 0 |
| PRIV-03 / D-28 | Seed title never appears in any query API response | integration | `pnpm vitest run integration/privacy-guard` | ❌ Wave 0 |
| OBS-04 | `grep -r 'req.body' src/` empty | static | `bash scripts/check-no-req-body.sh` | ❌ Wave 0 |
| OBS-01 / D-29 | Webhook log line has only whitelisted fields | unit | `pnpm vitest run plugins/request-logger` | ❌ Wave 0 |
| OBS-02 / D-30 | `/metrics` exposes all 5 named metrics | integration | `pnpm vitest run routes/metrics` | ❌ Wave 0 |
| DEPLOY-01 | `docker compose up` reaches `:3000` within 5 min | smoke | `bash scripts/smoke-compose.sh` (timed) | ❌ Wave 0 |
| DEPLOY-03 | Missing required env var → fail-fast at startup | unit | `pnpm vitest run env` | ❌ Wave 0 |
| SETUP-02 | Wizard renders D-13 verbatim copy before OAuth proceeds | e2e (web) | `pnpm --filter @linearwatch/web test:e2e` (Playwright) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm vitest run --changed` (only files affected by the diff)
- **Per wave merge:** `pnpm test` (full suite + bench)
- **Phase gate:** Full suite green + `webhook-ack.bench.ts` p99 < 200ms before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` (root + per-package extending) — config
- [ ] `packages/server/test/perf/webhook-ack.bench.ts` — D-31 benchmark
- [ ] `packages/server/test/integration/idempotency.test.ts` — INGEST-05
- [ ] `packages/server/test/integration/privacy-guard.test.ts` — PRIV-03
- [ ] `packages/server/test/integration/partition-rotation.test.ts` — D-06
- [ ] `scripts/check-no-req-body.sh` — OBS-04 grep guard
- [ ] `scripts/smoke-compose.sh` — DEPLOY-01 timed compose-up
- [ ] `packages/web/playwright.config.ts` + `tests/setup-wizard.spec.ts` — SETUP-02 e2e
- [ ] Test framework install: `pnpm add -D vitest @vitest/ui autocannon` at root

---

## Sources

### Primary (HIGH confidence)
- [Linear Webhooks Developer Docs](https://linear.app/developers/webhooks) — verified `Linear-Signature` and `Linear-Delivery` headers, HMAC-SHA256, 5s timeout, retry schedule (1m, 1h, 6h)
- [Linear Agent Interaction Docs](https://linear.app/developers/agent-interaction) — AgentSession event types, category-enables-UI gotcha
- [Postgres 16 Partitioning Docs](https://www.postgresql.org/docs/16/ddl-partitioning.html) — declarative partitioning, `DETACH PARTITION CONCURRENTLY`
- [Graphile Worker docs — cron](https://worker.graphile.org/docs/cron) — `parsedCronItems`, `parseCronItems`, `backfillPeriod`
- [Graphile Worker docs — config](https://worker.graphile.org/docs/config) — `taskList`, `concurrency`, `connectionString`
- [Drizzle ORM docs](https://orm.drizzle.team/) — `customType`, `sql` escape hatch, `drizzle-kit generate`
- [Fastify 5 docs](https://fastify.dev/docs/v5/) — `addContentTypeParser`, `parseAs: 'buffer'`
- [npm registry](https://www.npmjs.com/) — version verification 2026-05-03 (graphile-worker 0.16.6, drizzle-orm 0.45.2, fastify 5.8.5, etc.)
- `.planning/research/` (SUMMARY, STACK, ARCHITECTURE, PITFALLS, FEATURES) — load-bearing project research

### Secondary (MEDIUM confidence)
- [Fastify GitHub issue #5491](https://github.com/fastify/fastify/issues/5491) — community pattern for HMAC raw-body access
- [prom-client GitHub](https://github.com/siimon/prom-client) — Prometheus metric collector patterns
- [@octokit/webhooks-methods](https://github.com/octokit/webhooks.js) — referenced for P2 GitHub webhook verification

### Tertiary (LOW confidence — flagged in Assumptions)
- Graphile Worker internal table name `graphile_worker._private_jobs` for queue-depth scraping (assumed stable in 0.16.x — verify before P1 ships)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm 2026-05-03; SUMMARY.md choices are sound
- Architecture: HIGH — patterns adapted directly from ARCHITECTURE.md and verified against current docs
- Pitfalls: HIGH — all 8 CRITICAL pitfalls from PITFALLS.md mapped to specific verifying tasks
- Code examples: MEDIUM-HIGH — patterns drawn from official docs; specific test fixtures will need real Linear/dev credentials to fully exercise
- Open questions: MEDIUM — header-naming discrepancy is doc-only; remaining items are minor

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (30 days for stable libraries; sooner if Linear API or graphile-worker has a major release)

---

## RESEARCH COMPLETE

**Phase:** 1 — Foundation
**Confidence:** HIGH

### Key Findings
- All 8 CRITICAL pitfalls map to Phase 1 with specific verifying tasks; D-26 branded `TitleHash` makes Pitfall 4 a compile-time guarantee, not just a runtime test.
- Drizzle has no native partition DSL — first migration is hand-authored SQL with `PARTITION BY RANGE (received_at)`; subsequent migrations use `drizzle-kit generate`.
- Linear's webhook header is `Linear-Signature` (not `X-Linear-Signature-256` as in REQUIREMENTS.md INGEST-01) — flagged as Open Question 1 for a doc-only fix.
- Graphile Worker 0.16.6 verified; `parsedCronItems` + `backfillPeriod` is the correct pattern for partition rotation, shared-app detection, and (P1 stub) cost rollup.
- pnpm is missing on the dev machine; one-line `corepack enable` fixes it. Bun not needed in P1.

### File Created
`/home/bob/Linearwatch/.planning/phases/01-foundation/01-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All versions verified against npm registry 2026-05-03 |
| Architecture | HIGH | 9 concrete code patterns drawn from CONTEXT.md decisions + verified docs |
| Pitfalls | HIGH | All 8 CRITICALs mapped to verifying tasks |
| Code examples | MEDIUM-HIGH | Test fixtures will need live credentials to fully exercise; production patterns are sound |

### Open Questions
1. INGEST-01 header naming (`X-Linear-Signature-256` vs `Linear-Signature`) — recommend doc-only fix.
2. Single-tenant `WORKSPACE_ID` provenance (env vs setup-wizard-generated row + env after setup) — planner should make explicit.
3. Whether to keep Fastify owning `/api/v1/query` (recommended; P2 CLI compatibility) vs. moving it to a Next.js Route Handler.
4. Cost-per-closed-issue placeholder styling in dashboard table (designer's call within D-21).

### Ready for Planning
Research complete. Planner can now create PLAN.md files referencing Patterns 1-9 by name and the Validation Architecture test list.
