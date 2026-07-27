#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

case "${1:-seed}" in
  seed)
    compose exec -T api node /app/deploy/seed-phase6-agents.js
    ;;
  verify)
    compose exec -T api node /app/deploy/seed-phase6-agents.js --verify
    ;;
  *)
    printf 'Usage: %s [seed|verify]\n' "$0" >&2
    exit 2
    ;;
esac
