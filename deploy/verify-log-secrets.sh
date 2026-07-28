#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

since=${1:-30m}
umask 077
log_file=$(mktemp)
trap 'rm -f "$log_file"' EXIT

compose logs --since "$since" --no-color >"$log_file" 2>&1

set -a
source "$ENV_FILE"
set +a

secret_names=(
  AI_GATEWAY_ADMIN_TOKEN
  AI_TOKEN_ENCRYPTION_KEY
  AI_ADAPTER_INTERNAL_KEY
  MONGO_ROOT_PASSWORD
  JWT_SECRET
  JWT_REFRESH_SECRET
  CREDS_KEY
  CREDS_IV
  MEILI_MASTER_KEY
  POSTGRES_PASSWORD
  ADMIN_PANEL_SESSION_SECRET
  REDIS_PASSWORD
  SELLERSPRITE_MCP_SECRET_KEY
  SELLERSPRITE_MCP_INTERNAL_KEY
  SELLERSPRITE_MCP_DB_PASSWORD
  LINGXING_MCP_INTERNAL_KEY
  LINGXING_MCP_ENCRYPTION_KEY
  LINGXING_MCP_DB_PASSWORD
)

for name in "${secret_names[@]}"; do
  value=${!name:-}
  if [[ ${#value} -ge 8 ]] && grep -Fq -- "$value" "$log_file"; then
    printf 'Credential value from %s was found in recent logs.\n' "$name" >&2
    exit 1
  fi
done

if grep -Eqi \
  '(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|authorization[^[:alnum:]]{0,12}bearer[[:space:]]+[A-Za-z0-9._~-]{8,})' \
  "$log_file"; then
  printf 'A private key or bearer credential pattern was found in recent logs.\n' >&2
  exit 1
fi

printf 'LOG_SECRET_SCAN_OK since=%s exact_values=checked\n' "$since"
