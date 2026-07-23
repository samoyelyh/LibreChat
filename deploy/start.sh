#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
USER_PORT="${USER_PORT:-7999}"

invalid_images=$(compose config --images | grep -Ev '(@sha256:[0-9a-f]{64}|^sha256:[0-9a-f]{64})$' || true)
if [[ -n "$invalid_images" ]]; then
  printf 'Refusing to start because image refs are not immutable digests.\n' >&2
  exit 1
fi

compose config --quiet
while IFS= read -r image; do
  if [[ "$image" == sha256:* ]]; then
    docker image inspect "$image" >/dev/null
  else
    docker pull "$image"
  fi
done < <(compose config --images | sort -u)

compose up -d mongodb redis
for _ in $(seq 1 40); do
  mongo_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(compose ps -q mongodb)" 2>/dev/null || true)
  redis_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$(compose ps -q redis)" 2>/dev/null || true)
  [[ "$mongo_health" == healthy && "$redis_health" == healthy ]] && break
  sleep 3
done
[[ "${mongo_health:-}" == healthy && "${redis_health:-}" == healthy ]] || {
  printf 'MongoDB or Redis did not become healthy.\n' >&2
  exit 1
}
"$DEPLOY_DIR/init-ai-adapter-mongo.sh"
compose up -d --remove-orphans

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${USER_PORT}/readyz" >/dev/null && curl -fsS http://127.0.0.1:3000/health >/dev/null; then
    printf 'Phase 2 endpoints are ready.\n'
    exit 0
  fi
  sleep 5
done

compose ps
printf 'Timed out waiting for Phase 2 readiness.\n' >&2
exit 1
