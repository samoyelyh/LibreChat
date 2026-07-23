import type { NewApiClientContract } from './contracts.js';
import { AdapterError, UpstreamError } from './errors.js';
import type { NewApiLog, TokenUsage } from './types.js';

export function normalizedUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  if (path.startsWith('/api/')) return new URL(path, base.origin).toString();
  if (path.startsWith('/v1/') && base.pathname.replace(/\/+$/, '') === '/v1') {
    return new URL(path.replace(/^\/v1\//, ''), `${base.toString().replace(/\/+$/, '')}/`).toString();
  }
  return new URL(path.replace(/^\//, ''), `${base.toString().replace(/\/+$/, '')}/`).toString();
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

export class NewApiClient implements NewApiClientContract {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  private async jsonRequest<T>(path: string, token?: string, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = bearer(token);
    const response = await fetch(normalizedUrl(this.baseUrl, path), { headers, signal: combined });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      throw new UpstreamError(
        response.status,
        'new_api_request_failed',
        `New API request failed with HTTP ${response.status}`,
        bytes,
        response.headers.get('content-type') ?? undefined,
      );
    }
    try {
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
    } catch {
      throw new AdapterError(502, 'invalid_new_api_response', 'New API returned invalid JSON');
    }
  }

  async status(): Promise<Record<string, unknown>> {
    return this.jsonRequest<Record<string, unknown>>('/api/status');
  }

  async listModels(token: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.jsonRequest<Record<string, unknown>>('/v1/models', token, signal);
  }

  async tokenUsage(token: string, signal?: AbortSignal): Promise<TokenUsage> {
    const response = await this.jsonRequest<{ data?: TokenUsage }>('/api/usage/token', token, signal);
    if (!response.data) throw new AdapterError(502, 'invalid_usage_response', 'New API usage data is missing');
    return response.data;
  }

  async tokenLogs(token: string, signal?: AbortSignal): Promise<NewApiLog[]> {
    const response = await this.jsonRequest<{ data?: NewApiLog[] }>('/api/log/token', token, signal);
    return Array.isArray(response.data) ? response.data : [];
  }

  async relay(path: string, init: RequestInit, token: string, signal: AbortSignal): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    headers.delete('x-adapter-internal-key');
    headers.delete('x-librechat-user-id');
    headers.delete('x-librechat-user-email');
    headers.delete('x-librechat-conversation-id');
    headers.delete('x-librechat-message-id');
    headers.set('authorization', bearer(token));
    return fetch(normalizedUrl(this.baseUrl, path), {
      ...init,
      headers,
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
    });
  }
}

export function modelIds(response: Record<string, unknown>): string[] {
  const data = response.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((item) => (item && typeof item === 'object' && typeof item.id === 'string' ? item.id : null))
    .filter((value): value is string => value !== null);
}

export function filterModels(
  response: Record<string, unknown>,
  allowedModels: string[],
): Record<string, unknown> {
  const allowed = new Set(allowedModels);
  const data = Array.isArray(response.data)
    ? response.data.filter(
        (item) => item && typeof item === 'object' && typeof item.id === 'string' && allowed.has(item.id),
      )
    : [];
  return { ...response, data };
}
