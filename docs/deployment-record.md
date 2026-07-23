# Phase 1 部署记录

## 固定基线

- LibreChat tag：`v0.8.7`
- LibreChat commit：`9e74cc0e57b395926122bd4062c1fcedc48ed465`
- LibreChat tree：`7df65990a0ae0ecf70dd609962d964fc70c4a8f5`
- 工作分支：`woda/phase-1`
- 上游 remote：`https://github.com/danny-avila/LibreChat.git`
- New API：`v1.0.0-rc.21` / `bde9b2f44887d34ec54799ae191d50f97914359e`

本机直连 GitHub 在获取对象时多次连接重置，最终通过 `ghproxy.net` 仅传输 Git 对象；检出结果同时匹配 GitHub 官方 Git Data API 返回的 commit 与 tree SHA。传输用 remote 已删除，仓库只保留官方 `upstream`。

## 生产镜像锁

| 服务 | 不可变镜像 |
|---|---|
| Nginx | `nginx@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284` |
| LibreChat API | `ghcr.io/danny-avila/librechat-dev-api@sha256:91a1f259ee8902875f142c4efd3f36dd17fd87931f9f0070c059b952244b3694` |
| Admin Panel | `ghcr.io/clickhouse/librechat-admin-panel@sha256:9a78851f84f448eab780ac658c4d17db51974c240492affc789a72d61e35f678` |
| MongoDB | `mongo@sha256:098862b1339f031900ca66cf8fef799e616d6324fa41b9a263f2ec899552c1ef` |
| Meilisearch | `getmeili/meilisearch@sha256:8b57fc3c7f46535ddef3828df1538465ac19d892eb57c9a10da6df0880bd5856` |
| PostgreSQL/pgvector | `pgvector/pgvector@sha256:8809cfffff0082cf260c9ac752f1dd1afc77f6f0a55c4e6411321e78efc3d9a5` |
| RAG API | `ghcr.io/danny-avila/librechat-rag-api-dev-lite@sha256:c0ad82657b556c1e16dcfca85d045788f67caa223e25e70eb687f4d16b41dedc` |

## 服务器预检（脱敏）

- 主机：`192.168.0.27`，用户 `woda`
- OS：Ubuntu 22.04.5 LTS，内核 6.8，x86_64，支持 AVX/AVX2/SSE4.2
- Docker：29.4.0；Compose：5.1.2
- 内存：31 GiB；Swap：2 GiB
- 根分区：266 GiB，预检时可用约 70 GiB
- 部署目录：`/opt/cross-border-ai`，属主 `woda`
- `sudo -n`：不可用，交互式 sudo 成功
- 80/3000：预检时未监听
- 现有 BatchForge/Milvus 容器保持原状

## New API 验证摘要

凭证保存在服务器 `/home/woda/.config/cross-border-ai/newapi-probe.env`，权限 `0600`，未复制到本仓库。验证输出只保留状态码、字段名、数据类型、模型名和协议计数。

## 变更记录

后续部署、管理员创建、RBAC 预置、测试和回滚结果追加到本文件。不得写入密码、Token、Authorization Header、用户列表或日志正文。

- RAG API 在 Phase 1 保持部署和健康检查，但文件检索在全局配置中关闭。
- 为满足固定 RAG 镜像的启动校验，嵌入客户端使用非秘密占位值和本机丢弃端点；任何意外请求都会在容器内快速失败，不会访问外部模型。Phase 2 启用 RAG 时必须同时替换 provider、model、base URL 和凭证。

## 实际部署与验收结果

- 生产目录：`/opt/cross-border-ai`；用户入口：`http://192.168.0.27:7999`；管理入口：`http://192.168.0.27:3000`。
- Nginx、LibreChat API、Admin Panel、MongoDB、Meilisearch、PostgreSQL/pgvector 与 RAG API 全部为 `healthy`。
- 首个账号通过官方 CLI 交互创建并确认为系统 `ADMIN`；第二个 CLI 账号确认为非管理员。密码未作为命令参数、未写入 Git 或本记录。
- 六个自定义 Role、六个 Group 和业务 `admin` 的 7 项 SystemGrant 连续预置两次后数量不变。
- 公开注册返回 HTTP 403；首次访问写入 `lang=zh-Hans`，已有语言 Cookie 不被覆盖。
- 浏览器实测显示“沃达跨境电商AI平台”、简体中文登录页和 LibreChat `v0.8.7` 上游链接；用户已确认用户端与 Admin Panel 登录成功。
- 系统管理员的用户、角色、部门、基础配置四个 Admin API 均返回 HTTP 200；认证后运行配置确认 Agent、MCP、Remote Agent、Skills、记忆、代码执行、Web 搜索和共享链接全部关闭。
- 会话隔离实测为他人 HTTP 404、所有者 HTTP 200，临时测试会话随后删除。
- 整栈重启后账号、Role、Group、SystemGrant 与配置仍存在，`verify-phase1.sh` 再次返回 `PHASE1_VERIFY_OK`。
- 局域网实测：7999/3000 可达，80 已按用户要求释放；3080/27017/7700/5432 不可达。主机原有独立 Python 服务占用 8000，与本 Compose 项目无关；本项目 RAG API 无任何 Host Publish 映射。
- 日志中未发现 Authorization Header 模式，已跟踪文件和容器日志中未发现 `.env` 真实值。
- 最终备份目录：`/opt/cross-border-ai/deploy/backups/phase1-final-20260722`；回滚不会自动删除命名卷。

## 已知限制

- Admin Panel 仍为 Preview；`/api/admin/users` 在本版本主要提供查询，用户创建和禁用继续使用官方 CLI。
- Phase 1 为可信局域网 HTTP，未启用 Secure Cookie/HSTS；取得内部域名和证书后必须升级 HTTPS。
- New API 为 RC 版本，Phase 2 接入前必须重跑管理 API 结构与四类模型请求契约测试。

