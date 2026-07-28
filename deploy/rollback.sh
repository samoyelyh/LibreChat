#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

backup_dir=${1:-}
[[ -d "$backup_dir" ]] || {
  printf 'Usage: %s <backup-directory> [--restore-db] [--restore-files]\n' "$0" >&2
  exit 2
}

restore_db=false
restore_files=false
for option in "${@:2}"; do
  case "$option" in
    --restore-db)
      restore_db=true
      ;;
    --restore-files)
      restore_files=true
      ;;
    *)
      printf 'Unknown rollback option: %s\n' "$option" >&2
      exit 2
      ;;
  esac
done

"$DEPLOY_DIR/verify-backup.sh" "$backup_dir"

backup_path() {
  local modern=$1
  local legacy=$2
  if [[ -f "$backup_dir/$modern" ]]; then
    printf '%s\n' "$backup_dir/$modern"
  else
    printf '%s\n' "$backup_dir/$legacy"
  fi
}

cp "$(backup_path config/docker-compose.production.yml docker-compose.production.yml)" "$COMPOSE_FILE"
cp "$(backup_path config/nginx.conf nginx.conf)" "$DEPLOY_DIR/nginx.conf"
cp "$(backup_path config/librechat.yaml librechat.yaml)" "$ROOT_DIR/config/librechat.yaml"
env_backup=$(backup_path secrets/deploy.env deploy.env)
[[ ! -f "$env_backup" ]] || install -m 0600 "$env_backup" "$ENV_FILE"
mkdir -p "$DEPLOY_DIR/runtime"
override_backup=$(backup_path config/images.override.yml images.override.yml)
if [[ -f "$override_backup" ]]; then
  cp "$override_backup" "$OVERRIDE_FILE"
else
  rm -f "$OVERRIDE_FILE"
fi

compose config --quiet
compose up -d --remove-orphans

if [[ "$restore_db" == true ]]; then
  mongodb_backup=$(backup_path data/mongodb.archive.gz mongodb.archive.gz)
  [[ -f "$mongodb_backup" ]] || {
    printf 'MongoDB backup is missing.\n' >&2
    exit 1
  }
  mongo_container=$(compose ps -q mongodb)
  docker cp "$mongodb_backup" "$mongo_container:/tmp/phase1-mongodb.archive.gz"
  compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/phase1-mongodb.archive.gz --gzip'
  compose exec -T mongodb rm -f /tmp/phase1-mongodb.archive.gz
  ai_backup=$(backup_path data/ai-adapter-mongodb.archive.gz ai-adapter-mongodb.archive.gz)
  if [[ -f "$ai_backup" ]]; then
    docker cp "$ai_backup" "$mongo_container:/tmp/ai-adapter-mongodb.archive.gz"
    compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/ai-adapter-mongodb.archive.gz --gzip'
    compose exec -T mongodb rm -f /tmp/ai-adapter-mongodb.archive.gz
  fi
  seller_backup=$(backup_path data/sellersprite-mongodb.archive.gz sellersprite-mongodb.archive.gz)
  if [[ -f "$seller_backup" ]]; then
    docker cp "$seller_backup" "$mongo_container:/tmp/sellersprite-mongodb.archive.gz"
    compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/sellersprite-mongodb.archive.gz --gzip'
    compose exec -T mongodb rm -f /tmp/sellersprite-mongodb.archive.gz
  fi
  lingxing_backup=$(backup_path data/lingxing-mongodb.archive.gz lingxing-mongodb.archive.gz)
  if [[ -f "$lingxing_backup" ]]; then
    docker cp "$lingxing_backup" "$mongo_container:/tmp/lingxing-mongodb.archive.gz"
    compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/lingxing-mongodb.archive.gz --gzip'
    compose exec -T mongodb rm -f /tmp/lingxing-mongodb.archive.gz
  fi
fi

if [[ "$restore_files" == true ]]; then
  files_backup="$backup_dir/data/librechat-files.tar.gz"
  [[ -f "$files_backup" ]] || {
    printf 'LibreChat file backup is missing.\n' >&2
    exit 1
  }
  api_container=$(compose ps -q api)
  [[ -n "$api_container" ]] || {
    printf 'LibreChat API container is not running.\n' >&2
    exit 1
  }
  docker cp "$files_backup" "$api_container:/tmp/librechat-files.tar.gz"
  compose exec -T api sh -lc \
    'tar -xzf /tmp/librechat-files.tar.gz -C /app && rm -f /tmp/librechat-files.tar.gz'
fi

printf 'Rollback applied. Named volumes were not deleted.\n'
