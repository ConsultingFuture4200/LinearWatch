---
status: partial
phase: 01-foundation
source: [01-VERIFICATION.md]
started: 2026-05-04T06:00:00Z
updated: 2026-05-04T06:35:00Z
---

## Current Test

UAT #3 (setup wizard walkthrough) — partial; confirm welcome + AgentSession warning + redirect-to-OAuth in browser

## Tests

### 1. docker-compose smoke (DEPLOY-01 / SC#1)
expected: Run `git clone && docker compose up` on a clean laptop and confirm `http://localhost:3000` reaches the dashboard within 5 minutes; no manual DB setup.
result: passed (2026-05-04T06:35:00Z) — `bash scripts/smoke-compose.sh` reported "OK: dashboard + server reachable in 26s" after fixing 4 Phase-1 gaps (missing .dockerignore, missing packages/web/public, workspace package main fields pointing at .ts source, env validator rejecting empty WORKSPACE_ID)
why_human: Requires real Docker daemon and clean image. CI `compose-smoke` job runs this on every push but should be confirmed manually once before declaring Phase 1 complete.
fix_commits:
  - 910ceb5 — fix(01-01): add .dockerignore to keep host node_modules out of build context
  - c8b0086 — fix(01-08): add empty packages/web/public/ for Next.js standalone build
  - cfa9325 — fix(01-04,01-08): point workspace package main fields at dist/, pass env to worker
  - 2685c57 — fix(01-04): treat empty WORKSPACE_ID env as unset

### 2. Real Linear webhook delivery (SC#2)
expected: Send a real Linear webhook with valid HMAC against the deployed instance; observe exactly one `events.raw_event` row even if Linear retries; cost view reflects new agent activity after resolver job runs.
result: [pending]
why_human: SC#2 is verified end-to-end with injected Fastify requests. First delivery from a real Linear workspace (Business or Enterprise plan) should be observed before declaring Phase 1 complete.

### 3. Setup wizard UX walkthrough (SETUP-01..04 / SC#4)
expected: Walk the wizard at `/setup` in a browser. Step 2 modal renders verbatim D-13 copy; Escape blocked; only "I've notified my team" advances; Linear OAuth round-trips; API key reveal happens once; `--seed` populates the cost view; webhook URL + cURL block on Done step.
result: [pending]
why_human: Verbatim D-13 copy is asserted by 3 Playwright tests; full 7-step UX should be eyeballed once with a real Linear OAuth app to confirm hand-off between steps and `LINEARWATCH_PUBLIC_URL` placeholder substitution.

### 4. Production-hardware webhook benchmark (INGEST-04 / D-31)
expected: Run `pnpm --filter @linearwatch/server bench:webhook-ack` against `postgres:16-alpine` on the target deployment hardware; p99 < 200ms with non-2xx=0 across 200 concurrent connections for 15s.
result: [pending]
why_human: Verified locally at p99=169ms on the developer machine. The 200ms SLA has only ~30ms of headroom; production-class hardware should be measured at least once because contention characteristics differ.

### 5. GitHub branch protection (LAUNCH-prerequisite)
expected: Confirm GitHub branch protection on `main` requires all 6 CI gates: static-checks, lint-typecheck-test, bench-webhook-ack, e2e-setup-wizard, privacy-guard, compose-smoke.
result: [pending]
why_human: Branch protection is not enforced by CI itself — the repo owner must configure it once on GitHub. README documents the contract but cannot enforce it.

## Summary

total: 5
passed: 1
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

### G-01: Phase-1 docker-compose smoke surfaced 4 plan defects
status: resolved
discovered: 2026-05-04T06:30:00Z
resolved: 2026-05-04T06:35:00Z
plans_affected: [01.01-repo-bootstrap, 01.04-server-bootstrap, 01.08-dashboard]

UAT #1 caught four bugs that the automated CI gates did not catch because no
gate exercised a clean docker-build-and-boot of the production images on a host
with the source repository pnpm-installed in dev mode:

1. **Missing .dockerignore** — `COPY packages/db ./packages/db` overwrote the
   deps-stage's clean `node_modules` with the host's pnpm symlinks, breaking
   tsc with "Cannot find module 'drizzle-orm/pg-core'". Plan 01.01 missed it.
   Fixed in 910ceb5.

2. **Missing packages/web/public/** — Next.js standalone Dockerfile.web requires
   the directory to exist. Plan 01.08 missed it. Fixed in c8b0086.

3. **Workspace package.json `main` pointing at .ts source** — `packages/{db,
   shared,server}/package.json` all had `"main": "./src/index.ts"`. Works for
   tsx/dev/vitest, breaks at production runtime where Node loads JS directly.
   Plan 01.02 / 01.03 / 01.04 missed it. Fixed in cfa9325.

4. **compose.yml worker missing LINEAR_*/LINEARWATCH_INTERNAL_API_KEY** + **env
   validator rejecting empty WORKSPACE_ID** — process-global env.ts forces the
   worker to validate vars it doesn't use, and Zod's `.uuid().optional()` rejects
   empty strings. Fixed in cfa9325 + 2685c57.

### Recommended Phase 2 follow-ups (not blocking SC#1):

- Add a CI guard `static-checks` step that asserts `.dockerignore` exists and
  excludes `node_modules`.
- Add a CI guard that asserts every workspace `package.json#main` does not match
  `\.ts$` (must point to compiled output).
- Right-size `packages/server/src/env.ts` to be process-aware: split into
  `serverEnv`, `workerEnv`, `webEnv` so the worker doesn't validate `LINEAR_*`
  it doesn't use.
- Add a `compose-smoke` integration test that boots all three production images
  on a clean checkout and asserts dashboard reachability — the smoke script
  exists but is not yet wired into a Docker-in-Docker CI step.
