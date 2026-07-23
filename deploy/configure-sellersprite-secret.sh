#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_runtime
umask 077

printf '\n============================================================\n'
printf ' 沃达跨境电商 AI 平台 - 卖家精灵 Phase 3 配置\n'
printf '============================================================\n'
printf '密钥输入会被隐藏；保存后只能覆盖，不能读取明文。\n\n'

operator=''
while [[ ${#operator} -lt 3 ]]; do
  read -r -p '管理员标识（邮箱或姓名，用于审计，必填）: ' operator
done

read -r -p '套餐每月调用额度（未知请填 0）[0]: ' monthly_limit
monthly_limit=${monthly_limit:-0}
[[ "$monthly_limit" =~ ^[0-9]+$ ]] || {
  printf '调用额度必须是 0 或正整数。\n' >&2
  exit 2
}

secret=''
confirmation=''
while [[ -z "$secret" || "$secret" != "$confirmation" ]]; do
  IFS= read -r -s -p '卖家精灵 Secret Key（粘贴后按回车，输入隐藏）: ' secret
  printf '\n'
  IFS= read -r -s -p '请再次输入同一个 Secret Key（输入隐藏）: ' confirmation
  printf '\n'
  if [[ -z "$secret" ]]; then
    printf '必填项为空，请重新输入。\n\n'
  elif [[ "$secret" != "$confirmation" ]]; then
    printf '两次输入不一致，请重新输入。\n\n'
  fi
done

if [[ "$secret" == *$'\n'* || "$secret" == *$'\r'* ]]; then
  printf '密钥不能包含换行符。\n' >&2
  exit 2
fi
if [[ ! "$secret" =~ ^[A-Za-z0-9_./+=:-]+$ ]]; then
  printf '密钥包含不支持的字符，请确认复制的是“密钥值”而不是名称或整段配置。\n' >&2
  exit 2
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
internal_key=${SELLERSPRITE_MCP_INTERNAL_KEY:-}
db_password=${SELLERSPRITE_MCP_DB_PASSWORD:-}
[[ -n "$internal_key" ]] || internal_key=$(openssl rand -base64 48 | tr -d '\n')
[[ -n "$db_password" ]] || db_password=$(openssl rand -base64 36 | tr -d '\n')

export PHASE3_SECRET_VALUE="$secret"
export PHASE3_INTERNAL_KEY="$internal_key"
export PHASE3_DB_PASSWORD="$db_password"
export PHASE3_MONTHLY_LIMIT="$monthly_limit"
export PHASE3_ENV_FILE="$ENV_FILE"
python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["PHASE3_ENV_FILE"])
updates = {
    "SELLERSPRITE_MCP_URL": "https://mcp.sellersprite.com/mcp",
    "SELLERSPRITE_MCP_SECRET_KEY": os.environ["PHASE3_SECRET_VALUE"],
    "SELLERSPRITE_MCP_INTERNAL_KEY": os.environ["PHASE3_INTERNAL_KEY"],
    "SELLERSPRITE_MCP_DB": "sellersprite_mcp_gateway",
    "SELLERSPRITE_MCP_DB_USERNAME": "sellersprite_gateway",
    "SELLERSPRITE_MCP_DB_PASSWORD": os.environ["PHASE3_DB_PASSWORD"],
    "SELLERSPRITE_MCP_GATEWAY_PORT": "4200",
    "SELLERSPRITE_MCP_TIMEOUT_MS": "120000",
    "SELLERSPRITE_MCP_AUDIT_RETENTION_DAYS": "365",
    "SELLERSPRITE_MCP_MONTHLY_LIMIT": os.environ["PHASE3_MONTHLY_LIMIT"],
    "PHASE3_SELLERSPRITE_ENABLED": "true",
}
lines = path.read_text(encoding="utf-8").splitlines()
seen = set()
result = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        result.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")
tmp = path.with_suffix(".env.phase3.tmp")
tmp.write_text("\n".join(result) + "\n", encoding="utf-8")
tmp.chmod(0o600)
tmp.replace(path)
path.chmod(0o600)
PY
unset PHASE3_SECRET_VALUE PHASE3_INTERNAL_KEY PHASE3_DB_PASSWORD

fingerprint=$(printf '%s' "$secret" | sha256sum | cut -c61-64)
printf '\n已安全写入：长度 %s，SHA-256 指纹后四位 %s。\n' "${#secret}" "$fingerprint"
secret=''
confirmation=''

printf '正在构建并启动卖家精灵网关，请保持窗口打开……\n'
"$DEPLOY_DIR/build-sellersprite-gateway.sh"
"$DEPLOY_DIR/start.sh"
compose exec -T sellersprite-mcp-gateway \
  node dist/cli/admin.js credential-sync --operator "$operator" >/dev/null
compose exec -T sellersprite-mcp-gateway node dist/cli/admin.js test
printf '\nPHASE3_SELLERSPRITE_CONFIGURED\n'
printf '配置与连接测试已完成。可以关闭此窗口并回到 Codex。\n'
