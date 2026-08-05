#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

expected_commit=9e74cc0e57b395926122bd4062c1fcedc48ed465
actual_commit=$(git -C "$ROOT_DIR" rev-parse v0.8.7^{commit})
[[ "$actual_commit" == "$expected_commit" ]] || {
  printf 'Pinned LibreChat v0.8.7 commit mismatch.\n' >&2
  exit 1
}

tag="woda/librechat:v0.8.7-phase9-admin-users"
docker build \
  --pull=false \
  --file "$ROOT_DIR/Dockerfile.multi" \
  --tag "$tag" \
  --build-arg BUILD_COMMIT="$expected_commit" \
  --build-arg BUILD_BRANCH="woda/phase-9" \
  --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$ROOT_DIR"
image_id=$(docker image inspect --format '{{.Id}}' "$tag")
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  printf 'Built LibreChat image did not return an immutable image ID.\n' >&2
  exit 1
}
docker run --rm --entrypoint node "$image_id" -e "
  for (const name of ['compression', 'express', 'mongoose', 'module-alias']) require(name);
  for (const name of ['@librechat/api', '@librechat/data-schemas', 'librechat-data-provider']) require(name);
" >/dev/null || {
  printf 'LibreChat runtime dependency smoke test failed.\n' >&2
  exit 1
}
docker run --rm --entrypoint grep "$image_id" \
  -q 'System administrators cannot be created from this form' \
  /app/packages/api/dist/index.cjs || {
  printf 'Phase 9 administrator user-creation API is missing from the built image.\n' >&2
  exit 1
}
docker run --rm --entrypoint grep "$image_id" \
  -q 'extractAgentMessageDocument' \
  /app/packages/api/dist/index.cjs || {
  printf 'Agent document compatibility routing is missing from the built API package.\n' >&2
  exit 1
}
docker run --rm --entrypoint grep "$image_id" \
  -q 'resolveFileContextTokenLimit' \
  /app/packages/api/dist/index.cjs || {
  printf 'Shared file-context token budgeting is missing from the built API package.\n' >&2
  exit 1
}
docker run --rm --entrypoint grep "$image_id" \
  -q 'extractAgentMessageDocument' \
  /app/api/server/services/Files/process.js || {
  printf 'Agent message-document extraction is missing from the built API.\n' >&2
  exit 1
}
docker run --rm --entrypoint sh "$image_id" -c \
  "grep -R -q 'Create user account' /app/client/dist" || {
  printf 'Phase 9 administrator user-creation interface is missing from the built image.\n' >&2
  exit 1
}

if grep -q '^LIBRECHAT_IMAGE=' "$ENV_FILE"; then
  sed -i "s|^LIBRECHAT_IMAGE=.*|LIBRECHAT_IMAGE=${image_id}|" "$ENV_FILE"
else
  printf 'LIBRECHAT_IMAGE=%s\n' "$image_id" >> "$ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
printf 'LibreChat Phase 9 administrator user-management image built and pinned by local image ID.\n'
