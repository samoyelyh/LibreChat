#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
USER_PORT="${USER_PORT:-7999}"

failures=0

pass() {
  printf 'PASS %s\n' "$1"
}

fail() {
  printf 'FAIL %s\n' "$1" >&2
  failures=$((failures + 1))
}

if [[ "$(git -C "$ROOT_DIR" rev-parse HEAD)" == 9e74cc0e57b395926122bd4062c1fcedc48ed465 ]]; then
  pass 'LibreChat commit is fixed to v0.8.7'
else
  fail 'LibreChat commit mismatch'
fi

if [[ -f "$ROOT_DIR/LICENSE" ]] && grep -q 'MIT License' "$ROOT_DIR/LICENSE"; then
  pass 'LibreChat MIT license is retained'
else
  fail 'LibreChat MIT license is missing'
fi

if compose config --quiet; then
  pass 'Compose configuration is valid'
else
  fail 'Compose configuration is invalid'
fi

invalid_images=$(compose config --images | grep -Ev '@sha256:[0-9a-f]{64}$' || true)
if [[ -z "$invalid_images" ]]; then
  pass 'All production images use immutable digests'
else
  fail 'One or more images are not digest pinned'
fi

api_version=$(compose exec -T api node -p "require('/app/package.json').version" 2>/dev/null || true)
if [[ "$api_version" == v0.8.7 ]]; then
  pass 'Running LibreChat image reports v0.8.7'
else
  fail "Running LibreChat image version mismatch"
fi

for service in $(compose config --services); do
  container=$(compose ps -q "$service")
  if [[ -z "$container" ]]; then
    fail "$service container is missing"
    continue
  fi
  state=$(docker inspect --format '{{.State.Status}}' "$container")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
  if [[ "$state" == running && "$health" == healthy ]]; then
    pass "$service is running and healthy"
  else
    fail "$service state=$state health=$health"
  fi
done

if curl -fsS "http://127.0.0.1:${USER_PORT}/health" | grep -q OK; then
  pass 'User entry /health is healthy'
else
  fail 'User entry /health failed'
fi

if curl -fsS "http://127.0.0.1:${USER_PORT}/readyz" >/dev/null; then
  pass 'User entry /readyz is ready'
else
  fail 'User entry /readyz failed'
fi

if curl -fsS http://127.0.0.1:3000/health | grep -q OK; then
  pass 'Admin entry health is healthy'
else
  fail 'Admin entry health failed'
fi

if curl -fsS "http://127.0.0.1:${USER_PORT}/api/config" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['appTitle']=='沃达跨境电商AI平台'; assert d['registrationEnabled'] is False; assert d['socialLoginEnabled'] is False; assert d['emailLoginEnabled'] is True"; then
  pass 'Brand and authentication startup config are correct'
else
  fail 'Brand or authentication startup config mismatch'
fi

if grep -Eq '^  memories: false$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -Eq '^  runCode: false$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -Eq '^  webSearch: false$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -Eq '^  skills: false$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -Eq '^  sharedLinks: false$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -A6 -E '^  mcpServers:$' "$ROOT_DIR/config/librechat.yaml" | grep -Eq '^    use: false$' \
  && grep -A5 -E '^  remoteAgents:$' "$ROOT_DIR/config/librechat.yaml" | grep -Eq '^    use: false$' \
  && grep -Eq '^memory:$' "$ROOT_DIR/config/librechat.yaml" \
  && grep -Eq '^  disabled: true$' "$ROOT_DIR/config/librechat.yaml"; then
  pass 'Phase 1 high-risk features are explicitly disabled'
else
  fail 'One or more Phase 1 high-risk feature gates are missing'
fi

registration_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"email":"phase1-registration-check@invalid.local","password":"not-a-real-password","confirm_password":"not-a-real-password","name":"phase1","username":"phase1-registration-check"}' \
  "http://127.0.0.1:${USER_PORT}/api/auth/register")
if [[ "$registration_status" == 403 ]]; then
  pass 'Public registration is rejected'
else
  fail "Public registration returned HTTP $registration_status"
fi

if curl -sSI "http://127.0.0.1:${USER_PORT}/" | tr -d '\r' | grep -qi '^Set-Cookie: lang=zh-Hans'; then
  pass 'First visit receives zh-Hans cookie'
else
  fail 'First visit did not receive zh-Hans cookie'
fi

if curl -sSI -H 'Cookie: lang=en' "http://127.0.0.1:${USER_PORT}/" | tr -d '\r' | grep -qi '^Set-Cookie: lang=zh-Hans'; then
  fail 'Existing language preference was overwritten'
else
  pass 'Existing language preference is respected'
fi

if compose ps --format json | python3 -c '
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
bad = [
    row["Service"]
    for row in rows
    if row["Service"] != "nginx"
    and any(int(pub.get("PublishedPort") or 0) > 0 for pub in row.get("Publishers") or [])
]
raise SystemExit(1 if bad else 0)
'; then
  pass 'This Compose project publishes no internal service ports'
else
  fail 'At least one internal Compose service has a non-zero published host port'
fi

if "$DEPLOY_DIR/seed-rbac.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-rbac.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-rbac.sh" verify; then
  pass 'RBAC seed is present and idempotent'
else
  fail 'RBAC seed or idempotency check failed'
fi

if compose exec -T api node /app/deploy/verify-user-isolation.js; then
  pass 'User conversation isolation is enforced through the HTTP API'
else
  fail 'User conversation isolation check failed'
fi

if compose exec -T api node /app/deploy/verify-admin-api.js; then
  pass 'Admin APIs and authenticated Phase 1 feature gates are available'
else
  fail 'Admin API or authenticated feature-gate verification failed'
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
secret_names=(
  MONGO_ROOT_PASSWORD MEILI_MASTER_KEY POSTGRES_PASSWORD ADMIN_PANEL_SESSION_SECRET
  JWT_SECRET JWT_REFRESH_SECRET CREDS_KEY CREDS_IV SELLERSPRITE_MCP_SECRET_KEY
  AI_GATEWAY_ADMIN_TOKEN AI_TOKEN_ENCRYPTION_KEY AI_ADAPTER_INTERNAL_KEY
)
logs_file=$(mktemp)
trap 'rm -f "$logs_file"' EXIT
compose logs --no-color > "$logs_file"

for name in "${secret_names[@]}"; do
  value=${!name:-}
  [[ -z "$value" ]] && continue
  if git -C "$ROOT_DIR" grep -Fq -- "$value" -- . 2>/dev/null; then
    fail "$name appears in a tracked file"
  fi
  if grep -Fq -- "$value" "$logs_file"; then
    fail "$name appears in container logs"
  fi
done

if grep -Eiq 'Authorization:[[:space:]]*Bearer|Bearer[[:space:]]+sk-' "$logs_file"; then
  fail 'An authentication header pattern appears in container logs'
else
  pass 'No authentication header pattern appears in container logs'
fi

rm -f "$logs_file"
trap - EXIT

if [[ "$failures" -ne 0 ]]; then
  printf 'PHASE1_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi

printf 'PHASE1_VERIFY_OK\n'
