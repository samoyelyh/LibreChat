#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

compose config --quiet
"$DEPLOY_DIR/seed-resume-agent.sh" seed >/dev/null
"$DEPLOY_DIR/seed-resume-agent.sh" seed >/dev/null
"$DEPLOY_DIR/seed-resume-agent.sh" verify
compose exec -T api node /app/deploy/verify-resume-mcp.js

container=$(compose ps -q resume-mcp-gateway)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container")
[[ "$health" == healthy ]] || {
  printf 'Resume MCP gateway health=%s\n' "$health" >&2
  exit 1
}

if compose ps --format json | python3 -c '
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
gateway = next((row for row in rows if row["Service"] == "resume-mcp-gateway"), None)
raise SystemExit(1 if not gateway or any(int(p.get("PublishedPort") or 0) for p in gateway.get("Publishers") or []) else 0)
'; then
  printf 'RESUME_VERIFY_OK agent=1 reads=6 writes=0 publicPorts=0\n'
else
  printf 'Resume MCP gateway exposes a host port\n' >&2
  exit 1
fi
