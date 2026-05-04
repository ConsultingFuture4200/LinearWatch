# linearwatch — Product Requirements Document

**Version:** 0.1.0
**Status:** Draft
**Owner:** Dustin Powers
**Last updated:** 2026-05-03

---

## 1. Summary

linearwatch is a self-hosted, open-source observability layer for AI agents working in Linear workspaces. It ingests Linear Agent Session webhooks, GitHub PR outcomes, and agent vendor cost data; resolves them into a unified agent identity; and exposes cost, reliability, and lineage analytics through a dashboard, CLI, and YAML-defined alert rules.

The 90-day MVP target is a v0.1 release with three to five active design-partner installations and a Show HN launch backed by a benchmark blog post.

## 2. Problem

Engineering teams are running multiple agents — Cursor, Devin, Codex, Sentry's Seer, and increasingly homegrown internal agents — concurrently in their Linear workspace. Each vendor exposes its own session log. Linear shows the comment thread. No tool exposes the cross-agent runtime view: what every agent did this week, what it cost per outcome, and what merged code got reverted within seven days.

The closest analog in the data engineering space (Definity for Spark/Databricks) demonstrates the pattern: runtime telemetry → agentic root-cause analysis → cost and reliability optimization. The agent-on-Linear ecosystem is at the same stage data pipelines were when APM tools emerged: heterogeneous, increasingly expensive, and unobservable across vendors.

## 3. Goals and non-goals

### Goals

- Provide cost attribution per agent per issue per outcome, in a single schema.
- Surface reliability regressions (revert rate, time-to-resolution, success rate) before they compound.
- Expose cross-agent lineage for any issue: which agents touched it, in what order, with what result.
- Ship as a single Docker compose deployment with Postgres as the only required dependency.
- Maintain vendor neutrality across all supported agent platforms.

### Non-goals (v0)

- Multi-tool support beyond Linear (GitHub used only for outcome enrichment, not as a primary issue source).
- Multi-tenant SaaS hosting.
- Built-in authentication beyond environment-variable basic auth and reverse-proxy support.
- LLM-powered natural language query interface (deferred to v0.2).
- Mobile or native applications.

## 4. Target users

Primary: engineering leaders and platform engineers at 10-50 person startups running three or more agents concurrently in Linear. These users self-host Plausible, Langfuse, or Supabase; they prefer cloning a repo to filling out a demo form.

Secondary: solo operators and small teams running multi-agent setups who want cost discipline before headcount grows.

Explicitly out of scope: Fortune 500 buyers requiring SSO, SOC 2, and procurement contracts (deferred to a future hosted commercial tier).

## 5. Architecture

### 5.1 Component overview

```
External sources       Core pipeline           Storage     Surfaces
─────────────────      ──────────────────      ────────    ────────────
Linear webhooks  ──┐
GitHub webhooks  ──┤
Vendor APIs      ──┼──► Webhook receiver ──► Identity ──► Postgres ──► Dashboard
Internal SDK     ──┘                         resolver                ──► CLI
                                                ▼                    ──► Alerts
                                            Enrichment
                                              worker
```

A separate, opt-in anonymized telemetry path branches off the enrichment worker to a hosted aggregator for the public benchmark dataset. This path is off by default and never carries customer-identifying data.

### 5.2 Component responsibilities

**Webhook receiver.** HTTP endpoint accepting signed webhooks from Linear and GitHub. Validates HMAC signatures, normalizes payloads into a canonical event envelope, and writes raw events to `events.raw_event` for replay safety. Idempotent on upstream event ID.

**Identity resolver.** The core IP. Stitches a Linear `Agent Session` (issue ID, app user ID, timestamps), a GitHub PR (author login matching `*-bot[bot]` patterns or commit trailers), and a vendor session record (Cursor session ID, Devin run ID) into a single `agent_session_id`. Maintains a learned mapping table of `(linear_app_user_id, github_login, vendor_session_pattern)` triples per workspace. New agents are detected and surface in the dashboard for one-click confirmation.

**Enrichment worker.** Background job that polls vendor APIs for cost data, observes GitHub for PR merge/revert/CI outcomes within a 14-day window, and computes derived metrics (cost per closed issue, time to resolution, revert rate). Runs on a 60-second cycle in v0.

**Postgres.** Single-instance relational store. Star schema with `agent_sessions` as the fact table and `agents`, `issues`, `repos`, `teams`, `cycles` as dimensions. No Redis, no Kafka, no time-series database in v0.

**Dashboard.** Next.js application. Three views (Cost, Reliability, Lineage) plus a setup wizard. Reads exclusively through the internal query API.

**CLI.** Single binary (`linearwatch`). Commands: `query`, `report`, `lineage`, `tail`, `rules test`. Reads through the same query API as the dashboard.

**Alerts.** YAML-defined rules evaluated on a 5-minute cron. v0 supports two rule types: cost anomaly (multiple of rolling average) and reliability regression (threshold breach over window). Notifications via Slack webhook, email, and generic webhook.

