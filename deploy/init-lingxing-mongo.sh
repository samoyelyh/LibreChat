#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

for name in LINGXING_MCP_DB_USERNAME LINGXING_MCP_DB_PASSWORD; do
  [[ -n "${!name:-}" ]] || {
    printf '%s is required in %s\n' "$name" "$ENV_FILE" >&2
    exit 1
  }
done

compose exec -T \
  -e LINGXING_MCP_DB="${LINGXING_MCP_DB:-lingxing_mcp_gateway}" \
  -e LINGXING_MCP_DB_USERNAME="$LINGXING_MCP_DB_USERNAME" \
  -e LINGXING_MCP_DB_PASSWORD="$LINGXING_MCP_DB_PASSWORD" \
  mongodb mongosh --quiet /opt/woda/init-lingxing-mongo.js \
  | grep -q LINGXING_MONGO_USER_OK
printf 'Lingxing gateway MongoDB user is ready.\n'
