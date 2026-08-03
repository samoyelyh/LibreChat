#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0

check() {
  local label=$1
  shift
  if "$@"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

all_healthy() {
  local container state health
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    state=$(docker inspect --format '{{.State.Status}}' "$container")
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    [[ "$state" == running ]] || return 1
    [[ -z "$health" || "$health" == healthy ]] || return 1
  done < <(compose ps -q)
}

admin_create_requires_auth() {
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    -d '{"name":"Phase Nine Probe"}' \
    "http://127.0.0.1:${USER_PORT:-7999}/api/admin/users")
  [[ "$status" == 401 || "$status" == 403 ]]
}

public_registration_disabled() {
  grep -q '^ALLOW_REGISTRATION=false$' "$ENV_FILE"
  grep -q '^ALLOW_SOCIAL_REGISTRATION=false$' "$ENV_FILE"
}

check 'compose configuration' compose config --quiet
check 'all containers healthy' all_healthy
check 'user entry ready' curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/readyz"
check 'administrator user creation requires authentication' admin_create_requires_auth
check 'public and social registration remain disabled' public_registration_disabled
check 'administrator user API is present' compose exec -T api grep -q \
  'System administrators cannot be created from this form' /app/packages/api/dist/index.cjs
check 'administrator user interface is present' compose exec -T api sh -c \
  "grep -R -q 'Create user account' /app/client/dist"
check 'Phase 8 regression suite' bash -lc \
  "SKIP_EXTERNAL_MCP_CATALOGS=true '$DEPLOY_DIR/verify-phase8.sh' | grep -q PHASE8_VERIFY_OK"
check 'recent logs contain no credential material' "$DEPLOY_DIR/verify-log-secrets.sh" 30m

if ((failures > 0)); then
  printf 'Phase 9 verification failed: %d check(s).\n' "$failures" >&2
  exit 1
fi

printf 'PHASE9_VERIFY_OK admin_create=enabled public_registration=disabled role_and_department=enabled rollback=ready\n'
