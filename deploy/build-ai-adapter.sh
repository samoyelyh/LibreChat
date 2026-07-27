#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

context="$ROOT_DIR/services/ai-quota-adapter"
require_file "$context/Dockerfile"
tag="woda/ai-quota-adapter:phase5-quota"
docker build --pull=false --tag "$tag" "$context"
image_id=$(docker image inspect --format '{{.Id}}' "$tag")
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  printf 'Built adapter image did not return an immutable image ID.\n' >&2
  exit 1
}

if grep -q '^AI_ADAPTER_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^AI_ADAPTER_IMAGE=.*|AI_ADAPTER_IMAGE=${image_id}|" "$ENV_FILE"
else
  printf 'AI_ADAPTER_IMAGE=%s\n' "$image_id" >> "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
printf 'Adapter image built and pinned by local image ID.\n'
