# Phase 8：安全和生产部署

## 1. 本轮完成内容

Phase 8 在 Phase 7 的结构化展示基础上完成生产安全收口：

- LibreChat 到 AI Adapter、SellerSprite MCP Gateway、LingXing MCP Gateway 的内部请求使用 HMAC-SHA256 动态签名；
- 签名绑定 HTTP 方法、路径和查询参数、规范化正文摘要、时间戳、随机数及 LibreChat 用户上下文；
- 静态内部密钥只用于本机生成签名，不再作为请求 Header 发送；
- 三个服务使用 MongoDB 唯一随机数集合阻断重放，随机数按 TTL 自动清理；
- 两个 MCP 网关使用 MongoDB 分钟桶实现按用户、按 Tool 的跨实例限流；
- 无签名、错误签名、过期签名和重放请求写入独立安全审计集合，不记录 Header、正文或密钥；
- MCP 网关移出 `edge` 网络，只连接独立内部 `mcp` 网络与数据库 `backend` 网络；
- 备份拆分为 `config/`、`data/`、`secrets/`，秘密目录保持 `0700`，环境文件保持 `0600`；
- 备份完成后自动验证 SHA-256、MongoDB gzip 归档和必要配置，回滚前再次验证；
- 增加完整的 Phase 8 生产验收脚本，覆盖签名、防重放、限流、审计、隔离、备份、健康和端口暴露。

本轮不启用写工具，不发送付费模型请求，不执行真实 MCP 业务查询。

## 2. 当前 Git Tag

LibreChat 上游基线仍固定为 `v0.8.7`。

## 3. 当前 Commit SHA

上游 LibreChat 基线仍为 `9e74cc0e57b395926122bd4062c1fcedc48ed465`。Phase 8 实施提交为 `1c7477e`。

## 4. 修改文件

- `packages/api/src/mcp/connection.ts`
- `packages/api/src/endpoints/models.ts`
- `packages/api/src/endpoints/openai/config.ts`
- 三个内部服务的认证、配置、数据库、代理、CLI 和类型文件
- `deploy/docker-compose.production.yml`
- `deploy/.env.example`
- `deploy/backup.sh`
- `deploy/rollback.sh`
- 三个镜像构建脚本
- Phase 3、Phase 4、Phase 6 的内部请求验证脚本

## 5. 新增文件

- `packages/api/src/mcp/signing.ts`
- `packages/api/src/mcp/signing.spec.ts`
- 三个服务的 `security.ts`
- 两个 MCP 网关的 `security.test.ts`
- `deploy/gateway-signing.js`
- `deploy/build-librechat-phase8.sh`
- `deploy/verify-phase8-security.js`
- `deploy/verify-phase8.sh`
- `deploy/verify-backup.sh`
- `deploy/verify-log-secrets.sh`
- `deploy/verify-file-persistence.sh`
- `deploy/upgrade-phase8-env.sh`
- 本文档

## 6. 删除文件

无。

## 7. 新增环境变量

```env
AI_ADAPTER_SIGNATURE_TOLERANCE_MS=30000
SELLERSPRITE_MCP_SIGNATURE_TOLERANCE_MS=30000
SELLERSPRITE_MCP_REQUESTS_PER_MINUTE=60
LINGXING_MCP_SIGNATURE_TOLERANCE_MS=30000
LINGXING_MCP_REQUESTS_PER_MINUTE=60
```

签名继续使用各服务已有的独立内部密钥，不新增共享总密钥。示例文件不包含真实值。

## 8. 数据模型变化

AI Adapter 数据库新增：

- `adapter_request_nonces`：随机数唯一记录，绝对时间 TTL；
- `adapter_security_audits`：脱敏安全拒绝审计，按审计保留期 TTL。

两个 MCP 网关数据库分别新增：

- `gateway_request_nonces`：随机数唯一记录，绝对时间 TTL；
- `gateway_rate_limits`：按用户、Tool 和分钟组成的限流桶，绝对时间 TTL；
- `gateway_security_audits`：脱敏安全拒绝审计，按审计保留期 TTL。

不修改 LibreChat User、Conversation、Message、Role、Group、Agent 或 Skill 数据结构。

## 9. 权限变化

- 原有角色、部门、Agent 和 Tool allowlist 不变；
- 领星写工具继续为 0；
- 所有 AI/MCP 内部调用除身份和业务权限校验外，必须先通过签名与防重放校验；
- 被禁用用户仍会在数据库身份复核阶段立即失去 AI 与 MCP 权限。

