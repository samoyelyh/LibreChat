#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

set_env() {
  local name=$1
  local value=$2
  if grep -q "^${name}=" "$ENV_FILE"; then
    sed -i "s|^${name}=.*|${name}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$name" "$value" >> "$ENV_FILE"
  fi
}

# No Lingxing user key is requested here. Users add it after login.
set_env LINGXING_MCP_URL "https://openmcp.lingxing.com/mcp-servers/lingxing-mcp"
set_env LINGXING_MCP_INTERNAL_KEY "$(openssl rand -hex 32)"
set_env LINGXING_MCP_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
set_env LINGXING_MCP_GATEWAY_PORT "4300"
set_env LINGXING_MCP_DB "lingxing_mcp_gateway"
set_env LINGXING_MCP_DB_USERNAME "lingxing_gateway"
# Hex avoids URI-reserved characters because Compose embeds this value in the
# MongoDB connection string.
set_env LINGXING_MCP_DB_PASSWORD "$(openssl rand -hex 36)"
set_env LINGXING_MCP_TIMEOUT_MS "120000"
set_env LINGXING_MCP_AUDIT_RETENTION_DAYS "365"
set_env PHASE4_LINGXING_ENABLED "true"
chmod 0600 "$ENV_FILE"

"$DEPLOY_DIR/build-lingxing-gateway.sh"
"$DEPLOY_DIR/build-librechat-phase4.sh"
printf 'PHASE4_ENV_AND_IMAGES_READY\n'
