#!/usr/bin/env bash
# DEPLOY-01: docker compose up reaches dashboard :3000 within 5 minutes (300s).
set -euo pipefail
START=$(date +%s)
LIMIT=300

cleanup() { docker compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Inject minimum env vars to satisfy fail-fast checks.
export LINEAR_CLIENT_ID="smoke-client"
export LINEAR_CLIENT_SECRET="smoke-secret"
export LINEAR_WEBHOOK_SECRET="smoke-webhook-secret"
export LINEARWATCH_INTERNAL_API_KEY="smoke-internal-key"

docker compose up --build -d

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))
  if [ "$ELAPSED" -gt "$LIMIT" ]; then
    echo "FAIL: dashboard not reachable within ${LIMIT}s"
    docker compose logs --tail=200
    exit 1
  fi
  if curl -fsS http://localhost:3000 >/dev/null 2>&1 \
     && curl -fsS http://localhost:8080/health >/dev/null 2>&1; then
    echo "OK: dashboard + server reachable in ${ELAPSED}s"
    exit 0
  fi
  sleep 3
done
