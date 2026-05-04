#!/usr/bin/env bash
# D-26 / Pitfall 13: the `issues` schema must declare `title_hash` and NOT a
# raw `title` column. Static grep is the first line of defense; the runtime
# integration test (no-title-column.test.ts) is the second.
set -euo pipefail

SCHEMA=packages/db/src/schema/issues.ts
if [ ! -f "$SCHEMA" ]; then
  echo "FAIL: $SCHEMA not found"
  exit 1
fi

# The TitleHash brand reference must be present (any of the three idiomatic spellings).
if ! grep -qE 'titleHash|title_hash|TitleHash' "$SCHEMA"; then
  echo "FAIL: $SCHEMA missing TitleHash brand reference"
  exit 1
fi

# Disallow raw title column declarations like `title: text(`, `title: varchar(`, `title: string`.
# `title_hash` and `titleHash` are NOT matched (the negative lookbehind is
# emulated by requiring whitespace+colon immediately after the bare word `title`).
# Skip JSDoc/line comments (lines whose first non-whitespace is `*` or `//`).
BAD=$(grep -nE '\btitle\s*:\s*text\(|\btitle\s*:\s*varchar\(|\btitle\s*:\s*string' "$SCHEMA" \
  | grep -vE ':[[:space:]]*\*' \
  | grep -vE ':[[:space:]]*//' \
  || true)
if [ -n "$BAD" ]; then
  echo "FAIL: $SCHEMA appears to declare a raw title column:"
  echo "$BAD"
  exit 1
fi

# Migration SQL must not declare a `title text` / `title varchar` column on issues.
# Scan every committed migration file and look for an `issues` CREATE TABLE
# block followed by a `title text` / `title varchar` column line.
MIGRATIONS_DIR=packages/db/migrations
if [ -d "$MIGRATIONS_DIR" ]; then
  for f in "$MIGRATIONS_DIR"/*.sql; do
    [ -f "$f" ] || continue
    # Use awk to extract the issues CREATE TABLE block(s) and grep for a bare title column.
    BLOCK_BAD=$(awk '
      /CREATE TABLE[[:space:]]+(IF NOT EXISTS[[:space:]]+)?(public\.)?issues[[:space:]]*\(/, /^\)/ { print }
    ' "$f" | grep -nE '^\s*title\s+(text|varchar|character)' || true)
    if [ -n "$BLOCK_BAD" ]; then
      echo "FAIL: $f declares a raw title column on issues:"
      echo "$BLOCK_BAD"
      exit 1
    fi
  done
fi

echo "OK: issues schema has title_hash; no title column."
