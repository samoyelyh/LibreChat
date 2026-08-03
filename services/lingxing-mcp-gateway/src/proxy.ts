import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { canUseTool, filterTools, permissionGroupForTool } from './policy.js';
import { structureToolCallBody } from './structured-result.js';
import { responseHeaders, type LingxingClient } from './upstream.js';
import type { CallAudit, RateLimitDecision, VerifiedActor } from './types.js';

interface JsonRpcRequest {
  id?: string | number | null;
  method?: string;
  params?: { name?: string };
}

interface ToolCall {
  id?: string | number | null;
  tool: string;
}

export interface ProxyStores {
  getCredentialSecret(userId: string, allowUntested?: boolean): Promise<string | null>;
  markUsed(userId: string): Promise<void>;
  recordCallAudits(values: CallAudit[]): Promise<void>;
  consumeToolRateLimit(userId: string, tool: string): Promise<RateLimitDecision>;
}

type Delay = (durationMs: number) => Promise<void>;

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function consumeRateLimit(
  stores: ProxyStores,
  userId: string,
  tool: string,
  wait: Delay = delay,
): Promise<RateLimitDecision> {
  let decision = await stores.consumeToolRateLimit(userId, tool);
  for (
    let attempt = 0;
    attempt < 2 && !decision.allowed && decision.window === 'second';
    attempt++
  ) {
    await wait(decision.retryAfterSeconds * 1000);
    decision = await stores.consumeToolRateLimit(userId, tool);
  }
  return decision;
}

function requests(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) {
    return body.filter((item): item is JsonRpcRequest => item != null && typeof item === 'object');
  }
  return body != null && typeof body === 'object' ? [body as JsonRpcRequest] : [];
}

function calls(body: unknown): ToolCall[] {
  return requests(body)
    .filter(
      (request) => request.method === 'tools/call' && typeof request.params?.name === 'string',
    )
    .map((request) => ({
      ...(request.id !== undefined ? { id: request.id } : {}),
      tool: request.params!.name!,
    }));
}

function includesMethod(body: unknown, method: string): boolean {
  return requests(body).some((request) => request.method === method);
}

