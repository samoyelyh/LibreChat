# Phase 7：结构化展示

## 交付范围

Phase 7 把领星和卖家精灵的只读 MCP 工具结果转换为统一、安全、可导出的电商数据视图：

- 指标卡；
- 数据表；
- 折线图、柱状图、饼图、散点图；
- 数据来源、工具名、请求编号和耗时；
- CSV 与 Excel 导出；
- 可折叠的标准化原始结果；
- Agent 工具调用步骤。

本阶段不接入新的模型，不执行付费模型请求，不调用 MCP 业务查询，也不开放领星写工具。

## 统一协议

两个 MCP 网关在收到真实 `tools/call` 返回后生成以下协议。JSON 与 SSE 响应使用同一转换器。

```ts
interface EcommerceToolResult {
  success: boolean;
  provider: 'lingxing' | 'sellersprite';
  toolName: string;
  requestId: string;
  rows?: Record<string, unknown>[];
  columns?: Array<{
    key: string;
    title: string;
    type?: 'text' | 'number' | 'currency' | 'percent' | 'date';
  }>;
  metrics?: Array<{ label: string; value: string | number; unit?: string }>;
  chartSuggestions?: Array<{
    type: 'line' | 'bar' | 'pie' | 'scatter';
    title: string;
    xField?: string;
    yFields?: string[];
  }>;
  elapsedMs: number;
  error?: { code: string; message: string };
}
```

标准化发生在服务端 MCP 网关，不依赖模型把 JSON 重新排版。原上游文本中的数组会转换为 `rows`；列类型、可安全展示的汇总字段和图表建议由确定性代码推导。嵌套单元格会序列化为文本，不进入执行环境。

来源映射：

| provider | 前端来源标签 | 业务含义 |
| --- | --- | --- |
| `lingxing` | LingXing ERP | 当前登录用户自己的领星数据 |
| `sellersprite` | SellerSprite | 公司统一凭证查询的第三方市场数据 |

Agent 的 Skill 继续负责区分“内部实际数据”“外部第三方数据”“外部估算数据”“AI 计算/推导”和“AI 建议”。前端来源标签不能替代业务口径标签。

## 前端渲染与安全边界

`OutputRenderer` 只在严格校验成功后启用电商结构化组件；普通 JSON、Markdown 和既有工具错误仍走 LibreChat 原渲染路径。

- 只接受 `lingxing`、`sellersprite` 两个 provider；
- 只接受 `line`、`bar`、`pie`、`scatter` 四种声明式图表；
- `xField`、`yFields` 必须存在于已校验的列中；
- 图表只使用 React 与 SVG 图元，不使用 `eval`、`Function`、动态模块或模型生成的 JavaScript；
- 表格最多同时渲染前 500 行，避免阻塞页面；导出保留协议解析后的全部数据；
- 解析器最多接受 20,000 行、100 列、24 个指标和 8 个图表建议，防止异常响应耗尽浏览器；
- 数值、币种和百分比保持工具原值，不擅自换算或重复乘以 100。

CSV 与 Excel 导出会对以 `= + - @` 开头的文本加单引号，防止电子表格公式注入。Excel 文件采用 Excel 可直接打开的 SpreadsheetML 工作簿，扩展名为 `.xls`；CSV 使用 UTF-8 BOM，便于中文 Excel 正确识别。

## Agent 调用步骤

三套 Phase 6 共享 Agent 的 `hide_sequential_outputs` 改为 `false`。用户可以展开每个工具步骤，查看：

- 数据来源；
- 工具名称；
- 网关请求编号前缀；
- 请求耗时；
- 指标、图表和表格；
- 标准化原始结果。

Skill 同时约束 Agent：最终回答使用 Markdown 总结，不大段复制 JSON，不生成图表代码，不补造缺失数据。三套 Agent 仍只绑定精确的只读工具 allowlist，`lingxing_write` 数量保持为 0。

## 自动验证

本地验证：

```bash
cd services/sellersprite-mcp-gateway
pnpm test
pnpm typecheck

cd ../lingxing-mcp-gateway
pnpm test
pnpm typecheck

cd ../../client
npm test -- \
  src/components/Chat/Messages/Content/Ecommerce/__tests__/parseEcommerceResult.test.ts \
  --runInBand --coverage=false
```

生产验证：

```bash
cd /opt/cross-border-ai
deploy/backup.sh
deploy/build-sellersprite-gateway.sh
deploy/build-lingxing-gateway.sh
deploy/build-librechat-phase7.sh
deploy/start.sh
deploy/verify-phase7.sh
```

`verify-phase7.sh` 使用确定性夹具验证两个网关的结构化协议，不访问真实业务数据；随后验证 Agent 幂等预置、Skill 正文隔离、工具目录过滤、领星写调用 403、前端结构化组件、7999 用户入口和 3000 管理入口。

## 回滚

部署前必须先执行 `deploy/backup.sh`。回滚只恢复上一组镜像 digest 和配置：

```bash
deploy/rollback.sh /opt/cross-border-ai/deploy/backups/<部署前备份>
```

Phase 7 不新增数据库集合。只有需要同时回退 Agent 的调用步骤配置和 Skill 内容版本时，才考虑 `--restore-db`；默认不恢复数据库、不删除数据卷。

## 已知限制

- 图表建议基于列名和真实数值列确定性推导，不做语义猜测；无法识别时只显示表格。
- SpreadsheetML 是兼容 Excel 的 `.xls` 工作簿，不是压缩的 `.xlsx`。如果后续要求复杂样式、多 Sheet 或超大数据集，再引入专用服务端 XLSX 生成器。
- 已保存的历史工具输出不会被追溯改写；只有部署 Phase 7 网关后产生的新工具调用自动使用统一协议。
- Phase 8 才继续完成请求签名、防重放的系统化增强以及完整数据隔离渗透测试；Phase 7 保持现有网关鉴权、限流、审计、备份、健康检查和日志轮转不变。

## 2026-07-27 实际部署结果

- 部署前备份：`/opt/cross-border-ai/deploy/backups/20260727T105845Z`；
- 部署完成备份：`/opt/cross-border-ai/deploy/backups/20260727T141206Z`；
- LibreChat：`sha256:a330730f99343af4e2c9874d4c2e9688a1a7e224b6df1dbefd1f5a234dcc89a1`；
- SellerSprite MCP Gateway：`sha256:9c322c7f920292756145fe27bd4c79fc5e8b87317f9861db31c2a7c9a35262ed`；
- LingXing MCP Gateway：`sha256:f800b7313d77189a5c5b8b85077f8a7258e6d0d8999761e9390a2579ae8aae0a`；
- 本地前端协议/导出测试 3 项通过，前端 TypeScript 检查、定向 ESLint 和生产构建通过；
- 两个网关共 21 项测试通过，两个严格 TypeScript 检查通过；
- `PHASE6_AGENTS_OK agents=3 tools=126 deferred=112 writeTools=0 viewerRoles=7` 连续两次通过；
- `PHASE7_VERIFY_OK structured=metrics,table,line,bar,pie,scatter,exports sources=2 writes=disabled`；
- 浏览器登录态页面确认标题和品牌为“沃达跨境电商AI平台”，新会话主界面、`kimi-k2` 和 MCP 服务器入口可见；
- 用户入口 `http://192.168.0.27:7999` 与管理入口 `http://192.168.0.27:3000` 健康；
- API、两个 MCP 网关和 Nginx 最近日志扫描未发现鉴权 Header、Bearer、密钥模式或结构化模块关键异常；
- 验收没有发送聊天消息、没有调用模型、没有读取真实 MCP 业务数据、没有执行写操作。
