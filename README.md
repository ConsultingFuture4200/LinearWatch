# agentwatch

Self-hosted, open-source observability for AI agents working in Linear workspaces.

agentwatch ingests Linear Agent Session webhooks, GitHub PR outcomes, and agent vendor cost
data; resolves them into a unified agent identity; and exposes cost, reliability, and lineage
analytics through a dashboard, CLI, and YAML-defined alert rules.

**Core value:** cross-agent attribution — for any issue, team, or cycle, see which agent did
what, what it cost, and whether the change held up.

## Quick start

```bash
git clone https://github.com/your-org/agentwatch.git
cd agentwatch
cp .env.example .env
# Edit .env: set LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET, LINEAR_WEBHOOK_SECRET,
# and AGENTWATCH_INTERNAL_API_KEY (any random 32+ char string).

docker compose up
# Open http://localhost:3000
```

The full stack (Postgres + server + worker + Next.js dashboard) reaches the dashboard
placeholder within 5 minutes on a clean laptop.

## Local development (contributors)

The hybrid inner loop avoids rebuilding containers on every code change:

```bash
docker compose up postgres            # database only
pnpm install
pnpm --filter @agentwatch/server dev  # webhook receiver + query API on host
pnpm --filter @agentwatch/server worker  # Graphile Worker on host
pnpm --filter @agentwatch/web dev     # Next.js dashboard on host
```

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before pushing — CI runs all three plus
the OBS-04 grep guard.

## Deployment notes

### Reverse-proxy auth (DEPLOY-05)

agentwatch v0 does not ship built-in authentication. Put the dashboard and server behind a
reverse-proxy that adds basic auth or your existing SSO.

**nginx:**

```nginx
location / {
  auth_basic "agentwatch";
  auth_basic_user_file /etc/nginx/agentwatch.htpasswd;
  proxy_pass http://localhost:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}

location /webhooks/ {
  # Linear/GitHub webhooks must NOT require basic auth.
  proxy_pass http://localhost:8080;
}
```

**Caddy:**

```
agentwatch.example.com {
  basicauth /* {
    admin {env.AGENTWATCH_BASIC_AUTH_HASH}
  }
  reverse_proxy /webhooks/* localhost:8080
  reverse_proxy localhost:3000
}
```

Always exclude the webhook paths from basic auth — they authenticate via HMAC.

### PgBouncer (DEPLOY-06)

If your `DATABASE_URL` points at PgBouncer in transaction-mode (Supabase, Neon-via-PgBouncer,
self-hosted PgBouncer), append `?pgbouncer=true` to the connection string:

```
DATABASE_URL=postgres://user:pass@pgbouncer:6432/agentwatch?pgbouncer=true
```

Requires PgBouncer **≥ 1.21** with `max_prepared_statements > 0`. See the
[PgBouncer FAQ](https://www.pgbouncer.org/faq.html) for tuning. Without this flag, prepared
statements break under transaction-mode pooling.

### Linear plan

Agent Session webhook access requires **Linear Business or Enterprise**. The Free and
Standard plans cannot deliver `actor=app` events. agentwatch will fall back to no-op
behavior on workspaces without the AgentSession scope.

## Project layout

```
packages/
  db/       Drizzle schema + migrations (Phase 1 schema is partitioned events table + star)
  shared/   Zod schemas, TitleHash type, query DSL types — shared between server and web
  server/   Fastify webhook receiver + query API + Graphile Worker host
  web/      Next.js 15 dashboard reading exclusively through the internal query API
```

## Privacy

Issue titles are SHA-256 hashed by default with a per-workspace salt. The `issues` schema has
no `title: string` column. Setting `LOG_LEVEL=debug` does not log webhook bodies — payload
keys only, never values. No data leaves your instance unless `TELEMETRY_OPT_IN=true`, in
which case daily aggregate rollups (no titles, no IDs, no costs at session granularity) are
sent to the public benchmark aggregator. Anonymization spec ships in `docs/telemetry.md`
(Phase 3).

## Status

[![CI](https://github.com/agentwatch/agentwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/agentwatch/agentwatch/actions/workflows/ci.yml)

agentwatch is pre-v0.1. Phase 1 (Foundation) is the active milestone — see
[`.planning/ROADMAP.md`](./.planning/ROADMAP.md). v0.1 ships when Phase 3 (Launch) success
criteria are met.

### CI gates (all required for Phase 1)

Every push runs these six independent jobs. Each one maps to a load-bearing claim in the
PRD; a failing gate is a red build, never a warning.

| Gate | Verifies |
|------|----------|
| `static-checks` | `req.body` not in production code (OBS-04 / Pitfall 12); `issues` schema has no `title` column (D-26 / Pitfall 13); web has no DB driver imports (API-07). |
| `lint-typecheck-test` | `pnpm lint`, `pnpm typecheck`, `pnpm test` across all packages. |
| `bench-webhook-ack` | 200 concurrent valid Linear webhooks; p99 < 200ms (D-31 / INGEST-04). |
| `e2e-setup-wizard` | AgentSession warning copy verbatim; click-through gate enforced (SETUP-02 / D-13). |
| `privacy-guard` | Seeded titles never appear in any query API response (PRIV-03 / Pitfall 13); `issues` table has no `title` column at runtime. |
| `compose-smoke` | `docker compose up` reaches the dashboard at `:3000` within 5 minutes on a clean image (DEPLOY-01). |

Branch-protection should require all six jobs to pass before merge to `main`.

MIT licensed. Contributions welcome — see `CONTRIBUTING.md` (Phase 3).
