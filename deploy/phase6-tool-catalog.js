const MCP_DELIMITER = '_mcp_';

const TOOL_GROUPS = Object.freeze({
  lingxing_read_basic: Object.freeze([
    'get_my_sids',
    'get_fba_stock_list',
    'erp_listing',
    'query_product_performance_asin_lists',
  ]),
  lingxing_finance: Object.freeze([
    'get_profit_report_msku',
    'query_order_profit_list_gross_profit',
  ]),
  lingxing_ads: Object.freeze([
    'ad_auth_shops',
    'ad_campaign_report',
    'ad_campaign_group_report',
    'ad_campaign_keyword_report',
    'ad_campaign_search_term_report',
    'ad_campaign_targeting_report',
    'ad_campaign_product_report',
    'ad_portfolio_report_shop',
  ]),
  lingxing_monitor_read: Object.freeze([
    'query_erp_keyword_ranking_keyword',
    'query_erp_keyword_ranking_asin',
    'query_erp_competitive_monitor',
    'query_erp_follow_sale_monitor',
    'query_erp_new_monitor',
    'get_custom_report_list',
    'get_custom_report_by_id',
    'get_custom_indicator_list',
    'get_custom_indicator_field',
  ]),
  lingxing_write: Object.freeze([
    'create_erp_keyword',
    'create_erp_competitive_monitor',
    'create_erp_follow_sale_monitor',
    'create_erp_new_monitor',
    'add_custom_indicator',
    'update_custom_indicator',
  ]),
  sellersprite_asin: Object.freeze([
    'competitor_lookup',
    'product_research',
    'product_node',
    'asin_competitor',
    'asin_detail',
    'asin_coupon_trend',
    'asin_detail_with_coupon_trend',
    'asin_sales_trend',
    'asin_prediction',
    'bsr_prediction',
    'keepa_info',
  ]),
  sellersprite_keyword: Object.freeze([
    'traffic_keyword',
    'keyword_research',
    'keyword_research_trends',
    'keyword_miner',
    'traffic_extend',
    'aba_research_weekly',
    'aba_research_monthly',
    'aba_research_trend',
    'google_trend',
    'keyword_order',
    'traffic_listing',
    'traffic_keyword_stat',
    'traffic_listing_stat',
    'traffic_source',
  ]),
  sellersprite_market: Object.freeze([
    'market_research',
    'market_research_statistics',
    'market_product_concentration',
    'market_brand_concentration',
    'market_seller_country_distribution',
    'market_seller_concentration',
    'market_seller_type_concentration',
    'market_product_demand_trend',
    'market_listing_date_distribution',
    'market_listing_trend_distribution',
    'market_ratings_count_distribution',
    'market_rating_distribution',
    'market_price_distribution',
    'market_ebc_distribution',
  ]),
  sellersprite_review: Object.freeze(['review']),
});

const LINGXING_READ_GROUPS = Object.freeze([
  'lingxing_read_basic',
  'lingxing_finance',
  'lingxing_ads',
  'lingxing_monitor_read',
]);
const SELLERSPRITE_GROUPS = Object.freeze([
  'sellersprite_asin',
  'sellersprite_keyword',
  'sellersprite_market',
  'sellersprite_review',
]);

function unique(values) {
  return [...new Set(values)];
}

function rawToolsForGroups(groups) {
  return unique(groups.flatMap((group) => TOOL_GROUPS[group] ?? []));
}

function toolId(tool, server) {
  return `${tool}${MCP_DELIMITER}${server}`;
}

function toolIdsForGroups(groups, server) {
  return rawToolsForGroups(groups).map((tool) => toolId(tool, server));
}

const lingxingReadTools = Object.freeze(rawToolsForGroups(LINGXING_READ_GROUPS));
const sellerSpriteTools = Object.freeze(rawToolsForGroups(SELLERSPRITE_GROUPS));

