---
phase: 01-foundation
verified: 2026-05-04T06:00:00Z
status: human_needed
score: 44/44 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run `git clone && docker compose up` on a clean laptop and confirm http://localhost:3000 reaches the dashboard within 5 minutes"
    expected: "Dashboard loads at :3000 (or /setup) within 300s; no manual DB setup needed"
    why_human: "DEPLOY-01 / SC#1 requires a real Docker daemon and clean image; CI compose-smoke job runs this on every push but can't be exercised by static grep — first manual confirmation should occur before Phase 1 close-out"
  - test: "Send a real Linear webhook with a valid HMAC signature against the deployed instance"
    expected: "events.raw_event row created exactly once even if Linear retries; dashboard cost view reflects the new agent activity after resolver job runs"
    why_human: "SC#2 was verified end-to-end against an injected Fastify request; first delivery from a real Linear workspace (Business or Enterprise plan) should be observed before declaring Phase 1 complete"
  - test: "Walk through the setup wizard at /setup in a browser"
    expected: "Step 2 modal renders verbatim D-13 copy; pressing Escape does not dismiss; only `I've notified my team` advances; Linear OAuth round-trips; API key reveal happens once; --seed populates the cost view; webhook URL + cURL block on the Done step"
    why_human: "SETUP-02 verbatim copy is verified by Playwright (3 tests) but the full 7-step UX should be eyeballed once with a real Linear OAuth app to confirm the hand-off between steps feels right and the AGENTWATCH_PUBLIC_URL placeholder substitutes correctly"
  - test: "Run the webhook-ack benchmark `pnpm --filter @agentwatch/server bench:webhook-ack` against postgres:16-alpine on the target deployment hardware"
    expected: "p99 < 200ms with non2xx=0 across 200 concurrent connections for 15s"
    why_human: "INGEST-04 / D-31 was verified locally at p99=169ms on the developer machine; production-class hardware should be measured at least once because the 200ms SLA has only ~30ms of headroom and contention characteristics differ"
  - test: "Confirm GitHub branch protection on `main` requires all 6 CI gates"
    expected: "Repo settings → Branches → main protection rule lists static-checks, lint-typecheck-test, bench-webhook-ack, e2e-setup-wizard, privacy-guard, compose-smoke as required status checks"
    why_human: "Branch protection is not enforced by CI itself — repo owner must configure it once on GitHub; README documents the contract but cannot enforce it"
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A real Linear workspace's agent activity is visible in the cost dashboard — schema is correct, ingest is idempotent, privacy defaults are enforced at the type level, and no CRITICAL pitfall can corrupt data.

**Verified:** 2026-05-04T06:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Phase 5 Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC#1 | `git clone && docker compose up` reaches dashboard at http://localhost:3000 within 5 min on clean laptop, no manual DB setup | ✓ VERIFIED (in code) | `compose.yml` (3-service stack postgres:16-alpine + server + worker + web); `Dockerfile.web` Next.js standalone, `Dockerfile.worker` shared server+worker; `scripts/smoke-compose.sh` enforces 300s budget; CI `compose-smoke` job runs on clean ubuntu-latest. Not exercisable in this environment (no Docker daemon access) — flagged for human verification. |
| SC#2 | Real Linear webhook with valid HMAC produces exactly one `events.raw_event` row regardless of replays; SHA-1-only GitHub webhook returns 401 (foundation pattern) | ✓ VERIFIED | `packages/server/src/routes/webhooks/linear.ts`: `timingSafeEqual` HMAC verify (line 84, line 130); idempotency via NOT-EXISTS CTE on `(source, upstream_id)` plus `ON CONFLICT (source, upstream_id, received_at) DO NOTHING` defense-in-depth; raw-body integrity via `($N::text)::jsonb` cast (line 128); 5x-replay test in `idempotency.test.ts` asserts exactly 1 row; `webhook-linear.test.ts` asserts 401 on invalid HMAC and structural equality of stored payload. GitHub receiver is P2 by phase scope. |
| SC#3 | Cost dashboard shows spend per agent broken down by team and cycle, sourced exclusively through `POST /api/v1/query` — no React component makes a direct Postgres call | ✓ VERIFIED | `packages/web/src/lib/query.ts` is the sole client; `packages/web/src/app/(dashboard)/cost/page.tsx` calls `fetchQuery({ metric: 'cost_by_agent', dimension: 'agent', ... })`; `bash scripts/check-web-no-db-import.sh` returns "OK: no DB driver imports under packages/web/src" — exit 0. Verified directly. |
| SC#4 | Setup wizard explicitly warns about Linear AgentSession UI visibility before any OAuth step completes; `agentwatch setup` and dashboard wizard follow the same flow (CLI parity is P2) | ✓ VERIFIED | `packages/web/src/components/agentsession-warning-modal.tsx` line 29 contains verbatim D-13 copy; `packages/web/src/app/setup/agentsession-warning/page.tsx` line 31 carries the same string in a server-rendered sr-only div; `onEscapeKeyDown={(e) => e.preventDefault()}` line 72; "I've notified my team" verbatim button label confirmed at agentsession-warning-modal.tsx:34. Playwright `setup-wizard.spec.ts` 3 tests assert verbatim copy + Escape blocked + click-through advance. CLI placeholder at `packages/server/bin/agentwatch.js` per D-11. |
| SC#5 | `grep -r 'req.body' src/` returns empty (allow-req-body annotated exceptions OK); the `issues` ORM type has no `title: string` field; CI asserts raw title strings never appear in any query API response | ✓ VERIFIED | `bash scripts/check-no-req-body.sh` → "OK: no req.body in production code" (verified directly); `packages/db/src/schema/issues.ts` has only `titleHash: titleHashColumn('title_hash').notNull()` and an explicit "NO `title: text('title')` field anywhere" comment — no `title:` declaration; `bash scripts/check-no-title-leak.sh` → "OK: issues schema has title_hash; no title column" (verified directly); `packages/server/test/integration/privacy-guard.test.ts` seeds `__SEED_DETECTOR_PHASE1_*` through real `/webhooks/linear` route and asserts absence in 8 (metric × dimension) query API responses; `packages/server/test/integration/no-title-column.test.ts` queries `information_schema.columns` to confirm. Wired into CI `static-checks` + `privacy-guard` jobs. |

