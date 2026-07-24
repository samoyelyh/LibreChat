import type { ConnectionTestResult, GatewayConfig } from './types.js';

const requestHeaderNames = [
  'accept',
  'content-type',
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
];
const responseHeaderNames = [
  'content-type',
  'cache-control',
  'mcp-session-id',
  'mcp-protocol-version',
  'retry-after',
];

function requestHeaders(
  incoming: Record<string, string | string[] | undefined>,
  secret: string,
): Headers {
  const headers = new Headers();
  for (const name of requestHeaderNames) {
    const value = incoming[name];
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value) && value[0]) headers.set(name, value[0]);
  }
  headers.set('X-Mcp-Key', secret);
  return headers;
}

export function responseHeaders(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of responseHeaderNames) {
    const value = response.headers.get(name);
    if (value) headers[name] = value;
  }
  return headers;
}

function parseMcpPayload(text: string): {
  result?: { protocolVersion?: string; tools?: unknown[] };
  error?: unknown;
} {
  const data = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'))
    ?.slice(5)
    .trim();
  return JSON.parse(data || text) as {
    result?: { protocolVersion?: string; tools?: unknown[] };
    error?: unknown;
  };
}

export class LingxingClient {
  constructor(private readonly config: GatewayConfig) {}

  async relay(input: {
    secret: string;
    method: 'GET' | 'POST' | 'DELETE';
    headers: Record<string, string | string[] | undefined>;
    body?: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    return fetch(this.config.upstreamUrl, {
      method: input.method,
      headers: requestHeaders(input.headers, input.secret),
      ...(input.body != null ? { body: input.body } : {}),
      signal,
    });
  }

  async connectionTest(secret: string): Promise<ConnectionTestResult> {
    let sessionId: string | null = null;
    let protocolVersion = '2025-06-18';
    try {
      const initialized = await this.relay({
        secret,
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': protocolVersion,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'lingxing-connection-test',
          method: 'initialize',
          params: {
            protocolVersion,
            capabilities: {},
            clientInfo: { name: 'woda-lingxing-connection-test', version: '1.0.0' },
          },
        }),
      });
      sessionId = initialized.headers.get('mcp-session-id');
      if (!initialized.ok) {
        return {
          ok: false,
          code: initialized.status === 401 || initialized.status === 403 ? 'invalid_key' : 'upstream_http',
          message: `initialize HTTP ${initialized.status}`,
        };
      }
      const payload = parseMcpPayload(await initialized.text());
      if (payload.error) {
        return { ok: false, code: 'mcp_initialize_error', message: 'initialize returned an MCP error' };
      }
      protocolVersion = payload.result?.protocolVersion ?? protocolVersion;
      await this.relay({
        secret,
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
        secret,
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'mcp-protocol-version': protocolVersion,
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'lingxing-tools-list',
          method: 'tools/list',
          params: {},
        }),
      });
      if (!tools.ok) {
        return { ok: false, code: 'tools_list_http', message: `tools/list HTTP ${tools.status}` };
      }
      const toolPayload = parseMcpPayload(await tools.text());
      if (toolPayload.error) {
        return { ok: false, code: 'tools_list_error', message: 'tools/list returned an MCP error' };
      }
      const toolCount = Array.isArray(toolPayload.result?.tools) ? toolPayload.result.tools.length : 0;
      return {
        ok: toolCount > 0,
        code: toolCount > 0 ? 'connected' : 'no_tools',
        message: toolCount > 0 ? 'connected' : 'no tools returned',
        toolCount,
      };
    } catch (error) {
      const code =
        error != null && typeof error === 'object' && 'code' in error ? String(error.code) : 'failed';
      return { ok: false, code: 'connection_failed', message: `connection ${code}` };
    } finally {
      if (sessionId) {
        await this.relay({
          secret,
          method: 'DELETE',
          headers: { 'mcp-session-id': sessionId, 'mcp-protocol-version': protocolVersion },
        }).catch(() => undefined);
      }
    }
  }
}
