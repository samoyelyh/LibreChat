#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

context="$ROOT_DIR/services/lingxing-mcp-gateway"
require_file "$context/Dockerfile"
tag="woda/lingxing-mcp-gateway:phase8-security"
docker build --pull=false --tag "$tag" "$context"
image_id=$(docker image inspect --format '{{.Id}}' "$tag")
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  printf 'Built Lingxing gateway image did not return an immutable image ID.\n' >&2
  exit 1
}

if grep -q '^LINGXING_MCP_GATEWAY_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^LINGXING_MCP_GATEWAY_IMAGE=.*|LINGXING_MCP_GATEWAY_IMAGE=${image_id}|" "$ENV_FILE"
else
  printf 'LINGXING_MCP_GATEWAY_IMAGE=%s\n' "$image_id" >> "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
printf 'LingXing Phase 8 security gateway image built and pinned by local image ID.\n'
