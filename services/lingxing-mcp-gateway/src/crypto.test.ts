import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, fingerprintLast4 } from './crypto.js';

describe('credential encryption', () => {
  it('round-trips with per-user authenticated data and never stores plaintext', () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret('lx-secret-value', key, 'user-a');
    expect(JSON.stringify(encrypted)).not.toContain('lx-secret-value');
    expect(decryptSecret(encrypted, key, 'user-a')).toBe('lx-secret-value');
    expect(() => decryptSecret(encrypted, key, 'user-b')).toThrow();
  });

  it('creates a stable four-character fingerprint', () => {
    expect(fingerprintLast4('same')).toHaveLength(4);
    expect(fingerprintLast4('same')).toBe(fingerprintLast4('same'));
  });
});
