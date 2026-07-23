#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

mode=${1:-seed}
case "$mode" in
  seed)
    compose exec -T api node /app/deploy/seed-phase1-rbac.js
    ;;
  verify)
    compose exec -T api node /app/deploy/seed-phase1-rbac.js --verify
    ;;
  *)
    printf 'Usage: %s [seed|verify]\n' "$0" >&2
    exit 2
    ;;
esac
