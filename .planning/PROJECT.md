# agentwatch

## What This Is

agentwatch is a self-hosted, open-source observability layer for AI agents working in Linear workspaces. It ingests Linear Agent Session webhooks, GitHub PR outcomes, and agent vendor cost data; resolves them into a unified agent identity; and exposes cost, reliability, and lineage analytics through a dashboard, CLI, and YAML-defined alert rules.

Built for engineering leaders and platform engineers at 10-50 person startups running three or more agents (Cursor, Devin, Codex, Sentry Seer, internal) concurrently in Linear — teams who self-host Plausible/Langfuse/Supabase and prefer cloning a repo to filling out a demo form.

## Core Value

**Cross-agent attribution** — for any issue, any team, any cycle, show which agent did what, what it cost, and whether the change held up. If everything else fails, this single capability must work.

## Requirements

### Validated

(None yet — ship to validate)

### Active

#### Ingestion & identity
- [ ] Webhook receiver for Linear Agent Session events with HMAC verification
- [ ] Webhook receiver for GitHub PR / push / status events with signature verification
- [ ] Vendor API enrichment workers for Cursor and one other vendor (Devin or Codex)
- [ ] Internal SDK clients for Node and Python emitting `session_start`, `session_end`, `cost_recorded`
- [ ] Identity resolver stitching Linear `linear_app_user_id`, GitHub `*-bot[bot]` login, and vendor session ID into a single `agent_session_id`
- [ ] Low-confidence resolutions surface in dashboard for human one-click confirmation
- [ ] Raw event store (`events.raw_event`) with 30-day retention for replay

#### Storage
- [ ] Postgres schema and migrations: fact table `agent_sessions`, dimensions `agents`/`issues`/`repos`/`teams`/`cycles`
- [ ] Issue titles hashed by default; full title opt-in per workspace

#### Surfaces
- [ ] Cost dashboard view: spend per agent per team per cycle, cost-per-closed-issue, anomaly highlights
- [ ] Reliability dashboard view: success rate, revert-within-7d, time-to-resolution distributions
- [ ] Lineage dashboard view: per-issue timeline of every agent that touched it
- [ ] Setup wizard for first-run configuration
- [ ] Internal query API: POST `/api/v1/query` with `metric`/`dimension`/`filters`/`window`
- [ ] CLI `agentwatch` with `query`, `report`, `lineage`, `tail`, `rules test`, `setup` commands

#### Alerts
- [ ] YAML rule format with `name`/`when`/`window`/`notify` fields
- [ ] Rule engine evaluates on 5-minute cron
- [ ] Two default rule types: cost anomaly (multiple of rolling average), reliability regression (threshold breach over window)
- [ ] Notifications via Slack webhook, email, generic webhook

#### Deployment & ops
- [ ] Single `docker compose up` brings up working dashboard within 5 minutes on a developer laptop
- [ ] Helm chart for Kubernetes deploys
- [ ] Structured JSON logs by default
- [ ] Prometheus `/metrics` endpoint: event counts, queue depth, enrichment lag, identity-resolver confidence
- [ ] Performance: webhook receiver p99 < 200ms ack; dashboard query p95 < 1s over 90d on 100k-session workspace; enrichment lag < 5min

#### Telemetry & launch
- [ ] Anonymized telemetry pipeline: opt-in (`TELEMETRY_OPT_IN=true`), daily rollup of `(agent_name, cost_bucket, outcome, model_tier, workspace_size_bucket)` only
- [ ] Hosted aggregator service for opt-in dataset
- [ ] Documentation site (quickstart, configuration, SDK)
- [ ] Public benchmark blog post drafted from aggregated opt-in data

### Out of Scope

- **Multi-tool issue sources beyond Linear (Jira, GitHub Issues, Asana)** — go deep on Linear before going wide; Jira deferred to post-launch
- **Multi-tenant SaaS hosting** — single-tenant in v0; one Postgres instance equals one workspace
- **SSO, SOC 2, audit logs, procurement-friendly auth** — deferred to future hosted commercial tier
- **LLM-powered natural-language query** — v0 ships a constrained DSL; NL deferred to v0.2
- **Mobile or native applications** — web dashboard + CLI only
- **Custom SQL expressions in rule engine** — DSL-only in v0 for safety; revisit on community feedback
- **Redis, Kafka, or time-series database** — Postgres only until benchmarked load proves otherwise