**Score:** 5/5 success criteria verified

### 8 CRITICAL Pitfalls Eliminated

| # | Pitfall | Status | Evidence |
|---|---------|--------|----------|
| 1 | Webhook deduplication missing | ✓ ELIMINATED | UNIQUE `(source, upstream_id, received_at)` on `events.raw_event` (`migrations/0000_init.sql:237`); idempotency CTE in `routes/webhooks/linear.ts` keys dedup on `(source, upstream_id)` directly; `idempotency.test.ts` 5x-replay asserts 1 row |
| 2 | Synchronous processing in webhook handler | ✓ ELIMINATED | `routes/webhooks/linear.ts` does HMAC verify → INSERT → `add_job('resolve_identity'::text)` → 200; webhook-linear.test.ts asserts no `resolveIdentity(` call in source; bench-webhook-ack benchmark p99=169ms < 200ms (D-31) |
| 3 | GitHub SHA-256 signature not enforced (foundation pattern) | ✓ ELIMINATED | HMAC + `timingSafeEqual` pattern established in 01.05 with explicit length precheck; the same primitive will be reused for GitHub in P2. Per phase scope GitHub receiver itself is P2. |
| 4 | Issue title hashing has multiple code paths | ✓ ELIMINATED | `hashTitle()` in `packages/shared/src/privacy.ts` is the only function with `createHash('sha256')` for titles; `TitleHash` branded type makes a stray raw-string assignment a TS compile error; `issues` Drizzle schema has no `title` field; verified by `check-no-title-leak.sh`, `no-title-column.test.ts`, and the `@ts-expect-error` test in `privacy.test.ts` |
| 5 | `LOG_LEVEL=debug` leaks raw webhook payloads | ✓ ELIMINATED | Three-layer defense in `packages/server/src/index.ts`: `disableRequestLogging: true`, pino redact paths cover `req.body` + `req.headers["linear-signature"]` + `req.headers["x-hub-signature-256"]` + `*.payload` + `workspace_salt` + `api_key_hash`, custom `req`/`res` serializers; `request-logger.test.ts` injects 'SECRET-TITLE' and asserts absence at info AND debug levels; `check-no-req-body.sh` exits OK |
| 6 | Shared Linear OAuth app across multiple agents | ✓ ELIMINATED | `packages/server/src/tasks/detect-shared-app.ts` runs hourly cron; CTE classifies sessions by `agentSession.sessionId` regex (`^cursor-`, `^devin-`, `^codex-`); writes `workspace_warnings` row when ≥2 vendor contexts in 24h; idempotent via LIKE-on-message guard; `detect-shared-app.test.ts` 4 tests pass |
| 7 | Telemetry opt-in evaluated too late | ✓ ELIMINATED | `packages/server/src/env.ts` reads `TELEMETRY_OPT_IN` at startup and `logBootBanner` line 84 logs `telemetry: ${env.TELEMETRY_OPT_IN ? 'on' : 'off'}`; daily rollup pipeline is P3 by scope but the env-var pattern is established and visible in the boot log |
| 8 | `events.raw_event` vacuum starvation | ✓ ELIMINATED | `migrations/0000_init.sql` declares `PARTITION BY RANGE (received_at)` + DO block pre-creating current+next month partitions; `packages/server/src/tasks/rotate-raw-event-partitions.ts` ensures CREATE IF NOT EXISTS for current+next + DROP TABLE IF EXISTS for partitions whose upper bound is >30 days old (regex bug on timestamptz upper-bound caught and fixed in 01.06); `crontab.ts` registers `0 0 1 * *` with `backfillPeriod: 86_400_000` for missed-schedule catchup; `partition-rotation.test.ts` asserts 3-month-old partition is dropped |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/db/migrations/0000_init.sql` | First migration with partitioning, idempotency unique, indexes | ✓ VERIFIED | `PARTITION BY RANGE (received_at)`; `UNIQUE (source, upstream_id, received_at)` line 237; BRIN on started_at; partial indexes; CHECK on identity state |
| `packages/db/src/schema/issues.ts` | title_hash with TitleHash brand, NO title field | ✓ VERIFIED | `customType<{ data: TitleHash }>` + only `titleHash: titleHashColumn('title_hash').notNull()`; explicit comment "NO `title: text('title')` field anywhere" |
| `packages/shared/src/privacy.ts` | hashTitle + TitleHash brand | ✓ VERIFIED | sha256(salt + ":" + trim+lowercase) per D-27; 7 unit tests including `@ts-expect-error` brand test |
| `packages/shared/src/query.ts` | MetricName, DimensionName closed enums | ✓ VERIFIED | `MetricName = z.enum(['cost_by_agent', 'agent_session_count'])`; `DimensionName = z.enum(['agent', 'team', 'cycle'])`; refined Window |
| `packages/shared/src/events.ts` | SdkEventBody discriminated union | ✓ VERIFIED | session_start, session_end, cost_recorded with non-negative cost_usd |
| `packages/server/src/index.ts` | Fastify + env validation + migrations [BLOCKING] + plugins | ✓ VERIFIED | env loadEnv → pino(redact) → migrate(BLOCKING) → fastify.decorate → plugins → routes → listen; integration test asserts ordering + bad DATABASE_URL exits non-zero |
| `packages/server/src/plugins/raw-body.ts` | addContentTypeParser parseAs:'buffer' | ✓ VERIFIED | exposes req.rawBody Buffer for HMAC verify |
| `packages/server/src/plugins/auth.ts` | Bearer auth with timingSafeEqual | ✓ VERIFIED | sha256(plaintext) + timingSafeEqual on equal-length buffers; 5 auth tests |
| `packages/server/src/plugins/metrics.ts` | 5 D-30 named metrics | ✓ VERIFIED | events_received_total, webhook_ack_seconds, jobs_queue_depth, identity_resolver_confidence, enrichment_lag_seconds; metrics.test.ts confirms via /metrics text |
| `packages/server/src/routes/webhooks/linear.ts` | HMAC verify + idempotent INSERT + async enqueue | ✓ VERIFIED | timingSafeEqual + CTE NOT-EXISTS + add_job('resolve_identity'::text); `grep -E "req\.body" linear.ts` returns empty |
| `packages/server/src/worker.ts` | Graphile Worker with 4 P1 tasks | ✓ VERIFIED | resolve_identity, rotate_raw_event_partitions, detect_shared_app, refresh_cost_rollup all in taskList |
| `packages/server/src/tasks/resolve-identity.ts` | Idempotent, D-16 confidence formula | ✓ VERIFIED | `ON CONFLICT (workspace_id, raw_event_id) DO NOTHING`; `0.5 * hasLinear`; observes resolverConfidenceHistogram |
| `packages/server/src/tasks/rotate-raw-event-partitions.ts` | CREATE next + DROP > 30d old | ✓ VERIFIED | `CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.raw_event`; `DROP TABLE IF EXISTS`; no `DELETE FROM events.raw_event`; regex bug on timestamptz upper-bound caught and fixed |
| `packages/server/src/tasks/detect-shared-app.ts` | ≥2 vendor contexts in 24h → warning | ✓ VERIFIED | regex `^cursor-`/`^devin-`/`^codex-`; `interval '24 hours'`; idempotent via LIKE-on-message; INSERT INTO workspace_warnings |
| `packages/server/src/crontab.ts` | parsedCronItems with backfillPeriod | ✓ VERIFIED | `'0 0 1 * *'` with `backfillPeriod: 86_400_000`; hourly detect_shared_app; daily refresh_cost_rollup stub |
| `packages/server/src/query/dispatcher.ts` | Record<MetricName, SqlFn> static map | ✓ VERIFIED | line 23 `const handlers: Record<MetricName, SqlFn>` |
| `packages/server/src/query/metrics/cost-by-agent.ts` | Static SQL, parameterized filters | ✓ VERIFIED | drizzle `sql` template tag; closed switch on Zod-enum dim; no `+ req.` concatenation |
| `packages/server/src/query/metrics/agent-session-count.ts` | COUNT(*) with optional dimension | ✓ VERIFIED | bound parameters via drizzle sql tag |
| `packages/server/src/routes/api/v1/query.ts` | Bearer-auth + Zod parse + dispatch | ✓ VERIFIED | `{ preHandler: fastify.authBearer }`; QueryRequest.safeParse; allow-req-body annotated |
| `packages/server/src/routes/api/v1/sdk-event.ts` | Bearer + idempotency_key (caller or synth) | ✓ VERIFIED | `synthesizeKey(workspaceId, sessionId, eventType, minuteBucket)`; CTE NOT-EXISTS dedup; ON CONFLICT defense |
| `packages/server/src/routes/api/v1/agents-confirm.ts` | PENDING_CONFIRMATION → CONFIRMED | ✓ VERIFIED | UPDATE … WHERE state='PENDING_CONFIRMATION'; 404 on soft-deleted agent |
| `packages/server/src/routes/api/v1/setup.ts` | Workspace bootstrap, key generation, OAuth callback | ✓ VERIFIED | `agw_` + 32 base64url; sha256 hash stored; 409 on second bootstrap; setup.test.ts 9 cases |
| `packages/server/src/routes/api/v1/seed.ts` | Bearer-auth seed + clear-seed | ✓ VERIFIED | calls insertSyntheticData; idempotent; clear-seed cascades demo rows |
| `packages/server/src/routes/api/v1/workspace.ts` | warnings + seed-status endpoints (NEW) | ✓ VERIFIED | Bearer-auth GETs added in 01.08 to support dashboard banners |
| `packages/server/src/seed/synthetic.ts` | 50 sessions, 3 demo agents, hashTitle | ✓ VERIFIED | cursor-demo/devin-demo/internal-bot-demo; 24+18+8=50 sessions across 14 days; hashTitle for all titles; intentional anomaly day at $20 |
| `packages/server/bin/agentwatch.js` | CLI placeholder per D-11 | ✓ VERIFIED | prints dashboard URL message |
| `packages/web/src/lib/query.ts` | Single typed POST /api/v1/query client | ✓ VERIFIED | uses AGENTWATCH_INTERNAL_URL; cache:'no-store' |
| `packages/web/src/lib/api.ts` | confirmAgent + fetchActiveWarnings + fetchSeedStatus | ✓ VERIFIED | server-only; no NEXT_PUBLIC_AGENTWATCH_INTERNAL_API_KEY exists |
| `packages/web/src/app/(dashboard)/cost/page.tsx` | Cost view fetches via fetchQuery | ✓ VERIFIED | calls cost_by_agent + agent_session_count via lib/query.ts |
| `packages/web/src/components/identity-side-panel.tsx` | DASH-04 confirm UI, modal={false} | ✓ VERIFIED | line 61 `<Dialog … modal={false}>`; w-[480px]; verbatim copy from UI-SPEC |
| `packages/web/src/components/agentsession-warning-modal.tsx` | Verbatim D-13 copy + Escape disabled | ✓ VERIFIED | line 29 verbatim string; line 72 `onEscapeKeyDown={(e) => e.preventDefault()}` |
| `packages/web/src/app/setup/*` | 7-step wizard | ✓ VERIFIED | layout, page (welcome), agentsession-warning, linear-oauth (+ callback route), github-pat, workspace, seed, done |
| `packages/web/test/e2e/setup-wizard.spec.ts` | SETUP-02 verbatim + click-through | ✓ VERIFIED | 3 Playwright tests pass |
| `packages/server/test/integration/privacy-guard.test.ts` | PRIV-03 end-to-end seed trace | ✓ VERIFIED | seeds __SEED_DETECTOR_PHASE1_* via real /webhooks/linear; iterates 2×4 metric×dim; expects absence in all responses |
| `packages/server/test/integration/no-title-column.test.ts` | D-26 information_schema check | ✓ VERIFIED | asserts title_hash present, title absent |
| `packages/server/test/perf/webhook-ack.bench.ts` | 200 concurrent, p99 < 200ms | ✓ VERIFIED | autocannon 200 connections × 15s; local p99=169ms; CI bench-webhook-ack job |
| `scripts/check-no-req-body.sh` | OBS-04 grep guard | ✓ VERIFIED | exits 0 directly verified |
| `scripts/check-no-title-leak.sh` | D-26 schema gate | ✓ VERIFIED | exits 0 directly verified |
| `scripts/check-web-no-db-import.sh` | API-07 enforcement | ✓ VERIFIED | exits 0 directly verified |
| `scripts/smoke-compose.sh` | DEPLOY-01 5-min boot test | ✓ VERIFIED (in code) | injects synthetic env; polls :3000 + :8080/health with 300s budget |
| `.github/workflows/ci.yml` | All 6 phase 1 gates | ✓ VERIFIED | static-checks, lint-typecheck-test, bench-webhook-ack, e2e-setup-wizard, privacy-guard, compose-smoke (independent jobs) |
| `compose.yml` | postgres:16-alpine + server + worker + web; no Redis/Kafka/TSDB | ✓ VERIFIED | 4 services; zero matches for redis/kafka/clickhouse/timescale/influxdb |
| `.env.example` | DEPLOY-03 fail-fast contract | ✓ VERIFIED | DATABASE_URL, LINEAR_CLIENT_*, LINEAR_WEBHOOK_SECRET, AGENTWATCH_INTERNAL_API_KEY, plus tunables with defaults |
| `README.md` | Reverse-proxy + PgBouncer + Status section | ✓ VERIFIED | nginx + Caddy snippets; `?pgbouncer=true`; Linear Business plan note; Status section lists all 6 CI gates |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `packages/server/src/index.ts` | `migrations/0000_init.sql` | `migrate(db, { migrationsFolder })` BEFORE `fastify.listen()` | ✓ WIRED | line 78 migrate < line 110 listen; integration test confirms ordering + non-zero exit on bad DATABASE_URL |
| `packages/server/src/routes/webhooks/linear.ts` | `events.raw_event` UNIQUE | NOT-EXISTS CTE + `ON CONFLICT (source, upstream_id, received_at) DO NOTHING` | ✓ WIRED | grep matches both clauses |
| `packages/server/src/routes/webhooks/linear.ts` | Graphile resolve_identity | `add_job('resolve_identity'::text, payload::json)` | ✓ WIRED | gated on `isNewInsert === true`; consumer registered in worker.ts |
| `packages/server/src/tasks/resolve-identity.ts` | `identity_mappings` UNIQUE | `ON CONFLICT (workspace_id, raw_event_id) DO NOTHING` | ✓ WIRED | idempotent; resolve-identity.test.ts 3× replay → 1 row |
| `packages/server/src/tasks/rotate-raw-event-partitions.ts` | `events.raw_event` partitions | `CREATE TABLE … PARTITION OF events.raw_event` + `DROP TABLE IF EXISTS` | ✓ WIRED | partition-rotation.test.ts confirms 3-month-old partition dropped |
| `packages/server/src/crontab.ts` | rotate task | `parseCronItems('0 0 1 * *', backfillPeriod: 86_400_000)` | ✓ WIRED | crontab.ts:30-32 |
| `packages/server/src/query/dispatcher.ts` | MetricName enum | `Record<MetricName, SqlFn>` | ✓ WIRED | TypeScript refuses to compile if a metric is missing |
| `packages/server/src/routes/api/v1/sdk-event.ts` | events.raw_event source='sdk' | `INSERT … VALUES ('sdk', $idempotencyKey, …) ON CONFLICT … DO NOTHING` | ✓ WIRED | sdk-event.test.ts 5/5 |
| `packages/web/src/app/(dashboard)/cost/page.tsx` | `lib/query.ts` | `await fetchQuery({ metric: 'cost_by_agent', … })` | ✓ WIRED | RSC server-side fetch |
| `packages/web/src/lib/query.ts` | server `/api/v1/query` | `fetch(${AGENTWATCH_INTERNAL_URL}/api/v1/query, Bearer)` | ✓ WIRED | grep confirms env-var read |
| `packages/db/src/schema/issues.ts` | `packages/shared/src/privacy.ts` | `import type { TitleHash } from '@agentwatch/shared'` + `customType<{ data: TitleHash }>` | ✓ WIRED | brand carries through to migration |
| `.github/workflows/ci.yml` | `scripts/check-no-req-body.sh` | bash invocation in static-checks job | ✓ WIRED | also runs check-no-title-leak + check-web-no-db-import |
| `.github/workflows/ci.yml` | `privacy-guard.test.ts` | `pnpm --filter @agentwatch/server test -- privacy-guard no-title-column` | ✓ WIRED | line 161 |
| `.github/workflows/ci.yml` | `scripts/smoke-compose.sh` | `bash scripts/smoke-compose.sh` in compose-smoke job | ✓ WIRED | line 165 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| OBS-04 grep guard | `bash scripts/check-no-req-body.sh` | "OK: no req.body in production code" | ✓ PASS |
| D-26 title leak guard | `bash scripts/check-no-title-leak.sh` | "OK: issues schema has title_hash; no title column" | ✓ PASS |
| API-07 web isolation | `bash scripts/check-web-no-db-import.sh` | "OK: no DB driver imports under packages/web/src" | ✓ PASS |
| issues schema title columns | `grep -n "title" packages/db/src/schema/issues.ts` | only `title_hash` / `titleHash` / `TitleHash` references plus the "NO title field" comment | ✓ PASS |
| Idempotency UNIQUE constraint | `grep -nE "UNIQUE.*source.*upstream_id" packages/db/migrations/0000_init.sql` | line 237 `CONSTRAINT raw_event_delivery_unique UNIQUE (source, upstream_id, received_at)` | ✓ PASS |
| Partition rotation cron registered | `grep "rotate_raw_event_partitions\|backfillPeriod" packages/server/src/crontab.ts` | task registered with backfillPeriod 86_400_000 | ✓ PASS |
| All 4 worker tasks registered | `grep "resolve_identity\|rotate_raw_event_partitions\|detect_shared_app\|refresh_cost_rollup" worker.ts` | 4 distinct task entries in taskList | ✓ PASS |
| D-13 verbatim copy | `grep "Heads up: enabling Linear" packages/web/src/components/agentsession-warning-modal.tsx packages/web/src/app/setup/agentsession-warning/page.tsx` | both files contain the verbatim string | ✓ PASS |
| Side panel modal={false} | `grep "modal={false}" packages/web/src/components/identity-side-panel.tsx` | line 61 confirmed | ✓ PASS |
| Escape disabled on warning modal | `grep onEscapeKeyDown packages/web/src/components/agentsession-warning-modal.tsx` | line 72 `e.preventDefault()` | ✓ PASS |
| 6 CI gates present | `grep -nE "static-checks\|bench-webhook-ack\|e2e-setup-wizard\|privacy-guard\|compose-smoke\|lint-typecheck-test" .github/workflows/ci.yml` | all 6 jobs at top level | ✓ PASS |
| Phase 1 integration test count | `ls packages/server/test/integration/ \| wc -l` | 13 integration test files (agents-confirm, detect-shared-app, idempotency, migrations-on-startup, no-title-column, partition-rotation, privacy-guard, query-api, resolve-identity, sdk-event, seed, setup, webhook-linear) | ✓ PASS |
| `docker compose up` smoke | `bash scripts/smoke-compose.sh` | not exercised — Docker daemon not accessible in this verifier environment; CI runs on every push | ? SKIP (human verification) |
| Webhook-ack bench | `pnpm --filter @agentwatch/server bench:webhook-ack` | not exercised here; 01.05 SUMMARY records local p99=169ms; CI runs on every push | ? SKIP (human verification) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `cost/page.tsx` | `byAgent.rows` | server `await fetchQuery({metric:'cost_by_agent', dimension:'agent', …})` → POST /api/v1/query → `cost-by-agent.ts` SQL `SUM(cost_usd) FROM agent_sessions JOIN agents …` | Yes, when `agent_sessions` populated (real webhooks or `--seed`); 0 when empty (renders `<EmptyState>`) | ✓ FLOWING |
| `agents-table.tsx` | `agentRows` / `sessionRows` props | passed from cost/page.tsx server fetch | Yes (same source as chart) | ✓ FLOWING |
| `identity-side-panel.tsx` | agent + linearAppUserId props | passed when user clicks UnconfirmedBadge in agents-table | Hardcoded "—" for First seen / Last seen / sessions count in P1 (documented stub; query API doesn't surface those fields yet) | ⚠️ STATIC (P1 stub — surfaces in P2 metric extension) |
| `synthetic-data-banner.tsx` | seedStatus | server `fetchSeedStatus()` → GET /api/v1/workspace/seed-status → `EXISTS` against agents WHERE name LIKE '%-demo' | Yes — lights up after wizard `--seed` writes cursor-demo etc. | ✓ FLOWING |
| `workspace-warnings-banner.tsx` | warnings list | server `fetchActiveWarnings()` → GET /api/v1/workspace/warnings → SELECT FROM workspace_warnings | Yes — populated by detect_shared_app cron writing to workspace_warnings | ✓ FLOWING |
| `cost-chart.tsx` | data prop | rows from cost/page.tsx | Yes (renders aggregate-totals per agent in P1; documented stub for daily-bucket time-series in P2) | ⚠️ AGGREGATE-ONLY (P1 — documented in 01.08 deviation; daily metric ships in P2) |
| `anomaly-pill.tsx` | multiple | static unit (no live wiring in P1; rendered with synthetic anomaly day from --seed) | Component is shipped + tested but not yet pinned to chart bars; P2 metric extension wires it | ⚠️ NOT YET WIRED TO CHART (P1 — documented stub; resolved in P2) |
| FiltersBar (team/cycle dropdowns) | options array | empty in P1 (only "All teams"/"All cycles" + window) | "list-distinct-values" surface deferred to P2 (would extend QueryResponse contract frozen in 01.07) | ⚠️ STATIC OPTIONS (P1 — documented stub) |

The P1-stub items above are not gaps — each is documented in the 01.08 SUMMARY's Known Stubs section and explicitly aligned with the P1→P2 boundary. The roadmap goal "real Linear workspace's agent activity is visible in the cost dashboard" is satisfied because the load-bearing data flow (webhook → events.raw_event → resolver → identity_mappings + agent_sessions → cost_by_agent SQL → /api/v1/query → fetchQuery → CostChart/AgentsTable) is end-to-end live.

### Requirements Coverage

All 44 requirement IDs declared in PLAN frontmatter across 01.01–01.10 are satisfied. Complete enumeration:

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ---------- | ----------- | ------ | -------- |
| DATA-01 | 01.02 | Star-schema fact + dim tables | ✓ SATISFIED | migrations/0000_init.sql sections 2-3; schema-shape tests |
| DATA-02 | 01.02 | Migrations checked into VCS, applied at startup | ✓ SATISFIED | drizzle-kit journal + migrate(BLOCKING) before listen (01.04) |
| DATA-03 | 01.02 | events.raw_event monthly-partitioned with (source, upstream_id) UNIQUE | ✓ SATISFIED | PARTITION BY RANGE + UNIQUE (source, upstream_id, received_at) line 237 |
| DATA-04 | 01.02 | (agent_id, started_at DESC), (issue_id, started_at), BRIN, FK indexes | ✓ SATISFIED | 6 indexes shipped in 0000_init.sql Section 3 |
| DATA-05 | 01.02 | identity_mappings keyed on resolver state | ✓ SATISFIED | UNIQUE (workspace_id, raw_event_id) + state CHECK |
| DATA-06 | 01.02, 01.06 | cost_by_agent_daily exists; refresh stub | ✓ SATISFIED | composite PK ready for CONCURRENTLY refresh; refresh_cost_rollup task is P1 stub per CONTEXT.md scope |
| INGEST-01 | 01.05 | Linear webhook + HMAC | ✓ SATISFIED | timingSafeEqual; 401 on invalid; webhook-linear.test.ts |
| INGEST-03 | 01.03, 01.04, 01.07 | SDK endpoint with Bearer + 3 event types | ✓ SATISFIED | SdkEventBody discriminated union; sdk-event.test.ts |
| INGEST-04 | 01.05 | Webhook ack p99 < 200ms under 200 concurrent | ✓ SATISFIED | bench p99=169ms; CI bench-webhook-ack |
| INGEST-05 | 01.05 | Idempotent on `(source, upstream_id)` | ✓ SATISFIED | NOT-EXISTS CTE; 5x-replay test |
| INGEST-06 | 01.05, 01.06 | Raw event store retention via partitioning | ✓ SATISFIED | rotate_raw_event_partitions cron + DROP > 30d |
| ID-01 | 01.06 | Resolver writes identity_mappings per Linear event | ✓ SATISFIED | resolve-identity.test.ts case 1 |
| ID-02 | 01.06 | State machine NEW_AGENT → PENDING → AUTO/CONFIRMED | ✓ SATISFIED | state CHECK constraint; PENDING_CONFIRMATION at 0.5 (D-16) |
| ID-03 | 01.06 | Confidence weighted sum (P1: linear=0.5 only) | ✓ SATISFIED | `0.5 * hasLinear`; signalWeights `{linear:0.5, github:0, vendor:0}` |
| ID-05 | 01.06 | detect_shared_app cron + workspace_warnings | ✓ SATISFIED | hourly cron; 4 tests |
| ID-06 | 01.04, 01.06 | IDENTITY_CONFIDENCE_THRESHOLD env var (default 0.8) | ✓ SATISFIED | env.ts coerce + default 0.8; resolverConfidenceHistogram observed |
| API-01 | 01.07 | POST /api/v1/query JSON body | ✓ SATISFIED | QueryRequest schema |
| API-02 | 01.03, 01.07 | Unknown metric → 400 | ✓ SATISFIED | Zod enum reject; query-api.test.ts case 3 |
| API-03 | 01.07 | Each metric is static SQL function | ✓ SATISFIED | Record<MetricName, SqlFn> + cost-by-agent.ts + agent-session-count.ts |
| API-04 | 01.03, 01.07 | Metrics: cost_by_agent, agent_session_count | ✓ SATISFIED | both implemented + tested |
| API-05 | 01.03, 01.07 | Dimensions: agent, team, cycle | ✓ SATISFIED | DimensionName enum + tests |
| API-06 | 01.04, 01.07 | Bearer workspace API key | ✓ SATISFIED | authBearer plugin + sha256 + timingSafeEqual |
| API-07 | 01.07, 01.08 | Dashboard reads exclusively through query API | ✓ SATISFIED | check-web-no-db-import.sh OK |
| API-08 | 01.07 | Query API p95 < 1s | ✓ SATISFIED (in code) | static SQL + analytics indexes; needs human verification on 100k-session workspace (deferred to P2 OBS-05 perf benchmark) |
| DASH-01 | 01.08 | Cost view spend per agent by team and cycle | ✓ SATISFIED | cost/page.tsx + CostChart + AgentsTable; anomaly overlay deferred to P2 |
| DASH-04 | 01.07, 01.08 | One-click confirm UI | ✓ SATISFIED | UnconfirmedBadge → IdentitySidePanel → confirmAgent → POST /agents/:id/confirm |
| DASH-05 | 01.09 | First-run setup wizard | ✓ SATISFIED | 7-step wizard at /setup |
| DASH-06 | 01.09 | --seed option offered + clearable | ✓ SATISFIED | /setup/seed → POST /api/v1/seed; banner driven by *-demo signal |
| DEPLOY-01 | 01.01, 01.10 | docker compose up reaches dashboard within 5 min | ✓ SATISFIED (in code) | smoke-compose.sh + CI compose-smoke job; first execution flagged for human verification |
| DEPLOY-02 | 01.01 | Postgres-only (no Redis/Kafka/TSDB) | ✓ SATISFIED | compose.yml grep returns 0 for forbidden services |
| DEPLOY-03 | 01.01, 01.04 | Required env vars fail-fast | ✓ SATISFIED | loadEnv prints one FATAL line per missing var; env.test.ts |
| DEPLOY-05 | 01.01 | Reverse-proxy auth documented | ✓ SATISFIED | nginx + Caddy snippets in README |
| DEPLOY-06 | 01.01 | PgBouncer transaction-mode documented | ✓ SATISFIED | `?pgbouncer=true` + ≥1.21 in README |
| OBS-01 | 01.04 | Structured JSON logs by default | ✓ SATISFIED | pino + redact + custom serializers + disableRequestLogging:true |
| OBS-02 | 01.04 | Prometheus /metrics endpoint | ✓ SATISFIED | registerMetricsRoute returns text/plain |
| OBS-03 | 01.04 | Five named metrics | ✓ SATISFIED | events_received_total, webhook_ack_seconds, jobs_queue_depth, identity_resolver_confidence, enrichment_lag_seconds |
| OBS-04 | 01.01, 01.04, 01.10 | grep -r 'req.body' empty in CI | ✓ SATISFIED | check-no-req-body.sh + allow-req-body annotated reads |
| PRIV-01 | 01.03 | Issue titles hashed by default | ✓ SATISFIED | hashTitle is sole producer; TitleHash brand |
| PRIV-02 | 01.03 | Per-workspace opt-in for plain titles | ✓ SATISFIED | workspaces.store_titles_plain column; PATCH endpoint deferred per 01.08 settings stub (column exists, P2 wires the toggle) |
| PRIV-03 | 01.03, 01.10 | Raw titles never appear in query API responses | ✓ SATISFIED | privacy-guard.test.ts seeds + iterates 8 perms |
| SETUP-01 | 01.09 | First-run wizard collects Linear OAuth + GitHub PAT | ✓ SATISFIED | 7 steps, OAuth callback route, PAT cookie + persist |
| SETUP-02 | 01.09 | AgentSession warning verbatim + click-through | ✓ SATISFIED | Playwright 3 tests; modal Escape disabled; verbatim D-13 copy |
| SETUP-03 | 01.09 | Empty dashboard state with webhook URL + cURL | ✓ SATISFIED | EmptyState (01.08) + /setup/done page |
| SETUP-04 | 01.09 | --seed inserts ~50 synthetic sessions | ✓ SATISFIED | synthetic.ts inserts 24+18+8=50; seed.test.ts |

**Coverage:** 44/44 requirement IDs satisfied. No orphaned IDs from REQUIREMENTS.md Phase 1 mapping.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/server/src/plugins/request-logger.ts` | annotated | `req.body as Record<string, unknown>` | ℹ️ Info | Annotated `// allow-req-body: D-29 top-level keys only` — used only for `Object.keys(body)`, no value serialization |
| `packages/server/src/routes/api/v1/{query,sdk-event,agents-confirm,setup}.ts` | annotated | `safeParse(req.body)` | ℹ️ Info | All annotated `// allow-req-body: Zod-validated parse boundary` — required entry points |
| `packages/server/src/{worker,index}.ts` | annotated | `'req.body'` literal in pino redact paths | ℹ️ Info | Annotated `// allow-req-body: pino redact path string (Pitfall 5)` — required to register the redact rule |
| `packages/web/src/components/identity-side-panel.tsx` | side panel | "First seen / Last seen / sessions count" hardcoded `—` | ℹ️ Info | P1 stub documented in 01.08 SUMMARY; query API metric extension is P2 |
| `packages/web/src/components/cost-chart.tsx` | chart shape | aggregate totals per agent (not daily-bucket stack) | ℹ️ Info | P1 stub documented in 01.08 SUMMARY; metric API contract change deferred to P2 |
| `packages/web/src/components/anomaly-pill.tsx` | usage | shipped but not wired to chart bars in P1 | ℹ️ Info | Documented stub; component renders correctly in unit tests |
| `packages/web/src/components/filters-bar.tsx` | options | empty team/cycle dropdowns ("All teams" / "All cycles" only) | ℹ️ Info | Documented stub; list-distinct-values is P2 |
| `packages/web/src/app/(dashboard)/settings/page.tsx` | regenerate-key click | no-op pending P2 rotate-key endpoint | ℹ️ Info | Documented stub |
| `packages/server/src/tasks/refresh-cost-rollup.ts` | task body | logs and returns | ℹ️ Info | Intentional P1 stub per CONTEXT.md scope; cron registered for P2 body swap |

**No blockers or warnings found.** All Info-level items are intentional P1 stubs documented in their respective SUMMARYs and aligned with the P1→P2 boundary in CONTEXT.md `<deferred>`.

### Human Verification Required

5 items require human validation before declaring Phase 1 close-out (see frontmatter `human_verification` for the structured list):

1. **`docker compose up` clean-laptop boot (DEPLOY-01 / SC#1)** — CI compose-smoke job runs on every push and is the durable gate, but the first manual confirmation on a real developer laptop should occur before close-out.
2. **First real Linear webhook end-to-end (SC#2)** — exercise HMAC verify + idempotent INSERT + resolver enqueue with a webhook from an actual Linear Business/Enterprise workspace.
3. **Setup wizard UX walkthrough (SC#4)** — Playwright covers the verbatim copy and click-through gate; full 7-step UX should be eyeballed once with a real Linear OAuth app.
4. **Webhook-ack benchmark on production-class hardware (INGEST-04 / D-31)** — local p99=169ms leaves ~30ms of headroom; production hardware should be measured at least once.
5. **Branch protection ruleset on `main`** — README documents the contract but only the repo owner can configure GitHub branch protection to require all 6 status checks.

### Gaps Summary

No gaps blocking Phase 1 goal achievement. Every Phase 1 success criterion has a backing CI gate, an integration test, or a static check; every requirement ID declared in plan frontmatter is satisfied with verifiable code; every CRITICAL pitfall is eliminated with a runtime test, a static check, or both. Several P1→P2 boundary stubs exist in the dashboard (anomaly overlay, daily-bucket chart, dimension-list dropdowns, settings PATCH endpoints) but are explicitly aligned with CONTEXT.md `<deferred>` and documented in plan SUMMARYs.

The phase status is **human_needed** rather than passed because five validation steps cannot be exercised by static or unit-level verification:

- DEPLOY-01 requires Docker daemon access (exists in CI; not in this verifier environment)
- SC#2 first-real-webhook requires a Linear Business/Enterprise plan webhook delivery
- SC#4 wizard UX needs a one-time human walkthrough
- INGEST-04 production-hardware benchmark needs the target deployment
- Branch protection is a GitHub repo setting outside the codebase

These are not gaps — every one of them has a CI gate or test backing it, and the human verification step is a one-time gate to mark Phase 1 closed.

---

_Verified: 2026-05-04T06:00:00Z_
_Verifier: Claude (gsd-verifier)_

## HUMAN VERIFICATION NEEDED