**Internal SDK.** Three thin clients (Node, Python, Go) that emit a small set of events (`session_start`, `session_end`, `cost_recorded`) to the linearwatch ingestion endpoint. Authenticated with a workspace API key.

**Anonymizer + aggregator.** Separate service path. If `TELEMETRY_OPT_IN=true`, the anonymizer emits a daily rollup containing only `(agent_name, cost_bucket, outcome, model_tier, workspace_size_bucket)` to the hosted aggregator. No issue content, no code, no identifying strings. Aggregator runs as a separate hosted service maintained by the project.

## 6. Data model

### 6.1 Fact table: `agent_sessions`

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` | Primary key, generated on first event |
| `agent_id` | `uuid` | FK to `agents` |
| `issue_id` | `uuid` | FK to `issues` |
| `linear_app_user_id` | `text` | Linear's actor=app user ID |
| `started_at` | `timestamptz` | First observed event for this session |
| `ended_at` | `timestamptz` | Last observed event, or null if open |
| `cost_usd` | `numeric(10,4)` | Aggregated cost from vendor API or SDK |
| `tokens_in` | `bigint` | If reported |
| `tokens_out` | `bigint` | If reported |
| `outcome` | `text` | `closed`, `abandoned`, `reverted`, `failed`, `open` |
| `pr_url` | `text` | If a PR was opened |
| `reverted_at` | `timestamptz` | If revert detected within 14d window |
| `model_tier` | `text` | `frontier`, `mid`, `small` if known |

### 6.2 Dimension tables

`agents`: `id`, `name`, `vendor`, `linear_app_user_id`, `github_login`, `created_at`. One row per resolved agent identity per workspace.

`issues`: `id`, `linear_id`, `team_id`, `cycle_id`, `title_hash`, `created_at`, `closed_at`. Title is hashed by default for privacy; full title optional.

`repos`: `id`, `github_owner_repo`, `linear_team_id`. Maps repos to teams.

`teams`, `cycles`: standard Linear concepts mirrored locally for join performance.

### 6.3 Raw event store

`events.raw_event`: `id`, `source` (`linear` | `github` | `vendor` | `sdk`), `received_at`, `payload jsonb`, `signature_valid bool`. 30-day retention by default. Enables full reprocessing of derived data without re-fetching upstream.

## 7. Interfaces

### 7.1 Query API

Internal HTTP API used by both dashboard and CLI. POST `/api/v1/query` with a JSON body containing a `metric`, `dimension`, `filters`, and `window`. Returns rows in a normalized format. Not externally documented in v0 (treat as internal stability), but stable enough for the CLI to depend on.

### 7.2 CLI commands

```
linearwatch query "<natural language fragment>"   # parsed into structured query
linearwatch report cost --team ENG --window 14d
linearwatch report reliability --agent cursor
linearwatch lineage LIN-1234
linearwatch tail
linearwatch rules test rules/cost-spike.yaml
linearwatch setup
```

The `query` command accepts a small DSL in v0 — pure natural language is deferred to v0.2 once an LLM-powered translator is added.

### 7.3 Webhook endpoints

```
POST /webhooks/linear      Linear webhook receiver
POST /webhooks/github      GitHub webhook receiver
POST /api/v1/sdk/event     Internal SDK event ingestion (API key auth)
```

### 7.4 Rule format

```yaml
name: <unique_string>
description: <optional human description>
when: <expression>           # references metrics with rolling-window functions
window: <duration>           # evaluation window
notify:
  - slack: <channel_or_webhook>
  - email: <address>
  - webhook: <url>
