import type { GatewayProfile, PermissionGroup, VerifiedActor } from './types.js';

export const RESUME_READ_TOOLS = new Set([
  'parse_resume',
  'get_candidate',
  'search_candidates',
  'get_candidate_missing_fields',
  'generate_followup',
  'list_parsing_templates',
]);

export const RESUME_WRITE_TOOLS = new Set(['update_candidate_fields', 'record_candidate_reply']);

export const TOOL_GROUPS: Record<PermissionGroup, ReadonlySet<string>> = {
  resume_read: RESUME_READ_TOOLS,
  sellersprite_asin: new Set([
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
  sellersprite_keyword: new Set([
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
  sellersprite_market: new Set([
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
  sellersprite_review: new Set(['review']),
};

const advertisingExactTools = ['competitor_lookup', 'asin_competitor'];
const allOperationGroups = (Object.keys(TOOL_GROUPS) as PermissionGroup[]).filter(
  (group) => group !== 'resume_read',
);

export function permissionGroupForTool(tool: string): PermissionGroup | undefined {
  if (RESUME_READ_TOOLS.has(tool)) return 'resume_read';
  return allOperationGroups.find((group) => TOOL_GROUPS[group].has(tool));
}

export function authorizeIdentity(input: {
  role: string;
  departments: string[];
  profile?: GatewayProfile;
}): Pick<VerifiedActor, 'permissionGroups' | 'exactTools' | 'allTools'> {
  const normalizedRole = input.role.trim();
  const departments = new Set(input.departments);

  if (input.profile === 'resume') {
    const allowed =
      normalizedRole === 'ADMIN' ||
      normalizedRole === 'admin' ||
      departments.has('管理层');
    return {
      permissionGroups: allowed ? ['resume_read'] : [],
      exactTools: [],
      allTools: false,
    };
  }

  if (
    normalizedRole === 'ADMIN' ||
    normalizedRole === 'admin' ||
    (departments.has('管理层') && ['ADMIN', 'admin'].includes(normalizedRole))
  ) {
    return { permissionGroups: allOperationGroups, exactTools: [], allTools: true };
  }
  if (['USER', 'operation'].includes(normalizedRole) && departments.has('运营部')) {
    return { permissionGroups: allOperationGroups, exactTools: [], allTools: false };
  }
  if (['USER', 'advertising'].includes(normalizedRole) && departments.has('广告组')) {
    return {
      permissionGroups: ['sellersprite_keyword'],
      exactTools: advertisingExactTools,
      allTools: false,
    };
  }
  return { permissionGroups: [], exactTools: [], allTools: false };
}

export function canUseServer(actor: VerifiedActor): boolean {
  return actor.allTools || actor.permissionGroups.length > 0 || actor.exactTools.length > 0;
}

export function canUseTool(actor: VerifiedActor, tool: string): boolean {
  if (RESUME_WRITE_TOOLS.has(tool)) return false;
  if (actor.allTools) return true;
  if (actor.exactTools.includes(tool)) return true;
  const group = permissionGroupForTool(tool);
  return group != null && actor.permissionGroups.includes(group);
}

export function filterToolsResult<T>(value: T, actor: VerifiedActor): T {
  if (actor.allTools || value == null || typeof value !== 'object') return value;
  const response = value as Record<string, unknown>;
  const result = response.result;
  if (result == null || typeof result !== 'object') return value;
  const tools = (result as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return value;
  const filtered = tools.filter(
    (tool) =>
      tool != null &&
      typeof tool === 'object' &&
      typeof (tool as Record<string, unknown>).name === 'string' &&
      canUseTool(actor, (tool as Record<string, unknown>).name as string),
  );
  return {
    ...response,
    result: { ...(result as Record<string, unknown>), tools: filtered },
  } as T;
}
