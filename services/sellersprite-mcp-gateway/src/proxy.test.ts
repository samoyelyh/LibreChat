import { describe, expect, it, vi } from 'vitest';
import type { AppStores } from './app.js';
import type { CallAudit, GatewayConfig, VerifiedActor } from './types.js';
import { buildApp } from './app.js';
import { authorizeIdentity } from './policy.js';
import { createSignedHeaders } from './security.js';
import { testing } from './proxy.js';
import { SellerSpriteClient } from './upstream.js';

const advertising: VerifiedActor = {
  userId: '507f1f77bcf86cd799439011',
  email: 'ads@example.com',
  role: 'advertising',
  departments: ['广告组'],
  ...authorizeIdentity({ role: 'advertising', departments: ['广告组'] }),
};

const config: GatewayConfig = {
  profile: 'sellersprite',
  host: '127.0.0.1',
  port: 4200,
  internalKey: 'internal-key-with-at-least-32-bytes',
  upstreamUrl: 'https://seller.example.test/mcp',
  upstreamSecret: 'seller-secret',
  mongoUri: 'mongodb://mongo.example.test/gateway',
  libreChatDatabase: 'LibreChat',
  gatewayDatabase: 'sellersprite_mcp_gateway',
  requestTimeoutMs: 120000,
  auditRetentionDays: 365,
  monthlyLimit: 0,
  signatureToleranceMs: 30000,
  requestsPerMinute: 60,
  upstreamAuth: 'secret-key',
};

function testStores(audits: CallAudit[]): AppStores {
  return {
    ping: async () => undefined,
    verifyActor: async () => advertising,
    recordAudits: async (items) => {
      audits.push(...items);
    },
    syncCredential: async () => undefined,
    recordConnectionTest: async () => undefined,
    status: async () => ({
      configured: true,
      fingerprintLast4: 'test',
      updatedAt: null,
      updatedBy: null,
      lastConnectionTestAt: null,
      lastConnectionTestOk: null,
      lastConnectionTestMessage: null,
      lastToolCount: null,
      lastCallAt: null,
      month: '2026-08',
      monthlyCallCount: 0,
      monthlyLimit: null,
      usageRatio: null,
    }),
    recentAudits: async () => [],
    consumeNonce: async () => true,
    recordSecurityAudit: async () => undefined,
    consumeToolRateLimit: async () => ({
      allowed: true,
      limit: 60,
      remaining: 59,
      retryAfterSeconds: 1,
    }),
  };
}

describe('MCP proxy transformations', () => {
  it('extracts tools/call without logging arguments', () => {
    const calls = testing.toolCalls({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'traffic_keyword', arguments: { asin: 'B000TEST' } },
    });
    expect(calls).toEqual([{ id: 7, tool: 'traffic_keyword' }]);
    expect(JSON.stringify(calls)).not.toContain('B000TEST');
  });

  it('filters an SSE tools/list event', () => {
    const input =
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"traffic_keyword"},{"name":"review"}]}}\n\n';
    const output = testing.filterToolsBody(input, advertising, 'text/event-stream');
    expect(output).toContain('traffic_keyword');
    expect(output).not.toContain('"review"');
  });

  it('extracts record counts without retaining response bodies', () => {
    expect(testing.nestedRecordCount({ result: { content: [{ text: '{"data":[1,2,3]}' }] } })).toBe(
      3,
    );
    expect(testing.nestedRecordCount({ result: { data: { total: 19 } } })).toBe(19);
  });

  it('accepts MCP JSON and SSE media types but rejects HTML responses', () => {
    expect(testing.isMcpResponseContentType('application/json; charset=utf-8', 200)).toBe(true);
    expect(testing.isMcpResponseContentType('application/problem+json', 502)).toBe(true);
    expect(testing.isMcpResponseContentType('text/event-stream', 200)).toBe(true);
    expect(testing.isMcpResponseContentType(null, 202)).toBe(true);
    expect(testing.isMcpResponseContentType(null, 200)).toBe(false);
    expect(testing.isMcpResponseContentType('text/html; charset=utf-8', 200)).toBe(false);
  });

  it('converts a successful HTML upstream response to a structured 502 and failed audit', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 29,
      method: 'tools/call',
      params: { name: 'traffic_keyword_stat', arguments: { asin: 'B000TEST' } },
    });
    const actor = {
      'x-librechat-user-id': advertising.userId,
      'x-librechat-user-email': advertising.email,
      'x-librechat-user-role': advertising.role,
    };
    const client = new SellerSpriteClient(config);
    vi.spyOn(client, 'relay').mockResolvedValue(
      new Response('<html><body>temporary upstream error</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const audits: CallAudit[] = [];
    const app = buildApp(config, testStores(audits), client);

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...createSignedHeaders({
          secret: config.internalKey,
          method: 'POST',
          path: '/mcp',
          bodyText: body,
          actorHeaders: actor,
        }),
      },
      body,
    });

    expect(response.statusCode).toBe(502);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({
      jsonrpc: '2.0',
      id: 29,
      error: {
        code: -32052,
        data: { code: 'sellersprite_invalid_content_type' },
        message: 'SellerSprite returned an invalid MCP response',
      },
    });
    expect(response.body).not.toContain('temporary upstream error');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tool: 'traffic_keyword_stat',
      allowed: true,
      success: false,
      upstreamStatus: 200,
      errorCode: 'sellersprite_invalid_content_type',
    });
    await app.close();
  });
});
