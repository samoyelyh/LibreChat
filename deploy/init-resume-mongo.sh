#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

for name in RESUME_MCP_DB_USERNAME RESUME_MCP_DB_PASSWORD; do
  [[ -n "${!name:-}" ]] || {
    printf '%s is required in %s\n' "$name" "$ENV_FILE" >&2
    exit 1
  }
done

compose exec -T \
  -e RESUME_MCP_DB="${RESUME_MCP_DB:-resume_mcp_gateway}" \
  -e RESUME_MCP_DB_USERNAME="$RESUME_MCP_DB_USERNAME" \
  -e RESUME_MCP_DB_PASSWORD="$RESUME_MCP_DB_PASSWORD" \
  mongodb mongosh --quiet --file /dev/stdin \
  < "$DEPLOY_DIR/init-resume-mongo.js" \
  | grep -q RESUME_MONGO_USER_OK
printf 'Resume gateway MongoDB user is ready.\n'
