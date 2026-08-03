import { describe, expect, it, vi } from 'vitest';
import { testing, type ProxyStores } from './proxy.js';
import type { RateLimitDecision } from './types.js';

function decision(input: Partial<RateLimitDecision>): RateLimitDecision {
  return {
    allowed: false,
    limit: 1,
    remaining: 0,
    retryAfterSeconds: 1,
    window: 'second',
    ...input,
  };
}

function stores(consumeToolRateLimit: ProxyStores['consumeToolRateLimit']): ProxyStores {
  return {
    getCredentialSecret: async () => null,
    markUsed: async () => undefined,
    recordCallAudits: async () => undefined,
    consumeToolRateLimit,
  };
}

describe('Lingxing tool pacing', () => {
  it('waits and reacquires a per-second slot instead of returning 429 immediately', async () => {
    const consumeToolRateLimit = vi
      .fn<ProxyStores['consumeToolRateLimit']>()
      .mockResolvedValueOnce(decision({}))
      .mockResolvedValueOnce(
        decision({ allowed: true, window: 'minute', limit: 60, remaining: 59 }),
      );
    const wait = vi.fn(async () => undefined);

    const result = await testing.consumeRateLimit(
      stores(consumeToolRateLimit),
      'user-1',
      'get_fba_stock_list',
      wait,
    );

    expect(result.allowed).toBe(true);
    expect(wait).toHaveBeenCalledWith(1000);
    expect(consumeToolRateLimit).toHaveBeenCalledTimes(2);
  });

  it('stops after two waits when the queue remains saturated', async () => {
    const consumeToolRateLimit = vi
      .fn<ProxyStores['consumeToolRateLimit']>()
      .mockResolvedValue(decision({ retryAfterSeconds: 2 }));
    const wait = vi.fn(async () => undefined);

    const result = await testing.consumeRateLimit(
      stores(consumeToolRateLimit),
      'user-1',
      'get_fba_stock_list',
      wait,
    );

    expect(result.allowed).toBe(false);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(consumeToolRateLimit).toHaveBeenCalledTimes(3);
  });

  it('does not retry a minute-level hard limit', async () => {
    const consumeToolRateLimit = vi
      .fn<ProxyStores['consumeToolRateLimit']>()
      .mockResolvedValue(decision({ limit: 60, retryAfterSeconds: 30, window: 'minute' }));
    const wait = vi.fn(async () => undefined);

    const result = await testing.consumeRateLimit(
      stores(consumeToolRateLimit),
      'user-1',
      'get_fba_stock_list',
      wait,
    );

    expect(result.allowed).toBe(false);
    expect(wait).not.toHaveBeenCalled();
    expect(consumeToolRateLimit).toHaveBeenCalledTimes(1);
  });
});
