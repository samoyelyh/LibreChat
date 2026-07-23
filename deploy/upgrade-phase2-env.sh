#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_file "$ENV_FILE"
[[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || {
  printf '%s must have mode 0600.\n' "$ENV_FILE" >&2
  exit 1
}

set_value() {
  local key=$1 value=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_value() {
  local key=$1 value=$2 current
  current=$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)
  [[ -n "$current" ]] || set_value "$key" "$value"
}

ensure_value AI_ADAPTER_DB_NAME ai_quota_adapter
ensure_value AI_ADAPTER_DB_USERNAME ai_adapter
ensure_value AI_ADAPTER_DB_PASSWORD "$(openssl rand -hex 32)"
ensure_value REDIS_PASSWORD "$(openssl rand -hex 32)"
ensure_value AI_TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
ensure_value AI_ADAPTER_INTERNAL_KEY "$(openssl rand -hex 32)"
ensure_value NEW_API_BASE_URL https://api.aso8ty.com/v1
ensure_value AI_ADAPTER_PORT 4100
ensure_value NEW_API_REQUEST_TIMEOUT_MS 120000
ensure_value AI_ADAPTER_REQUESTS_PER_MINUTE 30
ensure_value AI_ADAPTER_MAX_CONCURRENT_REQUESTS 2
ensure_value AI_ADAPTER_AUDIT_RETENTION_DAYS 90
ensure_value AI_ADAPTER_TEST_MODEL kimi-k2
ensure_value RUN_BILLABLE_PHASE2_TESTS false
grep -q '^AI_ADAPTER_IMAGE=' "$ENV_FILE" || printf 'AI_ADAPTER_IMAGE=\n' >> "$ENV_FILE"

chmod 0600 "$ENV_FILE"
printf 'Phase 2 environment values are present. Secret values were not printed.\n'
