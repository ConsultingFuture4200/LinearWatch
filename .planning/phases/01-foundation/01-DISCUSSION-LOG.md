# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `01-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 01-foundation
**Mode:** `--auto` (no interactive questions; Claude selected recommended defaults for each gray area)
**Areas auto-discussed:** Migration & seed strategy, Webhook idempotency key, Setup wizard flow, Identity resolver execution model, Auth & API keys, Cost dashboard layout, Local dev workflow, Monorepo layout

---

## Migration & Seed Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| drizzle-kit generate → SQL files in `migrations/`, applied at startup | Self-hosters can read and audit the SQL; replay-friendly | ✓ |
| Runtime migrations via TypeScript (e.g. node-pg-migrate) | More flexible but harder to audit | |
| Hand-written SQL files only | Maximum control, more error-prone | |

**Auto-selected:** drizzle-kit generate + drizzle-kit migrate at startup
**Reason:** Self-hosters expect to read SQL; matches research SUMMARY.md `drizzle-kit generate → checked-in migrations` recommendation; partition DDL can use `sql\`...\`` escape hatch in migration files.

### Sub-decision: `events.raw_event` partitioning

| Option | Description | Selected |
|--------|-------------|----------|
| Monthly declarative partitioning from first migration, with rotate-partitions cron | Pitfall 8 hard requirement; cannot be retrofitted | ✓ |
| Single table with daily DELETE cron | Vacuum-starvation risk per Pitfall 8 | |

**Auto-selected:** Monthly partitions from migration #1.

### Sub-decision: `--seed` data shape

| Option | Description | Selected |
|--------|-------------|----------|
| ~50 sessions, 14 days, 3 demo agents, all dashboard states | Validates empty-dashboard hypothesis | ✓ |
| Minimal (one session) | Doesn't render anomaly states | |
| Realistic-enough to mistake for prod | Banner-warning concern | |

**Auto-selected:** ~50 sessions with explicit "synthetic — clear via admin command" banner in dashboard.

---

## Webhook Idempotency Key

| Option | Description | Selected |
|--------|-------------|----------|
| `Linear-Delivery` UUID header → `events.raw_event.upstream_id` | Linear documents this as stable; matches research recommendation | ✓ |
| Synthesized composite (source, event_type, entity_id, occurred_at) | Defeats dedup if any field varies | |
| Hybrid (header preferred, fallback to composite) | Silent fallback hides misconfigured proxies | |

**Auto-selected:** Header-only, hard-fail with 400 if header missing.
**Reason:** Linear always emits `Linear-Delivery`; absence is a misconfiguration we want loud, not silently bypassed.

---

## Setup Wizard Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Dashboard-first wizard; CLI `agentwatch setup` is a stub redirecting to dashboard URL in P1 | CLI ships in P2 anyway; dashboard already exists in P1 | ✓ |
| CLI-first; dashboard wizard mirrors it | CLI binary doesn't ship until P2 — chicken-and-egg | |
| Both at parity in P1 | Doubles surface for a P1 build | |

**Auto-selected:** Dashboard-first; CLI parity deferred to P2 alongside CLI binary release.

### Sub-decision: AgentSession UI warning placement

| Option | Description | Selected |
|--------|-------------|----------|
| Full-screen modal before OAuth flow, with "I've notified my team" gate | Highest-stakes UX moment; explicit gate matches SETUP-02 intent | ✓ |
| Inline checkbox at end of OAuth screen | Easier to miss; insufficient given trust stakes | |
| Footnote/link only | Sets up the failure mode the requirement exists to prevent | |

**Auto-selected:** Modal + explicit click-through.

---

## Identity Resolver Execution Model

| Option | Description | Selected |
|--------|-------------|----------|
| Async Graphile job, idempotent on `(workspace_id, raw_event_id)` | Maintains async-only handler invariant (Pitfall 2) | ✓ |
| Synchronous resolution inside webhook handler | Violates D-04 / Pitfall 2 — must not be done | |
| Trigger-based (Postgres) | Couples resolver to schema; hard to test | |

**Auto-selected:** Async Graphile job; idempotent re-runs.

### Sub-decision: P1 confidence formula

| Option | Description | Selected |
|--------|-------------|----------|
| `0.5 * has_linear_app_user_id` only — every P1 row PENDING_CONFIRMATION until human-confirmed | Single-signal auto-promotion is dangerous; matches research "do not hardcode" | ✓ |
| Treat single Linear signal as 1.0 to auto-promote | Re-creates Pitfall 6 (shared OAuth app silent merge) | |

**Auto-selected:** Sub-threshold confidence; explicit human confirmation flow until cross-source signals exist in P2.

### Sub-decision: Confirmation UI

| Option | Description | Selected |
|--------|-------------|----------|
| Inline "Unconfirmed" badge → side panel with Confirm button | Allows batch confirmation without breaking flow | ✓ |
| Modal per row | Interrupts batch confirm; bad UX for first-install | |
| Separate `/admin/identity` page | Buries the action; users won't find it | |

