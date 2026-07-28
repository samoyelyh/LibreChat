#!/usr/bin/env bash
set -euo pipefail

backup_dir=${1:-}
[[ -d "$backup_dir" ]] || {
  printf 'Usage: %s <backup-directory>\n' "$0" >&2
  exit 2
}

mode=$(stat -c %a "$backup_dir")
((10#$mode <= 700)) || {
  printf 'Backup directory permissions are too broad: %s\n' "$mode" >&2
  exit 1
}

if [[ -f "$backup_dir/SHA256SUMS" ]]; then
  (cd "$backup_dir" && sha256sum -c SHA256SUMS)
fi

secret_file="$backup_dir/secrets/deploy.env"
[[ -f "$secret_file" ]] || secret_file="$backup_dir/deploy.env"
[[ ! -f "$secret_file" || "$(stat -c %a "$secret_file")" == 600 ]] || {
  printf 'Protected environment backup must have mode 0600.\n' >&2
  exit 1
}

for name in mongodb ai-adapter-mongodb sellersprite-mongodb lingxing-mongodb; do
  archive="$backup_dir/data/$name.archive.gz"
  [[ -f "$archive" ]] || archive="$backup_dir/$name.archive.gz"
  [[ ! -f "$archive" ]] || gzip -t "$archive"
done

compose_backup="$backup_dir/config/docker-compose.production.yml"
[[ -f "$compose_backup" ]] || compose_backup="$backup_dir/docker-compose.production.yml"
librechat_backup="$backup_dir/config/librechat.yaml"
[[ -f "$librechat_backup" ]] || librechat_backup="$backup_dir/librechat.yaml"
[[ -f "$compose_backup" && -f "$librechat_backup" ]] || {
  printf 'Required configuration backup is incomplete.\n' >&2
  exit 1
}

printf 'BACKUP_VERIFY_OK directory=%s\n' "$backup_dir"
