#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

for name in AI_ADAPTER_DB_USERNAME AI_ADAPTER_DB_PASSWORD; do
  [[ -n "${!name:-}" ]] || {
    printf '%s is required in %s\n' "$name" "$ENV_FILE" >&2
    exit 1
  }
done

compose exec -T \
  -e AI_ADAPTER_DB_NAME="${AI_ADAPTER_DB_NAME:-ai_quota_adapter}" \
  -e AI_ADAPTER_DB_USERNAME="$AI_ADAPTER_DB_USERNAME" \
  -e AI_ADAPTER_DB_PASSWORD="$AI_ADAPTER_DB_PASSWORD" \
  mongodb mongosh --quiet /opt/woda/init-ai-adapter-mongo.js | grep -q AI_ADAPTER_MONGO_USER_OK
printf 'Adapter MongoDB user is ready.\n'