## Context

**Domain context.** The agent-on-Linear ecosystem is heterogeneous and increasingly expensive. Each vendor (Cursor, Devin, Codex, Seer) exposes its own session log; Linear shows the comment thread; nobody shows the cross-agent runtime view. The closest analog is Definity for Spark/Databricks: runtime telemetry → agentic root-cause analysis → cost and reliability optimization. agentwatch is positioned as APM for agents anchored on Linear.

**Linear specifics.** Linear's Agent Session webhooks expose `actor=app` events. Access requires Business or Enterprise plan. `linear_app_user_id` is the stable identifier for an agent within a workspace.

**Naming.** Local working directory is `Linearwatch`. Canonical project name is **agentwatch** — used in PRD, README, repo name, package names, CLI binary, and all surfaces.

**Distribution model.** Build-in-public from Day 1, MIT licensed, public roadmap, public Discord. v0.1 launch via Show HN backed by a benchmark blog post drawn from opt-in telemetry. Target: 3-5 active design-partner installations and Show HN moment within 90 days.

**User profile.** Self-hosters. They will read the README, clone the repo, edit `.env`, run `docker compose up`. They will not fill out a demo form. They expect Postgres-only, structured logs, and Prometheus metrics.

## Constraints

- **Tech stack — Dashboard**: Next.js (web UI). Reads exclusively through internal query API; no direct DB access from React components.
- **Tech stack — Backend**: TBD between Node and Go. Decision deferred to research phase. Must support Node SDK and Python SDK as first-class clients.
- **Tech stack — Storage**: Postgres only. No Redis, no Kafka, no time-series DB in v0.
- **Tech stack — Deployment**: Docker compose as primary distribution; Helm chart as secondary. Single-binary CLI (`agentwatch`).
- **Timeline**: 90 days from initialization to v0.1 release + Show HN launch. Phase 1 (Days 1-21), Phase 2 (Days 22-60), Phase 3 (Days 61-90).
- **Budget — operational**: Self-hosted by users. Project itself runs on opt-in telemetry aggregator (small hosted service) plus docs site. Aim for low single-digit dollars/month at launch scale.
- **Performance**: Webhook receiver p99 < 200ms ack; dashboard query p95 < 1s over 90d on 100k-session workspace; enrichment lag < 5min between PR merge and reflected outcome.
- **Privacy**: Issue titles hashed by default; no customer data leaves instance unless `TELEMETRY_OPT_IN=true`. Enforced in code, not policy. Anonymization spec in `docs/telemetry.md`.
- **Auth**: Environment-variable basic auth and reverse-proxy support only in v0. No built-in SSO/OAuth for end users (workspace operators trust their reverse proxy).
- **Linear plan**: Agent Session webhook access requires Business or Enterprise. Stated in README; not a problem to solve.
- **Licensing**: MIT. Trademark and any future commercial entity tracked separately.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Project name `agentwatch` (over `Linearwatch`) | PRD canonical name; positions cross-vendor not Linear-only despite Linear being the v0 anchor | — Pending |
| Postgres-only in v0 (no Redis/Kafka/TSDB) | Deployment simplicity is the #1 quality bar — `docker compose up` in 5 min on a laptop | — Pending |
| Single-tenant in v0 | One Postgres = one workspace. Avoids tenant isolation complexity until paying customers exist | — Pending |
| DSL-only rules engine (no custom SQL) | Safety: untrusted YAML in version-controlled rules dirs shouldn't yield SQL injection vectors | — Pending |
| Linear-only as primary issue source in v0 | Go deep before wide. Jira/GitHub Issues deferred. GitHub used only for outcome enrichment. | — Pending |
| Telemetry off by default; per-day rollup granularity | Privacy-conservative default; per-issue granularity may be revisited if benchmark questions require | — Pending |
| Identity resolver exposes confidence as Prometheus metric and surfaces low-confidence rows for human confirmation | Incorrect attribution undermines trust faster than any other failure | — Pending |
| Build-in-public from Day 1; Show HN at v0.1 | Audience seeding before launch; benchmark blog post is the linkable artifact regardless of HN performance | — Pending |
| Phase plan from PRD: Foundation (1-21) → Enrichment (22-60) → Launch (61-90) | Matches coarse granularity preference; each phase has clear exit criteria from PRD §9 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-03 after initialization*