## 10. Docker 配置变化

- 新增内部网络 `mcp`；
- LibreChat API 同时加入 `mcp`；
- 两个 MCP 网关从 `edge` 移除，只加入 `mcp` 与 `backend`；
- 两个网关增加 `cap_drop: ALL` 和 `pids_limit: 256`；
- 三个服务注入签名时钟容差与 MCP 限流配置；
- 仅 Nginx 保持发布 `7999` 和 `3000`。

## 11. 启动命令

```bash
cd /opt/cross-border-ai
deploy/backup.sh
deploy/build-ai-adapter.sh
deploy/build-sellersprite-gateway.sh
deploy/build-lingxing-gateway.sh
deploy/build-librechat-phase8.sh
deploy/start.sh
```

## 12. 测试命令

```bash
cd services/ai-quota-adapter && pnpm test && pnpm typecheck
cd ../sellersprite-mcp-gateway && pnpm test && pnpm typecheck
cd ../lingxing-mcp-gateway && pnpm test && pnpm typecheck
cd ../../packages/api
npm test -- src/mcp/signing.spec.ts --runInBand --coverage=false
npx tsc --noEmit -p tsconfig.json

cd /opt/cross-border-ai
deploy/verify-phase8.sh /opt/cross-border-ai/deploy/backups/<备份目录>
```

## 13. 自动化测试结果

本地结果：

- AI Adapter：4 个测试文件、12 项测试通过；
- SellerSprite Gateway：5 个测试文件、17 项测试通过；
- LingXing Gateway：4 个测试文件、7 项测试通过；
- LibreChat API 签名：4 项测试通过；
- 四个 TypeScript 检查通过；
- 定向 ESLint 通过。

生产结果（2026-07-28）：

- `deploy/verify-phase8.sh` 返回 `PHASE8_VERIFY_OK`；
- 无签名、错误签名、过期签名和重放请求均被拒绝，AI Adapter 与两个 MCP 网关的脱敏安全审计均写入成功；
- SellerSprite 与 LingXing 的 MongoDB 分布式每用户/每 Tool 限流均通过；
- Phase 7 本地能力、权限、Agent、Skill、结构化结果和入口回归通过，外部 MCP 目录探测不作为 Phase 8 安全发布门槛；
- 会话所有权隔离、内部 `mcp` 网络隔离及宿主机仅发布 `7999`、`3000` 均通过；
- 所有 11 个生产服务均为 `healthy`；
- 完成态备份 `/opt/cross-border-ai/deploy/backups/20260728T050729Z` 的 SHA-256、四个 MongoDB gzip 归档、配置完整性和秘密权限通过；
- 最近 30 分钟日志逐项比对真实秘密值，并检查 Bearer/私钥模式，结果为 `LOG_SECRET_SCAN_OK`。

Phase 8 不可变镜像 ID：

| 服务 | 镜像 ID |
| --- | --- |
| LibreChat API | `sha256:8cb0021533bc46c7dc16ec89beecf56e67114665203143f69413959193fd1500` |
| AI Adapter | `sha256:c7d092759ce0d064b2b9b3f65249378719befc06bb8e684aee6cbec7d2529773` |
| SellerSprite Gateway | `sha256:093f5ac4aaaee074d2ff056ae456eb7b64761cbc4a50651e46bdddd4101e476b` |
| LingXing Gateway | `sha256:0e76c8d05796a97ada9ea8010368cdba7ad8da0c94d6f81ea4ab534c5eada94b` |

Phase 8 图片持久化热修复（2026-07-28）：

- 根因：生产 Compose 只持久化 `/app/uploads`，遗漏 LibreChat 本地处理图片目录 `/app/client/public/images`；API 容器重建后旧图片丢失，Agent 读取附件触发 `ENOENT`，浏览器随后以未落库的临时回复作为父消息而收到 HTTP 409；
- 新增命名卷 `images` 挂载到 `/app/client/public/images`，原 `uploads` 卷保持不变；
- 备份新增 `data/librechat-files.tar.gz`，同时保存原始 uploads 与处理后 images，并纳入 SHA-256、gzip 和归档路径白名单验证；
- 回滚新增显式 `--restore-files` 参数。默认回滚仍不修改文件卷，也不自动删除命名卷；
- `deploy/verify-file-persistence.sh` 写入无业务数据的测试标记，强制重建 API 后成功读取并清理，返回 `FILE_PERSISTENCE_OK`；
- 热修复前保护性备份：`/opt/cross-border-ai/deploy/backups/20260728T081050Z`；
- 热修复完成态备份：`/opt/cross-border-ai/deploy/backups/20260728T081359Z`；
- 热修复后 `deploy/verify-phase8.sh` 再次返回 `PHASE8_VERIFY_OK`，全部 11 个服务健康；
- 旧图片目录在修复前已经为空，丢失的处理后图片无法从该目录恢复；受影响对话需要新建对话并重新上传附件。

