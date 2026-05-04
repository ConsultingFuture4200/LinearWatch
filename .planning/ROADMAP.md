# ROADMAP: agentwatch

**Project:** agentwatch — self-hosted AI agent observability for Linear workspaces
**Core value:** Cross-agent attribution — for any issue, any team, any cycle, show which agent did what, what it cost, and whether the change held up.
**Timeline:** 90 days (Days 1-21 → 22-60 → 61-90)
**Granularity:** Coarse (3 phases)
**Requirements mapped:** 80/80

---

## Phases

- [ ] **Phase 1: Foundation** — Schema, idempotent Linear ingest, identity resolver v0, query API skeleton, cost dashboard, setup wizard. All 8 CRITICAL pitfalls eliminated.
- [ ] **Phase 2: Enrichment** — GitHub enrichment, vendor API workers, cross-source resolver, rollup table, reliability + lineage views, alert engine, CLI, Node + Python SDKs.
- [ ] **Phase 3: Launch** — Telemetry pipeline, hosted aggregator, Helm chart, docs site, CI benchmarks, Show HN.

---

## Phase Details

### Phase 1: Foundation
**Goal**: A real Linear workspace's agent activity is visible in the cost dashboard — schema is correct, ingest is idempotent, privacy defaults are enforced at the type level, and no CRITICAL pitfall can corrupt data.
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, INGEST-01, INGEST-03, INGEST-04, INGEST-05, INGEST-06, ID-01, ID-02, ID-03, ID-05, ID-06, API-01, API-02, API-03, API-04, API-05, API-06, API-07, API-08, DASH-01, DASH-04, DASH-05, DASH-06, DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-05, DEPLOY-06, OBS-01, OBS-02, OBS-03, OBS-04, PRIV-01, PRIV-02, PRIV-03, SETUP-01, SETUP-02, SETUP-03, SETUP-04
**Success Criteria** (what must be TRUE):
  1. User can run `git clone && docker compose up` on a clean laptop and reach a working dashboard at `http://localhost:3000` within 5 minutes — no manual DB setup, no pre-populated config.
  2. A real Linear webhook (with valid HMAC) produces exactly one row in `events.raw_event` regardless of how many times it is replayed; a SHA-1-only GitHub webhook returns 401.
  3. The cost dashboard shows spend per agent broken down by team and cycle, sourced exclusively through `POST /api/v1/query` — no React component makes a direct Postgres call.
  4. The setup wizard explicitly warns about the Linear AgentSession UI visibility change before any OAuth step completes; `agentwatch setup` and the dashboard wizard follow the same flow.
  5. `grep -r 'req.body' src/` returns empty; the `issues` ORM type has no `title: string` field; CI asserts raw title strings never appear in any query API response.
**Plans**: 10 plans
- [ ] 01.01-repo-bootstrap-PLAN.md — pnpm workspace, tsconfig, Biome, Vitest, compose stack, env contract, CI scaffolding
- [ ] 01.02-db-schema-PLAN.md — Drizzle schema files; first migration with monthly partitioning, FKs, analytics indexes
- [ ] 01.03-shared-package-PLAN.md — hashTitle()+TitleHash brand; Query API Zod enums; SDK event schemas
- [ ] 01.04-server-bootstrap-PLAN.md — Fastify + env validation + drizzle-kit migrate [BLOCKING] + pino redact + /metrics + Bearer auth
- [ ] 01.05-linear-webhook-PLAN.md — POST /webhooks/linear: HMAC verify, idempotent INSERT, async enqueue; 200-concurrent p99<200ms benchmark
- [ ] 01.06-graphile-worker-tasks-PLAN.md — Worker entry; resolve_identity, rotate_raw_event_partitions, detect_shared_app, refresh_cost_rollup stub
- [ ] 01.07-query-api-sdk-endpoint-PLAN.md — Zod-enumerated POST /api/v1/query dispatcher; SDK event endpoint; agents-confirm endpoint
- [ ] 01.08-dashboard-PLAN.md — Next.js 15 cost view + identity side panel + P2-stub tabs + settings; lib/query.ts as the only data path
- [ ] 01.09-setup-wizard-seed-PLAN.md — 7-step wizard with verbatim D-13 AgentSession warning; Playwright e2e; --seed synthetic data
- [ ] 01.10-ci-gates-and-smoke-PLAN.md — Privacy guard + static checks + compose smoke; all 6 CI gates wired
**UI hint**: yes

### Phase 2: Enrichment
**Goal**: At least one design partner has caught a real anomaly using the tool — cross-source attribution works, cost-per-outcome and revert-rate are accurate, the alert engine fires on real data, and the CLI + SDKs are in the hands of users.
**Depends on**: Phase 1
**Requirements**: INGEST-02, INGEST-07, INGEST-08, INGEST-09, ID-04, DASH-02, DASH-03, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08, CLI-09, ALERT-01, ALERT-02, ALERT-03, ALERT-04, ALERT-05, ALERT-06, ALERT-07, SDK-01, SDK-02, SDK-03, SDK-04, SDK-05, SDK-06, OBS-05, PRIV-04
**Success Criteria** (what must be TRUE):
  1. A design partner can run `agentwatch lineage LIN-1234` and see every agent that touched the issue in order, with outcome — including cross-vendor sessions from GitHub PR enrichment.
  2. `agentwatch report cost --team ENG --window 14d` returns a formatted report with cost-per-closed-issue that includes vendor-enriched cost data from Cursor (and one other vendor).
  3. A `cost-spike.yaml` alert rule fires a Slack notification when an agent's weekly spend exceeds 3× its 28-day rolling average; the same rule does not double-fire within the same window bucket.
  4. `@agentwatch/sdk` (Node) and `agentwatch` (PyPI) can emit `session_start`, `session_end`, and `cost_recorded` events to a running instance with only a workspace API key and server URL configured.
  5. `agentwatch agent purge <id>` soft-deletes the agent, propagates the deletion through `cost_by_agent_daily`, and the agent no longer appears in any dashboard view.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Launch
