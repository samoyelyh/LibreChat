#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

backup_dir=${1:-}
restore_db=${2:-}
[[ -d "$backup_dir" ]] || {
  printf 'Usage: %s <backup-directory> [--restore-db]\n' "$0" >&2
  exit 2
}

cp "$backup_dir/docker-compose.production.yml" "$COMPOSE_FILE"
cp "$backup_dir/nginx.conf" "$DEPLOY_DIR/nginx.conf"
cp "$backup_dir/librechat.yaml" "$ROOT_DIR/config/librechat.yaml"
mkdir -p "$DEPLOY_DIR/runtime"
if [[ -f "$backup_dir/images.override.yml" ]]; then
  cp "$backup_dir/images.override.yml" "$OVERRIDE_FILE"
else
  rm -f "$OVERRIDE_FILE"
fi

compose config --quiet
compose up -d --remove-orphans

if [[ "$restore_db" == '--restore-db' ]]; then
  [[ -f "$backup_dir/mongodb.archive.gz" ]] || {
    printf 'MongoDB backup is missing.\n' >&2
    exit 1
  }
  mongo_container=$(compose ps -q mongodb)
  docker cp "$backup_dir/mongodb.archive.gz" "$mongo_container:/tmp/phase1-mongodb.archive.gz"
  compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/phase1-mongodb.archive.gz --gzip'
  compose exec -T mongodb rm -f /tmp/phase1-mongodb.archive.gz
  if [[ -f "$backup_dir/ai-adapter-mongodb.archive.gz" ]]; then
    docker cp "$backup_dir/ai-adapter-mongodb.archive.gz" "$mongo_container:/tmp/ai-adapter-mongodb.archive.gz"
    compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/ai-adapter-mongodb.archive.gz --gzip'
    compose exec -T mongodb rm -f /tmp/ai-adapter-mongodb.archive.gz
  fi
  if [[ -f "$backup_dir/sellersprite-mongodb.archive.gz" ]]; then
    docker cp "$backup_dir/sellersprite-mongodb.archive.gz" "$mongo_container:/tmp/sellersprite-mongodb.archive.gz"
    compose exec -T mongodb sh -lc 'mongorestore --quiet --drop --authenticationDatabase admin --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --archive=/tmp/sellersprite-mongodb.archive.gz --gzip'
    compose exec -T mongodb rm -f /tmp/sellersprite-mongodb.archive.gz
  fi
fi

printf 'Rollback applied. Named volumes were not deleted.\n'
