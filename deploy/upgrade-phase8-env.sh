#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_file "$ENV_FILE"
[[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || {
  printf '%s must have mode 0600.\n' "$ENV_FILE" >&2
  exit 1
}

set_value() {
  local key=$1 value=$2 temporary
  temporary=$(mktemp "${ENV_FILE}.XXXXXX")
  grep -v "^${key}=" "$ENV_FILE" > "$temporary" || true
  printf '%s=%s\n' "$key" "$value" >> "$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$ENV_FILE"
}

ensure_value() {
  local key=$1 value=$2 current
  current=$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1)
  [[ -n "$current" ]] || set_value "$key" "$value"
}

ensure_value AI_ADAPTER_SIGNATURE_TOLERANCE_MS 30000
ensure_value SELLERSPRITE_MCP_SIGNATURE_TOLERANCE_MS 30000
ensure_value SELLERSPRITE_MCP_REQUESTS_PER_MINUTE 60
ensure_value LINGXING_MCP_SIGNATURE_TOLERANCE_MS 30000
ensure_value LINGXING_MCP_REQUESTS_PER_MINUTE 60
chmod 0600 "$ENV_FILE"

printf 'Phase 8 security environment values are present; no secret was printed.\n'
