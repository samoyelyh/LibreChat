# Phase 1 运维手册

## 地址与目录

- 部署目录：`/opt/cross-border-ai`
- 用户入口：`http://192.168.0.27:7999`
- 管理入口：`http://192.168.0.27:3000`
- 真实环境变量：`/opt/cross-border-ai/deploy/.env`（必须为 `0600`）

## 首次启动

```bash
cd /opt/cross-border-ai
./deploy/start.sh
./deploy/create-user.sh
./deploy/seed-rbac.sh seed
./deploy/verify-phase1.sh
```

`create-user.sh` 调用固定镜像内的官方 `/app/config/create-user.js` CLI，密码只在交互提示中输入，不作为命令参数。数据库中的首个用户由 LibreChat 设为系统 `ADMIN`。生产镜像默认工作目录是 `/app/api`，因此不从该目录直接调用 workspace 中的同名 npm script。

## 日常命令

```bash
./deploy/start.sh
./deploy/stop.sh
./deploy/backup.sh
./deploy/seed-rbac.sh verify
./deploy/verify-phase1.sh
```

## 更新

更新不追随 `latest`。必须提供显式发布标识和一个或多个 digest：

```bash
./deploy/update.sh v0.8.8 \
  api=registry.example/librechat@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

脚本先备份，再写入忽略 Git 的 runtime override、拉取指定 digest 并重启。更新前必须完成上游差异审查、New API 契约测试和数据库迁移评估。

## 回滚

```bash
./deploy/rollback.sh /opt/cross-border-ai/deploy/backups/20260722T000000Z
```

只有人工确认需要恢复数据库时才追加 `--restore-db`。回滚不会执行 `down -v`，也不会删除命名卷。

## 用户管理限制

Admin Panel v0.8.7 主要支持用户查询，以及 Role、Group、SystemGrant 和配置管理。用户创建、禁用使用官方 CLI：

```bash
./deploy/create-user.sh
docker compose --env-file deploy/.env -f deploy/docker-compose.production.yml exec api node /app/config/ban-user.js
```

## HTTPS

Phase 1 仅用于可信局域网 HTTP，`SESSION_COOKIE_SECURE=false`。取得内部域名与证书后，应新增 443、强制 HTTPS、启用 Secure Cookie 与 HSTS，再关闭明文入口。

## Phase 2 常用操作

首次升级：

```bash
./deploy/upgrade-phase2-env.sh
./deploy/build-ai-adapter.sh
./deploy/start.sh
```

映射一个现有非管理员测试用户时运行 `./deploy/upsert-ai-mapping.sh`。脚本会显示已选择的 Email 和模型，并提供不回显的 Token 输入框；Token 不作为命令参数。只读验收运行 `./deploy/verify-phase2.sh`。

## SSH 项目密钥

经用户明确授权，后续阶段保留一把仅用于 `woda@192.168.0.27` 的项目专用 ED25519 密钥。私钥只保存在本机用户 `.ssh` 目录，不得复制到仓库、服务器部署目录、备份或日志。撤销时从服务器 `~/.ssh/authorized_keys` 删除注释为 `woda-cross-border-ai-codex` 的公钥，并删除本机对应私钥；轮换时先验证新密钥，再撤销旧密钥。

## Phase 3 卖家精灵 MCP

首次配置或轮换公司统一密钥：

```bash
./deploy/configure-sellersprite-secret.sh
```

该脚本提供带标签的两次隐藏输入，不接受空值或两次不一致的值。保存后只能覆盖，不能从管理命令读回明文。

日常只读管理：

```bash
./deploy/sellersprite-admin.sh status
./deploy/sellersprite-admin.sh test
./deploy/sellersprite-admin.sh audits 50
./deploy/seed-phase3-rbac.sh verify
./deploy/verify-phase3.sh
```

`status` 只显示是否配置、SHA-256 指纹后四位、更新人/时间、最近连接测试、最后调用、本月次数和套餐使用比例。`test` 只执行 MCP 初始化和工具列表，不发起业务数据查询。

## Phase 6 预设 Agent

```bash
./deploy/seed-phase6-agents.sh seed
./deploy/seed-phase6-agents.sh verify
./deploy/verify-phase6.sh
```

`seed-phase6-agents.sh` 幂等维护“领星经营分析”“Amazon 市场分析”“跨境综合诊断”三套共享 Agent、服务端执行型 Skill、精确工具 allowlist、Deferred Tools 和 Owner/Viewer ACL。写工具保持后端禁用；`verify-phase6.sh` 会直接验证网关拒绝领星写调用。

NewAPI 的 `gpt-5.6-sol` 经真实 Chat Completions/Responses 探测能够直接读取 Excel，但 LibreChat MyAgent 的原生文件转换链路无法稳定把附件交给全部已配置模型。`woda-ai` Agent 因此统一在上传时使用 LibreChat 内置文档解析器提取 PDF、Word、Excel 和 OpenDocument 的纯文本，同时保留原始文件用于历史记录和下载；模型请求不再包含上游不兼容的 `file` 内容块。

历史消息附件若在本兼容修复部署前上传，可在确认文件名和所属用户后执行一次幂等补录：`TARGET_FILENAME='<文件名>' TARGET_USER_ID='<用户 ID>' docker compose ... exec -T api node /app/deploy/backfill-agent-document-context.js`。脚本只给唯一匹配的本地文档补充解析文本，不替换或删除原文件；没有唯一匹配时拒绝执行。
