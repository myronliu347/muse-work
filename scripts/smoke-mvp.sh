#!/usr/bin/env bash
# Muse Work MVP smoke: start server, hit health/providers/auth, create session.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> building @muse-work/provider && @muse-work/server"
pnpm -F @muse-work/provider build >/dev/null
pnpm -F @muse-work/server build >/dev/null

SERVER_LOG="$(mktemp)"
trap 'rm -f "$SERVER_LOG"; kill "$SERVER_PID" 2>/dev/null || true' EXIT

node packages/server/dist/index.js --port 0 >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

PORT=""
for _ in $(seq 1 50); do
  if grep -q '"ready":true' "$SERVER_LOG" 2>/dev/null; then
    PORT="$(grep '"ready":true' "$SERVER_LOG" | tail -1 | sed -E 's/.*"port":([0-9]+).*/\1/')"
    break
  fi
  sleep 0.1
done

if [[ -z "$PORT" ]]; then
  echo "FAIL: server did not print ready JSON"
  cat "$SERVER_LOG" >&2
  exit 1
fi

BASE="http://127.0.0.1:${PORT}"
echo "==> server ready at ${BASE}"

curl -sf "${BASE}/health" | grep -q '"ok":true'
echo "OK  GET /health"

curl -sf "${BASE}/providers" | grep -q '"codemaker"'
echo "OK  GET /providers"

curl -sf "${BASE}/auth/status" | grep -q '"state"'
echo "OK  GET /auth/status"

WORKDIR="$(mktemp -d)"
SESSION_JSON="$(curl -sf -X POST "${BASE}/sessions" \
  -H 'Content-Type: application/json' \
  -d "{\"workdir\":\"${WORKDIR}\"}")"
echo "$SESSION_JSON" | grep -q '"id"'
echo "OK  POST /sessions"

echo "==> smoke passed"
