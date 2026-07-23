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
