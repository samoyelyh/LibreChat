#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
USER_PORT=${USER_PORT:-7999}
failures=0

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if compose config --quiet; then pass 'Compose configuration is valid'; else fail 'Compose configuration is invalid'; fi

invalid_images=$(compose config --images | grep -Ev '(@sha256:[0-9a-f]{64}|^sha256:[0-9a-f]{64})$' || true)
if [[ -z "$invalid_images" ]]; then pass 'Production images are immutable'; else fail 'An image is not immutable'; fi

for service in redis ai-quota-adapter; do
  container=$(compose ps -q "$service")
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container" 2>/dev/null || true)
  if [[ "$health" == healthy ]]; then pass "$service is healthy"; else fail "$service health=$health"; fi
done

if compose exec -T ai-quota-adapter node dist/cli/verify-readonly.js >/dev/null; then
  pass 'Mapped model list and authoritative New API balance are readable'
else
  fail 'Read-only adapter contract verification failed'
fi

if curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${USER_PORT}/api/ai-quota/balance" | grep -q '^401$'; then
  pass 'Public balance route requires a LibreChat access token'
else
  fail 'Public balance route did not reject an anonymous request'
fi

if compose ps --format json | python3 -c '
import json, sys
rows = [json.loads(line) for line in sys.stdin if line.strip()]
internal = {"redis", "ai-quota-adapter"}
bad = [r["Service"] for r in rows if r["Service"] in internal and any(int(p.get("PublishedPort") or 0) for p in r.get("Publishers") or [])]
raise SystemExit(1 if bad else 0)
'; then pass 'Redis and adapter expose no host ports'; else fail 'An internal Phase 2 port is published'; fi

if grep -q "X-LibreChat-User-ID: '{{LIBRECHAT_USER_ID}}'" "$ROOT_DIR/config/librechat.yaml" \
  && grep -q "baseURL: 'http://ai-quota-adapter:4100/v1'" "$ROOT_DIR/config/librechat.yaml"; then
  pass 'LibreChat uses resolved per-user adapter context'
else
  fail 'LibreChat adapter context configuration is missing'
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
logs_file=$(mktemp)
trap 'rm -f "$logs_file"' EXIT
compose logs --no-color > "$logs_file"
for name in REDIS_PASSWORD AI_ADAPTER_DB_PASSWORD AI_TOKEN_ENCRYPTION_KEY AI_ADAPTER_INTERNAL_KEY; do
  value=${!name:-}
  [[ -z "$value" ]] && continue
  git -C "$ROOT_DIR" grep -Fq -- "$value" -- . 2>/dev/null && fail "$name appears in a tracked file"
  grep -Fq -- "$value" "$logs_file" && fail "$name appears in container logs"
done
if grep -Eiq 'Authorization:[[:space:]]*Bearer|Bearer[[:space:]]+sk-' "$logs_file"; then
  fail 'An authentication header pattern appears in logs'
else
  pass 'Logs contain no authentication header pattern'
fi

if [[ "$failures" -ne 0 ]]; then
  printf 'PHASE2_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi
printf 'PHASE2_VERIFY_OK\n'
