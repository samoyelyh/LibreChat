import { describe, expect, it } from 'vitest';
import {
  TOOL_GROUPS,
  authorizeIdentity,
  canUseTool,
  filterToolsResult,
  permissionGroupForTool,
} from './policy.js';
import type { VerifiedActor } from './types.js';

function actor(
  role: string,
  departments: string[],
): VerifiedActor {
  return {
    userId: '507f1f77bcf86cd799439011',
    email: 'user@example.com',
    role,
    departments,
    ...authorizeIdentity({ role, departments }),
  };
}

describe('SellerSprite permission policy', () => {
  it('allows operations for the business role or platform user in the operations department', () => {
    expect(canUseTool(actor('operation', ['运营部']), 'market_research')).toBe(true);
    expect(canUseTool(actor('operation', []), 'market_research')).toBe(false);
    expect(canUseTool(actor('USER', ['运营部']), 'market_research')).toBe(true);
    expect(canUseTool(actor('USER', ['只读访客']), 'market_research')).toBe(false);
  });

  it('limits advertising to keyword and competitor tools', () => {
    const advertising = actor('advertising', ['广告组']);
    expect(canUseTool(advertising, 'traffic_keyword')).toBe(true);
    expect(canUseTool(advertising, 'aba_research_weekly')).toBe(true);
    expect(canUseTool(advertising, 'competitor_lookup')).toBe(true);
    expect(canUseTool(advertising, 'asin_competitor')).toBe(true);
    expect(canUseTool(advertising, 'asin_detail')).toBe(false);
    expect(canUseTool(advertising, 'market_research')).toBe(false);
    expect(canUseTool(advertising, 'review')).toBe(false);
  });

  it('applies advertising limits to platform users in the advertising department', () => {
    const advertising = actor('USER', ['广告组']);
    expect(canUseTool(advertising, 'traffic_keyword')).toBe(true);
    expect(canUseTool(advertising, 'competitor_lookup')).toBe(true);
    expect(canUseTool(advertising, 'asin_detail')).toBe(false);
    expect(canUseTool(advertising, 'market_research')).toBe(false);
  });

  it('fails closed for finance, visitors, technical, and new unknown tools', () => {
    for (const [role, department] of [
      ['finance', '财务组'],
      ['viewer', '只读访客'],
      ['technical', '技术部'],
    ] as const) {
      expect(canUseTool(actor(role, [department]), 'asin_detail')).toBe(false);
    }
    expect(canUseTool(actor('operation', ['运营部']), 'future_write_tool')).toBe(false);
  });

  it('gives system and business admins full access', () => {
    expect(canUseTool(actor('ADMIN', ['管理层']), 'trademark_list')).toBe(true);
    expect(canUseTool(actor('admin', ['管理层']), 'future_read_tool')).toBe(true);
  });

  it('classifies all four required permission groups', () => {
    expect(permissionGroupForTool('asin_detail')).toBe('sellersprite_asin');
    expect(permissionGroupForTool('keyword_miner')).toBe('sellersprite_keyword');
    expect(permissionGroupForTool('market_price_distribution')).toBe('sellersprite_market');
    expect(permissionGroupForTool('review')).toBe('sellersprite_review');
    expect(Object.keys(TOOL_GROUPS)).toHaveLength(4);
  });

  it('filters tools/list so clients cannot enumerate denied tools', () => {
    const result = filterToolsResult(
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          tools: [
            { name: 'traffic_keyword' },
            { name: 'competitor_lookup' },
            { name: 'asin_detail' },
            { name: 'market_research' },
            { name: 'future_tool' },
          ],
        },
      },
      actor('advertising', ['广告组']),
    );
    expect(result.result.tools.map((tool) => tool.name)).toEqual([
      'traffic_keyword',
      'competitor_lookup',
    ]);
  });
});
