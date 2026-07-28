import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const INTERNAL_GATEWAY_KEY_HEADER = 'x-mcp-gateway-key';
export const INTERNAL_ADAPTER_KEY_HEADER = 'x-adapter-internal-key';
export const SIGNATURE_HEADERS = {
  version: 'x-woda-signature-version',
  timestamp: 'x-woda-timestamp',
  nonce: 'x-woda-nonce',
  contentHash: 'x-woda-content-sha256',
  signature: 'x-woda-signature',
} as const;

const SIGNATURE_VERSION = 'v1';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJSON(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key]!)}`);
  return `{${entries.join(',')}}`;
}

export function canonicalBody(bodyText: string): string {
  if (bodyText.length === 0) {
    return '';
  }
  try {
    return canonicalJSON(JSON.parse(bodyText) as JsonValue);
  } catch {
    return bodyText;
  }
}

export function contentHash(bodyText: string): string {
  return createHash('sha256').update(canonicalBody(bodyText)).digest('hex');
}

function headerValue(headers: Record<string, string>, name: string): string {
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return match?.[1] ?? '';
}

function actorBinding(headers: Record<string, string>): string {
  return [
    'x-librechat-user-id',
    'x-librechat-user-email',
    'x-librechat-user-role',
    'x-librechat-conversation-id',
    'x-librechat-message-id',
    'x-librechat-agent-id',
  ]
    .map((name) => headerValue(headers, name).trim())
    .join('\n');
}

export function canonicalRequest(input: {
  method: string;
  url: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  headers: Record<string, string>;
}): string {
  const url = new URL(input.url);
  return [
    SIGNATURE_VERSION,
    input.method.toUpperCase(),
    `${url.pathname}${url.search}`,
    input.timestamp,
    input.nonce,
    input.bodyHash,
    actorBinding(input.headers),
  ].join('\n');
}

export function signGatewayHeaders(input: {
  url: string;
  method: string;
  bodyText: string;
  headers: Record<string, string>;
  now?: number;
  nonce?: string;
}): Record<string, string> {
  const keyHeader = [INTERNAL_GATEWAY_KEY_HEADER, INTERNAL_ADAPTER_KEY_HEADER].find(
    (name) => headerValue(input.headers, name).length > 0,
  );
  const secret = keyHeader ? headerValue(input.headers, keyHeader) : '';
  if (!secret) {
    return input.headers;
  }
  const headers = Object.fromEntries(
    Object.entries(input.headers).filter(
      ([key, value]) =>
        key.toLowerCase() !== INTERNAL_GATEWAY_KEY_HEADER &&
        key.toLowerCase() !== INTERNAL_ADAPTER_KEY_HEADER &&
        !(
          keyHeader === INTERNAL_ADAPTER_KEY_HEADER &&
          key.toLowerCase() === 'authorization' &&
          value === `Bearer ${secret}`
        ) &&
        !Object.values(SIGNATURE_HEADERS).includes(
          key.toLowerCase() as (typeof SIGNATURE_HEADERS)[keyof typeof SIGNATURE_HEADERS],
        ),
    ),
  );
  const timestamp = String(input.now ?? Date.now());
  const nonce = input.nonce ?? randomUUID();
  const bodyHash = contentHash(input.bodyText);
  const canonical = canonicalRequest({
    method: input.method,
    url: input.url,
    timestamp,
    nonce,
    bodyHash,
    headers,
  });
  return {
    ...headers,
    [SIGNATURE_HEADERS.version]: SIGNATURE_VERSION,
    [SIGNATURE_HEADERS.timestamp]: timestamp,
    [SIGNATURE_HEADERS.nonce]: nonce,
    [SIGNATURE_HEADERS.contentHash]: bodyHash,
    [SIGNATURE_HEADERS.signature]: createHmac('sha256', secret).update(canonical).digest('hex'),
  };
}

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createSignedFetch(baseFetch: FetchFunction = globalThis.fetch): FetchFunction {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const initialHeaders = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => initialHeaders.set(key, value));
    const hasSigningKey = [INTERNAL_GATEWAY_KEY_HEADER, INTERNAL_ADAPTER_KEY_HEADER].some((name) =>
      initialHeaders.has(name),
    );
    if (!hasSigningKey) {
      return baseFetch(input, init);
    }
    const request = new Request(input, init);
    const bodyText =
      request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
    const headers = signGatewayHeaders({
      url: request.url,
      method: request.method,
      bodyText,
      headers: Object.fromEntries(request.headers.entries()),
    });
    return baseFetch(new Request(request, { headers }));
  };
}

export function signaturesEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