```

## 8. Non-functional requirements

**Deployment simplicity.** `git clone && docker compose up` produces a working dashboard within five minutes on a developer laptop. This is the single most important quality bar.

**Postgres only.** No additional infrastructure dependencies in v0. Add Redis or a queue only if benchmarked load demands it.

**Single-tenant.** One Postgres instance equals one customer workspace. No tenant isolation logic in v0.

**Observability.** Structured JSON logs by default. Prometheus-compatible `/metrics` endpoint exposing event counts, queue depth, enrichment lag, and identity-resolver confidence scores.

**Performance targets.** Webhook receiver: p99 < 200ms acknowledgment. Dashboard query: p95 < 1s for any view over 90 days of data on a 100k-session workspace. Enrichment lag: < 5 minutes between PR merge and reflected outcome.

**Privacy by default.** Issue titles hashed unless workspace setting overrides. No customer data leaves the instance unless `TELEMETRY_OPT_IN=true`. Anonymization spec lives in `docs/telemetry.md` and is enforced in code, not policy.

## 9. Milestones (90-day plan)

### Phase 1 — Foundation (Days 1-21)

Goal: ingest, store, and display the simplest possible end-to-end flow. One design partner signed.

- Webhook receiver for Linear with signature verification
- Postgres schema and migrations
- Identity resolver v0 (Linear-only, no cross-source stitching yet)
- Minimal dashboard with a single Cost view
- Repository public on Day 1 with a strong README and architecture diagram
- Five to ten customer discovery calls; one design partner signed by Day 21

Exit criteria: a real Linear workspace's agent activity is visible in the dashboard.

### Phase 2 — Enrichment and depth (Days 22-60)

Goal: ship the thin slice across all three capabilities. Three design partners.

- GitHub webhook receiver and PR outcome correlation
- Cross-source identity resolver
- Vendor API enrichment for at least Cursor and one other
- Reliability and Lineage dashboard views
- CLI v0 with `query`, `report`, `lineage`, `tail`
- Two default alert rules (cost spike, revert-rate spike)
- Internal SDK for Node and Python
- Two more design partners onboarded; first partner using in production weekly

Exit criteria: at least one design partner has caught a real anomaly using the tool.

### Phase 3 — Launch (Days 61-90)

Goal: public Show HN launch with benchmark post. Five active installations.

- Production-grade Docker compose and Helm chart
- Documentation site (docs.linearwatch.dev or equivalent) with quickstart, configuration, SDK
- Anonymized telemetry pipeline and aggregator service deployed
- Benchmark blog post drafted from aggregated opt-in data
- Show HN launch on a Tuesday or Wednesday morning
- Discord server with first contributors active
- Two community-contributed rule packs in the rules registry

Exit criteria: launch hits HN front page or comparable distribution moment; 500+ stars within seven days; 20+ confirmed installations.

## 10. Success metrics

**Day 90 must-haves.** v0.1 release published. Three to five active design-partner installations running weekly. Documentation complete enough that a stranger can install without asking questions. One credible benchmark finding from opt-in telemetry.

**Day 90 stretch goals.** 1,000+ GitHub stars. Five or more contributors with merged PRs. Inbound interest from at least one company about a hosted version.

**Explicitly not metrics in 90 days.** Revenue. Paid customers. Hosted version availability. SOC 2 progress.

## 11. Risks and mitigations

**Linear ships native cross-agent analytics.** Probability: meaningful within 12 months. Impact: existential if positioning stays Linear-only. Mitigation: design data model and identity resolver to be source-agnostic from day one; ship GitHub source explicitly to anchor the multi-tool story; begin Jira spike no later than Day 90+30.

**Vendor APIs close or restrict cost data access.** Probability: moderate per vendor. Impact: degrades cost view per-vendor but does not break the product. Mitigation: SDK path covers internal agents regardless; community can contribute scrapers for vendors that resist; never depend on a single vendor for the core value prop.

**Identity resolver fragility.** Probability: high — botX[bot] naming conventions and workspace misconfigurations will break edge cases. Impact: incorrect attribution undermines trust faster than any other failure mode. Mitigation: surface low-confidence resolutions in the dashboard for human confirmation; expose resolver accuracy as a Prometheus metric; budget a full week in Phase 2 specifically for resolver hardening.

**Design partner acquisition stalls.** Probability: moderate. Impact: 90-day plan runs without real-world feedback. Mitigation: customer discovery starts Day 1, not Day 30; use Linear customer stories and agent vendor case studies as a sourcing list; accept design partners across timezones to keep momentum.

**OSS launch lands quietly.** Probability: roughly 60% based on base rates. Impact: slow audience build, but project is still useful. Mitigation: build-in-public from Day 1 to seed an audience before launch; benchmark blog post becomes the linkable artifact regardless of HN performance; plan a second launch moment at v0.2 if v0.1 is quiet.

**Maintenance burden post-launch.** Probability: certain. Impact: contributor pace and personal bandwidth limits. Mitigation: recruit two to three contributors during Phase 2 with merge rights; document triage SLAs honestly ("we respond within a week"); design the codebase for forkability.

## 12. Open questions

- Pricing model for an eventual hosted tier — per-agent-per-month, per-event, or seat-based. Defer until three design partners have weighed in.
- Whether to support Linear's Triage Automations as a passive observability source in addition to Agent Sessions. Decide by end of Phase 1.
- Anonymization granularity for telemetry — per-issue rollup versus per-day rollup. Privacy-conservative default is per-day; some benchmark questions require per-issue. Decide before telemetry pipeline ships.
- Whether the rules engine should support custom SQL expressions or only the constrained DSL. Lean toward DSL-only in v0 for safety; revisit based on community feedback.

## 13. Appendix

### A. Glossary

- **Agent Session** — Linear's term for an interaction between a user and an `actor=app` agent, exposed via webhook events.
- **Identity resolver** — linearwatch's mapping layer that unifies events from Linear, GitHub, and vendor APIs into a single `agent_session_id`.
- **Revert window** — the 14-day period after a PR merges during which linearwatch tracks whether the change is reverted, used as a reliability signal.
- **Outcome** — the terminal state of an agent session: `closed`, `abandoned`, `reverted`, `failed`, or `open`.

### B. Related work

Definity (data pipelines), Mezmo AURA, Logz.io agent observability, Langfuse and Helicone (LLM observability, single-application focus), Sentry Seer (RCA agent for Linear). linearwatch is positioned distinctly as cross-vendor agent ops anchored in the Linear workspace.

### C. License and governance

MIT licensed. Project maintained under YOUR_USERNAME/linearwatch with a public roadmap, public Discord, and quarterly maintainer meetings once a contributor base exists. Trademark and any future commercial entity tracked separately.
