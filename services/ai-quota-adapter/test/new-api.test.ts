import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterError } from '../src/errors.js';
import { loginIdentity, NewApiClient, normalizedUrl } from '../src/new-api.js';

afterEach(() => vi.unstubAllGlobals());

describe('New API URL normalization', () => {
  it('retains the configured v1 prefix for OpenAI-compatible routes', () => {
    expect(normalizedUrl('https://api.aso8ty.com/v1', '/v1/models')).toBe(
      'https://api.aso8ty.com/v1/models',
    );
    expect(normalizedUrl('https://api.aso8ty.com/v1/', '/v1/chat/completions')).toBe(
      'https://api.aso8ty.com/v1/chat/completions',
    );
  });

  it('resolves New API management routes from the origin', () => {
    expect(normalizedUrl('https://api.aso8ty.com/v1', '/api/usage/token')).toBe(
      'https://api.aso8ty.com/api/usage/token',
    );
  });
});

describe('New API login response compatibility', () => {
  it('reads the legacy top-level user id', () => {
    expect(loginIdentity({ id: 42, require_2fa: false })).toEqual({
      userId: 42,
      accessToken: undefined,
      requireTwoFactor: false,
    });
  });

  it('reads the nested user returned by current New API versions', () => {
    expect(loginIdentity({ access_token: 'session-access-token', user: { id: 84 } })).toEqual({
      userId: 84,
      accessToken: 'session-access-token',
      requireTwoFactor: false,
    });
  });

  it('preserves two-factor authentication checks for either response shape', () => {
    expect(loginIdentity({ require_2fa: true }).requireTwoFactor).toBe(true);
    expect(loginIdentity({ user: { id: 84, require_2fa: true } }).requireTwoFactor).toBe(true);
  });
});

describe('New API relay timeout', () => {
  it('stops the response timer after streaming headers arrive', async () => {
    let relaySignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        relaySignal = init?.signal ?? undefined;
        return new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      }),
    );
    const client = new NewApiClient('https://api.aso8ty.com/v1', 10);
    const response = await client.relay(
      '/v1/chat/completions',
      { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
      'runtime-token',
      new AbortController().signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(response.status).toBe(200);
    expect(relaySignal?.aborted).toBe(false);
  });

  it('returns a specific gateway timeout before response headers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
          }),
      ),
    );
    const client = new NewApiClient('https://api.aso8ty.com/v1', 10);
    await expect(
      client.relay(
        '/v1/chat/completions',
        { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } },
        'runtime-token',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject<Partial<AdapterError>>({
      statusCode: 504,
      code: 'new_api_response_timeout',
    });
  });
});
