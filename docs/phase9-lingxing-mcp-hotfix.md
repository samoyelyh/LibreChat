# Phase 9 领星 MCP 429/502 修复记录

## 问题与根因

- 用户端访问 `/api/lingxing/status` 返回 502。领星网关容器健康，LibreChat API 可通过 `mcp` 网络访问网关，但 Nginx 仅连接 `edge` 网络，无法解析只连接 `backend`、`mcp` 与独立出站网络的领星网关。
- 领星官方限制每个 Tool 的调用频率为 QPS 1。原有网关只实现每用户、每 Tool、每分钟 60 次的分钟桶，允许同一秒内突发多次调用，可能被领星上游返回 429。

## 修复

- 新增内部网络 `lingxing_control`，只连接 Nginx 与领星网关，用于浏览器侧凭证管理 API。Nginx 不加入 `mcp` 网络，领星网关仍不加入公开 `edge` 网络，MCP 与健康检查端口继续不对局域网发布。
- 领星网关新增 MongoDB 原子节流锁，同一用户的同一 Tool 两次调用至少间隔 `LINGXING_MCP_TOOL_INTERVAL_MS`，生产默认 1100 毫秒。
- 遇到本地每秒节流时最多排队等待两次；分钟硬上限仍保留。
- 仅对已经通过只读权限策略的 Tool 调用、`tools/list` 和连接测试启用一次 429 重试，遵循上游 `Retry-After`，单次等待上限 5 秒。写工具仍保持关闭且不会自动重试。

## 验收标准

- 未登录访问 `/api/lingxing/status` 返回 401，而不是 502。
- Nginx 与领星网关共享 `lingxing_control`；Nginx 不加入 `mcp`；领星网关不加入 `edge`。
- 同一用户、同一 Tool 的首次调用获得执行槽，紧接着的调用被节流并给出重试时间。
- 领星网关单元测试、TypeScript 类型检查、Compose 校验、Phase 8 和 Phase 9 回归全部通过。
- 日志与 Git 跟踪文件不包含领星密钥或鉴权头值。

## 回滚

使用部署前备份恢复 Compose、Nginx 配置和上一版领星网关镜像。数据库仅新增短生命周期的 `pace:` 限流记录，无需回滚业务数据；不删除数据卷。
