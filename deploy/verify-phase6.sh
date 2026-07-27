#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0

check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

check 'compose configuration' compose config --quiet
check 'phase6 seed first pass' "$DEPLOY_DIR/seed-phase6-agents.sh" seed
check 'phase6 seed idempotent second pass' "$DEPLOY_DIR/seed-phase6-agents.sh" seed
check 'phase6 agents, skills, ACLs, and deferred tools' \
  bash -lc "\"$DEPLOY_DIR/seed-phase6-agents.sh\" verify | grep -q PHASE6_AGENTS_OK"
check 'ordinary user sees shared Agents while Skill bodies stay redacted' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase6-api.js | grep -q PHASE6_API_OK"
check 'live MCP catalogs and write-tool filtering' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase6-live-tools.js | grep -q PHASE6_LIVE_TOOLS_OK"
check 'Lingxing write call remains denied at the gateway' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase4-actors.js | grep -q PHASE4_ACTOR_SECURITY_OK"
check 'user entry ready' curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/readyz"
check 'admin entry healthy' curl -fsS http://127.0.0.1:3000/health

if ((failures > 0)); then
  printf 'Phase 6 verification failed: %d check(s).\n' "$failures" >&2
  exit 1
fi

printf 'PHASE6_VERIFY_OK agents=3 writes=disabled\n'
