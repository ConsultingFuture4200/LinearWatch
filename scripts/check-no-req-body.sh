#!/usr/bin/env bash
# OBS-04: req.body / request.body must never appear in production source code.
# Test files allowed to use req.body for fixtures; production paths must use req.rawBody.
set -euo pipefail

# Each glob is optional — early-phase packages may not exist yet.
SEARCH_DIRS=()
for d in packages/server/src packages/web/src packages/shared/src; do
  if [ -d "$d" ]; then
    SEARCH_DIRS+=("$d")
  fi
done

if [ ${#SEARCH_DIRS[@]} -eq 0 ]; then
  echo "OK: no production source dirs to scan yet"
  exit 0
fi

# Match `req.body` / `request.body` in production code, but exclude:
# - `rawBody` (the canonical raw-buffer field)
# - JSDoc / line comments (lines whose first non-whitespace is `*` or `//`)
# - `Object.keys(req.body)` / `Object.keys(request.body)` — keys, not values
# - lines explicitly annotated `// allow-req-body: <reason>` for audited cases
#   (e.g., the D-29 request-logger plugin reads top-level key names only)
MATCHES=$(grep -rnE "req\.body|request\.body" \
  "${SEARCH_DIRS[@]}" \
  --include='*.ts' --include='*.tsx' \
  2>/dev/null \
  | grep -v 'rawBody' \
  | grep -vE ':[[:space:]]*\*' \
  | grep -vE ':[[:space:]]*//' \
  | grep -vE 'Object\.keys\((req|request)\.body\)' \
  | grep -v 'allow-req-body' \
  || true)

if [ -n "$MATCHES" ]; then
  echo "FAIL: req.body / request.body found in production code:"
  echo "$MATCHES"
  exit 1
fi
echo "OK: no req.body in production code"
