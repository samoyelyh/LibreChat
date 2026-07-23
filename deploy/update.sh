#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

release_tag=${1:-}
shift || true
if [[ -z "$release_tag" || "$release_tag" == *latest* || $# -eq 0 ]]; then
  printf 'Usage: %s <explicit-release-tag> <service=immutable-image> [...]\n' "$0" >&2
  exit 2
fi

declare -A allowed=(
  [nginx]=1 [api]=1 [admin-panel]=1 [mongodb]=1 [meilisearch]=1 [vectordb]=1 [rag-api]=1
  [redis]=1 [ai-quota-adapter]=1 [sellersprite-mcp-gateway]=1 [lingxing-mcp-gateway]=1
)
mkdir -p "$DEPLOY_DIR/runtime"
tmp=$(mktemp "$DEPLOY_DIR/runtime/images.override.XXXXXX")
trap 'rm -f "$tmp"' EXIT
printf 'services:\n' > "$tmp"

for mapping in "$@"; do
  service=${mapping%%=*}
  image=${mapping#*=}
  if [[ -z "${allowed[$service]:-}" || "$image" == *latest* ]]; then
    printf 'Invalid immutable image mapping: %s\n' "$mapping" >&2
    exit 2
  fi
  immutable=false
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] && immutable=true
  [[ "$service" == ai-quota-adapter && "$image" =~ ^sha256:[0-9a-f]{64}$ ]] && immutable=true
  [[ "$service" == sellersprite-mcp-gateway && "$image" =~ ^sha256:[0-9a-f]{64}$ ]] && immutable=true
  [[ "$service" == lingxing-mcp-gateway && "$image" =~ ^sha256:[0-9a-f]{64}$ ]] && immutable=true
  [[ "$service" == api && "$image" =~ ^sha256:[0-9a-f]{64}$ ]] && immutable=true
  if [[ "$immutable" != true ]]; then
    printf 'Invalid immutable image mapping: %s\n' "$mapping" >&2
    exit 2
  fi
  printf '  %s:\n    image: %s\n' "$service" "$image" >> "$tmp"
done

backup_dir=$($DEPLOY_DIR/backup.sh)
mv "$tmp" "$OVERRIDE_FILE"
trap - EXIT
printf '%s\n' "$release_tag" > "$DEPLOY_DIR/runtime/release-tag"
compose config --quiet
while IFS= read -r image; do
  if [[ "$image" == sha256:* ]]; then
    docker image inspect "$image" >/dev/null
  else
    docker pull "$image"
  fi
done < <(compose config --images | sort -u)
compose up -d --remove-orphans
printf 'Updated release %s. Rollback source: %s\n' "$release_tag" "$backup_dir"
