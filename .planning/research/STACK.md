# Stack Research

**Domain:** Self-hosted observability/analytics platform for AI agents (webhooks → Postgres → Next.js dashboard + CLI + SDKs)
**Researched:** 2026-05-03
**Confidence:** HIGH (all core choices verified against official docs and current npm/Go ecosystem)

---

## Backend Language Verdict: Node.js (TypeScript), not Go

**Decision: Node.js + TypeScript throughout.**

The single most contested question. The answer is Node.js because of one hard constraint: the Node SDK is a first-class deliverable, and splitting languages across the server and the SDK creates two separate dependency trees, two CI pipelines, two contributor onboarding stories, and significant duplicated logic in the identity resolver. In a 90-day open-source project with a solo maintainer, that split is unaffordable.

The performance objection does not hold at agentwatch's scale. p99 < 200ms for webhook acknowledgment is trivially achievable in Node.js with Fastify — the 200ms budget is dominated by the Postgres write (1-5ms round trip on a loopback connection), not framework overhead. Go would yield p99 around 5-15ms vs Node.js around 15-30ms for the raw HTTP path; both are well inside the 200ms SLA with 10x headroom to spare.

The single-binary CLI objection is real but solved: Bun's `--compile` flag produces a self-contained binary from TypeScript with no Node.js runtime on the target machine. Bun 1.1+ has 95-98% Node.js API compatibility and is production-deployed by Anthropic (Claude Code CLI). This gives the deployment simplicity of Go binaries without leaving the TypeScript ecosystem.

Go would be the right call if: (a) agentwatch ever needs sub-10ms p99 at 50k RPS, or (b) a Go-native design partner wants to contribute. Neither applies in v0.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS | Server runtime | Active LTS through 2027; Fastify v5 targets ≥20; ecosystem breadth for SDK parity |
| TypeScript | 5.x | Language | Static types across server, CLI, and SDK — single source of truth for query API types |
| Fastify | 5.8.x | HTTP server (webhook receiver + query API) | 2-3x faster than Express; schema-based request validation built-in; plugins for pino, cors, auth; v5 stable as of late 2024; 45-55k req/s on Node.js 22 — p99 < 200ms budget met with 10x headroom |
| Drizzle ORM | 0.45.x (stable) | ORM + migrations | Compiles to SQL with minimal overhead; 1.15x faster than raw pg pooling; `sql` escape hatch for window functions; drizzle-kit for migration discipline; star schema with rolling-window queries is idiomatic |
| pg-boss | 12.18.x | Background job queue (60s enrichment, 5m alert cron) | Postgres-only (no Redis/SIDEKIQ); SKIP LOCKED for exactly-once delivery; cron syntax built-in; 231k weekly downloads vs graphile-worker's 87k; simpler API for agentwatch's two job types |
| Next.js | 15.5.x (or 16.x if stable) | Dashboard web app | App Router + RSC for server-side data fetching through query API; streaming Suspense for progressive chart rendering; shadcn/ui compatible; self-hostable via `next start` in Docker |
| Bun | 1.x | CLI binary compilation + dev tooling | `bun build --compile` produces a truly standalone binary (no Node runtime on target); used by Anthropic for Claude Code CLI; 95-98% Node.js API compat; also faster dev server for SDK contributors |
| pino | 9.x | Structured JSON logging | 5x faster than Winston; JSON output by default (satisfies "structured logs by default" requirement); `pino-pretty` for dev; native Fastify integration |
| prom-client | 15.1.x | Prometheus `/metrics` endpoint | De facto Node.js Prometheus client; counters/histograms/gauges for event_count, queue_depth, enrichment_lag, resolver_confidence |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@linear/sdk` | 82.x | Linear GraphQL API (enrichment worker, setup wizard) | All Linear API calls — typed client auto-generated from Linear's schema; webhooks use raw HTTP + HMAC, not this SDK |
| `@octokit/rest` | 22.x | GitHub REST API (PR outcome enrichment) | Fetching PR merge/revert/CI status in the enrichment worker |
| `@octokit/webhooks` | latest | GitHub webhook signature verification | `webhooks.verify(body, sig)` — handles `x-hub-signature-256` HMAC-SHA256 verification; use `@octokit/webhooks-methods` for standalone verify without the event emitter |
| `crypto` (Node built-in) | — | Linear webhook HMAC-SHA256 verification | `createHmac('sha256', secret).update(rawBody).digest('hex')` + `timingSafeEqual`; no external dep needed |
| `commander` | 14.0.x | CLI argument parsing | 130k downstream packages; zero deps; 22ms startup vs oclif's 120ms; sufficient for agentwatch's 6-command surface; Bun compiles the whole tree |
| `zod` | 3.x | Runtime validation for query API inputs, YAML rule parsing | Shared between server and CLI for DSL validation; generates TypeScript types |
| `js-yaml` | 4.x | YAML rule file parsing | Parse alert rule YAML in both server and CLI |
| `tsup` | 8.x | SDK build (Node SDK package) | Outputs ESM + CJS + `.d.ts` in one command; used by Drizzle and other modern TS libs |
| `changesets` | 2.x | SDK versioning and npm publish | Monorepo-aware semver bumps for `@agentwatch/sdk` package |
| `httpx` (Python) | 0.27.x | Python SDK HTTP client | Async-first, mirrors Node SDK interface; both sync and async APIs |
| `pino-http` | 10.x | HTTP request logging middleware for Fastify | Auto-logs req/res with correlation IDs |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| pnpm workspaces | Monorepo package management | Root workspace with `packages/server`, `packages/cli`, `packages/sdk-node`, `packages/sdk-python` (Python managed separately with uv) |
| drizzle-kit | Schema diffing and migration generation | `drizzle-kit generate` → SQL files checked into `migrations/`; `drizzle-kit migrate` applies them at startup |
| Docker Compose | Primary distribution | `compose.yml` brings up `postgres:16-alpine` + app; single `docker compose up` in ≤5 min |
| GoReleaser (or `bun build --compile` + GitHub Actions matrix) | CLI binary release | Build `agentwatch` binary for linux/amd64, linux/arm64, darwin/arm64; attach to GitHub releases |
| uv | Python SDK dev environment | `uv sync` for contributors; `pyproject.toml` with hatchling backend |

---

## Installation

```bash
# Server + CLI + Node SDK (monorepo root)
pnpm install