const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'agent_woda-lingxing-business-analysis',
    legacyIds: Object.freeze(['woda-lingxing-business-analysis']),
    name: '领星经营分析',
    skillName: 'lingxing-business-analysis',
    description: '使用当前用户自己的领星数据，分析店铺、Listing、库存、利润、广告和经营表现。',
    starter: '请分析我的领星店铺经营情况，并区分原始数据、AI 计算和 AI 建议。',
    groups: LINGXING_READ_GROUPS,
    tools: Object.freeze(toolIdsForGroups(LINGXING_READ_GROUPS, 'lingxing-mcp')),
    eagerTools: Object.freeze(
      [
        'get_my_sids',
        'get_fba_stock_list',
        'erp_listing',
        'query_product_performance_asin_lists',
      ].map((tool) => toolId(tool, 'lingxing-mcp')),
    ),
    skillBody: `# 领星经营分析

## 数据边界

- 只使用当前登录用户自己的领星凭证与已授权店铺数据。
- 工具返回的领星数据标记为“领星原始数据”；基于原始字段进行的运算标记为“AI 计算”；经营策略标记为“AI 建议”。
- 不跨用户、跨店铺补全数据，不把缺失字段、失败调用或缓存结果编造成真实数据。

## 分析规则

- 可分析店铺表现、Listing、FBA 库存、产品表现、利润、广告、关键词排名和监控数据。
- 金额必须带工具返回的币种；无法确认币种时明确写“币种未确认”。
- 百分比字段先判断工具返回的是比例还是百分数，不得重复乘以 100。
- 对比必须说明站点、店铺和时间范围；条件不足时先提出最少且明确的补充问题。
- 输出结论时列出依据字段、计算口径、异常项和建议优先级。

## 安全规则

- 本 Agent 只绑定领星只读工具。
- 不请求、不展示、不转述用户的领星密钥。
- 创建、编辑、修改或删除类操作一律不得执行；不得把聊天中的“确认”当作写操作授权。
`,
  }),
  Object.freeze({
    id: 'agent_woda-amazon-market-analysis',
    legacyIds: Object.freeze(['woda-amazon-market-analysis']),
    model: 'gpt-5.6-sol',
    name: 'Amazon 市场分析',
    skillName: 'amazon-market-analysis',
    description: '使用公司统一卖家精灵数据，分析 ASIN、关键词、市场容量、趋势、集中度和评论。',
    starter: '请根据 ASIN、站点和时间范围，分析这个 Amazon 市场及主要竞品。',
    groups: SELLERSPRITE_GROUPS,
    tools: Object.freeze(toolIdsForGroups(SELLERSPRITE_GROUPS, 'sellersprite-mcp')),
    eagerTools: Object.freeze(
      ['competitor_lookup', 'asin_detail', 'keyword_research', 'market_research', 'review'].map(
        (tool) => toolId(tool, 'sellersprite-mcp'),
      ),
    ),
    skillBody: `# Amazon 市场分析

## 数据边界

- 通过公司统一卖家精灵凭证查询 Amazon 第三方市场数据。
- 工具直接返回的采集字段标记为“第三方采集数据”；卖家精灵估算字段标记为“第三方估算”；模型二次计算或归纳标记为“AI 推导”。
- 不得把估算销量、估算销售额或预测值表述为 Amazon 真实订单数据。

## 分析规则

- 可分析 ASIN、竞品、关键词、ABA、流量、市场容量、品牌与商品集中度、趋势和评论。
- 查询前优先确认 Amazon 站点、ASIN/关键词和时间范围。
- 对多来源字段说明来源、口径和时间窗口；冲突时并列展示，不擅自选择对业务更有利的值。
- 输出市场规模、竞争强度、需求趋势、关键词机会、评论痛点和可验证的后续动作。

## 安全规则

- 仅调用已绑定的卖家精灵只读工具，不尝试发现或调用未授权工具。
- 不展示、复述或索取公司统一卖家精灵密钥。
- 工具失败或数据为空时明确报告，不使用模拟数据冒充真实结果。
`,
  }),
  Object.freeze({
    id: 'agent_woda-cross-border-integrated-diagnosis',
    legacyIds: Object.freeze(['woda-cross-border-integrated-diagnosis']),
    name: '跨境综合诊断',
    skillName: 'cross-border-integrated-diagnosis',
    description: '关联用户自己的领星经营数据与公司卖家精灵市场数据，完成内外部综合诊断。',
    starter: '请按站点、ASIN 和时间范围，把我的内部经营表现与外部市场数据做综合诊断。',
    groups: Object.freeze([...LINGXING_READ_GROUPS, ...SELLERSPRITE_GROUPS]),
    tools: Object.freeze([
      ...toolIdsForGroups(LINGXING_READ_GROUPS, 'lingxing-mcp'),
      ...toolIdsForGroups(SELLERSPRITE_GROUPS, 'sellersprite-mcp'),
    ]),
    eagerTools: Object.freeze([
      toolId('get_my_sids', 'lingxing-mcp'),
      toolId('query_product_performance_asin_lists', 'lingxing-mcp'),
      toolId('asin_detail', 'sellersprite-mcp'),
      toolId('keyword_research', 'sellersprite-mcp'),
      toolId('market_research', 'sellersprite-mcp'),
    ]),
    skillBody: `# 跨境综合诊断

## 关联规则

- 同时使用当前登录用户自己的领星数据和公司卖家精灵市场数据。
- 只按已确认的 Amazon 站点、ASIN 和时间范围进行关联。
- 禁止只根据商品名称模糊关联后直接得出结论；关联键不足或冲突时必须先向用户澄清。
- 内外部时间粒度不一致时先说明差异，再决定是否能够比较。

## 来源标签

- 领星工具返回的实际经营字段标记为“内部实际数据”。
- 卖家精灵采集字段标记为“外部第三方数据”。
- 卖家精灵估算、预测字段标记为“外部估算数据”。
- 模型进行的计算、归纳和建议标记为“AI 推导结果”。

## 诊断规则

- 依次检查销量与流量、库存与补货、利润、广告、关键词、竞争格局、评论和趋势。
- 金额必须标注币种；百分比先确认口径，不得重复乘以 100。
- 输出证据、异常、可能原因、置信度、验证方法和按影响/成本排序的行动建议。
- 任何一个数据源不可用时，明确降级范围，不用另一个来源推测缺失的实际经营数据。

## 安全规则

- 仅使用已绑定的两类只读工具，不索取或展示任何凭证。
- 创建、编辑、修改或删除类操作一律不得执行；不得把聊天中的“确认”当作写操作授权。
`,
  }),
]);

module.exports = {
  MCP_DELIMITER,
  TOOL_GROUPS,
  LINGXING_READ_GROUPS,
  SELLERSPRITE_GROUPS,
  AGENT_DEFINITIONS,
  lingxingReadTools,
  sellerSpriteTools,
  rawToolsForGroups,
  toolId,
};
