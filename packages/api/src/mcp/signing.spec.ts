import { canonicalBody, createSignedFetch, signGatewayHeaders, SIGNATURE_HEADERS } from './signing';

describe('MCP gateway request signing', () => {
  const headers = {
    'X-MCP-Gateway-Key': 'phase8-secret'.repeat(4),
    'X-LibreChat-User-ID': 'user-a',
    'X-LibreChat-User-Email': 'user@example.com',
    'X-LibreChat-User-Role': 'USER',
  };

  it('canonicalizes JSON without depending on object key order', () => {
    expect(canonicalBody('{"b":2,"a":{"d":4,"c":3}}')).toBe('{"a":{"c":3,"d":4},"b":2}');
  });

  it('replaces the static gateway key with a bound HMAC signature', () => {
    const signed = signGatewayHeaders({
      url: 'http://sellersprite-mcp-gateway:4200/mcp?mode=test',
      method: 'POST',
      bodyText: '{"b":2,"a":1}',
      headers,
      now: 1_700_000_000_000,
      nonce: '00000000-0000-4000-8000-000000000000',
    });

    expect(signed['X-MCP-Gateway-Key']).toBeUndefined();
    expect(signed[SIGNATURE_HEADERS.version]).toBe('v1');
    expect(signed[SIGNATURE_HEADERS.timestamp]).toBe('1700000000000');
    expect(signed[SIGNATURE_HEADERS.nonce]).toBe('00000000-0000-4000-8000-000000000000');
    expect(signed[SIGNATURE_HEADERS.contentHash]).toMatch(/^[a-f0-9]{64}$/);
    expect(signed[SIGNATURE_HEADERS.signature]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not sign requests without the internal key header', () => {
    const unsigned = { Accept: 'application/json' };
    expect(
      signGatewayHeaders({
        url: 'https://example.com/mcp',
        method: 'GET',
        bodyText: '',
        headers: unsigned,
      }),
    ).toBe(unsigned);
  });

  it('signs adapter fetches without forwarding its static bearer secret', async () => {
    const calls: Request[] = [];
    const baseFetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return new Response('{}');
    });
    const signedFetch = createSignedFetch(baseFetch);
    await signedFetch('http://ai-quota-adapter:4100/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer adapter-secret',
        'X-Adapter-Internal-Key': 'adapter-secret',
        'X-LibreChat-User-ID': 'user-a',
        'X-LibreChat-User-Email': 'user@example.com',
      },
      body: '{"model":"kimi-k2"}',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers.get('x-adapter-internal-key')).toBeNull();
    expect(calls[0]!.headers.get('authorization')).toBeNull();
    expect(calls[0]!.headers.get(SIGNATURE_HEADERS.signature)).toMatch(/^[a-f0-9]{64}$/);
  });
});