## 14. 手工验证步骤

1. 登录 `http://192.168.0.27:7999`；
2. 确认登录、模型列表、历史会话和三个共享 Agent 正常；
3. 打开 `http://192.168.0.27:3000`，确认管理面板健康；
4. 不发送模型消息，避免产生验收费用；
5. 执行 `deploy/verify-phase8.sh`，确认无签名、错误签名、过期签名和重放均被拒绝；
6. 确认只有 `7999` 和 `3000` 发布到宿主机；
7. 对最新备份执行 `deploy/verify-backup.sh`。

## 15. 安全检查结果

- HMAC 使用 SHA-256 和常量时间比较；
- 正文采用递归排序键的规范 JSON 后计算 SHA-256，避免属性顺序造成误判；
- 默认时钟偏差窗口为 30 秒；
- 随机数使用 UUID，数据库 `_id` 唯一约束保证跨容器实例防重放；
- 内部密钥和与其相同的 Bearer 值在发送前移除；
- AI Adapter 转发 New API 前移除全部签名 Header；
- 安全审计不保存请求 Header、正文、模型提示词、MCP 参数、返回正文或秘密；
- 日志保持轮转和敏感字段脱敏；
- 备份秘密和普通配置分目录保存。

## 16. 已知问题

- 当前仍为局域网 HTTP。没有内部域名和可信证书时不能安全启用 HTTPS Cookie；
- SSO 需要公司提供 OIDC/SAML 身份提供方、Client ID、回调地址和用户映射规则；
- 签名要求 LibreChat 沃达补丁，后续升级 MCP 传输和 OpenAI Client 时必须重跑签名契约测试；
- MongoDB TTL 清理不是实时任务，过期记录可能在后台清理周期内短暂保留，但不会再次通过时间窗口校验；
- 备份验证确认完整性和归档可读性；数据库恢复仍必须由管理员显式指定 `--restore-db`。
- 2026-07-28 最终复核时，SellerSprite 已配置且保留最近 44 个 Tool 的成功目录记录，但当前外部上游连接测试返回 `connection failed`。请求已通过沃达网关签名与权限校验，失败发生在外部连接阶段；平台容器与 Phase 8 安全发布门槛不受影响，真实 SellerSprite 调用在上游恢复前处于降级状态。

## 17. 未完成内容

- HTTPS：等待内部域名、证书或公司 CA；
- SSO：等待身份提供方参数；
- 真实灾难恢复到独立备用服务器：当前只有一台目标服务器，已完成可恢复备份验证与原地回滚路径；
- 写工具审批状态机仍未开放，继续保持关闭。

## 18. 回滚方式

```bash
cd /opt/cross-border-ai
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<Phase-8-部署前备份>
```

默认只恢复配置、镜像引用并重启，不删除命名卷。只有数据库也必须回退且经过人工确认时：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<备份目录> --restore-db
```

仅恢复本地上传文件和处理后图片：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<备份目录> --restore-files
```

需要同时恢复数据库与文件时可同时指定两个参数。回滚脚本在恢复前验证备份完整性。

## 19. 与上游 LibreChat 的升级冲突

Phase 8 修改 `packages/api/src/mcp/connection.ts`，并在 OpenAI 兼容模型列表与 Client 配置中加入内部签名包装。这些位置是上游活跃代码，升级冲突风险高于品牌和 YAML 配置。升级时必须：

1. 保留上游最新的 SSRF、重定向和流式响应保护；
2. 重新应用“静态内部密钥只用于本地签名、不直接发送”的约束；
3. 重跑模型列表、非流式、SSE、MCP GET/POST/DELETE、重定向和防重放契约测试；
4. 未通过 Phase 8 发布门槛前不得更新生产镜像。
