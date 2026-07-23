# Phase 4：领星逐用户 MCP

## 交付范围

Phase 4 将领星 ERP 作为逐用户数据源接入，不引入共享公司密钥，不开放任何写工具，也不创建业务 Agent。用户在 LibreChat 的“设置 → 账号 → 我的数据源 → 领星 ERP”自行新增、覆盖、测试或删除密钥；系统管理员可在同一页面的管理员区域为目标用户代配置、测试和撤销。

领星官方 MCP 地址固定为 `https://mcp.lingxing.com/erp/mcp`，鉴权 Header 为 `X-Mcp-Key`。密钥属于具体领星账号，泄露后应在领星重新生成。

## 安全设计

- 浏览器只把新密钥提交一次；所有状态、用户和管理员接口都不会返回密钥原文。
- 网关使用独立的 32 字节主密钥和 AES-256-GCM 加密，随机 96 位 IV，并把 LibreChat `userId` 作为附加认证数据。密文无法复制给另一用户解密。
- MongoDB 只保存密文、IV、认证 Tag 和 SHA-256 指纹末四位，不保存明文、可逆指纹或请求参数。
- 网关服务账号仅具有 `lingxing_mcp_gateway` 的 `readWrite` 和 `LibreChat` 的 `read` 权限。
- 用户请求使用 LibreChat JWT；内部 MCP 请求同时校验随机内部密钥、用户 ID、邮箱、角色和数据库实时状态。
- 管理员只支持新增或覆盖，不能读取、导出、复制密钥，也不能把目标用户密钥作为自己的密钥使用。
- 自助覆盖会直接销毁旧密文，后续请求只能使用新密钥；撤销会删除密文字段。
- 凭证操作审计记录操作者、目标用户、动作、原因、来源 IP、新旧指纹和测试结果，不记录密钥。
- 调用审计记录用户、角色、部门、会话、工具、授权结果、HTTP 状态和耗时，不记录参数或返回正文。
- 审计默认保留 365 天。Docker 日志对 Authorization、内部密钥、用户密钥和密文字段做脱敏并轮转。

## API

用户 API（均要求有效 LibreChat JWT）：

- `GET /api/lingxing/status`
- `GET /api/lingxing/usage`
- `PUT /api/lingxing/credential`
- `POST /api/lingxing/test`
- `DELETE /api/lingxing/credential`

管理员 API（只允许系统 `ADMIN` 或业务 `admin`）：

- `GET /api/lingxing/admin/users`
- `GET /api/lingxing/admin/users/:userId/status`
- `PUT /api/lingxing/admin/users/:userId/credential`
- `POST /api/lingxing/admin/users/:userId/test`
- `DELETE /api/lingxing/admin/users/:userId/credential`
- `GET /api/lingxing/admin/audits`

管理操作的 `reason` 为必填。Nginx 只公开 `/api/lingxing/`；网关的 `/mcp`、`/health`、`/readyz` 和 4300 端口仅在 Docker 网络内可达。

## 工具与权限

官方工具按下列权限组归类。未登记的新工具默认拒绝，避免领星升级后意外开放写能力。

| 权限组 | 范围 |
| --- | --- |
| `lingxing_read_basic` | 店铺、FBA 库存、Listing、ASIN 商品表现 |
| `lingxing_finance` | MSKU 利润报表、订单毛利 |
| `lingxing_ads` | 广告店铺、Campaign、广告组、关键词、搜索词、投放、商品、Portfolio |
| `lingxing_monitor_read` | 关键词排名、竞品、跟卖、店铺监控、自定义报表与指标读取 |
| `lingxing_write` | 创建监控、增加或更新自定义指标等所有写工具 |

Phase 4 权限矩阵：

| 角色/部门 | 基础读 | 财务读 | 广告读 | 监控读 | 写 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ADMIN` / `admin` | 是 | 是 | 是 | 是 | 否 |
| `operation` / 运营部 | 是 | 否 | 否 | 是 | 否 |
| `advertising` / 广告组 | 是 | 否 | 是 | 否 | 否 |
| `finance` / 财务组 | 是 | 是 | 否 | 否 | 否 |
| `technical` / 技术部 | 否 | 否 | 否 | 否 | 否 |
| `viewer` / `USER` | 否 | 否 | 否 | 否 | 否 |

网关同时执行领星官方的单工具每秒最多一次限制。Phase 4 为单实例部署，限流状态保存在进程内；横向扩展前必须把该状态迁移到 Redis。

## 部署

```bash
cd /opt/cross-border-ai
deploy/backup.sh
deploy/configure-phase4.sh
deploy/start.sh
deploy/verify-phase4.sh
```

`configure-phase4.sh` 只生成网关内部密钥、AES 主密钥、MongoDB 密码并构建两个不可变本地镜像；它不会请求或保存任何用户领星密钥。LibreChat 镜像始终从上游 `v0.8.7` Commit `9e74cc0e57b395926122bd4062c1fcedc48ed465` 源码构建。

## 验收

无真实领星密钥时必须满足：

- 网关健康，匿名凭证 API 返回 401；
- MCP 漏传/伪造用户身份被拒绝；
- 任意角色调用写工具均在网关内被拒绝，不访问领星；
- 未配置或未通过测试的用户不会访问领星；
- 4300、4200、4100、8000、7700、5432 和 27017 均未发布到宿主机；
- RBAC 脚本可重复执行；
- Git、响应和日志中无真实密钥。

配置真实密钥后还需验证：

- 保存后页面只显示指纹末四位；
- 测试返回工具数量并把状态置为 `active`；
- A 用户不能读取、测试、撤销或调用 B 用户的密钥；
- 自助覆盖后旧密文不存在，撤销后密文字段不存在；
- 角色只能看到并调用权限矩阵允许的只读工具。

## 回滚

部署前备份包含 Compose、Nginx、LibreChat 配置、受保护的 `.env`、镜像状态和四个 MongoDB 数据库。回滚配置和镜像：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<timestamp>
```

只有确认数据也需要回退时才执行：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<timestamp> --restore-db
```

脚本不会删除命名卷。恢复领星数据库时必须同时恢复同一备份中的 `deploy.env`，否则 AES 主密钥不匹配，历史密文将无法解密。

## 已知限制

- LibreChat v0.8.7 的外置 Admin Panel 镜像没有可维护的插件扩展点，因此目标用户代配置功能位于 LibreChat 账号设置的管理员区域；服务端权限和审计不依赖前端隐藏。
- Phase 4 不开放写工具、不创建 Agent、不做跨实例限流，也不把领星凭证同步到 New API。
- 领星 MCP 工具清单会变化。每次升级必须先更新显式工具分类并完成回归测试；未知工具始终拒绝。
