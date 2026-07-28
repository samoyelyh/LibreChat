#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=${1:-$DEPLOY_DIR/backups/$timestamp}
mkdir -p "$backup_dir"
chmod 0700 "$backup_dir"
config_dir="$backup_dir/config"
data_dir="$backup_dir/data"
secrets_dir="$backup_dir/secrets"
mkdir -p "$config_dir" "$data_dir" "$secrets_dir"
chmod 0700 "$config_dir" "$data_dir" "$secrets_dir"

cp "$COMPOSE_FILE" "$config_dir/docker-compose.production.yml"
cp "$DEPLOY_DIR/nginx.conf" "$config_dir/nginx.conf"
cp "$ROOT_DIR/config/librechat.yaml" "$config_dir/librechat.yaml"
install -m 0600 "$ENV_FILE" "$secrets_dir/deploy.env"
[[ ! -f "$OVERRIDE_FILE" ]] || cp "$OVERRIDE_FILE" "$config_dir/images.override.yml"
compose config --no-interpolate > "$config_dir/compose.no-interpolate.yml"
compose config --images > "$config_dir/image-refs.txt"
compose images --format json > "$config_dir/image-state.json" || true
git -C "$ROOT_DIR" status --short --branch > "$config_dir/git-status.txt"
git -C "$ROOT_DIR" diff --no-ext-diff > "$config_dir/git.diff"
sha256sum "$ENV_FILE" | sed 's#  .*#  secrets/deploy.env#' > "$config_dir/env.sha256"
cat > "$config_dir/restore-plan.txt" <<'EOF'
Restore order:
1. Verify SHA256SUMS before using the backup.
2. Restore config and immutable image references first.
3. Start services and run health checks.
4. Restore databases only after explicit operator confirmation.
5. Never delete named volumes automatically.
EOF

mongo_container=$(compose ps -q mongodb)
[[ -n "$mongo_container" ]] || {
  printf 'MongoDB container is not running.\n' >&2
  exit 1
}
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db LibreChat --archive=/tmp/phase1-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/phase1-mongodb.archive.gz" "$data_dir/mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/phase1-mongodb.archive.gz

# Adapter mappings contain encrypted credentials and must be backed up with
# stricter directory permissions. No plaintext token is present in this dump.
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db "${AI_ADAPTER_DB_NAME:-ai_quota_adapter}" --archive=/tmp/ai-adapter-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/ai-adapter-mongodb.archive.gz" "$data_dir/ai-adapter-mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/ai-adapter-mongodb.archive.gz

# SellerSprite call audits and safe credential metadata contain no plaintext
# secret; the actual secret remains only in the protected deploy.env copy.
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db "${SELLERSPRITE_MCP_DB:-sellersprite_mcp_gateway}" --archive=/tmp/sellersprite-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/sellersprite-mongodb.archive.gz" "$data_dir/sellersprite-mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/sellersprite-mongodb.archive.gz

# Lingxing credentials are encrypted with AES-256-GCM. The encryption key is
# present only in the protected deploy.env copy stored in this mode-0700 folder.
compose exec -T mongodb sh -lc 'mongodump --quiet --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --db "${LINGXING_MCP_DB:-lingxing_mcp_gateway}" --archive=/tmp/lingxing-mongodb.archive.gz --gzip'
docker cp "$mongo_container:/tmp/lingxing-mongodb.archive.gz" "$data_dir/lingxing-mongodb.archive.gz"
compose exec -T mongodb rm -f /tmp/lingxing-mongodb.archive.gz

# Local file storage is separate from MongoDB. Preserve both the original
# uploads and LibreChat's processed image files without exposing filenames in
# command output.
compose exec -T api sh -lc \
  'tar -czf - -C /app uploads client/public/images' \
  >"$data_dir/librechat-files.tar.gz"

(
  cd "$backup_dir"
  find config data secrets -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
)
"$DEPLOY_DIR/verify-backup.sh" "$backup_dir" >/dev/null
printf '%s\n' "$backup_dir"
