# Phase 6：预设 Agent、工具分组与 Deferred Tools

## 交付范围

Phase 6 在 Phase 3/4 的两类 MCP 网关和 Phase 5 的服务端执行型 Skill 基础上，预置三套共享业务 Agent：

| Agent | 数据源 | 绑定工具 | Eager | Deferred |
| --- | --- | ---: | ---: | ---: |
| 领星经营分析 | 当前用户自己的领星凭证 | 23 | 4 | 19 |
| Amazon 市场分析 | 公司统一卖家精灵凭证 | 40 | 5 | 35 |
| 跨境综合诊断 | 领星 + 卖家精灵 | 63 | 5 | 58 |

三套 Agent 固定使用 `woda-ai` Endpoint 和 `gpt-5.6-sol`。所有 Agent 只允许直接工具调用，不启用代码间接调用。每套 Agent 的详细业务规则存放在独立的 `executionOnly` Skill 中；共享用户能使用 Agent，但不能读取 Skill 正文或附件。

## 工具组

工具目录由 `deploy/phase6-tool-catalog.js` 统一声明，包含：

- 领星：`lingxing_read_basic`、`lingxing_finance`、`lingxing_ads`、`lingxing_monitor_read`、`lingxing_write`；
- 卖家精灵：`sellersprite_asin`、`sellersprite_keyword`、`sellersprite_market`、`sellersprite_review`。

角色和部门授权仍由两个 MCP 网关在服务端校验；Agent 授权通过 Agent 的精确工具 allowlist 实现。三套 Agent 均未绑定 `lingxing_write` 中的任何工具。

卖家精灵实际返回 44 个工具，本阶段只绑定经过分类和审查的 40 个目录工具；其余工具不会因为上游新增而自动进入 Agent。领星实际返回 23 个获授权的只读工具，写工具在 `tools/list` 中的暴露数量为 0。

## Deferred Tools

每个 Agent 只把常用的入口查询保留为 Eager，其余工具设置：

```json
{
  "defer_loading": true,
  "allowed_callers": ["direct"]
}
```

LibreChat 在模型需要时通过 `tool_search` 发现 Deferred Tools，避免把数十个工具 Schema 全部塞进每次模型上下文。预置脚本同时验证每个 Agent 至少包含一个 Eager 和一个 Deferred Tool。

## 数据表达规则

- 领星经营分析区分“领星原始数据”“AI 计算”“AI 建议”，金额必须标注币种，百分比不得重复乘以 100。
- Amazon 市场分析区分“第三方采集数据”“第三方估算”“AI 推导”，估算销量不得表述为真实订单销量。
- 跨境综合诊断只按已确认的 Amazon 站点、ASIN 和时间范围关联，禁止仅凭商品名称模糊关联；输出标记“内部实际数据”“外部第三方数据”“外部估算数据”“AI 推导结果”。
- 任一数据源不可用或字段缺失时必须明确降级，不允许用模拟数据或模型推测冒充真实 MCP 结果。

## 写操作安全边界

Phase 6 的生产状态保持“所有领星写工具默认禁用”：

- `lingxing_write` 六个工具不出现在任何预设 Agent 中；
- 领星网关的 `tools/list` 不向用户暴露写工具；
- 即使系统管理员直接构造 `tools/call`，网关仍返回 403；
- 聊天中的“确认”“同意”或提示词指令不能改变后端权限。

LibreChat v0.8.7 的 MCP 执行链没有可复用的“暂停工具调用 → 显示确认卡 → 单次恢复相同调用”机制。本阶段没有用普通聊天消息伪造二次确认，也没有为了展示确认卡而开放写能力。因此当前系统不会显示可执行写确认卡，因为没有任何写调用能够到达上游。

未来如需启用写工具，必须先完成真实的单次确认状态机：确认卡展示数据源、Tool、操作类型、店铺、对象、完整待提交参数和风险；授权绑定用户、调用 ID 与参数摘要且短时有效；取消不得调用；失败不得自动重试；创建类操作必须有幂等键；审计日志不得记录密钥。该能力通过自动化验收前，`lingxing_write` 必须继续保持关闭。

## 权限与幂等

- 系统管理员拥有三套 Agent 和三份 Skill 的 Owner ACL。
- 内置 `USER` 与 `admin`、`technical`、`operation`、`advertising`、`finance`、`viewer` 获得 Viewer ACL。
- 用户能否真正调用某类 MCP 工具，继续由其角色、部门、凭证状态和网关策略共同决定。
- `seed-phase6-agents.sh` 可重复执行；配置未变化时不新增 Agent、Skill 或版本记录。

## 部署与验收

```bash
cd /opt/cross-border-ai
deploy/backup.sh
deploy/start.sh
deploy/verify-phase6.sh
```

2026-07-27 实际验收结果：

- 部署前备份：`/opt/cross-border-ai/deploy/backups/20260727T081811Z`；
- 部署完成备份：`/opt/cross-border-ai/deploy/backups/20260727T083016Z`；
- LibreChat 镜像仍为 `sha256:66fb4f4d4a6505d9200258db39b54188ae1d56122515ee5c48f9e057d5600dfc`；
- AI Adapter 镜像仍为 `sha256:2dcbdcdb016fca96423b60ad25a1117a0111316d5ea17d8ec3db81a65b0f0224`；
- `PHASE6_AGENTS_OK agents=3 tools=126 deferred=112 writeTools=0 viewerRoles=7`；
- `PHASE6_API_OK viewerSkills=3 viewerAgents=3 redaction=ok`；
- `PHASE6_LIVE_TOOLS_OK sellersprite=44 lingxing=23 exposedWrites=0`；
- 连续两次预置通过，未产生重复对象；
- 用户入口 `http://192.168.0.27:7999` 和管理入口 `http://192.168.0.27:3000` 健康；
- `PHASE6_VERIFY_OK agents=3 writes=disabled`；
- Phase 2、Phase 3、Phase 4、Phase 5 Skill 和 Phase 5 个人额度回归全部通过。

验收只执行 MCP 初始化与 `tools/list`，没有调用 New API 模型，没有执行 MCP 业务查询，也没有产生付费模型请求。

## 回滚

恢复部署前配置和镜像：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/20260727T081811Z
```

只有确认需要删除或回退 Phase 6 的 Agent、Skill 与 ACL 时，才使用 `--restore-db`。回滚脚本不会自动删除数据卷。
