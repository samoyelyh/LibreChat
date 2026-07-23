import type { PermissionGroup, VerifiedActor } from './types.js';

const toolGroups: Record<PermissionGroup, ReadonlySet<string>> = {
  lingxing_read_basic: new Set([
    'get_my_sids',
    'get_fba_stock_list',
    'erp_listing',
    'query_product_performance_asin_lists',
  ]),
  lingxing_finance: new Set([
    'get_profit_report_msku',
    'query_order_profit_list_gross_profit',
  ]),
  lingxing_ads: new Set([
    'ad_auth_shops',
    'ad_campaign_report',
    'ad_campaign_group_report',
    'ad_campaign_keyword_report',
    'ad_campaign_search_term_report',
    'ad_campaign_targeting_report',
    'ad_campaign_product_report',
    'ad_portfolio_report_shop',
  ]),
  lingxing_monitor_read: new Set([
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
  lingxing_write: new Set([
    'create_erp_keyword',
    'create_erp_competitive_monitor',
    'create_erp_follow_sale_monitor',
    'create_erp_new_monitor',
    'add_custom_indicator',
    'update_custom_indicator',
  ]),
};

export function permissionGroupForTool(tool: string): PermissionGroup | undefined {
  return (Object.entries(toolGroups) as Array<[PermissionGroup, ReadonlySet<string>]>).find(
    ([, tools]) => tools.has(tool),
  )?.[0];
}

export function groupsForIdentity(role: string, departments: string[]): PermissionGroup[] {
  if (role === 'ADMIN' || role === 'admin') {
    return ['lingxing_read_basic', 'lingxing_finance', 'lingxing_ads', 'lingxing_monitor_read'];
  }
  const groups = new Set<PermissionGroup>();
  if (role === 'operation' || departments.includes('运营部')) {
    groups.add('lingxing_read_basic');
    groups.add('lingxing_monitor_read');
  }
  if (role === 'advertising' || departments.includes('广告组')) {
    groups.add('lingxing_read_basic');
    groups.add('lingxing_ads');
  }
  if (role === 'finance' || departments.includes('财务组')) {
    groups.add('lingxing_read_basic');
    groups.add('lingxing_finance');
  }
  return [...groups];
}

export function canUseTool(actor: VerifiedActor, tool: string): boolean {
  const group = permissionGroupForTool(tool);
  return group != null && group !== 'lingxing_write' && actor.groups.includes(group);
}

export function filterTools(value: unknown, actor: VerifiedActor): unknown {
  if (Array.isArray(value)) return value.map((item) => filterTools(item, actor));
  if (value == null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === 'tools' && Array.isArray(child)) {
      result[key] = child.filter(
        (tool) =>
          tool != null &&
          typeof tool === 'object' &&
          typeof (tool as Record<string, unknown>).name === 'string' &&
          canUseTool(actor, String((tool as Record<string, unknown>).name)),
      );
    } else {
      result[key] = filterTools(child, actor);
    }
  }
  return result;
}

export const testing = { toolGroups };
