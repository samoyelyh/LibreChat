#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
failures=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if compose config --quiet; then pass 'Compose configuration is valid'; else fail 'Compose configuration is invalid'; fi

container=$(compose ps -q sellersprite-mcp-gateway)
health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container" 2>/dev/null || true)
if [[ "$health" == healthy ]]; then pass 'SellerSprite MCP gateway is healthy'; else fail "Gateway health=$health"; fi

if compose ps --format json | python3 -c '
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
gateway = next((row for row in rows if row["Service"] == "sellersprite-mcp-gateway"), None)
raise SystemExit(1 if not gateway or any(int(p.get("PublishedPort") or 0) for p in gateway.get("Publishers") or []) else 0)
'; then pass 'SellerSprite gateway has no published host port'; else fail 'Gateway port is publicly exposed'; fi

if grep -q "^  sellersprite-mcp:$" "$ROOT_DIR/config/librechat.yaml" \
  && grep -q "url: 'http://sellersprite-mcp-gateway:4200/mcp'" "$ROOT_DIR/config/librechat.yaml" \
  && grep -q "X-MCP-Gateway-Key: '\${SELLERSPRITE_MCP_INTERNAL_KEY}'" "$ROOT_DIR/config/librechat.yaml" \
  && ! grep -q '^  mcpServers:$' "$ROOT_DIR/config/librechat.yaml" \
  && ! grep -q 'customUserVars' "$ROOT_DIR/config/librechat.yaml" \
  && ! grep -q 'secret-key:' "$ROOT_DIR/config/librechat.yaml"; then
  pass 'LibreChat uses the internal gateway with no user credential form'
else
  fail 'LibreChat SellerSprite server configuration is unsafe or incomplete'
fi

if "$DEPLOY_DIR/seed-phase3-rbac.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-phase3-rbac.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-phase3-rbac.sh" verify; then
  pass 'Phase 3 RBAC seed is idempotent'
else
  fail 'Phase 3 RBAC verification failed'
fi

if compose exec -T api node /app/deploy/verify-phase3-actors.js; then
  pass 'Authorized admin and operations user are accepted'
else
  fail 'SellerSprite actor authorization failed'
fi

if compose exec -T sellersprite-mcp-gateway node -e "
fetch('http://127.0.0.1:4200/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
  .then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))
"; then pass 'Gateway rejects missing internal authentication'; else fail 'Gateway accepted missing auth'; fi

status_file=$(mktemp)
logs_file=$(mktemp)
config_file=$(mktemp)
trap 'rm -f "$status_file" "$logs_file" "$config_file"' EXIT
compose exec -T sellersprite-mcp-gateway node dist/cli/admin.js status > "$status_file"
if python3 - "$status_file" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
assert data["configured"] is True
assert len(data["fingerprintLast4"]) == 4
assert data["lastConnectionTestOk"] is True
assert data["lastToolCount"] > 0
assert data["monthlyCallCount"] >= 0
assert data["usageRatio"] is None or data["usageRatio"] >= 0
PY
then pass 'Admin status is safe and the latest connection test passed'; else fail 'Admin status/test metadata is invalid'; fi

# shellcheck disable=SC1090
source "$ENV_FILE"
compose logs --no-color > "$logs_file"
curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/api/config" > "$config_file"
for name in SELLERSPRITE_MCP_SECRET_KEY SELLERSPRITE_MCP_INTERNAL_KEY SELLERSPRITE_MCP_DB_PASSWORD; do
  value=${!name:-}
  if [[ -z "$value" ]]; then
    fail "$name is empty"
    continue
  fi
  git -C "$ROOT_DIR" grep -Fq -- "$value" -- . 2>/dev/null && fail "$name appears in a tracked file"
  grep -Fq -- "$value" "$logs_file" && fail "$name appears in container logs"
  grep -Fq -- "$value" "$config_file" && fail "$name appears in the public config response"
done
if ! grep -Fq -- "$SELLERSPRITE_MCP_SECRET_KEY" "$logs_file" \
  && ! grep -Fq -- "$SELLERSPRITE_MCP_SECRET_KEY" "$config_file"; then
  pass 'SellerSprite secret is absent from logs and public config'
fi

if [[ "$failures" -ne 0 ]]; then
  printf 'PHASE3_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi
printf 'PHASE3_VERIFY_OK\n'
