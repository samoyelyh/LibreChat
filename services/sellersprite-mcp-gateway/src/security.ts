import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type SignatureResult =
  | { ok: true; nonce: string; expiresAt: Date }
  | {
      ok: false;
      code:
        | 'missing_request_signature'
        | 'invalid_request_signature'
        | 'stale_request_signature';
    };

function canonicalJSON(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key]!)}`)
    .join(',')}}`;
}

function bodyText(body: FastifyRequest['body']): string {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  return canonicalJSON(body as JsonValue);
}

function digest(body: FastifyRequest['body']): string {
  return createHash('sha256').update(bodyText(body)).digest('hex');
}

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function actorBinding(request: FastifyRequest): string {
  return [
    'x-librechat-user-id',
    'x-librechat-user-email',
    'x-librechat-user-role',
    'x-librechat-conversation-id',
    'x-librechat-message-id',
    'x-librechat-agent-id',
  ]
    .map((name) => header(request, name).trim())
    .join('\n');
}

function canonicalRequest(
  request: FastifyRequest,
  timestamp: string,
  nonce: string,
  contentHash: string,
): string {
  const url = new URL(request.url, 'http://gateway.internal');
  return [
    VERSION,
    request.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    timestamp,
    nonce,
    contentHash,
    actorBinding(request),
  ].join('\n');
}

export function createSignedHeaders(input: {
  secret: string;
  method: string;
  path: string;
  bodyText?: string;
  actorHeaders?: Record<string, string>;
  now?: number;
  nonce?: string;
}): Record<string, string> {
  const headers = input.actorHeaders ?? {};
  const value = (name: string): string =>
    Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]?.trim() ?? '';
  const timestamp = String(input.now ?? Date.now());
  const nonce = input.nonce ?? randomUUID();
  const parsedBody = input.bodyText
    ? (() => {
        try {
          return canonicalJSON(JSON.parse(input.bodyText) as JsonValue);
        } catch {
          return input.bodyText;
        }
      })()
    : '';
  const contentHash = createHash('sha256').update(parsedBody).digest('hex');
  const actor = [
    'x-librechat-user-id',
    'x-librechat-user-email',
    'x-librechat-user-role',
    'x-librechat-conversation-id',
    'x-librechat-message-id',
    'x-librechat-agent-id',
  ]
    .map(value)
    .join('\n');
  const canonical = [
    VERSION,
    input.method.toUpperCase(),
    input.path,
    timestamp,
    nonce,
    contentHash,
    actor,
  ].join('\n');
  return {
    ...headers,
    'x-woda-signature-version': VERSION,
    'x-woda-timestamp': timestamp,
    'x-woda-nonce': nonce,
    'x-woda-content-sha256': contentHash,
    'x-woda-signature': createHmac('sha256', input.secret).update(canonical).digest('hex'),
  };
}

export function verifySignedRequest(
  request: FastifyRequest,
  secret: string,
  toleranceMs: number,
  now = Date.now(),
): SignatureResult {
  const version = header(request, 'x-woda-signature-version');
  const timestamp = header(request, 'x-woda-timestamp');
  const nonce = header(request, 'x-woda-nonce');
  const suppliedHash = header(request, 'x-woda-content-sha256');
  const suppliedSignature = header(request, 'x-woda-signature');
  if (!version || !timestamp || !nonce || !suppliedHash || !suppliedSignature) {
    return { ok: false, code: 'missing_request_signature' };
  }
  const timestampValue = Number(timestamp);
  if (
    version !== VERSION ||
    !Number.isSafeInteger(timestampValue) ||
    !UUID_PATTERN.test(nonce) ||
    Math.abs(now - timestampValue) > toleranceMs
  ) {
    return { ok: false, code: 'stale_request_signature' };
  }
  const expectedHash = digest(request.body);
  if (!safeEqual(suppliedHash, expectedHash)) {
    return { ok: false, code: 'invalid_request_signature' };
  }
  const expectedSignature = createHmac('sha256', secret)
    .update(canonicalRequest(request, timestamp, nonce, expectedHash))
    .digest('hex');
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    return { ok: false, code: 'invalid_request_signature' };
  }
  return {
    ok: true,
    nonce,
    expiresAt: new Date(Math.max(now, timestampValue) + toleranceMs * 2),
  };
}
