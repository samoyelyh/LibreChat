#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if compose config --quiet; then pass 'Compose configuration is valid'; else fail 'Compose configuration failed'; fi

container=$(compose ps -q lingxing-mcp-gateway)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)
[[ "$health" == healthy ]] && pass 'Lingxing gateway is healthy' || fail "Lingxing gateway health is ${health:-missing}"

api_image=$(compose config --images | sed -n '2p' || true)
if [[ "$LIBRECHAT_IMAGE" =~ ^sha256:[0-9a-f]{64}$ ]] && docker image inspect "$LIBRECHAT_IMAGE" >/dev/null 2>&1; then
  pass 'LibreChat Phase 4 image is pinned by immutable local ID'
else
  fail 'LibreChat Phase 4 image is not pinned'
fi

if grep -q "^  lingxing-mcp:$" "$ROOT_DIR/config/librechat.yaml" \
  && grep -q "url: 'http://lingxing-mcp-gateway:4300/mcp'" "$ROOT_DIR/config/librechat.yaml" \
  && grep -q "'lingxing-mcp-gateway:4300'" "$ROOT_DIR/config/librechat.yaml"; then
  pass 'LibreChat Lingxing MCP configuration is present'
else
  fail 'LibreChat Lingxing MCP configuration is incomplete'
fi

status=$(curl -sS -o /tmp/phase4-unauth.json -w '%{http_code}' \
  "http://127.0.0.1:${USER_PORT:-7999}/api/lingxing/status" || true)
if [[ "$status" == 401 ]] && grep -q unauthorized /tmp/phase4-unauth.json; then
  pass 'Credential API rejects anonymous access'
else
  fail "Credential API anonymous status was $status"
fi
rm -f /tmp/phase4-unauth.json

if compose exec -T api node /app/deploy/verify-phase4-actors.js; then
  pass 'Actor binding, write deny and encrypted-at-rest checks passed'
else
  fail 'Actor security checks failed'
fi

if "$DEPLOY_DIR/seed-phase4-rbac.sh" verify | grep -q PHASE4_RBAC_OK; then
  pass 'Phase 4 MCP role permissions are idempotent'
else
  fail 'Phase 4 RBAC verification failed'
fi

published=$(compose config | awk '
  /^  [a-zA-Z0-9_-]+:$/ {service=$1; gsub(/:/,"",service)}
  /^[[:space:]]+published:/ {gsub(/"/,"",$2); print service ":" $2}
')
if grep -Eq ':(4300|27017|7700|5432|8000|4100|4200)$' <<<"$published"; then
  fail 'An internal service port is publicly exposed'
else
  pass 'Lingxing and other internal ports are not published'
fi

if compose logs --no-color lingxing-mcp-gateway \
  | grep -Eiq '(x-mcp-key|authorization":|"key":"[^[]|ciphertext":"[^[])'; then
  fail 'Potential secret material found in Lingxing logs'
else
  pass 'Lingxing logs contain no credential/header values'
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'PHASE4_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi
printf 'PHASE4_VERIFY_OK\n'
