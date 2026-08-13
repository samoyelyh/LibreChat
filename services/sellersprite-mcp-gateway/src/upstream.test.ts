import { describe, expect, it } from 'vitest';
import { requestHeaders } from './upstream.js';

describe('upstream request authentication', () => {
  it('uses secret-key for SellerSprite without forwarding an incoming authorization header', () => {
    const headers = requestHeaders({ authorization: 'Bearer incoming' }, 'seller-secret');

    expect(headers.get('secret-key')).toBe('seller-secret');
    expect(headers.has('authorization')).toBe(false);
  });

  it('uses a bearer token for the resume MCP without exposing a secret-key header', () => {
    const headers = requestHeaders({}, 'resume-secret', 'bearer');

    expect(headers.get('authorization')).toBe('Bearer resume-secret');
    expect(headers.has('secret-key')).toBe(false);
  });
});
