#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
USER_PORT="${USER_PORT:-7999}"

invalid_images=$(compose config --images | grep -Ev '@sha256:[0-9a-f]{64}$' || true)
if [[ -n "$invalid_images" ]]; then
  printf 'Refusing to start because image refs are not immutable digests.\n' >&2
  exit 1
fi

compose config --quiet
compose pull
compose up -d --remove-orphans

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${USER_PORT}/readyz" >/dev/null && curl -fsS http://127.0.0.1:3000/health >/dev/null; then
    printf 'Phase 1 endpoints are ready.\n'
    exit 0
  fi
  sleep 5
done

compose ps
printf 'Timed out waiting for Phase 1 readiness.\n' >&2
exit 1
