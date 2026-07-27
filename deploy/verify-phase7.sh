#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0

check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

gateway_fixture='
const mod = await import("/app/dist/structured-result.js");
const output = mod.structureToolCallBody({
  text: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {content: [{type: "text", text: JSON.stringify({data: [
      {date: "2026-07-01", sales: 10},
      {date: "2026-07-02", sales: 15}
    ]})}]}
  }),
  contentType: "application/json",
  calls: [{id: 1, tool: "fixture_read"}],
  provider: process.env.PROVIDER,
  requestId: "phase7-fixture",
  elapsedMs: 1
});
const result = JSON.parse(output).result.structuredContent;
if (!result.success || result.rows.length !== 2 || result.chartSuggestions[0].type !== "line") {
  process.exit(1);
}
'

seller_image=$(compose images -q sellersprite-mcp-gateway | head -n 1)
lingxing_image=$(compose images -q lingxing-mcp-gateway | head -n 1)
librechat_image=$(compose images -q api | head -n 1)

check 'compose configuration' compose config --quiet
check 'phase7 agent seed first pass' "$DEPLOY_DIR/seed-phase6-agents.sh" seed
check 'phase7 agent seed idempotent second pass' "$DEPLOY_DIR/seed-phase6-agents.sh" seed
check 'phase7 agent call steps, skills, ACLs, and read-only boundaries' \
  bash -lc "\"$DEPLOY_DIR/seed-phase6-agents.sh\" verify | grep -q PHASE6_AGENTS_OK"
check 'ordinary user sees shared Agents while Skill bodies stay redacted' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase6-api.js | grep -q PHASE6_API_OK"
check 'live MCP catalogs and write-tool filtering' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase6-live-tools.js | grep -q PHASE6_LIVE_TOOLS_OK"
check 'LingXing write call remains denied at the gateway' \
  bash -lc "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase4-actors.js | grep -q PHASE4_ACTOR_SECURITY_OK"
check 'SellerSprite deterministic structured fixture' \
  docker run --rm --entrypoint node -e PROVIDER=sellersprite "$seller_image" \
    --input-type=module -e "$gateway_fixture"
check 'LingXing deterministic structured fixture' \
  docker run --rm --entrypoint node -e PROVIDER=lingxing "$lingxing_image" \
    --input-type=module -e "$gateway_fixture"
check 'structured frontend bundle present' \
  docker run --rm --entrypoint sh "$librechat_image" -c \
    "grep -R -q 'ecommerce-tool-result' /app/client/dist"
check 'user entry ready' curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/readyz"
check 'admin entry healthy' curl -fsS http://127.0.0.1:3000/health

if ((failures > 0)); then
  printf 'Phase 7 verification failed: %d check(s).\n' "$failures" >&2
  exit 1
fi

printf 'PHASE7_VERIFY_OK structured=metrics,table,line,bar,pie,scatter,exports sources=2 writes=disabled\n'