**Goal**: Public Show HN launch with a benchmark blog post; any stranger can install agentwatch without asking questions; telemetry privacy guarantee is verified in CI before a single byte leaves a user's instance.
**Depends on**: Phase 2
**Requirements**: TELE-01, TELE-02, TELE-03, TELE-04, TELE-05, TELE-06, DEPLOY-04, LAUNCH-01, LAUNCH-02, LAUNCH-03, LAUNCH-04, LAUNCH-05, LAUNCH-06
**Success Criteria** (what must be TRUE):
  1. With `TELEMETRY_OPT_IN` unset, a mock HTTP interceptor records zero outbound calls to the aggregator during a full daily cron run; with it set to `true`, exactly one correctly shaped payload is sent.
  2. `helm install agentwatch ./chart` deploys all three services with resource limits, liveness probes, and PodDisruptionBudgets passing `helm lint`; `docker compose up` smoke test passes on a clean image in CI within 5 minutes.
  3. A stranger following the quickstart on `docs.agentwatch.dev` can reach a working dashboard and emit their first SDK event without opening a GitHub issue for help.
  4. The benchmark blog post contains at least one credible finding derived from 14+ days of opt-in telemetry from 3+ design-partner installations.
**Plans**: TBD

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/10 | Not started | - |
| 2. Enrichment | 0/? | Not started | - |
| 3. Launch | 0/? | Not started | - |

---

## Coverage

| Requirement | Phase |
|-------------|-------|
| DATA-01 | Phase 1 |
| DATA-02 | Phase 1 |
| DATA-03 | Phase 1 |
| DATA-04 | Phase 1 |
| DATA-05 | Phase 1 |
| DATA-06 | Phase 1 |
| INGEST-01 | Phase 1 |
| INGEST-02 | Phase 2 |
| INGEST-03 | Phase 1 |
| INGEST-04 | Phase 1 |
| INGEST-05 | Phase 1 |
| INGEST-06 | Phase 1 |
| INGEST-07 | Phase 2 |
| INGEST-08 | Phase 2 |
| INGEST-09 | Phase 2 |
| ID-01 | Phase 1 |
| ID-02 | Phase 1 |
| ID-03 | Phase 1 |
| ID-04 | Phase 2 |
| ID-05 | Phase 1 |
| ID-06 | Phase 1 |
| API-01 | Phase 1 |
| API-02 | Phase 1 |
| API-03 | Phase 1 |
| API-04 | Phase 1 |
| API-05 | Phase 1 |
| API-06 | Phase 1 |
| API-07 | Phase 1 |
| API-08 | Phase 1 |
| DASH-01 | Phase 1 |
| DASH-02 | Phase 2 |
| DASH-03 | Phase 2 |
| DASH-04 | Phase 1 |
| DASH-05 | Phase 1 |
| DASH-06 | Phase 1 |
| CLI-01 | Phase 2 |
| CLI-02 | Phase 2 |
| CLI-03 | Phase 2 |
| CLI-04 | Phase 2 |
| CLI-05 | Phase 2 |
| CLI-06 | Phase 2 |
| CLI-07 | Phase 2 |
| CLI-08 | Phase 2 |
| CLI-09 | Phase 2 |
| ALERT-01 | Phase 2 |
| ALERT-02 | Phase 2 |
| ALERT-03 | Phase 2 |
| ALERT-04 | Phase 2 |
| ALERT-05 | Phase 2 |
| ALERT-06 | Phase 2 |
| ALERT-07 | Phase 2 |
| SDK-01 | Phase 2 |
| SDK-02 | Phase 2 |
| SDK-03 | Phase 2 |
| SDK-04 | Phase 2 |
| SDK-05 | Phase 2 |
| SDK-06 | Phase 2 |
| DEPLOY-01 | Phase 1 |
| DEPLOY-02 | Phase 1 |
| DEPLOY-03 | Phase 1 |
| DEPLOY-04 | Phase 3 |
| DEPLOY-05 | Phase 1 |
| DEPLOY-06 | Phase 1 |
| OBS-01 | Phase 1 |
| OBS-02 | Phase 1 |
| OBS-03 | Phase 1 |
| OBS-04 | Phase 1 |
| OBS-05 | Phase 2 |
| PRIV-01 | Phase 1 |
| PRIV-02 | Phase 1 |
| PRIV-03 | Phase 1 |
| PRIV-04 | Phase 2 |
| TELE-01 | Phase 3 |
| TELE-02 | Phase 3 |
| TELE-03 | Phase 3 |
| TELE-04 | Phase 3 |
| TELE-05 | Phase 3 |
| TELE-06 | Phase 3 |
| SETUP-01 | Phase 1 |
| SETUP-02 | Phase 1 |
| SETUP-03 | Phase 1 |
| SETUP-04 | Phase 1 |
| LAUNCH-01 | Phase 3 |
| LAUNCH-02 | Phase 3 |
| LAUNCH-03 | Phase 3 |
| LAUNCH-04 | Phase 3 |
| LAUNCH-05 | Phase 3 |
| LAUNCH-06 | Phase 3 |

**Total mapped: 80/80**

---

*Roadmap created: 2026-05-03*
*Last updated: 2026-05-03 after initialization*
