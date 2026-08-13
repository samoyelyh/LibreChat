import type { GatewayConfig } from './types.js';

const forwardedRequestHeaders = [
  'accept',
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];

const forwardedResponseHeaders = [
  'content-type',
  'cache-control',
  'mcp-session-id',
  'mcp-protocol-version',
  'retry-after',
];

export function requestHeaders(
  incoming: Record<string, string | string[] | undefined>,
  secret: string,
  auth: GatewayConfig['upstreamAuth'] = 'secret-key',
): Headers {
  const headers = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = incoming[name];
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value) && value[0]) headers.set(name, value[0]);
  }
  if (auth === 'bearer') headers.set('authorization', `Bearer ${secret}`);
  else headers.set('secret-key', secret);
  return headers;
}

export function responseHeaders(upstream: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of forwardedResponseHeaders) {
    const value = upstream.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

export class SellerSpriteClient {
  constructor(private readonly config: GatewayConfig) {}

  async relay(input: {
    method: 'GET' | 'POST' | 'DELETE';
    headers: Record<string, string | string[] | undefined>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    return fetch(this.config.upstreamUrl, {
      method: input.method,
      headers: requestHeaders(input.headers, this.config.upstreamSecret, this.config.upstreamAuth),
      ...(input.body != null ? { body: input.body } : {}),
      signal,
    });
  }

  async connectionTest(): Promise<{ ok: boolean; message: string; toolCount?: number }> {
    let sessionId: string | null = null;
    let protocolVersion = '2025-06-18';
    try {
      const initialize = await this.relay({
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': '2025-06-18',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'phase3-initialize',
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'woda-phase3-connection-test', version: '1.0.0' },
          },
        }),
      });
      sessionId = initialize.headers.get('mcp-session-id');
      if (!initialize.ok) {
        return { ok: false, message: `initialize HTTP ${initialize.status}` };
      }
      const initializeText = await initialize.text();
      const initializeData = initializeText
        .split(/\r?\n/)
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      const initialized = JSON.parse(initializeData || initializeText) as {
        result?: { protocolVersion?: unknown };
        error?: unknown;
      };
      if (initialized.error) return { ok: false, message: 'initialize returned an MCP error' };
      if (typeof initialized.result?.protocolVersion === 'string') {
        protocolVersion = initialized.result.protocolVersion;
      }

      await this.relay({
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': protocolVersion,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }).then((response) => response.arrayBuffer());

      const tools = await this.relay({
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': protocolVersion,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'phase3-tools-list',
          method: 'tools/list',
          params: {},
        }),
      });
      if (!tools.ok) return { ok: false, message: `tools/list HTTP ${tools.status}` };
      const text = await tools.text();
      const dataLine = text
        .split(/\r?\n/)
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim();
      const payload = JSON.parse(dataLine || text) as {
        result?: { tools?: unknown[] };
        error?: { code?: unknown };
      };
      if (payload.error) return { ok: false, message: 'tools/list returned an MCP error' };
      const toolCount = Array.isArray(payload.result?.tools) ? payload.result.tools.length : 0;
      return { ok: toolCount > 0, message: toolCount > 0 ? 'connected' : 'no tools returned', toolCount };
    } catch (error) {
      const code =
        error != null && typeof error === 'object' && 'code' in error ? String(error.code) : 'failed';
      return { ok: false, message: `connection ${code}` };
    } finally {
      if (sessionId) {
        await this.relay({
          method: 'DELETE',
          headers: { 'mcp-session-id': sessionId, 'mcp-protocol-version': protocolVersion },
        }).catch(() => undefined);
      }
    }
  }
}
