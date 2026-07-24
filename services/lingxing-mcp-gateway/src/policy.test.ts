import { describe, expect, it } from 'vitest';
import { canUseTool, groupsForIdentity, permissionGroupForTool } from './policy.js';
import type { VerifiedActor } from './types.js';

function actor(role: string, departments: string[] = []): VerifiedActor {
  const groups = groupsForIdentity(role, departments);
  return {
    userId: 'u1',
    email: 'u@example.com',
    role,
    departments,
    groups,
    admin: role === 'ADMIN' || role === 'admin',
  };
}

describe('Lingxing Phase 4 policy', () => {
  it('allows advertising reads but denies finance and writes', () => {
    const value = actor('advertising');
    expect(canUseTool(value, 'ad_campaign_report')).toBe(true);
    expect(canUseTool(value, 'get_profit_report_msku')).toBe(false);
    expect(canUseTool(value, 'update_custom_indicator')).toBe(false);
  });

  it('allows finance reports to finance and denies unknown future tools', () => {
    const value = actor('finance');
    expect(canUseTool(value, 'get_profit_report_msku')).toBe(true);
    expect(canUseTool(value, 'future_write_tool')).toBe(false);
  });

  it('never grants writes to administrators in Phase 4', () => {
    const value = actor('ADMIN');
    expect(permissionGroupForTool('create_erp_keyword')).toBe('lingxing_write');
    expect(canUseTool(value, 'create_erp_keyword')).toBe(false);
  });
});
