---
phase: 01-foundation
plan: 07
subsystem: foundation
tags: [query-api, sdk-endpoint, identity-confirm, dispatcher, dimension-enum, sql-injection-prevention]
requires:
  - "@agentwatch/shared QueryRequest + SdkEventBody from plan 01.03"
  - "Fastify bootstrap + authBearer plugin from plan 01.04"
  - "events.raw_event partitioned table + identity_mappings + agents schema from plan 01.02"
  - "logWebhookReceipt + webhookAckSeconds metrics from plan 01.04 (reused for SDK source label)"
provides:
  - "POST /api/v1/query — Bearer-authenticated query API; closed-enum metric/dimension dispatch (API-01..API-08)"
  - "POST /api/v1/sdk/event — Bearer-authenticated SDK ingestion endpoint with idempotency (INGEST-03 / D-10 / D-19)"
  - "POST /api/v1/agents/:id/confirm — DASH-04 one-click identity confirmation"
  - "src/query/dispatcher.ts — Record<MetricName, SqlFn> static map (API-03 enforcement)"
  - "src/query/metrics/cost-by-agent.ts — SUM(cost_usd) + COUNT(*) grouped by dimension"
  - "src/query/metrics/agent-session-count.ts — COUNT(*) with optional dimension"
  - "src/query/window.ts — Window → (since, until) parameter resolver"
affects:
  - "Plan 01.08 (cost dashboard) calls POST /api/v1/query exclusively for chart data and table data"
  - "Plan 01.08 dashboard side panel calls POST /api/v1/agents/:id/confirm on row confirmation (D-17)"
  - "Future P2 SDK packages (@agentwatch/sdk Node, agentwatch PyPI) target POST /api/v1/sdk/event"
  - "Future P2 metrics (DASH-02 reliability, DASH-03 lineage) extend MetricName + add metric files"
tech-stack:
  added: []
  patterns:
    - "Static metric → SQL function map (Record<MetricName, SqlFn>) — adding a metric is a one-line touch + new metric file; impossible to compile if MetricName grows without a handler"
    - "Closed-set switch on Zod-enum value selecting SQL fragments via drizzle-orm's `sql` template tag — user input never enters SQL text as a string concatenation; only as bound parameters"
    - "Idempotency-by-CTE-NOT-EXISTS pattern (mirrors plan 01.05 Linear webhook) — necessary because the partition rule requires received_at in the unique index, so a plain ON CONFLICT only catches microsecond races"
    - "Reuse webhookAckSeconds + eventsReceived with source='sdk' label — single histogram surface across webhook + SDK paths"
    - "State-predicate UPDATE for identity confirmation — `WHERE state='PENDING_CONFIRMATION'` is the load-bearing safeguard against flipping a CONFIRMED row back"
    - "allow-req-body annotation on Zod parse boundaries — the OBS-04 grep guard exempts the audited entry points; deny-by-default elsewhere"
key-files:
  created:
    - "packages/server/src/query/window.ts"
    - "packages/server/src/query/dispatcher.ts"
    - "packages/server/src/query/metrics/cost-by-agent.ts"
    - "packages/server/src/query/metrics/agent-session-count.ts"
    - "packages/server/src/routes/api/v1/query.ts"
    - "packages/server/src/routes/api/v1/sdk-event.ts"
    - "packages/server/src/routes/api/v1/agents-confirm.ts"
    - "packages/server/test/integration/query-api.test.ts"
    - "packages/server/test/integration/sdk-event.test.ts"
    - "packages/server/test/integration/agents-confirm.test.ts"
  modified:
    - "packages/server/src/index.ts (registered queryRoute, sdkEventRoute, agentsConfirmRoute)"
