#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if compose config --quiet; then
  pass 'Compose configuration is valid'
else
  fail 'Compose configuration failed'
fi

container=$(compose ps -q ai-quota-adapter)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null || true)
[[ "$health" == healthy ]] && pass 'AI quota adapter is healthy' || fail "AI quota adapter health is ${health:-missing}"

first=$("$DEPLOY_DIR/provision-phase5-users.sh")
second=$("$DEPLOY_DIR/provision-phase5-users.sh")
if grep -q '"success":true' <<<"$first" && grep -q '"success":true' <<<"$second"; then
  pass 'Existing-user personal account provisioning is idempotent'
else
  fail 'Existing-user personal account provisioning failed'
fi

if compose exec -T api node /app/deploy/verify-phase5-quota-api.js | grep -q PHASE5_QUOTA_API_OK; then
  pass 'Zero-quota policy, isolation, redaction, and idempotency checks passed'
else
  fail 'Quota API security verification failed'
fi

status=$(curl -sS -o /tmp/phase5-quota-anonymous.json -w '%{http_code}' \
  "http://127.0.0.1:${USER_PORT:-7999}/api/ai-quota/summary" || true)
if [[ "$status" == 401 ]]; then
  pass 'Quota summary rejects anonymous access'
else
  fail "Anonymous quota summary returned HTTP $status"
fi
rm -f /tmp/phase5-quota-anonymous.json

if [[ -z "$(compose exec -T api sh -lc 'printf %s "${AI_GATEWAY_ADMIN_TOKEN:-}${AI_TOKEN_ENCRYPTION_KEY:-}"')" ]]; then
  pass 'New API administrator and encryption credentials are absent from LibreChat API'
else
  fail 'Adapter-only credentials leaked into LibreChat API environment'
fi

published=$(compose config | awk '
  /^  [a-zA-Z0-9_-]+:$/ {service=$1; gsub(/:/,"",service)}
  /^[[:space:]]+published:/ {gsub(/"/,"",$2); print service ":" $2}
')
if grep -Eq ':(4100|27017|6379)$' <<<"$published"; then
  fail 'An AI quota internal service port is publicly exposed'
else
  pass 'AI quota adapter, MongoDB, and Redis ports remain internal'
fi

if compose logs --no-color ai-quota-adapter \
  | grep -Eiq '(encryptedManagementToken|managementToken|runtimeToken|authorization":|"AI_GATEWAY_ADMIN_TOKEN")'; then
  fail 'Potential credential material found in AI quota adapter logs'
else
  pass 'AI quota adapter logs contain no credential values'
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'PHASE5_QUOTA_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi
printf 'PHASE5_QUOTA_VERIFY_OK\n'
