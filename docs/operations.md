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
