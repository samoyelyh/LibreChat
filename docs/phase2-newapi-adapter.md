# Phase 2：New API 与 AI Quota Adapter

## 范围与结论

Phase 2 只实现公司 AI 中转的最小闭环：单个测试用户映射、授权模型列表、非流式对话、SSE、取消传播、真实余额与使用记录查询。New API 是唯一计费账本，Adapter 不执行任何二次扣费。自动创建 New API 用户、部门预算、个人额度策略和完整余额页面留到 Phase 5。

LibreChat v0.8.7 原生 Custom Endpoint 能解析 `{{LIBRECHAT_USER_ID}}` 与 `{{LIBRECHAT_USER_EMAIL}}`，因此本阶段没有修改 LibreChat 上游核心代码。LibreChat 只把已登录用户上下文传到内网 Adapter；Adapter 根据映射解密并注入该用户独立的 New API Token。

## 已验证的 New API 契约

- 目标：`https://api.aso8ty.com/v1`
- 版本：`v1.0.0-rc.21`
- 源码 Commit：`bde9b2f44887d34ec54799ae191d50f97914359e`
- 模型：`GET /v1/models`
- 对话：`POST /v1/chat/completions`
- Responses：`POST /v1/responses`
- Token 余额：`GET /api/usage/token`
- Token 日志：`GET /api/log/token`

Adapter 只使用模型 Token 调用上述用户级接口，不持有常驻 New API 管理员 Token。New API 为 RC 版本，任何升级都必须重新验证这些实际接口后才能发布。

## 安全边界

- Adapter、Redis、MongoDB 均不发布 Host 端口。
- `/v1/*` 只接受 `X-Adapter-Internal-Key` 和已解析的 LibreChat 用户上下文。
- 客户端提供的 `Authorization` 会被丢弃，随后注入映射用户的 Token。
- Token 使用 AES-256-GCM 加密；映射查询只返回不可逆指纹，不返回密文或明文。
- MongoDB 使用独立 `readWrite` 用户和独立数据库；Redis 使用密码认证。
- 模型白名单在 Adapter 后端校验，修改前端请求不能越权。
- Pino 对认证头和 Token 字段脱敏；调用审计不记录提示词、回答正文、Cookie 或密钥。
- 用户余额接口校验 LibreChat HS256 JWT，并按 JWT 中的用户 ID 重新查映射。
- 每用户 30 RPM、最多 2 个并发请求为初始保护值，可通过受保护环境变量调整。

## 数据变化

Adapter 独立数据库默认名为 `ai_quota_adapter`，包含：

- `ai_gateway_account_mappings`：LibreChat 用户、New API 用户、加密 Token、指纹、分组、状态和允许模型。LibreChat 用户 ID 与 Token Hash 均有唯一索引。
- `ai_gateway_call_audits`：请求 ID、用户、模型、路径、流式标记、状态、耗时、Token 计数和 New API Request ID。默认 90 天 TTL。

LibreChat 原生 User、Conversation 和 Message 模型没有结构变化。

## 公开与内部路由

- 用户入口：`http://192.168.0.27:7999`
- 管理入口：`http://192.168.0.27:3000`
- 用户余额：`GET /api/ai-quota/balance`，要求 LibreChat Bearer Token
- 用户记录：`GET /api/ai-quota/usage`，要求 LibreChat Bearer Token
- Adapter `/v1`、`/health`、`/readyz`：仅 Docker 网络可达

## 部署与验证

```bash
cd /opt/cross-border-ai
./deploy/upgrade-phase2-env.sh
./deploy/build-ai-adapter.sh
./deploy/start.sh
./deploy/upsert-ai-mapping.sh
./deploy/verify-phase1.sh
./deploy/verify-phase2.sh
```

只有一次最低成本的真实模型验收需要临时设置 `RUN_BILLABLE_PHASE2_TESTS=true` 并执行容器内 `node dist/cli/verify-live.js`；完成后立即恢复为 `false`。该测试包含一次最小非流式请求和一次最小 SSE 请求。

## 回滚

部署前运行 `deploy/backup.sh`。备份目录权限为 `0700`，其中 `deploy.env` 为 `0600`，必须按密钥备份对待且不得提交 Git。回滚恢复上一组 Compose/config/image override，再运行 `deploy/rollback.sh <备份目录>`。默认不删除 `redis_data`、MongoDB 数据或任何命名卷；只有确认新数据与旧版本不兼容时才单独恢复数据库备份。回滚到 Phase 1 时，Adapter 数据库和 Redis 卷可以保留但不会被 Phase 1 使用。
