#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0
backup_dir=${1:-$(find "$DEPLOY_DIR/backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1)}

check() {
  local label=$1
  shift
  if "$@"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label" >&2
    failures=$((failures + 1))
  fi
}

all_healthy() {
  local container state health
  while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    state=$(docker inspect --format '{{.State.Status}}' "$container")
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container")
    [[ "$state" == running ]] || return 1
    [[ -z "$health" || "$health" == healthy ]] || return 1
  done < <(compose ps -q)
}

mcp_network_isolated() {
  local nginx seller lingxing nginx_networks seller_networks lingxing_networks
  nginx=$(compose ps -q nginx)
  seller=$(compose ps -q sellersprite-mcp-gateway)
  lingxing=$(compose ps -q lingxing-mcp-gateway)
  [[ "$(docker network inspect woda-cross-border-ai_mcp --format '{{.Internal}}')" == true ]]
  [[ "$(docker network inspect woda-cross-border-ai_lingxing_control --format '{{.Internal}}')" == true ]]
  [[ "$(docker network inspect woda-cross-border-ai_sellersprite_egress --format '{{.Internal}}')" == false ]]
  [[ "$(docker network inspect woda-cross-border-ai_lingxing_egress --format '{{.Internal}}')" == false ]]
  nginx_networks=$(docker inspect "$nginx" --format '{{json .NetworkSettings.Networks}}')
  seller_networks=$(docker inspect "$seller" --format '{{json .NetworkSettings.Networks}}')
  lingxing_networks=$(docker inspect "$lingxing" --format '{{json .NetworkSettings.Networks}}')
  grep -q '"woda-cross-border-ai_lingxing_control"' <<<"$nginx_networks"
  ! grep -q '"woda-cross-border-ai_mcp"' <<<"$nginx_networks"
  ! grep -q '"woda-cross-border-ai_edge"' <<<"$seller_networks"
  ! grep -q '"woda-cross-border-ai_edge"' <<<"$lingxing_networks"
  ! grep -q '"woda-cross-border-ai_lingxing_control"' <<<"$seller_networks"
  grep -q '"woda-cross-border-ai_lingxing_control"' <<<"$lingxing_networks"
  grep -q '"woda-cross-border-ai_sellersprite_egress"' <<<"$seller_networks"
  ! grep -q '"woda-cross-border-ai_lingxing_egress"' <<<"$seller_networks"
  grep -q '"woda-cross-border-ai_lingxing_egress"' <<<"$lingxing_networks"
  ! grep -q '"woda-cross-border-ai_sellersprite_egress"' <<<"$lingxing_networks"
}

librechat_file_storage_persistent() {
  local api_container mounts
  api_container=$(compose ps -q api)
  mounts=$(docker inspect --format '{{range .Mounts}}{{println .Destination .Type}}{{end}}' "$api_container")
  grep -qx '/app/client/public/images volume' <<<"$mounts"
  grep -qx '/app/uploads volume' <<<"$mounts"
}

approved_ports_only() {
  local actual expected
  actual=$(
    while IFS= read -r container; do
      docker inspect --format \
        '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{println .HostPort}}{{end}}{{end}}' \
        "$container"
    done < <(compose ps -q)
  )
  actual=$(printf '%s\n' "$actual" | sed '/^$/d' | sort -n | uniq)
  expected=$(printf '%s\n' 3000 "${USER_PORT:-7999}" | sort -n)
  [[ "$actual" == "$expected" ]]
}

rate_limit_fixture='
const { loadConfig } = await import("/app/dist/config.js");
const { MongoStores } = await import("/app/dist/database.js");
const stores = new MongoStores(loadConfig());
await stores.connect();
const prefix = `phase8-rate-${Date.now()}`;
const limit = Number(process.env.RATE_LIMIT);
let decision;
for (let index = 0; index <= limit; index++) {
  decision = await stores.consumeToolRateLimit(prefix, "phase8_fixture");
}
await stores.close();
if (!decision || decision.allowed || decision.limit !== limit || decision.remaining !== 0) {
  process.exit(1);
}
'

lingxing_pace_fixture='
const { loadConfig } = await import("/app/dist/config.js");
const { MongoStores } = await import("/app/dist/database.js");
const stores = new MongoStores(loadConfig());
await stores.connect();
const prefix = `phase8-pace-${Date.now()}`;
const first = await stores.consumeToolRateLimit(prefix, "phase8_fixture");
const decision = await stores.consumeToolRateLimit(prefix, "phase8_fixture");
await stores.close();
if (!first.allowed || decision.allowed || decision.limit !== 1 || decision.window !== "second" || decision.retryAfterSeconds < 1) {
  process.exit(1);
}
'

lingxing_credential_api_reachable() {
  local status
  status=$(curl -sS -o /tmp/phase8-lingxing-status.json -w '%{http_code}' \
    "http://127.0.0.1:${USER_PORT:-7999}/api/lingxing/status")
  if [[ "$status" == 401 ]] && grep -q unauthorized /tmp/phase8-lingxing-status.json; then
    rm -f /tmp/phase8-lingxing-status.json
    return 0
  fi
  rm -f /tmp/phase8-lingxing-status.json
  return 1
}

check 'compose configuration' compose config --quiet
check 'all containers healthy' all_healthy
check 'MCP ingress is internal and each gateway has isolated outbound access' mcp_network_isolated
check 'LingXing credential API is reachable and rejects anonymous access' lingxing_credential_api_reachable
check 'LibreChat uploads and processed images use persistent volumes' librechat_file_storage_persistent
check 'signed request, replay, stale request, and audit controls' bash -lc \
  "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-phase8-security.js | grep -q PHASE8_SECURITY_OK"
check 'conversation ownership isolation' bash -lc \
  "cd \"$DEPLOY_DIR\" && docker compose --env-file .env -f docker-compose.production.yml exec -T api node /app/deploy/verify-user-isolation.js | grep -q PHASE1_ISOLATION_OK"
check 'SellerSprite distributed rate limit' compose exec -T \
  -e RATE_LIMIT="${SELLERSPRITE_MCP_REQUESTS_PER_MINUTE:-60}" \
  sellersprite-mcp-gateway node --input-type=module -e "$rate_limit_fixture"
check 'LingXing distributed one-tool-per-second pacing' compose exec -T \
  lingxing-mcp-gateway node --input-type=module -e "$lingxing_pace_fixture"
check 'Phase 7 regression suite' bash -lc \
  "SKIP_EXTERNAL_MCP_CATALOGS=true \"$DEPLOY_DIR/verify-phase7.sh\" | grep -q PHASE7_VERIFY_OK"
check 'backup integrity and secret isolation' "$DEPLOY_DIR/verify-backup.sh" "$backup_dir"
check 'user entry ready' curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/readyz"
check 'admin entry healthy' curl -fsS http://127.0.0.1:3000/health
check 'only approved host ports are published' approved_ports_only
check 'recent logs contain no credential material' "$DEPLOY_DIR/verify-log-secrets.sh" 30m

if ((failures > 0)); then
  printf 'Phase 8 verification failed: %d check(s).\n' "$failures" >&2
  exit 1
fi

printf 'PHASE8_VERIFY_OK signing=hmac-sha256 replay=blocked rate_limit=distributed audit=isolated backup=verified rollback=ready external_catalogs=not_required\n'
