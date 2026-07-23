#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

command=${1:-status}
shift || true
case "$command" in
  status|test|audits|credential-sync)
    compose exec -T sellersprite-mcp-gateway node dist/cli/admin.js "$command" "$@"
    ;;
  *)
    printf 'Usage: %s <status|test|audits [limit]|credential-sync --operator value>\n' "$0" >&2
    exit 2
    ;;
esac
