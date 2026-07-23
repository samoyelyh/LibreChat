#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE=$DEPLOY_DIR/.env
EXAMPLE_FILE=$DEPLOY_DIR/.env.example

[[ ! -e "$ENV_FILE" ]] || {
  printf 'Refusing to overwrite existing %s\n' "$ENV_FILE" >&2
  exit 1
}

install -m 0600 "$EXAMPLE_FILE" "$ENV_FILE"

set_value() {
  local key=$1
  local value=$2
  sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
}

set_value MONGO_ROOT_PASSWORD "$(openssl rand -hex 32)"
set_value MEILI_MASTER_KEY "$(openssl rand -hex 32)"
set_value POSTGRES_PASSWORD "$(openssl rand -hex 32)"
set_value ADMIN_PANEL_SESSION_SECRET "$(openssl rand -hex 32)"
set_value JWT_SECRET "$(openssl rand -hex 32)"
set_value JWT_REFRESH_SECRET "$(openssl rand -hex 32)"
set_value CREDS_KEY "$(openssl rand -hex 32)"
set_value CREDS_IV "$(openssl rand -hex 16)"
set_value AI_ADAPTER_DB_PASSWORD "$(openssl rand -hex 32)"
set_value REDIS_PASSWORD "$(openssl rand -hex 32)"
set_value AI_TOKEN_ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_value AI_ADAPTER_INTERNAL_KEY "$(openssl rand -hex 32)"

chmod 0600 "$ENV_FILE"
printf 'Created %s with mode 0600. Secret values were not printed.\n' "$ENV_FILE"