function filterToolsText(text: string, actor: VerifiedActor, contentType: string): string {
  if (contentType.includes('text/event-stream')) {
    return text
      .split(/\r?\n/)
      .map((line) => {
        if (!line.startsWith('data:')) return line;
        try {
          return `data: ${JSON.stringify(filterTools(JSON.parse(line.slice(5).trim()), actor))}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  }
  try {
    return JSON.stringify(filterTools(JSON.parse(text), actor));
  } catch {
    return text;
  }
}

function responseHasError(value: unknown, id: ToolCall['id']): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => {
    if (entry == null || typeof entry !== 'object') return false;
    const response = entry as Record<string, unknown>;
    return (id === undefined || response.id === id) && response.error != null;
  });
}

function audit(
  actor: VerifiedActor,
  call: ToolCall,
  input: {
    requestId: string;
    allowed: boolean;
    success: boolean;
    upstreamStatus: number;
    elapsedMs: number;
    errorCode?: string;
  },
): CallAudit {
  const permissionGroup = permissionGroupForTool(call.tool);
  return {
    requestId: input.requestId,
    userId: actor.userId,
    role: actor.role,
    departments: actor.departments,
    ...(actor.conversationId ? { conversationId: actor.conversationId } : {}),
    ...(actor.messageId ? { messageId: actor.messageId } : {}),
    ...(actor.agentId ? { agentId: actor.agentId } : {}),
    tool: call.tool,
    ...(permissionGroup ? { permissionGroup } : {}),
    allowed: input.allowed,
    success: input.success,
    upstreamStatus: input.upstreamStatus,
    elapsedMs: input.elapsedMs,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    createdAt: new Date(),
  };
}

function jsonRpcError(
  reply: FastifyReply,
  status: number,
  id: ToolCall['id'],
  code: number,
  message: string,
) {
  return reply.code(status).send({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

export async function proxyMcp(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  actor: VerifiedActor;
  stores: ProxyStores;
  upstream: LingxingClient;
}): Promise<void> {
  const { request, reply, actor, stores, upstream } = input;
  const method = request.method as 'GET' | 'POST' | 'DELETE';
  const toolCalls = method === 'POST' ? calls(request.body) : [];
  const requestId = randomUUID();
  const started = Date.now();

  const denied = toolCalls.find((call) => !canUseTool(actor, call.tool));
  if (denied) {
    await stores.recordCallAudits([
      audit(actor, denied, {
        requestId,
        allowed: false,
        success: false,
        upstreamStatus: 403,
        elapsedMs: Date.now() - started,
        errorCode: 'tool_not_authorized',
      }),
    ]);
    jsonRpcError(reply, 403, denied.id, -32003, '领星工具未授权');
    return;
  }

  const decisions = await Promise.all(
    toolCalls.map(async (call) => ({
      call,
      decision: await consumeRateLimit(stores, actor.userId, call.tool),
    })),
  );
  const limited = decisions.find(({ decision }) => !decision.allowed);
  if (limited) {
    reply.header('retry-after', String(limited.decision.retryAfterSeconds));
    reply.header('x-ratelimit-limit', String(limited.decision.limit));
    reply.header('x-ratelimit-remaining', String(limited.decision.remaining));
    reply.header('x-ratelimit-window', limited.decision.window);
    await stores.recordCallAudits([
      audit(actor, limited.call, {
        requestId,
        allowed: true,
        success: false,
        upstreamStatus: 429,
        elapsedMs: Date.now() - started,
        errorCode: 'tool_rate_limited',
      }),
    ]);
    jsonRpcError(reply, 429, limited.call.id, -32029, '领星工具调用频率超过限制');
    return;
  }

  const secret = await stores.getCredentialSecret(actor.userId);
  if (!secret) {
    if (toolCalls.length > 0) {
      await stores.recordCallAudits(
        toolCalls.map((call) =>
          audit(actor, call, {
            requestId,
            allowed: true,
            success: false,
            upstreamStatus: 403,
            elapsedMs: Date.now() - started,
            errorCode: 'credential_required',
          }),
        ),
      );
    }
    jsonRpcError(
      reply,
      403,
      toolCalls[0]?.id,
      -32001,
      '请先在“设置 → 我的数据源 → 领星 ERP”配置并测试密钥',
    );
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  let status = 502;
  let parsed: unknown;
  let errorCode: string | undefined;
  try {
    const response = await upstream.relay({
      secret,
      method,
      headers: request.headers,
      ...(method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
      retryRateLimit:
        method === 'POST' && (toolCalls.length > 0 || includesMethod(request.body, 'tools/list')),
    });
    status = response.status;
    const contentType = response.headers.get('content-type') ?? 'application/json';
    for (const [name, value] of Object.entries(responseHeaders(response))) {
      reply.header(name, value);
    }
    reply.header('x-lingxing-gateway-request-id', requestId);
    const raw = await response.text();
    const filteredBody =
      method === 'POST' && includesMethod(request.body, 'tools/list')
        ? filterToolsText(raw, actor, contentType)
        : raw;
    const body =
      toolCalls.length > 0
        ? structureToolCallBody({
            text: filteredBody,
            contentType,
            calls: toolCalls,
            provider: 'lingxing',
            requestId,
            elapsedMs: Date.now() - started,
          })
        : filteredBody;
    if (!contentType.includes('text/event-stream')) {
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
    }
    reply.code(status).send(body);
    if (response.ok) await stores.markUsed(actor.userId);
  } catch {
    errorCode = controller.signal.aborted ? 'client_closed_request' : 'lingxing_upstream_failed';
    status = controller.signal.aborted ? 499 : 502;
    request.log.warn({ requestId, errorCode }, 'Lingxing upstream request failed');
    if (!reply.sent) {
      reply.code(status).send({
        error: {
          code: errorCode,
          message: controller.signal.aborted ? '请求已取消' : '领星服务暂时不可用',
        },
      });
    }
  } finally {
    request.raw.removeListener('aborted', abort);
    if (toolCalls.length > 0) {
      const elapsedMs = Date.now() - started;
      await stores
        .recordCallAudits(
          toolCalls.map((call) =>
            audit(actor, call, {
              requestId,
              allowed: true,
              success: status >= 200 && status < 300 && !responseHasError(parsed, call.id),
              upstreamStatus: status,
              elapsedMs,
              ...(errorCode ? { errorCode } : {}),
            }),
          ),
        )
        .catch(() => undefined);
    }
  }
}

export const testing = { calls, consumeRateLimit, filterToolsText };