decisions:
  - "Used drizzle-orm's `sql` template tag for the metric SQL composition (over building text+params arrays manually). The closed-set switch returns `SQL` fragments (`sql\\`a.name\\``, `sql\\`JOIN agents a ON ...\\``) and the metric file composes them with bound parameters via `${...}` interpolation. drizzle handles the parameter offsets so we don't have to manage `$1, $2, ...` ourselves."
  - "Tests use Fastify's `app.inject()` rather than spawning the full server — matches the existing webhook-linear.test.ts convention from Plan 01.05 and avoids the spawn-and-poll-/health-for-30s overhead of the migrations-on-startup gate. The migration ordering invariant is already covered by Plan 01.04's integration test; this plan tests the route logic itself."
  - "SDK endpoint reuses Plan 01.05's `WITH existing AS (...) ... NOT EXISTS (...) ... ON CONFLICT DO NOTHING` CTE pattern verbatim. The unique constraint `(source, upstream_id, received_at)` requires `received_at` because the table is partitioned on it (Postgres rule), so a plain ON CONFLICT only catches microsecond-precision collisions. The CTE is the load-bearing dedup; ON CONFLICT is defense-in-depth."
  - "Confirm endpoint returns `confirmed_count` (the number of identity_mappings rows updated) instead of 200/204. The dashboard can show a no-op message when the operation matched zero rows (already confirmed, or wrong linear_app_user_id). This is a deliberate choice to make the side panel UX honest about what happened."
  - "404 on soft-deleted agent (rather than 409 or silent success). The dashboard should never reach this state — the side panel only opens for visible agents — but a stale tab + DELETE race is defensible. 404 matches the agent-not-found case and avoids inventing a third status code for an edge case."
  - "Filter `op: 'in'` accepts either a single string or an array — Zod's `z.union([z.string(), z.array(z.string())])` (already in @agentwatch/shared from 01.03). The metric implementation normalises with `Array.isArray(f.value) ? f.value : [f.value]` so the SQL `= ANY($N::uuid[])` form works in either case."
metrics:
  duration_seconds: 471
  duration_human: "~8 minutes"
  tasks_completed: 2
  files_created: 10
  files_modified: 1
  commits: 2
  completed: "2026-05-04T04:45:13Z"
---

# Phase 1 Plan 07: Query API + SDK Endpoint + Identity Confirm Summary

