#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

context="$ROOT_DIR/services/sellersprite-mcp-gateway"
require_file "$context/Dockerfile"
tag="woda/sellersprite-mcp-gateway:phase8-security"
docker build --pull=false --tag "$tag" "$context"
image_id=$(docker image inspect --format '{{.Id}}' "$tag")
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  printf 'Built SellerSprite gateway image did not return an immutable image ID.\n' >&2
  exit 1
}

if grep -q '^SELLERSPRITE_MCP_GATEWAY_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^SELLERSPRITE_MCP_GATEWAY_IMAGE=.*|SELLERSPRITE_MCP_GATEWAY_IMAGE=${image_id}|" "$ENV_FILE"
else
  printf 'SELLERSPRITE_MCP_GATEWAY_IMAGE=%s\n' "$image_id" >> "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
printf 'SellerSprite Phase 8 security gateway image built and pinned by local image ID.\n'