**Auto-selected:** Inline badge + side panel.

---

## Auth & Workspace API Keys

| Option | Description | Selected |
|--------|-------------|----------|
| One workspace API key for query API + SDK endpoint; HMAC for webhooks | Matches API-06 / INGEST-03; clean separation | ✓ |
| Separate keys for query vs SDK | Premature complexity for single-tenant v0 | |
| Use OAuth token directly for everything | Mixes user identity with machine identity | |

**Auto-selected:** Single workspace key (`agw_` + 32 bytes base64url, sha256-hashed at rest, displayed once at generation).

---

## Cost Dashboard Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Single page with team/cycle/window filters; chart + table; cost-per-closed-issue column shipped as `—` placeholder | Layout stable into P2 when `outcome` populates | ✓ |
| Defer the column entirely until P2 | P2 then has to add a column — risk of scope creep / re-layout | |
| Use tabs for cost vs sessions vs costs-by-team | Adds nav complexity P1 doesn't need | |

**Auto-selected:** Single page; placeholder column; Reliability/Lineage tabs ship as "Available in Phase 2" stubs so navigation is final.

---

## Local Dev Workflow

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: `docker compose up postgres` + `pnpm dev` for app/worker | Best HMR; keeps `docker compose up` (full) as the user install path | ✓ |
| Full Docker for everyone (`docker compose up` always) | Slow inner loop for contributors; slows P2 velocity | |
| Bare metal Postgres, no Docker | Fragments contributor environments | |

**Auto-selected:** Hybrid for contributors; full Docker for users (CI tests this path: DEPLOY-01, LAUNCH-06).

---

## Monorepo Layout (Phase 1 only)

| Option | Description | Selected |
|--------|-------------|----------|
| `packages/server`, `packages/web`, `packages/shared`, `packages/db` (CLI/SDK directories created in P2) | Match what actually ships in P1; empty dirs are noise | ✓ |
| Create all P1+P2 packages now (including empty CLI/SDKs) | Stale skeleton confuses contributors | |
| Single package, no workspaces | Doesn't scale to P2 SDK packages | |

**Auto-selected:** Four-package P1 layout; CLI/SDK packages added in P2.

---

## Privacy: Title Hashing

| Option | Description | Selected |
|--------|-------------|----------|
| `hashTitle()` utility + Zod-branded `TitleHash` type; `issues` row has no `title: string` field | Compile-time safety + CI runtime grep as second defense | ✓ |
| Runtime guard only (no branded types) | One missed code path leaks all titles (Pitfall 4) | |
| Hash at write-time but keep a `title_full` opt-in column on the row | Mixing makes per-workspace opt-in messier; design defers until v0.1 actually needs it | |

**Auto-selected:** Branded type; `title_full` opt-in is a workspace-level setting that lives in `workspaces.store_full_titles boolean`, but the **column for the full title** is on a separate `issue_titles_full` table that joins by issue id, opt-in only — keeps the default ORM type clean.

---

## Observability

| Option | Description | Selected |
|--------|-------------|----------|
| pino with custom Fastify request logger that filters `req.body`; `LOG_LEVEL=debug` adds payload-keys-only | Pitfall 5 mitigation at the logging layer | ✓ |
| Default Fastify logger | Logs `req.body` at debug — Pitfall 5 | |

**Auto-selected:** Custom logger with explicit allowlist of fields per event.

---

## Performance Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Smoke benchmark in CI: 200 concurrent webhooks, p99 < 200ms, in P1 | INGEST-04 SLA is load-bearing; gate from Day 1 | ✓ |
| Defer benchmark to P2 OBS-05 | Loses opportunity to catch regressions in Phase 1 itself | |

**Auto-selected:** P1 benchmark in CI; full 100k-session dashboard query benchmark remains a P2 OBS-05 deliverable.

---

## Claude's Discretion (delegated to downstream agents without re-asking)

- Drizzle schema file layout (split vs single file)
- Fastify plugin organization (autoload vs explicit)
- Next.js App Router file layout
- Test framework (default Vitest)
- Linting/formatting (default Biome; eslint+prettier acceptable fallback)
- Chart library (recharts is fine; shadcn/ui chart wrappers if available)
- Confirmation side-panel exact styling
- Graphile cron expression syntax within specified windows
- README copy

## Deferred Ideas (logged in CONTEXT.md `<deferred>` section)

- CLI binary, published SDK packages, GitHub webhook, vendor enrichment, outcome column population, cross-source resolver, rollup population, Reliability/Lineage views, alert engine, agent purge — all P2.
- Telemetry pipeline, Helm chart, docs site, benchmark blog post — P3.

## Drift to Reconcile

- CLAUDE.md mentions `pg-boss` while research SUMMARY.md authoritatively chooses Graphile Worker. Planner / Scribe should reconcile in a separate pass after CONTEXT.md is committed; do not block Phase 1 planning on this.
