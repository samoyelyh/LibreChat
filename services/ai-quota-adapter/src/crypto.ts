import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function decodeKey(raw: string): Buffer {
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('AI_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function encryptToken(token: string, rawKey: string): string {
  const key = decodeKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptToken(payload: string, rawKey: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = payload.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('Unsupported encrypted token payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', decodeKey(rawKey), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function fingerprintToken(token: string): string {
  const lastFour = token.slice(-4).padStart(4, '*');
  return `sha256:${hashToken(token).slice(0, 12)}:****${lastFour}`;
}
