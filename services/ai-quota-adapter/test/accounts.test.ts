import { describe, expect, it, vi } from 'vitest';
import { AccountService } from '../src/accounts.js';
import type { AdapterConfig } from '../src/config.js';
import type {
  AccountStore,
  NewApiClientContract,
  NewApiProvisioningClient,
} from '../src/contracts.js';
import { decryptToken } from '../src/crypto.js';
import type {
  AiGatewayAccountMapping,
  LibreChatIdentity,
  PolicyInput,
  ProvisioningAudit,
  QuotaPolicy,
  SafeMapping,
} from '../src/types.js';

const encryptionKey = '33'.repeat(32);
const identity: LibreChatIdentity = {
  userId: '67f000000000000000000002',
  email: 'operator@example.com',
  name: 'Operator',
  username: 'operator',
  role: 'operation',
  departments: ['Operations'],
  admin: false,
};
const policy: QuotaPolicy = {
  policyId: 'default:*',
  name: 'Default zero quota',
  scope: 'default',
  scopeValue: '*',
  priority: 0,
  quota: 0,
  gatewayGroup: 'default',
  allowedModels: ['kimi-k2'],
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};
const config: AdapterConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 4100,
  internalKey: 'internal-key-that-is-at-least-32-characters',
  encryptionKey,
  adminToken: 'administrator-access-token',
  jwtSecret: 'jwt-secret-that-is-at-least-32-characters',
  mongoUri: 'mongodb://unused',
  libreChatDatabase: 'LibreChat',
  adapterDatabase: 'ai_quota_adapter',
  redisUrl: 'redis://unused',
  newApiBaseUrl: 'https://new-api.invalid/v1',
  newApiAdminUserId: 1,
  requestTimeoutMs: 5000,
  requestsPerMinute: 30,
  maxConcurrentRequests: 2,
  auditRetentionDays: 90,
  defaultUserQuota: 0,
  defaultAllowedModels: ['kimi-k2'],
  testModel: 'kimi-k2',
  runBillableTests: false,
};

function safe(mapping: AiGatewayAccountMapping): SafeMapping {
  return {
    id: mapping.librechatUserId,
    librechatUserId: mapping.librechatUserId,
    librechatEmail: mapping.librechatEmail,
    newApiUserId: mapping.newApiUserId,
    newApiUsername: mapping.newApiUsername,
    ...(mapping.newApiTokenId ? { newApiTokenId: mapping.newApiTokenId } : {}),
    tokenFingerprint: mapping.tokenFingerprint,
    gatewayGroup: mapping.gatewayGroup,
    credentialStatus: mapping.credentialStatus,
    allowedModels: mapping.allowedModels,
    ...(mapping.quotaPolicyId ? { quotaPolicyId: mapping.quotaPolicyId } : {}),
    ...(mapping.provisionedBy ? { provisionedBy: mapping.provisionedBy } : {}),
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
}

class MemoryAccountStore implements AccountStore {
  mapping: AiGatewayAccountMapping | null = null;
  audits: ProvisioningAudit[] = [];

  async ping(): Promise<void> {}

  async identity(userId: string): Promise<LibreChatIdentity | null> {
    return userId === identity.userId ? identity : null;
  }

  async listIdentities(): Promise<LibreChatIdentity[]> {
    return [identity];
  }

  async findByUserId(userId: string): Promise<AiGatewayAccountMapping | null> {
    return this.mapping?.librechatUserId === userId ? this.mapping : null;
  }

  async findActiveByUserId(userId: string): Promise<AiGatewayAccountMapping | null> {
    const mapping = await this.findByUserId(userId);
    return mapping?.credentialStatus === 'active' ? mapping : null;
  }

  async upsert(
    input: Omit<AiGatewayAccountMapping, 'createdAt' | 'updatedAt'>,
  ): Promise<SafeMapping> {
    const now = new Date();
    this.mapping = {
      ...input,
      createdAt: this.mapping?.createdAt ?? now,
      updatedAt: now,
    };
    return safe(this.mapping);
  }

  async setStatus(
    userId: string,
    status: AiGatewayAccountMapping['credentialStatus'],
  ): Promise<void> {
    if (this.mapping?.librechatUserId === userId) {
      this.mapping = { ...this.mapping, credentialStatus: status, updatedAt: new Date() };
    }
  }

  async listSafe(): Promise<SafeMapping[]> {
    return this.mapping ? [safe(this.mapping)] : [];
  }

  async ensureDefaultPolicy(): Promise<QuotaPolicy> {
    return policy;
  }

  async resolvePolicy(): Promise<QuotaPolicy> {
    return policy;
  }

  async listPolicies(): Promise<QuotaPolicy[]> {
    return [policy];
  }

  async upsertPolicy(input: PolicyInput): Promise<QuotaPolicy> {
    return {
      ...input,
      policyId: `${input.scope}:${input.scopeValue}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async recordProvisioningAudit(audit: ProvisioningAudit): Promise<void> {
    this.audits.push(audit);
  }

  async close(): Promise<void> {}
}

function newApiClient(provision: ReturnType<typeof vi.fn>) {
  const client: NewApiClientContract & NewApiProvisioningClient = {
    status: async () => ({}),
    listModels: async () => ({ data: [] }),
    tokenUsage: async () => ({
      object: 'token_usage',
      name: 'managed',
      total_granted: 0,
      total_used: 0,
      total_available: 0,
      unlimited_quota: false,
      model_limits: {},
      model_limits_enabled: true,
      expires_at: -1,
    }),
    tokenLogs: async () => [],
    relay: async () => new Response(),
    provision,
    applyPolicy: async () => {},
    disableUser: async () => {},
    restoreUser: async () => {},
    groups: async () => ['default'],
  };
  return client;
}

describe('personal New API account provisioning', () => {
  it('provisions only once, starts at zero quota, and encrypts both credentials', async () => {
    const store = new MemoryAccountStore();
    const provision = vi.fn(async () => ({
      user: {
        id: 12,
        username: 'woda-managed-user',
        role: 1,
        status: 1,
        group: 'default',
        quota: 0,
        used_quota: 0,
      },
      token: {
        id: 34,
        name: 'woda-managed-token',
        status: 1,
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: false,
        model_limits_enabled: true,
        model_limits: 'kimi-k2',
        group: 'default',
        cross_group_retry: false,
      },
      runtimeToken: 'sk-user-runtime-secret',
      managementToken: 'user-management-secret',
    }));
    const service = new AccountService(config, store, newApiClient(provision));
    await service.initialize();

    const [first, second] = await Promise.all([
      service.ensure(identity),
      service.ensure(identity),
    ]);

    expect(provision).toHaveBeenCalledOnce();
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({
        username: expect.stringMatching(/^woda_[a-zA-Z0-9]{15}$/),
        password: expect.stringMatching(/^[a-zA-Z0-9_-]{16}aA1!$/),
        quota: 0,
        group: 'default',
        allowedModels: ['kimi-k2'],
      }),
    );
    expect(first.tokenHash).toBe(second.tokenHash);
    expect(first.encryptedToken).not.toContain('sk-user-runtime-secret');
    expect(first.encryptedManagementToken).not.toContain('user-management-secret');
    expect(decryptToken(first.encryptedToken, encryptionKey)).toBe('sk-user-runtime-secret');
    expect(
      decryptToken(first.encryptedManagementToken ?? '', encryptionKey),
    ).toBe('user-management-secret');
    expect(store.audits).toHaveLength(1);
  });
});
