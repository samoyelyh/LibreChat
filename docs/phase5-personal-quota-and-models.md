# Phase 5：个人额度与模型权限

## 交付结果

- LibreChat 用户与 New API 用户保持一对一映射，每个用户拥有独立的运行 Token。
- 现有用户在部署启动时幂等开通；后续新增用户在首次读取额度或调用模型时自动开通。
- 新账户默认额度为 `0`，默认分组为 `default`，默认允许 `gpt-5.6-sol`，以便使用平台预置 Agent。管理员显式授权后才能产生可消费额度。
- 支持四层策略：`user > department > role > default`；同层按 `priority` 和更新时间选择。
- 账户设置新增“AI 额度与模型”页面。用户可查看个人额度、模型范围和最近使用记录；管理员可搜索用户、保存策略、同步、停用和恢复个人 AI 账户。
- New API 仍是唯一计费账本，Adapter 不建立第二套扣费余额。

## 自动开通流程

1. Adapter 使用 LibreChat JWT 中的用户 ID 和 Email，并从 LibreChat MongoDB 重新解析账户、角色和部门。
2. 计算生效策略，生成长度符合 New API `v1.0.0-rc.21` 约束的确定性用户名与密码。
3. 通过 New API 管理接口创建普通用户、设置分组和额度、生成用户管理 Access Token，再创建受模型限制的运行 Token。
4. 运行 Token 和用户管理 Access Token 分别使用 AES-256-GCM 加密后写入 `ai_quota_adapter.ai_gateway_account_mappings`。
5. 浏览器、LibreChat API、日志和管理响应只接收指纹及安全元数据，永不接收明文 Token。

单实例内使用并发锁，MongoDB 使用 LibreChat 用户 ID 和 Token 哈希唯一索引，重复运行不会产生重复映射。横向扩展前仍需增加分布式开通锁。

## 数据变化

- `ai_gateway_account_mappings`：增加 New API Token ID、加密管理凭证、LibreChat 角色/部门、生效策略和开通方式。
- `ai_quota_policies`：保存 default、role、department 和 user 策略。
- `ai_quota_provisioning_audits`：保存策略与账户管理审计，按配置 TTL 自动清理。
- LibreChat 原生 User、Role、Group、Conversation 和 Message 结构不变。

## 安全边界

- New API 管理凭证只注入 `ai-quota-adapter`，在 LibreChat API 容器中被显式覆盖为空。
- Adapter MongoDB 用户仅对独立 Adapter 数据库有读写权，对 `LibreChat` 数据库只有读权。
- Nginx 只公开 JWT 保护的用户额度和管理路由；Adapter `4100`、MongoDB、Redis 等端口不发布到主机。
- 管理接口不信任 JWT 中的角色声明，必须从 MongoDB 重新确认当前用户仍为管理员。
- 本阶段验收不调用模型，不产生付费请求。

## 部署与验收

```bash
cd /opt/cross-border-ai
./deploy/upgrade-phase5-quota-env.sh
./deploy/backup.sh
./deploy/build-ai-adapter.sh
./deploy/build-librechat-phase5-quota.sh
./deploy/start.sh
./deploy/verify-phase5-quota.sh
```

2026-07-27 实际结果：

- LibreChat 镜像：`sha256:66fb4f4d4a6505d9200258db39b54188ae1d56122515ee5c48f9e057d5600dfc`
- AI Adapter 镜像：`sha256:2dcbdcdb016fca96423b60ad25a1117a0111316d5ea17d8ec3db81a65b0f0224`
- 现有 LibreChat 用户：2；活动映射：2；自动管理：1；历史手工映射：1。
- `verify-phase5-quota.sh`：`PHASE5_QUOTA_VERIFY_OK`
- Phase 2、Phase 3、Phase 4 和既有私有 Skill/共享 Agent 回归均通过。
- 部署前备份：`/opt/cross-border-ai/deploy/backups/20260727T072105Z`
- 发布后备份：`/opt/cross-border-ai/deploy/backups/20260727T074315Z`

## 回滚

```bash
cd /opt/cross-border-ai
./deploy/rollback.sh /opt/cross-border-ai/deploy/backups/20260727T072105Z
```

默认只恢复镜像和配置，不删除数据卷。只有确认数据库也必须回退时才使用 `--restore-db`。New API 中已创建的零额度子账户不会被旧版应用使用；需要清理时应先禁用并审计，不自动删除。

## 已知限制

- 部署前已有的管理员映射是历史手工 Token，缺少可管理该 New API 用户的 Access Token；可继续聊天和读取余额，但在轮换为自动管理映射前，策略同步会返回 `legacy_mapping_read_only`。
- 部门或角色策略保存后，新用户立即使用；现有自动管理用户可点击“Provision / sync”或运行 `provision-phase5-users.sh` 批量同步。
- 当前批量同步一次最多处理 50 个 LibreChat 用户；用户规模扩大前应改为游标分页和分布式任务。
- New API 仍为 RC 版本，升级前必须重跑管理接口契约测试。
