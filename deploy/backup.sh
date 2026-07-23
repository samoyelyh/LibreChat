#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=${1:-$DEPLOY_DIR/backups/$timestamp}
mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"

cp "$COMPOSE_FILE" "$backup_dir/docker-compose.production.yml"
cp "$DEPLOY_DIR/nginx.conf" "$backup_dir/nginx.conf"
cp "$ROOT_DIR/config/librechat.yaml" "$backup_dir/librechat.yaml"
install -m 0600 "$ENV_FILE" "$backup_dir/deploy.env"
[[ ! -f "$OVERRIDE_FILE" ]] || cp "$OVERRIDE_FILE" "$backup_dir/images.override.yml"
compose config --no-interpolate > "$backup_dir/compose.no-interpolate.yml"
compose config --images > "$backup_dir/image-refs.txt"
compose images --format json > "$backup_dir/image-state.json" || true
git -C "$ROOT_DIR" status --short --branch > "$backup_dir/git-status.txt"
git -C "$ROOT_DIR" diff --no-ext-diff > "$backup_dir/git.diff"
sha256sum "$ENV_FILE" > "$backup_dir/env.sha256"

mongo_container=$(compose ps -q mongodb)
[[ -n "$mongo_container" ]] || {
  printf 'MongoDB container is not running.\n' >&2
  exit 1
}
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db LibreChat --archive=/tmp/phase1-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/phase1-mongodb.archive.gz" "$backup_dir/mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/phase1-mongodb.archive.gz

# Adapter mappings contain encrypted credentials and must be backed up with
# stricter directory permissions. No plaintext token is present in this dump.
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db "${AI_ADAPTER_DB_NAME:-ai_quota_adapter}" --archive=/tmp/ai-adapter-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/ai-adapter-mongodb.archive.gz" "$backup_dir/ai-adapter-mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/ai-adapter-mongodb.archive.gz

# SellerSprite call audits and safe credential metadata contain no plaintext
# secret; the actual secret remains only in the protected deploy.env copy.
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db "${SELLERSPRITE_MCP_DB:-sellersprite_mcp_gateway}" --archive=/tmp/sellersprite-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/sellersprite-mongodb.archive.gz" "$backup_dir/sellersprite-mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/sellersprite-mongodb.archive.gz

find "$backup_dir" -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
  | sort -z \
  | xargs -0 sha256sum > "$backup_dir/SHA256SUMS"
printf '%s\n' "$backup_dir"
