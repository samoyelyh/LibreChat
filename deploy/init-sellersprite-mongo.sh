#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

for name in SELLERSPRITE_MCP_DB_USERNAME SELLERSPRITE_MCP_DB_PASSWORD; do
  [[ -n "${!name:-}" ]] || {
    printf '%s is required in %s\n' "$name" "$ENV_FILE" >&2
    exit 1
  }
done

compose exec -T \
  -e SELLERSPRITE_MCP_DB="${SELLERSPRITE_MCP_DB:-sellersprite_mcp_gateway}" \
  -e SELLERSPRITE_MCP_DB_USERNAME="$SELLERSPRITE_MCP_DB_USERNAME" \
  -e SELLERSPRITE_MCP_DB_PASSWORD="$SELLERSPRITE_MCP_DB_PASSWORD" \
  mongodb mongosh --quiet /opt/woda/init-sellersprite-mongo.js \
  | grep -q SELLERSPRITE_MONGO_USER_OK
printf 'SellerSprite gateway MongoDB user is ready.\n'
