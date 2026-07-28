import { SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type AppServices } from '../src/app.js';
import type { AdapterConfig } from '../src/config.js';
import { AdapterError } from '../src/errors.js';
import { createSignedHeaders } from '../src/security.js';
import type {
  AccountSummary,
  AiGatewayAccountMapping,
  CallAudit,
  NewApiLog,
  QuotaPolicy,
  SafeMapping,
  TokenUsage,
} from '../src/types.js';
import { encryptToken, fingerprintToken, hashToken } from '../src/crypto.js';

const encryptionKey = '22'.repeat(32);
const gatewayToken = 'sk-real-user-specific-token';
const config: AdapterConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 4100,
  internalKey: 'internal-key-that-is-at-least-32-characters',
  encryptionKey,
  adminToken: 'admin-token-that-is-long-enough',
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
  signatureToleranceMs: 30000,
  defaultUserQuota: 0,
  defaultAllowedModels: ['kimi-k2'],
  testModel: 'kimi-k2',
  runBillableTests: false,
};

const mapping: AiGatewayAccountMapping = {
  librechatUserId: 'user-1',
  librechatEmail: 'user@example.com',
  newApiUserId: '42',
  newApiUsername: 'phase2-user',
  encryptedToken: encryptToken(gatewayToken, encryptionKey),
  tokenFingerprint: fingerprintToken(gatewayToken),
  tokenHash: hashToken(gatewayToken),
  gatewayGroup: 'default',
  credentialStatus: 'active',
  allowedModels: ['kimi-k2'],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function internalHeaders(
  url: string,
  method: string,
  payload?: object,
  user: AiGatewayAccountMapping = mapping,
) {
  return createSignedHeaders({
    secret: config.internalKey,
    url: `http://adapter.test${url}`,
    method,
    ...(payload ? { bodyText: JSON.stringify(payload) } : {}),
    actorHeaders: {
      'x-librechat-user-id': user.librechatUserId,
      'x-librechat-user-email': user.librechatEmail,
    },
  });
}

const policy: QuotaPolicy = {
  policyId: 'default:*',
  name: 'Default',
  scope: 'default',
  scopeValue: '*',
  priority: 0,
  quota: 1000,
  gatewayGroup: 'default',
  allowedModels: ['kimi-k2'],
  enabled: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function accountSummary(value: AiGatewayAccountMapping): AccountSummary {
  return {
    identity: {
      userId: value.librechatUserId,
      email: value.librechatEmail,
      name: null,
      username: null,
      role: 'USER',
      departments: ['运营部'],
      admin: false,
    },
    mapping: {
      id: value.librechatUserId,
      librechatUserId: value.librechatUserId,
      librechatEmail: value.librechatEmail,
      newApiUserId: value.newApiUserId,
      newApiUsername: value.newApiUsername,
      tokenFingerprint: value.tokenFingerprint,
      gatewayGroup: value.gatewayGroup,
      credentialStatus: value.credentialStatus,
      allowedModels: value.allowedModels,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
    },
    effectivePolicy: policy,
    balance: {
      totalGranted: 1000,
      totalUsed: 10,
      totalAvailable: 990,
      unlimitedQuota: false,
      expiresAt: 0,
      unit: 'new_api_quota',
      authoritativeSource: 'new_api',
    },
  };
}

describe('AI quota adapter', () => {
  let audits: CallAudit[];
  let services: AppServices;
  let relaySpy: ReturnType<typeof vi.fn>;
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    audits = [];
    relaySpy = vi.fn(async (_path: string, init: RequestInit, token: string) => {
      expect(token).toBe(gatewayToken);
      expect(new Headers(init.headers).get('authorization')).toBeNull();
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }], usage: { total_tokens: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'new-api-1' } },
      );
    });
    services = {
      mappings: {
        ping: async () => undefined,
        findByUserId: async (userId) => (userId === mapping.librechatUserId ? mapping : null),
        findActiveByUserId: async (userId) => (userId === mapping.librechatUserId ? mapping : null),
        upsert: async () => ({}) as SafeMapping,
        setStatus: async () => undefined,
        listSafe: async () => [],
        identity: async (userId) =>
          userId === mapping.librechatUserId
            ? {
                userId,
                email: mapping.librechatEmail,
                name: null,
                username: null,
                role: 'USER',
                departments: [],
                admin: false,
              }
            : null,
        listIdentities: async () => [],
        ensureDefaultPolicy: async () => policy,
        resolvePolicy: async () => policy,
        listPolicies: async () => [policy],
        upsertPolicy: async () => policy,
        recordProvisioningAudit: async () => undefined,
        consumeNonce: async () => true,
        recordSecurityAudit: async () => undefined,
        close: async () => undefined,
      },
      audits: { record: async (audit) => void audits.push(audit) },
      limiter: {
        ping: async () => undefined,
        acquire: async () => async () => undefined,
        close: async () => undefined,
      },
      newApi: {
        status: async () => ({ success: true }),
        listModels: async () => ({
          object: 'list',
          data: [{ id: 'kimi-k2', object: 'model' }, { id: 'forbidden-model', object: 'model' }],
        }),
        tokenUsage: async (): Promise<TokenUsage> => ({
          object: 'token_usage',
          name: 'phase2',
          total_granted: 1000,
          total_used: 10,
          total_available: 990,
          unlimited_quota: false,
          model_limits: {},
          model_limits_enabled: true,
          expires_at: 0,
        }),
        tokenLogs: async (): Promise<NewApiLog[]> => [
          {
            user_id: 42,
            username: 'phase2-user',
            model_name: 'kimi-k2',
            quota: 5,
            prompt_tokens: 1,
            completion_tokens: 1,
            ip: 'should-not-leak',
            content: 'should-not-leak',
          },
        ],
        relay: relaySpy,
      },
      accounts: {
        ensure: async (actor) => {
          if (actor.userId !== mapping.librechatUserId) {
            throw new Error('unexpected unmapped user');
          }
          return mapping;
        },
        summary: async (actor) => {
          if (actor.userId !== mapping.librechatUserId) {
            throw new AdapterError(
              403,
              'ai_account_not_provisioned',
              'AI account is not provisioned',
            );
          }
          return accountSummary(mapping);
        },
        adminUsers: async () => [],
        listPolicies: async () => [policy],
        upsertPolicy: async () => policy,
        applyUserPolicy: async () => accountSummary(mapping),
        revoke: async () => accountSummary(mapping),
        restore: async () => accountSummary(mapping),
        modelCatalog: async () => ['kimi-k2'],
        gatewayGroups: async () => ['default'],
      },
    };
    app = buildApp(config, services);
  });

  afterEach(async () => app.close());

  it('returns only the mapped model list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/models',
      headers: internalHeaders('/v1/models', 'GET'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([{ id: 'kimi-k2', object: 'model' }]);
  });

  it('rejects a forged or unauthorized model before relay', async () => {
    const payload = {
      model: 'forbidden-model',
      messages: [{ role: 'user', content: 'test' }],
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: internalHeaders('/v1/chat/completions', 'POST', payload),
      payload,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('model_not_allowed');
    expect(relaySpy).not.toHaveBeenCalled();
  });

  it('injects the mapped token once and records metadata-only audit', async () => {
    const payload = {
      model: 'kimi-k2',
      messages: [{ role: 'user', content: 'secret prompt' }],
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        ...internalHeaders('/v1/chat/completions', 'POST', payload),
        authorization: 'Bearer attacker-value',
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(relaySpy).toHaveBeenCalledTimes(1);
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(gatewayToken);
    expect(JSON.stringify(audits)).not.toContain('secret prompt');
    expect(audits[0]?.newApiRequestId).toBe('new-api-1');
  });

  it('keeps two users on distinct New API billing tokens', async () => {
    const secondToken = 'sk-second-independent-billing-token';
    const secondMapping: AiGatewayAccountMapping = {
      ...mapping,
      librechatUserId: 'user-2',
      librechatEmail: 'second@example.com',
      newApiUserId: '43',
      newApiUsername: 'phase2-user-2',
      encryptedToken: encryptToken(secondToken, encryptionKey),
      tokenFingerprint: fingerprintToken(secondToken),
      tokenHash: hashToken(secondToken),
    };
    services.mappings.findActiveByUserId = async (userId) =>
      userId === mapping.librechatUserId ? mapping : userId === secondMapping.librechatUserId ? secondMapping : null;
    services.accounts.ensure = async (actor) =>
      actor.userId === mapping.librechatUserId ? mapping : secondMapping;
    const injected: string[] = [];
    relaySpy.mockImplementation(async (_path: string, _init: RequestInit, token: string) => {
      injected.push(token);
      return new Response(JSON.stringify({ choices: [], usage: { total_tokens: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    for (const user of [mapping, secondMapping]) {
      const payload = {
        model: 'kimi-k2',
        messages: [{ role: 'user', content: 'test' }],
      };
      const response = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: internalHeaders('/v1/chat/completions', 'POST', payload, user),
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(injected).toEqual([gatewayToken, secondToken]);
  });

  it('preserves SSE frames', async () => {
    relaySpy.mockResolvedValueOnce(
      new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    const payload = {
      model: 'kimi-k2',
      messages: [{ role: 'user', content: 'test' }],
      stream: true,
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: internalHeaders('/v1/chat/completions', 'POST', payload),
      payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('data: [DONE]');
  });

  it('returns authoritative balance and sanitized usage for the JWT user', async () => {
    const token = await new SignJWT({ id: mapping.librechatUserId, email: mapping.librechatEmail })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.jwtSecret));
    const balance = await app.inject({
      method: 'GET',
      url: '/api/user/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(balance.statusCode).toBe(200);
    expect(balance.json().data).toMatchObject({ totalAvailable: 990, authoritativeSource: 'new_api' });
    expect(balance.body).not.toContain(gatewayToken);

    const usage = await app.inject({
      method: 'GET',
      url: '/api/user/usage?limit=10',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(usage.statusCode).toBe(200);
    expect(usage.body).not.toContain('should-not-leak');
    expect(usage.json().data[0]).toMatchObject({ model: 'kimi-k2', quota: 5 });
  });

  it('rejects unmapped users even with a valid JWT', async () => {
    const token = await new SignJWT({ id: 'other-user', email: 'other@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(config.jwtSecret));
    const response = await app.inject({
      method: 'GET',
      url: '/api/user/balance',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('ai_account_not_provisioned');
  });
});