# Core server dependencies
pnpm add fastify @fastify/cors @fastify/basic-auth pino pino-http
pnpm add drizzle-orm pg pg-boss
pnpm add @linear/sdk @octokit/rest @octokit/webhooks zod js-yaml
pnpm add prom-client

# CLI package
pnpm add commander zod

# Node SDK package
pnpm add -D tsup

# Dev dependencies (root)
pnpm add -D typescript drizzle-kit @types/pg @types/node tsx vitest
pnpm add -D changesets

# Python SDK (managed separately)
uv init packages/sdk-python
uv add httpx
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Node.js + TypeScript | Go | Two-language repo is unaffordable in a 90-day solo project when Node SDK is first-class; p99 200ms SLA met by Node with 10x headroom |
| Fastify | Hono | Hono is better for edge/multi-runtime; Fastify has deeper Postgres-native plugin ecosystem (fastify-postgres, fastify-rate-limit); both meet perf target |
| Fastify | Express | Express is 2-3x slower; no built-in schema validation; Fastify is the 2025 default for new Node APIs |
| Drizzle ORM | Prisma | Prisma 7 dropped the Rust engine but still generates a client binary and has heavier migration flow; Drizzle's `sql` escape hatch is critical for rolling-window analytics queries; Drizzle benchmarks 2x faster for simple selects |
| Drizzle ORM | Kysely | Kysely is a query builder with no migration story; Drizzle adds schema-first migrations + ORM features without losing raw SQL access |
| Drizzle ORM | raw SQL / sqlc | sqlc is Go-only; raw SQL loses TypeScript types on query results; Drizzle gives both typed results AND raw escape hatch |
| pg-boss | graphile-worker | graphile-worker is excellent but lower adoption (87k vs 231k weekly downloads); pg-boss has built-in cron syntax and a simpler API for agentwatch's two job types |
| pg-boss | in-process setInterval | setInterval is not durable — crash loses the tick; Postgres-backed queue survives restarts with exactly-once delivery |
| pg-boss | BullMQ | BullMQ requires Redis, which violates the Postgres-only constraint |
| commander | oclif | oclif has 120ms startup vs commander's 22ms; oclif generates a project scaffold; overkill for 6 commands |
| commander | clipanion | clipanion (Yarn's CLI lib) is excellent but less ecosystem documentation; commander has 130k downstream packages and better known patterns |
| Bun `--compile` for CLI | vercel/pkg | pkg produces 90MB+ binaries embedding an old Node.js runtime; pkg is largely unmaintained; Bun binary is smaller and based on current runtime |
| Bun `--compile` for CLI | Go + Cobra | Requires a separate Go codebase; see Node vs Go verdict above |
| `@linear/sdk` | raw GraphQL | @linear/sdk is auto-generated from Linear's schema at v82.x — typed models for every event type; no reason to hand-roll GraphQL |
| `@octokit/rest` | raw GitHub API fetch | @octokit/rest adds retry, pagination, and typed responses; essential for the enrichment worker's PR polling loop |
| prom-client | OpenTelemetry SDK | OTel is the future standard, but adds collector infra complexity inappropriate for a `docker compose up` self-hosted tool; prom-client scrape endpoint is zero-config |
| Next.js App Router | Remix | Remix is viable but smaller ecosystem for analytics dashboards; Next.js 15 RSC + Suspense streaming is a better fit for the three-pane dashboard pattern |
| Next.js App Router | SvelteKit | SvelteKit is excellent but unfamiliar to most TypeScript-Node contributors; Next.js has more shadcn/ui-compatible chart components |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Redis | Violates the Postgres-only constraint; adds infra complexity to `docker compose up` | pg-boss for job queue; Postgres advisory locks for distributed locking |
| Kafka / RabbitMQ | Same infra complexity problem; agentwatch's event volume (10k-100k events/day) is trivially handled by Postgres | pg-boss |
| Any TSDB (TimescaleDB, InfluxDB, Prometheus as storage) | Adds a second database engine; agentwatch's analytics are 90-day rolling windows on a fact table — not time-series at TSDB scale | Postgres with `date_trunc` + window functions via Drizzle's `sql` escape hatch |
| Prisma (for analytics queries) | Heavy migration UX; no clean window-function escape hatch pre-v7; still has Prisma Accelerate dependency pull | Drizzle ORM |
| oclif | 120ms cold start (5x commander); plugin architecture overkill for a 6-command CLI | commander |
| vercel/pkg | Largely unmaintained; bundles outdated Node.js; 90MB+ binary | Bun `--compile` |
| Winston | 5x slower than pino; no structured JSON by default | pino |
| TypeORM | Legacy decorator-heavy API; Active Record pattern conflicts with star-schema SQL discipline | Drizzle ORM |
| BullMQ | Requires Redis | pg-boss |
| Express | 2-3x throughput deficit vs Fastify; no built-in schema validation | Fastify |

---

## Stack Patterns by Component

**Webhook receiver (webhook latency is the SLA-critical path):**
- Fastify with `application/json` and raw body access for HMAC
- Linear: `crypto.createHmac` on raw body; compare with `timingSafeEqual`
- GitHub: `@octokit/webhooks-methods` `verify()`
- Write to `events.raw_event` (jsonb) synchronously in same request handler — this is the p99 write, keep it one INSERT
- Return 200 immediately; enqueue enrichment job to pg-boss asynchronously

**Enrichment worker (60-second cycle):**
- pg-boss `schedule('enrich-sessions', '*/1 * * * *', {})` registers the cron on startup
- Worker function polls `events.raw_event` for unprocessed events, fans out to Linear API and GitHub API, upserts `agent_sessions`
- Keep within one pg-boss job type; idempotent on `linear_event_id`

**Alert evaluator (5-minute cron):**
- Separate pg-boss scheduled job `'evaluate-alerts'` on `'*/5 * * * *'`
- Loads YAML rules with js-yaml + zod validation at startup; re-validates on file change
- Queries `agent_sessions` with Drizzle's `sql` tag for rolling-window aggregates; pushes notifications via fetch

**Analytical queries (dashboard p95 < 1s):**
- Drizzle schema for type-safe joins on the star schema
- Window functions (rolling 7d/30d averages, percentiles) use `sql\`...\`` escape hatch
- Ensure `agent_sessions(started_at)`, `agent_sessions(agent_id, started_at)` indexes exist from day one
- Query API (POST `/api/v1/query`) is a thin dispatcher — no computed columns in Postgres; aggregation in SQL

**CLI binary distribution:**
- Source lives in `packages/cli/` as TypeScript
- `bun build --compile --target=bun-linux-x64 src/index.ts --outfile dist/agentwatch-linux-x64`
- GitHub Actions matrix for linux/amd64, linux/arm64, darwin/arm64
- Docker compose `agentwatch` image: same binary, `ENTRYPOINT ["/usr/local/bin/agentwatch"]`

**Node SDK (`@agentwatch/sdk`):**
- `packages/sdk-node/` in the monorepo; `tsup` builds ESM + CJS + `.d.ts`
- No server dependency — thin HTTP client that `POST /api/v1/sdk/event` with API key
- Published to npm via Changesets in CI
- Contributors do not need to run the server to work on the SDK

**Python SDK (`agentwatch` on PyPI):**
- `packages/sdk-python/` with `pyproject.toml` + hatchling backend
- `httpx` for async HTTP; mirrors Node SDK event names exactly
- `uv` for dev; `hatch build` for release; published via GitHub Actions

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Fastify 5.x | Node.js ≥20 LTS | Drops Node 18 support |
| Drizzle 0.45.x | pg 8.x, Node.js 18+ | v1.0 beta available but not recommended for production yet |
| pg-boss 12.x | Postgres ≥12 | Uses `SKIP LOCKED`; works with Postgres 16 Alpine in Docker |
| Next.js 15.x | React 19 or 18 | App Router required for RSC; Pages Router is legacy |
| @linear/sdk 82.x | Node.js 18+ | Auto-generated; version tracks Linear API schema |
| prom-client 15.x | Node.js 18+ | No updates in 2 years but stable; no known CVEs; sufficient for agentwatch's metric surface |
| Bun 1.x | Cross-compiles to linux/arm64, linux/x64, darwin/arm64 | 95-98% Node.js API compat; test SDK and CLI code under Node.js in CI to catch the 2-5% gap |

---

## Sources

- Fastify benchmarks — https://fastify.dev/benchmarks/ — verified throughput numbers
- Drizzle ORM docs — https://orm.drizzle.team/ — window function escape hatch, migration discipline
- drizzle-northwind-benchmarks — https://github.com/drizzle-team/drizzle-northwind-benchmarks-pg — 2x perf vs Prisma
- pg-boss npm — https://www.npmjs.com/package/pg-boss — v12.18.1 current
- @linear/sdk npm — https://www.npmjs.com/package/@linear/sdk — v82.x current
- @octokit/rest npm — https://www.npmjs.com/package/@octokit/rest — v22.0.1 current
- @octokit/webhooks GitHub — https://github.com/octokit/webhooks.js/ — `verify()` API confirmed
- Linear webhook docs — https://linear.app/developers/webhooks — `linear-signature` header, HMAC-SHA256
- GitHub webhook docs — https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries — `x-hub-signature-256`
- Bun executables docs — https://bun.com/docs/bundler/executables — `--compile` flag, cross-compile targets
- commander npm — https://www.npmjs.com/package/commander — v14.0.3, 22ms startup
- prom-client npm — https://www.npmjs.com/package/prom-client — v15.1.3 stable
- Next.js 15.5 blog — https://nextjs.org/blog/next-15-5 — App Router + RSC patterns confirmed
- DEV: "Building Great CLIs in 2025: Node.js vs Go vs Rust" — Go + Cobra + GoReleaser recommendation; Bun `--compile` as Node.js equivalent
- DEV: "Why we migrated our CLI from NodeJS to GoLang" — Go binary size/portability advantages documented; mitigated by Bun for this project
- Medium: "Node.js vs Go performance" — 2-5x throughput advantage for Go confirmed but irrelevant at agentwatch's SLA targets

---

*Stack research for: agentwatch — self-hosted AI agent observability platform*
*Researched: 2026-05-03*
