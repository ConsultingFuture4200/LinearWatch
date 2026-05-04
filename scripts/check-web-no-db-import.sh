#!/usr/bin/env bash
# API-07: the dashboard reads exclusively through the internal query API.
# No `pg`, `drizzle-orm`, or `drizzle-orm/node-postgres` import is permitted
# under packages/web/src/. Any direct DB driver import is a CI failure.
set -euo pipefail

WEB_SRC=packages/web/src
if [ ! -d "$WEB_SRC" ]; then
  echo "OK: $WEB_SRC does not exist yet — nothing to scan"
  exit 0
fi

MATCHES=$(grep -rEn "from ['\"](pg|drizzle-orm|drizzle-orm/node-postgres)['\"]" \
  "$WEB_SRC" \
  --include='*.ts' --include='*.tsx' \
  2>/dev/null || true)

if [ -n "$MATCHES" ]; then
  echo "FAIL: web component imports DB driver (API-07 violation):"
  echo "$MATCHES"
  exit 1
fi

echo "OK: no DB driver imports under $WEB_SRC"
