#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_file "$ENV_FILE"

probe_file=${NEW_API_PROBE_ENV:-/home/woda/.config/cross-border-ai/newapi-probe.env}
require_file "$probe_file"
[[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || {
  printf '%s must have mode 0600.\n' "$ENV_FILE" >&2
  exit 1
}
[[ "$(stat -c %a "$probe_file")" == 600 ]] || {
  printf '%s must have mode 0600.\n' "$probe_file" >&2
  exit 1
}

# shellcheck disable=SC1090
source "$probe_file"
: "${NEWAPI_ADMIN_ACCESS_TOKEN:?NEWAPI_ADMIN_ACCESS_TOKEN is required in the protected probe file}"
: "${NEWAPI_ADMIN_USER_ID:?NEWAPI_ADMIN_USER_ID is required in the protected probe file}"

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

set_value AI_GATEWAY_ADMIN_TOKEN "$NEWAPI_ADMIN_ACCESS_TOKEN"
set_value NEW_API_ADMIN_USER_ID "$NEWAPI_ADMIN_USER_ID"
ensure_value AI_DEFAULT_USER_QUOTA 0
ensure_value AI_DEFAULT_ALLOWED_MODELS gpt-5.6-sol
chmod 0600 "$ENV_FILE"

printf 'Phase 5 quota environment is ready; secret values were not printed.\n'