## Phase 2 实际部署记录（2026-07-23）

- 分支：`woda/phase-2`；LibreChat 上游基线仍为 `v0.8.7` / `9e74cc0e57b395926122bd4062c1fcedc48ed465`。
- AI Quota Adapter 已部署为独立 Node.js/TypeScript 服务；最终不可变本地镜像 ID 为 `sha256:18623910fffadc300ffe44024c28551a33f19980fdc01d96e0f6e642d9e1db2e`。
- Redis `7.4.9-alpine` 使用固定 digest，仅加入内部 Docker 网络；Adapter、Redis、MongoDB、Meilisearch、PostgreSQL 与 RAG API 均未发布 Host 端口。
- 已为一个现有非管理员测试用户建立独立 New API Token 映射；Token 使用 AES-256-GCM 保存，明文未写入 Git、命令参数、日志或交付记录。
- 授权模型为 `kimi-k2`。真实最低成本验收结果：模型列表 1 个、非流式 HTTP 200、SSE HTTP 200。
- 使用 2 分钟临时 LibreChat JWT 请求原生 `/api/models`，返回 `woda-ai: ["kimi-k2"]`，证明用户上下文、Custom Endpoint 和 Adapter 模型过滤链路已贯通；JWT 未输出或保存。
- 最近 30 分钟账单归属核验：Adapter 审计 2 条（流式 1、非流式 1），New API Token 日志 2 条（流式 1、非流式 1），两侧一致。New API 仍是唯一计费账本。
- `verify-phase2.sh` 返回 `PHASE2_VERIFY_OK`；完整 `verify-phase1.sh` 回归返回 `PHASE1_VERIFY_OK`。
- Redis 与 Adapter 重启后映射、模型列表和真实余额仍可读取，重启持久化验证通过。
- 用户入口保持 `http://192.168.0.27:7999`，管理入口保持 `http://192.168.0.27:3000`。本项目没有发布 80；当前宿主机 80 与 6379 分别由既有 `batchforge-frontend`、`batchforge-redis` 占用，未对它们执行任何变更。
- 部署前备份：`/opt/cross-border-ai/deploy/backups/20260723T040927Z`。
- 最终备份：`/opt/cross-border-ai/deploy/backups/20260723T042755Z`，包含 LibreChat Mongo、Adapter Mongo、Compose/config、不可变镜像记录和权限为 `0600` 的受保护环境文件。
- 根据用户 2026-07-23 的明确授权，SSH 从“每阶段临时密钥”调整为本机长期项目专用 ED25519 密钥；密钥不进入 Git。失败的临时公钥已从服务器删除，临时私钥已从本机删除。

Phase 2 没有实现 Phase 5 的自动 New API 用户开通、部门预算、额度调整后台和完整“我的额度”页面。当前余额与使用记录通过受 JWT 保护的 `/api/ai-quota/balance`、`/api/ai-quota/usage` 提供真实数据。

## Phase 3 实施记录（2026-07-23）

- 分支：`woda/phase-3`；范围只包含卖家精灵公司统一 MCP。
- 新增独立 `sellersprite-mcp-gateway`，负责服务端密钥注入、用户/角色/部门双重校验、工具列表过滤、调用审计和管理员连接测试。
- LibreChat 只连接 Docker 内网 `http://sellersprite-mcp-gateway:4200/mcp`；真实卖家精灵地址与 `secret-key` 仅由网关使用，网关不发布 Host 端口。
- 普通用户没有 `customUserVars`、密钥输入框或 MCP Server 创建权限。
- 权限组：`sellersprite_asin`、`sellersprite_keyword`、`sellersprite_market`、`sellersprite_review`；未知工具对非管理员默认拒绝。
- 网关数据库账号对 `LibreChat` 只有读权限，对独立审计库只有读写权限。
- 本地自动测试：3 个文件、12 项测试通过；TypeScript 类型检查和构建通过。
- 真实密钥已由用户隐藏输入并保存到权限为 `0600` 的服务器 `deploy/.env`；Git、公共配置和全部容器日志的明文匹配扫描通过。
- 最终本地镜像 ID：`sha256:20c2589439dbd8b14b826d5997d9a6d30f794f7d9fb5bd4734ef9b21e20ca3d7`。网关仅在 Docker 内网监听 `4200`，没有 Host Publish。
- SellerSprite Streamable HTTP 连接测试成功，实际发现 44 个工具；执行一次最低副作用真实工具调用 `trademark_country_list` 成功，月度审计计数准确从 0 增至 1。
- Phase 3 授权验证确认管理员允许、普通用户拒绝；8 个系统/业务角色和 6 个部门重复预置不产生重复数据。
- 整个 `interface.mcpServers` 按 v0.8.7 权限迁移语义从 YAML 省略，数据库角色权限成为唯一 `MCP_SERVERS` 来源；API 单独重启后以只验证模式确认权限未被重置。
- 重建 API 和 SellerSprite 网关后，连接状态、凭证安全元数据与月度审计计数保持不变；Nginx 使用 Docker DNS 动态解析，入口仍返回 HTTP 200。
- `verify-phase3.sh`、`verify-phase2.sh`、`verify-phase1.sh` 分别返回 `PHASE3_VERIFY_OK`、`PHASE2_VERIFY_OK`、`PHASE1_VERIFY_OK`。
- 最终备份：`/opt/cross-border-ai/deploy/backups/20260723T082701Z`，包含 LibreChat、AI Adapter 与 SellerSprite 审计数据库归档、Compose/config、镜像记录和受保护环境文件。
