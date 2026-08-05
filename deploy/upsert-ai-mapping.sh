#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
# shellcheck disable=SC1090
source "$ENV_FILE"

if [[ "${1:-}" == --token-stdin ]]; then
  token=$(cat)
else
  [[ -t 0 ]] || {
    printf 'Interactive input requires a terminal; use --token-stdin when piping a protected token.\n' >&2
    exit 2
  }
  read -r -s -p '请输入 New API 低额度测试 Token（输入内容不会显示）：' token
  printf '\n'
fi
[[ -n "$token" ]] || {
  printf 'Token 不能为空。\n' >&2
  exit 2
}

user_json=$(compose exec -T api node /app/deploy/list-phase2-user.js | tail -n 1)
user_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"$user_json")
user_email=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["email"])' <<<"$user_json")
model=${AI_ADAPTER_TEST_MODEL:-gpt-5.6-sol}

printf 'LibreChat 测试用户：%s\n' "$user_email"
printf '允许模型：%s\n' "$model"

printf '%s' "$token" | compose exec -T ai-quota-adapter \
  node dist/cli/upsert-mapping.js \
  --librechat-user-id "$user_id" \
  --librechat-email "$user_email" \
  --allow-model "$model"
unset token
printf '测试用户映射已保存；Token 仅以 AES-256-GCM 密文存储。\n'