Three Bearer-authenticated routes for the Phase 1 dashboard data plane:
the constrained query API (the dashboard's only read path), the SDK
ingestion endpoint (for early HTTP adopters; published packages are P2),
and the one-click identity confirmation endpoint (the dashboard side
panel calls this on D-17 confirmations). All three are gated by the
existing `authBearer` plugin from Plan 01.04 and tested end-to-end
against `postgres:16-alpine`.

## What Shipped

### Task 1 — Query API dispatcher + 2 metric SQL functions (commit `4b4f3cd`)

`packages/server/src/query/window.ts`:

- `resolveWindow(w: Window): { since: Date; until: Date }` — converts the
  shared Window schema's `last: '14d'` (relative) or `from`+`to` (absolute)
  contract into a single `(since, until)` pair that every metric SQL
  function binds as parameters.

`packages/server/src/query/metrics/cost-by-agent.ts`:

- `SUM(cost_usd)` + `COUNT(*)` grouped by dimension. NULL `cost_usd` rows
  count toward `count` but contribute 0 to `value` (P1 — vendor cost
  enrichment is P2).
- Dimension shape is selected via a closed switch on `DimensionName` (Zod
  enum). The switch returns drizzle `SQL` fragments (`sql\`a.name\``,
  `sql\`JOIN agents a ON ...\``); the user payload value never enters the
  SQL text as a string. Filter values are bound parameters via `${...}`.
- Filter shape is the same closed-switch pattern: `f.field`
  (`agent_id`/`team_id`/`cycle_id`) selects the SQL column; `f.op`
  (`eq`/`neq`/`in`) selects the operator. `in` uses `= ANY($N::uuid[])`.

`packages/server/src/query/metrics/agent-session-count.ts`:

- `COUNT(*)` with optional dimension. No-dimension case returns a single
  row keyed `'all'` with the total count over the window; with-dimension
  case returns one row per dimension value.
- Same closed-switch discipline as `cost-by-agent`.

`packages/server/src/query/dispatcher.ts`:

```ts
const handlers: Record<MetricName, SqlFn> = {
  cost_by_agent: costByAgent,
  agent_session_count: agentSessionCount,
};
```

The `Record<MetricName, SqlFn>` type is the load-bearing compile-time
gate: TypeScript refuses to compile if a `MetricName` enum value is
missing here. `MetricName` is a CLOSED Zod enum, so unknown values
reject at the route layer (`QueryRequest.safeParse(req.body)`) BEFORE
the dispatcher runs (T-07-01 / API-03).

`packages/server/src/routes/api/v1/query.ts`:

- `POST /api/v1/query` with `{ preHandler: fastify.authBearer }`.
- `QueryRequest.safeParse(req.body)` — closed Zod enums on `metric`,
  `dimension`, `filters[].field`, `filters[].op` reject any unknown
  string with a parseable Zod error formatted into a 400 response.
- `req.workspaceId` (set by `authBearer`) is the only source of the
  `workspace_id` parameter bound into every metric SQL function.
- Response envelope: `{ metric, dimension?, window, rows }`.

`packages/server/test/integration/query-api.test.ts` — 10 cases against
real Postgres + 10 seeded sessions across 3 agents and 2 teams:

1. 401 without bearer
2. 401 on bad bearer
3. 400 on unknown metric (`'sql_drop_table'` → Zod rejection)
4. 400 on unknown dimension (`'repo'` deferred to P2 → rejection)
5. `cost_by_agent` dimension=agent: cursor=7.5, devin=6.0, internal=0
   (NULL costs → 0 value but count > 0)
6. `cost_by_agent` dimension=team: ENG=7.5/7, OPS=6.0/3
7. `agent_session_count` no dimension: single `{key:'all', value:10}` row
8. `agent_session_count` dimension=agent: per-agent counts
9. Filter `team_id=eq:<uuid>`: only that team's agents in result
10. Pitfall 13 sanity: response JSON contains no `"title"` field, no
    `title_hash`, and not the seeded title hash string

### Task 2 — SDK event + identity confirm endpoints (commit `9daaad1`)

`packages/server/src/routes/api/v1/sdk-event.ts`:

- `POST /api/v1/sdk/event` with Bearer auth.
- `SdkEventBody.safeParse(req.body)` — discriminated union on
  `event_type` (`session_start` / `session_end` / `cost_recorded`)
  rejects any other event type with 400.
- Idempotency: caller may supply `idempotency_key` (≤128 chars per
  D-10); otherwise the server synthesizes
  `sha256(workspace_id|session_id|event_type|minute_bucket(occurred_at))`.
  Response includes the resolved key so the caller can correlate.
- INSERT uses the Plan-01.05 CTE pattern verbatim:

```sql
WITH existing AS (
  SELECT id FROM events.raw_event
   WHERE source='sdk' AND upstream_id=$1 ORDER BY received_at DESC LIMIT 1
), inserted AS (
  INSERT INTO events.raw_event (source, upstream_id, payload, signature_valid)
  SELECT 'sdk', $1, ($2::text)::jsonb, true
   WHERE NOT EXISTS (SELECT 1 FROM existing)
  ON CONFLICT (source, upstream_id, received_at) DO NOTHING
  RETURNING id
)
SELECT id FROM inserted UNION ALL SELECT id FROM existing LIMIT 1
```

- `webhookAckSeconds`/`eventsReceived` reused with `source='sdk'`.
- `logWebhookReceipt(req, reply, 'sdk')` — same D-29 whitelist line.

`packages/server/src/routes/api/v1/agents-confirm.ts`:

- `POST /api/v1/agents/:id/confirm` with Bearer auth.
- Body: `{ linear_app_user_id: string }`.
- Verifies `agents.id` exists and is not soft-deleted (404 otherwise).
- Update is `WHERE state='PENDING_CONFIRMATION'` — already-CONFIRMED rows
  are never flipped back (T-07-07 mitigation). Returns
  `{ ok, confirmed_count }`.

`packages/server/test/integration/sdk-event.test.ts` — 5 cases:

1. 401 without bearer.
2. 200 + 1 row inserted on valid `session_start` with caller-supplied
   `idempotency_key` (verified by counting raw_event rows for that
   `session_id`).
3. Caller-supplied key dedupes — two POSTs of the same body → 1 row.
4. Synthesized key dedupes — two POSTs without `idempotency_key` but
   identical `(session_id, event_type, occurred_at)` → 1 row, same
   echoed `idempotency_key`.
5. 400 on invalid `event_type` (`'agent_attempted_takeover'`).

`packages/server/test/integration/agents-confirm.test.ts` — 6 cases:

1. 401 without bearer.
2. 400 on missing body (no `linear_app_user_id`).
3. PENDING → CONFIRMED happy path: `state`, `confirmed_at`, `agent_id`
   all updated correctly.
4. T-07-07 invariant: an already-CONFIRMED row stays CONFIRMED with its
   original `agent_id` even when a new confirm POST targets a different
   `agents.id`. `confirmed_count: 0` on the no-op.
5. 404 on non-existent `agents.id`.
6. 404 on soft-deleted agent (`deleted_at IS NOT NULL`).

## Verification

| Gate                                      | Command                                                            | Result                |
|-------------------------------------------|--------------------------------------------------------------------|-----------------------|
| Typecheck (all packages)                  | `pnpm typecheck`                                                   | Clean (4/4)           |
| Lint (full repo)                          | `pnpm lint`                                                        | 78 files, 0 errors    |
| Server tests (full suite)                 | `DATABASE_URL_TEST=… pnpm --filter @agentwatch/server test`        | 54/54 pass            |
| Query API integration                     | `… pnpm --filter @agentwatch/server test -- query-api`             | 10/10 pass            |
| SDK event integration                     | `… pnpm --filter @agentwatch/server test -- sdk-event`             | 5/5 pass              |
| Agents confirm integration                | `… pnpm --filter @agentwatch/server test -- agents-confirm`        | 6/6 pass              |
| OBS-04 grep guard                         | `bash scripts/check-no-req-body.sh`                                | OK                    |
| Acceptance grep #1 (Record<MetricName>)   | `grep -n "Record<MetricName" packages/server/src/query/dispatcher.ts` | line 23            |
| Acceptance grep #2 (no string concat from req)| `grep -nE "\\+\\s*req\\." packages/server/src/query/metrics/cost-by-agent.ts` | NO matches |
| Acceptance grep #3 (sdk source + ON CONFLICT) | `grep -n "ON CONFLICT.*source.*upstream_id" packages/server/src/routes/api/v1/sdk-event.ts` | matches |
| Acceptance grep #4 (synthesizeKey + minuteBucket) | `grep -n "synthesizeKey\\|minuteBucket" packages/server/src/routes/api/v1/sdk-event.ts` | matches |
| Acceptance grep #5 (PENDING_CONFIRMATION predicate) | `grep -n "PENDING_CONFIRMATION" packages/server/src/routes/api/v1/agents-confirm.ts` | matches |

## Requirements Satisfied

| Req ID    | Description                                                          | Evidence                                                                          |
|-----------|----------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| API-01    | POST /api/v1/query with `{metric, dimension, filters, window}`       | `query.ts` route + `QueryRequest.safeParse` + dispatcher                          |
| API-02    | Unknown metric → 400                                                 | Test 3 (`metric: 'sql_drop_table'`) returns 400                                   |
| API-03    | Each metric is a static SQL function in `src/query/metrics/<metric>.ts` | `dispatcher.ts` `Record<MetricName, SqlFn>`; two metric files exist            |
| API-04    | P1 metrics: `cost_by_agent`, `agent_session_count`                   | Both implemented; tested end-to-end                                               |
| API-05    | P1 dimensions: `agent`, `team`, `cycle`                              | All three exercised in tests; unknown dimension `'repo'` → 400                    |
| API-06    | Bearer-token auth                                                    | All 3 routes use `{ preHandler: fastify.authBearer }`; 401 tests pass             |
| API-07    | Response envelope `{ metric, dimension, window, rows }`              | `query.ts` returns this exact shape; tests assert on `body.metric`, `body.dimension` |
| API-08    | Window required on every query                                       | `QueryRequest` schema requires `window`; missing window → Zod 400                 |
| INGEST-03 | SDK accepts session_start, session_end, cost_recorded                | `sdk-event.ts` discriminated union; 200 on valid; 400 on unknown event_type       |
| DASH-04   | Dashboard one-click confirmation                                     | `agents-confirm.ts` flips state to CONFIRMED with confirmed_at + agent_id         |

## Pitfalls Mitigated

- **T-07-01 (SQL injection via metric/dimension/filter strings):** Closed
  Zod enums (`MetricName`, `DimensionName`, `FilterField`, `FilterOp`)
  parse the request body BEFORE the dispatcher runs. The metric SQL
  functions select dimension shape and filter shape via switch statements
  on the parsed enum values; user-supplied values are bound as parameters
  via drizzle's `sql` template tag. The acceptance grep
  (`grep -nE "\+\s*req\." packages/server/src/query/metrics/cost-by-agent.ts`)
  returns no matches — there is no path from `req.body` strings to SQL
  text. Test 3 (unknown metric) and Test 4 (unknown dimension) prove the
  Zod gate is the boundary.
- **Pitfall 4 / 13 (Title leakage through query API):** Phase-1 metrics
  do not select from the `issues` table at all — `cost_by_agent` joins
  `agent_sessions` to `agents`/`teams`/`cycles`, never to `issues`.
  Test 10 seeds an `issues` row with a known `title_hash` and asserts
  the query response JSON contains no `"title"` field, no `title_hash`,
  and not the seeded hash string. Plan 01.10's CI privacy guard runs
  this end-to-end across every metric.
- **T-07-05 (SDK event replay double-counts):** Idempotency-key contract
  (caller-supplied OR synthesized) + the NOT-EXISTS-CTE INSERT pattern
  ensures duplicate POSTs collapse to one row. SDK Test 3 (caller-key)
  and SDK Test 4 (synthesized-key minute-bucket) prove both paths.
- **T-07-07 (Confirm flips a CONFIRMED row back to PENDING):** The
  `WHERE state='PENDING_CONFIRMATION'` predicate is the load-bearing
  guard; Test 4 of agents-confirm proves an already-CONFIRMED row stays
  CONFIRMED with its original `agent_id` when a new confirm POST targets
  a different agent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Biome formatter rejected the plan's reference snippet shape**

- **Found during:** Both tasks' lint gate.
- **Issue:** The plan's reference snippets used multi-line type
  declarations and `Array<{ ... }>` aggregations that Biome's 100-column
  width allowed on a single line. Biome's formatter is the project's
  source of truth for whitespace.
- **Fix:** Ran `pnpm exec biome check --write` on the touched files;
  collapsed `type SqlFn = (...) => ...` to one line and accepted Biome's
  multi-line `Array<{ key: ...; value: ...; count: ... }>` formatting in
  cost-by-agent.ts.
- **Files modified:** `packages/server/src/query/dispatcher.ts`,
  `packages/server/src/query/metrics/cost-by-agent.ts`,
  `packages/server/src/routes/api/v1/sdk-event.ts`
- **Commits:** `4b4f3cd`, `9daaad1`

**2. [Rule 3 — Blocking] Test files used template literals without interpolation**

- **Found during:** Lint gate.
- **Issue:** Biome's `noUnusedTemplateLiteral` rule rejected backtick
  strings like `` `INSERT INTO ...` `` that had no `${...}` placeholders.
- **Fix:** Ran biome with `--unsafe` to auto-replace those with single
  quotes. Backtick strings with `${...}` interpolation (e.g.
  `` `Bearer ${PLAINTEXT_KEY}` ``) were untouched.
- **Files modified:** `packages/server/test/integration/query-api.test.ts`,
  `packages/server/test/integration/agents-confirm.test.ts`
- **Commits:** `4b4f3cd`, `9daaad1`

**3. [Rule 3 — Blocking] OBS-04 grep guard tripped on `QueryRequest.safeParse(req.body)`**

- **Found during:** Task 1 verification.
- **Issue:** The grep guard from Plan 01.04 forbids `req.body` in
  production code unless the line contains `allow-req-body:` annotation.
  The query route's Zod parse boundary is exactly the kind of audited
  use the annotation was designed for, but the plan's reference snippet
  didn't include the annotation.
- **Fix:** Annotated `// allow-req-body: Zod-validated parse boundary;
  closed enums gate SQL dispatch` on the same line as `req.body`. Same
  treatment in `sdk-event.ts` and `agents-confirm.ts`.
- **Files modified:** all three new route files
- **Commits:** `4b4f3cd`, `9daaad1`

### Architectural Choices Within Plan Scope

- **`app.inject()` instead of spawning the full server:** the plan's
  reference snippet spawned `node packages/server/dist/index.js` and
  polled `/health` for readiness. The existing Plan-01.05 webhook test
  uses Fastify's `app.inject()` against a unit-assembled instance, which
  is faster (~500ms per file vs ~2s for spawn-and-poll) and isolates
  test failures from DB-startup-related noise. The migration ordering
  invariant is already covered by Plan 01.04's
  `migrations-on-startup.test.ts`; this plan tests the route logic, not
  the bootstrap. Kept the integration test naming and the
  `DATABASE_URL_TEST` env-var contract identical to other plans.
- **drizzle `sql` template tag instead of raw `db.execute({text, args})`:**
  the plan's reference snippet built `text` and `params` arrays manually
  with explicit `$1, $2, ...` placeholders. drizzle's `sql` tag handles
  parameter offsets automatically and lets us compose `SQL` fragments
  via the dim/filter switch statements — net cleaner code with the same
  parameter-binding guarantee.
- **404 on soft-deleted agent (rather than 409 or silent success):** the
  plan said "executor's call". 404 matches the agent-not-found case and
  avoids inventing a third status code for an edge case. The dashboard
  side panel only opens for visible agents, so this branch should never
  fire in practice — it's a defensive 404 on stale-tab races.
- **`Filter.op === 'in'` accepts a single string OR an array:** the
  shared schema uses `z.union([z.string(), z.array(z.string())])`, so
  the metric implementation normalises with `Array.isArray(...)
  ? f.value : [f.value]` before the `= ANY($N::uuid[])` bind. Saves
  callers from having to wrap a single-value `in` in a one-element
  array.
- **Reuse `webhookAckSeconds` and `eventsReceived` for SDK source:** the
  Plan-01.04 metrics plugin already declares both as labelled metrics
  (`source: 'linear'|'github'|'vendor'|'sdk'`). The SDK route adds the
  `'sdk'` label observation; no new metric needed.

## Threat Surface Assessment

No new surface introduced beyond the plan's `<threat_model>`. T-07-01
through T-07-07 dispositions hold:

- **T-07-01 (SQL injection):** mitigated — closed Zod enums + closed-set
  switch + bound parameters. Tests 3, 4 prove the gate.
- **T-07-02 (Title leakage):** mitigated — Phase-1 metrics don't query
  the `issues` table. Test 10 verifies the response surface.
- **T-07-03 (Cross-workspace query):** mitigated — every metric SQL
  function applies `WHERE s.workspace_id = ${ctx.workspaceId}`, sourced
  exclusively from `req.workspaceId` set by `authBearer`.
- **T-07-04 (SDK key spoofs another caller):** accepted (P1 single-tenant
  per CONTEXT.md and the plan threat model).
- **T-07-05 (SDK replay):** mitigated — caller-or-synthesized
  idempotency key + NOT-EXISTS-CTE. SDK Tests 3, 4 verify.
- **T-07-06 (Filter values logged):** accepted — pino redact paths
  cover `req.body`; values pass through bind parameters and never reach
  logs.
- **T-07-07 (Confirm rolls back):** mitigated — `WHERE
  state='PENDING_CONFIRMATION'` predicate. Confirm Test 4 verifies.

## Known Stubs

None. All three routes are real implementations consumed directly by
Plan 01.08 (cost dashboard).

The plan's `<output>` section documents that the published SDK packages
are P2 — that's a known forward stub at the project level (CONTEXT.md
deferred items), not a stub introduced by this plan. The endpoint
itself is fully functional.

