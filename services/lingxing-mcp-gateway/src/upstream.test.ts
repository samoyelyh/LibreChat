import { afterEach, describe, expect, it, vi } from 'vitest';
import { LingxingClient, testing } from './upstream.js';
import type { GatewayConfig } from './types.js';

const config: GatewayConfig = {
  host: '127.0.0.1',
  port: 4300,
  internalKey: 'internal-key'.repeat(4),
  jwtSecret: 'jwt-secret'.repeat(4),
  encryptionKey: Buffer.alloc(32),
  upstreamUrl: 'https://openmcp.lingxing.test/mcp',
  mongoUri: 'mongodb://localhost/test',
  libreChatDatabase: 'LibreChat',
  gatewayDatabase: 'lingxing_mcp_gateway',
  requestTimeoutMs: 5000,
  auditRetentionDays: 365,
  signatureToleranceMs: 30000,
  requestsPerMinute: 60,
  toolIntervalMs: 1100,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Lingxing upstream rate-limit handling', () => {
  it('retries a read-only request once after Retry-After', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const delays: number[] = [];
    const client = new LingxingClient(config, async (durationMs) => {
      delays.push(durationMs);
    });

    const response = await client.relay({
      secret: 'user-secret',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      retryRateLimit: true,
    });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([2000]);
  });

  it('does not retry when the caller has not marked the request safe', async () => {
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 429 }));
    const client = new LingxingClient(config, vi.fn());

    const response = await client.relay({
      secret: 'user-secret',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caps excessive Retry-After values', () => {
    const response = new Response('', { status: 429, headers: { 'retry-after': '120' } });
    expect(testing.retryDelayMs(response)).toBe(5000);
  });
});
