import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, fingerprintToken, hashToken } from '../src/crypto.js';

describe('token encryption', () => {
  const key = '11'.repeat(32);

  it('round trips with AES-256-GCM without embedding plaintext', () => {
    const token = 'sk-phase2-secret-token-value';
    const encrypted = encryptToken(token, key);
    expect(encrypted).not.toContain(token);
    expect(encrypted.startsWith('v1.')).toBe(true);
    expect(decryptToken(encrypted, key)).toBe(token);
  });

  it('creates a one-way hash and masked fingerprint', () => {
    const token = 'sk-phase2-abcdef1234';
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintToken(token)).toMatch(/^sha256:[a-f0-9]{12}:\*{4}1234$/);
    expect(fingerprintToken(token)).not.toContain('abcdef');
  });
});
