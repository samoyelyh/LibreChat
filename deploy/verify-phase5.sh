#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime

failures=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1" >&2; failures=$((failures + 1)); }

if compose config --quiet; then
  pass 'Compose configuration is valid'
else
  fail 'Compose configuration failed'
fi

if grep -A5 -E '^  agents:$' "$ROOT_DIR/config/librechat.yaml" | grep -Eq '^    use: true$' \
  && grep -A6 -E '^  skills:$' "$ROOT_DIR/config/librechat.yaml" | grep -Eq '^    use: true$' \
  && grep -A6 -E '^  skills:$' "$ROOT_DIR/config/librechat.yaml" | grep -Eq '^    defaultActiveOnShare: true$'; then
  pass 'Shared Agents and Skills are enabled with shared Skills active by default'
else
  fail 'Agent or Skill interface configuration is incomplete'
fi

if "$DEPLOY_DIR/seed-phase5-private-skills.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-phase5-private-skills.sh" seed >/dev/null \
  && "$DEPLOY_DIR/seed-phase5-private-skills.sh" verify | grep -q PHASE5_PRIVATE_SKILLS_OK; then
  pass 'Private Skill and shared Agent seed is idempotent'
else
  fail 'Private Skill or Agent seed verification failed'
fi

if compose exec -T api node /app/deploy/verify-phase5-api.js | grep -q PHASE5_API_OK; then
  pass 'ADMIN can maintain Skill bodies while USER receives redacted details and shared Agents'
else
  fail 'Skill redaction or shared Agent API verification failed'
fi

if [[ "$failures" -gt 0 ]]; then
  printf 'PHASE5_VERIFY_FAILED failures=%s\n' "$failures" >&2
  exit 1
fi
printf 'PHASE5_VERIFY_OK\n'
