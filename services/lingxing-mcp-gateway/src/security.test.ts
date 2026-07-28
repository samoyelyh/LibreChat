import Fastify from 'fastify';
import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifySignedRequest } from './security.js';

const secret = 'phase8-request-signing-secret'.repeat(2);
const now = 1_700_000_000_000;
const nonce = '00000000-0000-4000-8000-000000000000';

function signedHeaders(timestamp = now): Record<string, string> {
  const hash = createHash('sha256').update('{"a":1,"b":2}').digest('hex');
  const canonical = [
    'v1',
    'POST',
    '/mcp',
    String(timestamp),
    nonce,
    hash,
    'user-a\nuser@example.com\nUSER\n\n\n',
  ].join('\n');
  return {
    'content-type': 'application/json',
    'x-librechat-user-id': 'user-a',
    'x-librechat-user-email': 'user@example.com',
    'x-librechat-user-role': 'USER',
    'x-woda-signature-version': 'v1',
    'x-woda-timestamp': String(timestamp),
    'x-woda-nonce': nonce,
    'x-woda-content-sha256': hash,
    'x-woda-signature': createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

async function verify(body: string, headers: Record<string, string>) {
  const app = Fastify();
  let result: ReturnType<typeof verifySignedRequest> | undefined;
  app.post('/mcp', async (request) => {
    result = verifySignedRequest(request, secret, 30_000, now);
    return {};
  });
  await app.inject({ method: 'POST', url: '/mcp', headers, payload: body });
  await app.close();
  return result;
}

describe('signed gateway requests', () => {
  it('accepts canonical requests and rejects replayable stale material', async () => {
    expect(await verify('{"b":2,"a":1}', signedHeaders())).toEqual({
      ok: true,
      nonce,
      expiresAt: new Date(now + 60_000),
    });
    expect(await verify('{"a":9}', signedHeaders())).toEqual({
      ok: false,
      code: 'invalid_request_signature',
    });
    expect(await verify('{"a":1,"b":2}', signedHeaders(now - 31_000))).toEqual({
      ok: false,
      code: 'stale_request_signature',
    });
  });
});
