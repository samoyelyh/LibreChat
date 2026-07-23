#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT_DIR=$(cd "$DEPLOY_DIR/.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-$DEPLOY_DIR/docker-compose.production.yml}
ENV_FILE=${ENV_FILE:-$DEPLOY_DIR/.env}
OVERRIDE_FILE=${OVERRIDE_FILE:-$DEPLOY_DIR/runtime/images.override.yml}

require_file() {
  local path=$1
  [[ -f "$path" ]] || {
    printf 'Required file is missing: %s\n' "$path" >&2
    exit 1
  }
}

compose() {
  local files=(-f "$COMPOSE_FILE")
  [[ ! -f "$OVERRIDE_FILE" ]] || files+=(-f "$OVERRIDE_FILE")
  docker compose --env-file "$ENV_FILE" "${files[@]}" "$@"
}

require_runtime() {
  command -v docker >/dev/null
  docker compose version >/dev/null
  require_file "$ENV_FILE"
  require_file "$COMPOSE_FILE"
  if grep -q 'LOCK_PENDING' "$COMPOSE_FILE"; then
    printf 'Refusing to continue: production image digests are not fully locked.\n' >&2
    exit 1
  fi
  [[ "$(stat -c %a "$ENV_FILE")" == 600 ]] || {
    printf 'Refusing to continue: %s must have mode 0600.\n' "$ENV_FILE" >&2
    exit 1
  }
}
