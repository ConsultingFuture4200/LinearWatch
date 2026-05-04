---
status: partial
phase: 01-foundation
source: [01-VERIFICATION.md]
started: 2026-05-04T06:00:00Z
updated: 2026-05-04T06:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. docker-compose smoke (DEPLOY-01 / SC#1)
expected: Run `git clone && docker compose up` on a clean laptop and confirm `http://localhost:3000` reaches the dashboard within 5 minutes; no manual DB setup.
result: [pending]
why_human: Requires real Docker daemon and clean image. CI `compose-smoke` job runs this on every push but should be confirmed manually once before declaring Phase 1 complete.

### 2. Real Linear webhook delivery (SC#2)
expected: Send a real Linear webhook with valid HMAC against the deployed instance; observe exactly one `events.raw_event` row even if Linear retries; cost view reflects new agent activity after resolver job runs.
result: [pending]
why_human: SC#2 is verified end-to-end with injected Fastify requests. First delivery from a real Linear workspace (Business or Enterprise plan) should be observed before declaring Phase 1 complete.

### 3. Setup wizard UX walkthrough (SETUP-01..04 / SC#4)
expected: Walk the wizard at `/setup` in a browser. Step 2 modal renders verbatim D-13 copy; Escape blocked; only "I've notified my team" advances; Linear OAuth round-trips; API key reveal happens once; `--seed` populates the cost view; webhook URL + cURL block on Done step.
result: [pending]
why_human: Verbatim D-13 copy is asserted by 3 Playwright tests; full 7-step UX should be eyeballed once with a real Linear OAuth app to confirm hand-off between steps and `AGENTWATCH_PUBLIC_URL` placeholder substitution.

### 4. Production-hardware webhook benchmark (INGEST-04 / D-31)
expected: Run `pnpm --filter @agentwatch/server bench:webhook-ack` against `postgres:16-alpine` on the target deployment hardware; p99 < 200ms with non-2xx=0 across 200 concurrent connections for 15s.
result: [pending]
why_human: Verified locally at p99=169ms on the developer machine. The 200ms SLA has only ~30ms of headroom; production-class hardware should be measured at least once because contention characteristics differ.

### 5. GitHub branch protection (LAUNCH-prerequisite)
expected: Confirm GitHub branch protection on `main` requires all 6 CI gates: static-checks, lint-typecheck-test, bench-webhook-ack, e2e-setup-wizard, privacy-guard, compose-smoke.
result: [pending]
why_human: Branch protection is not enforced by CI itself — the repo owner must configure it once on GitHub. README documents the contract but cannot enforce it.

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
