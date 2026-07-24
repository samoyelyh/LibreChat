import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { EncryptedSecret } from './types.js';

export function fingerprintLast4(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex').slice(-4);
}

export function encryptSecret(secret: string, key: Buffer, userId: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`lingxing:${userId}:v1`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptSecret(value: EncryptedSecret, key: Buffer, userId: string): string {
  if (value.version !== 1 || value.algorithm !== 'aes-256-gcm') {
    throw new Error('Unsupported credential encryption format');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(`lingxing:${userId}:v1`, 'utf8'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
