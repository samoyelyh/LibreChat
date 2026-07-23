# Phase 3：卖家精灵公司统一 MCP

## 实施边界

本阶段只接入卖家精灵公司统一 MCP，不接入领星个人 MCP、业务 Agent、自动 New API 开户、部门预算或完整管理后台页面。

官方协议核对结果：

- 卖家精灵官方地址为 `https://mcp.sellersprite.com/mcp`，支持 Streamable HTTP。
- 官方要求请求头名称固定为 `secret-key`，也提供 URL 参数方式；本项目只使用请求头，禁止把密钥放入 URL。
- LibreChat v0.8.7 的 YAML MCP 配置支持 `streamable-http`、服务器环境变量与 `LIBRECHAT_USER_*` 请求头占位符。
- 公司统一凭证没有配置 `customUserVars`，普通用户界面不会出现卖家精灵密钥输入框。
- v0.8.7 的 MCP `title` 校验只允许英文字母、数字和空格，因此标题使用 `SellerSprite`，中文能力说明保留；未为改中文标题修改上游核心校验器。

参考：

- [卖家精灵 MCP 接入方式](https://open.sellersprite.com/mcp/16)
- [卖家精灵 MCP 工具目录](https://open.sellersprite.com/mcp)
- [LibreChat MCP](https://www.librechat.ai/en/docs/features/mcp)
- [LibreChat MCP Servers 配置结构](https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers)

## 架构与密钥边界

```text
LibreChat（当前登录用户上下文）
  │  X-MCP-Gateway-Key + 用户 ID/Email/Role
  ▼
SellerSprite MCP Gateway（Docker 内网，无 Host Publish）
  ├─ 向 LibreChat Mongo 只读校验用户、角色、部门
  ├─ 后端执行工具授权与 tools/list 过滤
  ├─ 注入 secret-key
  ├─ 透明转发 Streamable HTTP / SSE / Session Header
  └─ 写入独立调用审计库
  ▼
https://mcp.sellersprite.com/mcp
```

真实 `SELLERSPRITE_MCP_SECRET_KEY` 只存在于服务器权限为 `0600` 的 `deploy/.env` 和网关容器环境中。LibreChat YAML、MongoDB、浏览器响应、URL、Git 和调用日志都不保存明文。网关 Mongo 只保存 SHA-256 指纹后四位、更新时间、操作人、连接测试结果和调用审计。

Mongo 用户 `sellersprite_gateway` 只拥有：

- `sellersprite_mcp_gateway` 数据库 `readWrite`；
- `LibreChat` 数据库 `read`。

## 权限策略

所有请求同时校验 LibreChat 数据库中的用户 ID、Email、Role 和 Group 成员关系。客户端修改请求头不能绕过数据库校验。

| 身份条件 | 权限 |
|---|---|
| 内置 `ADMIN` 或业务 `admin` | 全部当前只读工具；卖家精灵新增工具仅管理员可见 |
| `operation` 且属于“运营部” | `sellersprite_asin`、`sellersprite_keyword`、`sellersprite_market`、`sellersprite_review` |
| `advertising` 且属于“广告组” | 关键词、流量词、ABA，以及 `competitor_lookup`、`asin_competitor` |
| `technical`、`finance`、`viewer`、内置 `USER` 或角色/部门不匹配 | 拒绝 |

非管理员遇到卖家精灵新增的未知工具时默认拒绝。`tools/list` 会按当前用户权限过滤，不能通过枚举工具发现未授权能力；`tools/call` 再次强制校验。

Phase 3 不在 YAML 中设置整个 `interface.mcpServers` 对象。LibreChat v0.8.7 只要看到该对象，就会把它当作启动时系统角色权限迁移输入；省略它可以让数据库中预置的角色级 `MCP_SERVERS` 在 API 单独重启后保持不变。`CREATE`、`SHARE`、`SHARE_PUBLIC` 和 `CONFIGURE_OBO` 仍在所有角色权限中显式关闭。

## 调用审计

`tools/call` 独立记录：

- 用户 ID、角色和部门；
- 会话 ID、消息 ID；
- Tool 名称和工具权限组；
- 允许/拒绝、成功/失败、HTTP 状态、错误码；
- 调用时间、耗时和可安全推断的返回记录数；
- 公司密钥本月累计调用次数。

不记录工具参数、Amazon 查询正文、返回正文、认证头或任何密钥。套餐月额度通过 `SELLERSPRITE_MCP_MONTHLY_LIMIT` 配置；为 `0` 时使用比例返回 `null`，不会伪造额度。

## 运维命令

全部命令在 `/opt/cross-border-ai` 执行：

```bash
./deploy/configure-sellersprite-secret.sh
./deploy/sellersprite-admin.sh status
./deploy/sellersprite-admin.sh test
./deploy/sellersprite-admin.sh audits 50
./deploy/verify-phase3.sh
```

密钥更换只能再次运行配置脚本覆盖。脚本使用两次隐藏输入，显示长度与 SHA-256 指纹后四位，随后重建/重启网关、同步安全元数据并执行无业务副作用的 `initialize + tools/list` 连接测试。

## 回滚

备份增加 `sellersprite-mongodb.archive.gz`；受保护的 `deploy.env` 包含服务器密钥。回滚默认只恢复 Compose、LibreChat 配置与镜像，不删除命名卷；只有显式传入 `--restore-db` 才恢复 LibreChat、AI Adapter 和卖家精灵审计数据库。

## 已知限制

- Phase 3 管理功能由服务器侧安全 CLI 提供；Admin Panel 页面集成留给后续管理后台阶段。
- LibreChat 当前只允许安全的会话/消息 body 占位符，Agent ID 要到 Agent 阶段再补充；Phase 3 审计中的 Agent 字段为空。
- LibreChat 的用户封禁是缓存态机制。网关每次调用都会重新验证用户和权限，但“已打开页面旧 Token 立即失效”的统一实现仍需后续集中会话吊销机制。
