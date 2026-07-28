#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

marker=".woda-persistence-$RANDOM-$$"
payload="woda-file-persistence-v1"
api_path="/app/client/public/images/$marker"

cleanup() {
  compose exec -T api rm -f "$api_path" >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose exec -T api sh -c 'printf "%s" "$1" > "$2"' sh "$payload" "$api_path"
before=$(compose ps -q api)
compose up -d --force-recreate --no-deps api >/dev/null
after=$(compose ps -q api)

[[ -n "$before" && -n "$after" && "$before" != "$after" ]] || {
  printf 'API container was not recreated.\n' >&2
  exit 1
}

for _ in $(seq 1 40); do
  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$after")
  [[ "$health" == healthy ]] && break
  sleep 3
done
[[ "${health:-}" == healthy ]] || {
  printf 'API did not become healthy after recreation.\n' >&2
  exit 1
}

compose exec -T api sh -c 'test "$(cat "$1")" = "$2"' sh "$api_path" "$payload"
compose restart nginx >/dev/null
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${USER_PORT:-7999}/readyz" >/dev/null 2>&1; then
    entry_ready=true
    break
  fi
  sleep 1
done
[[ "${entry_ready:-false}" == true ]] || {
  printf 'User entry did not recover after Nginx restart.\n' >&2
  exit 1
}

printf 'FILE_PERSISTENCE_OK api_recreated=true images_volume=preserved\n'