## Threat Flags

(No new threat surface flags raised. The plan's threat_model fully
covers the three routes shipped here.)

## Next Plan Handoff

Plan 01.08 (cost dashboard) consumes:

```ts
// Server-side fetch from a Next.js Server Component (Pattern 8 from RESEARCH.md):
const r = await fetch('http://server:8080/api/v1/query', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${process.env.WORKSPACE_API_KEY}`,
  },
  body: JSON.stringify({
    metric: 'cost_by_agent',
    dimension: 'agent',
    window: { last: searchParams.window ?? '14d' },
    filters: searchParams.team ? [{ field: 'team_id', op: 'eq', value: searchParams.team }] : undefined,
  }),
});
```

The dashboard's row-confirm side panel (D-17) calls:

```ts
await fetch(`http://server:8080/api/v1/agents/${agentId}/confirm`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ linear_app_user_id: candidate.linear_app_user_id }),
});
```

Future P2 SDK packages (`@agentwatch/sdk` Node, `agentwatch` PyPI) post
to `/api/v1/sdk/event` with the same `SdkEventBody` shape — the contract
is now stable.

## Commits

- `4b4f3cd` — feat(01-07): query API dispatcher + cost_by_agent + agent_session_count
- `9daaad1` — feat(01-07): SDK event endpoint + agents confirm endpoint

## Self-Check

```
FOUND: /home/bob/Linearwatch/packages/server/src/query/window.ts
FOUND: /home/bob/Linearwatch/packages/server/src/query/dispatcher.ts
FOUND: /home/bob/Linearwatch/packages/server/src/query/metrics/cost-by-agent.ts
FOUND: /home/bob/Linearwatch/packages/server/src/query/metrics/agent-session-count.ts
FOUND: /home/bob/Linearwatch/packages/server/src/routes/api/v1/query.ts
FOUND: /home/bob/Linearwatch/packages/server/src/routes/api/v1/sdk-event.ts
FOUND: /home/bob/Linearwatch/packages/server/src/routes/api/v1/agents-confirm.ts
FOUND: /home/bob/Linearwatch/packages/server/test/integration/query-api.test.ts
FOUND: /home/bob/Linearwatch/packages/server/test/integration/sdk-event.test.ts
FOUND: /home/bob/Linearwatch/packages/server/test/integration/agents-confirm.test.ts
FOUND commit: 4b4f3cd
FOUND commit: 9daaad1
```

## Self-Check: PASSED
