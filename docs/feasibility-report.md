# LibreChat + New API + 双 MCP 改造可行性报告

## 结论

项目可行，建议以 LibreChat `v0.8.7`（Commit `9e74cc0e57b395926122bd4062c1fcedc48ed465`）作为交互、认证、会话与权限底座，以独立 Adapter 对接 New API，并把领星与卖家精灵分别实现为受审计 MCP Server。Phase 1 只部署底座，不接入任何模型、MCP 或业务 Agent。

## 可直接复用

- LibreChat：邮箱登录、JWT/刷新令牌、Conversation/Message、简体中文、Admin Panel、Role、Group、SystemGrant、配置覆盖、Agent/MCP 接口框架。
- New API：OpenAI 兼容的 Models、Chat Completions、Responses、Token/分组/额度/日志管理接口。
- 权限：内置 `ADMIN` 作为业务 `super_admin`；自定义 Role 表达岗位权限；Group 表达部门；SystemGrant 控制 Admin Panel 能力。

## 必须补齐的能力

- New API Adapter：LibreChat 用户与 New API 用户/Token 的受控映射、额度查询、请求签名、错误归一化、幂等重试与成本审计。
- 双 MCP：凭证托管、租户隔离、工具 allowlist、只读/写入分级、审批与完整审计。
- 业务 Agent：按部门授权的提示词、模型、工具、知识库和费用上限。
- 管理扩展：LibreChat `v0.8.7` 的 `/api/admin/users` 主要是查询；用户创建/禁用仍使用官方 `create-user`、`ban-user` CLI。

## 实际验证

- 服务器：Ubuntu 22.04.5 LTS、Docker 29.4.0、Compose 5.1.2、x86_64/AVX2、31 GiB 内存；根分区约 70 GiB 可用；80/3000 未占用。
- New API：`https://api.aso8ty.com` 响应头与 `/api/status` 均报告 `v1.0.0-rc.21`。
- 管理接口：用户、Token、分组、模型、日志接口使用管理员系统访问令牌实测成功；响应均只记录结构，不保留用户数据或日志正文。
- 测试 Token：`/v1/models` 实测成功；用最低倍率候选 `kimi-k2` 完成非流式、SSE、无副作用 Tool Calling 和 Responses 请求，均为 HTTP 200。
- SSE：存在合法 JSON data 帧与 `[DONE]`；Tool Calling 只返回一次 `get_constant`，未执行外部动作。

## 数据变化

Phase 1 只写入 LibreChat 原生 User、Role、Group、SystemGrant、Conversation、Message 与配置覆盖数据，不创建额度、New API 映射或 MCP 凭证集合。预置脚本创建六个自定义角色、六个本地部门，并将首个系统管理员加入“管理层”。

## 风险与控制

- Admin Panel 仍为 Preview：固定镜像 digest，保留 CLI 管理路径与回滚包。
- New API 为 RC：Phase 2 必须对已验证结构做契约测试，升级前重新跑四类最小请求。
- HTTP 仅限局域网：Cookie 明确关闭 Secure；获得内部域名与证书后再启用 HTTPS。
- 镜像 `latest` 可变：只用于一次性拉取检查，生产 Compose 只允许 `@sha256:`。
- 凭证泄露：`.env` 为 `0600`，日志不输出请求头/正文，Git 和响应执行秘密扫描。
- 上游升级冲突：品牌尽量使用环境/YAML/Nginx，不修改 LibreChat 核心 UI/i18n。

## 八阶段路线

1. Phase 1：基础部署、品牌、登录关闭注册、Admin Panel、Role/Group 预置。
2. Phase 2：New API Adapter、用户/Token 映射、额度与发布门槛。
3. Phase 3：领星只读 MCP、凭证隔离与审计。
4. Phase 4：卖家精灵只读 MCP、限流与字段脱敏。
5. Phase 5：部门业务 Agent 与知识库。
6. Phase 6：写工具审批、幂等键与补偿事务。
7. Phase 7：成本治理、告警、审计报表与横向扩展。
8. Phase 8：HTTPS/SSO、灾备演练、灰度升级与正式验收。

## 回滚

部署前保存 Git SHA、镜像 digest、未展开变量的 Compose/config、副本清单和 MongoDB dump。回滚优先恢复上一组 digest/config 并重启；仅在数据结构或数据已变更且人工确认后恢复 MongoDB。任何回滚都不自动删除命名卷。
