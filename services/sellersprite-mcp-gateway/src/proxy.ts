import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { canUseServer, canUseTool, filterToolsResult, permissionGroupForTool } from './policy.js';
import { structureToolCallBody } from './structured-result.js';
import { responseHeaders, type SellerSpriteClient } from './upstream.js';
import type { CallAudit, RateLimitDecision, VerifiedActor } from './types.js';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string };
}

interface ToolCall {
  id?: string | number | null;
  tool: string;
}

export interface AuditRecorder {
  recordAudits(audits: CallAudit[]): Promise<void>;
  consumeToolRateLimit(userId: string, tool: string): Promise<RateLimitDecision>;
}

function jsonRpcRequests(body: unknown): JsonRpcRequest[] {
  if (Array.isArray(body)) return body.filter((item): item is JsonRpcRequest => item != null && typeof item === 'object');
  if (body != null && typeof body === 'object') return [body as JsonRpcRequest];
  return [];
}

function toolCalls(body: unknown): ToolCall[] {
  return jsonRpcRequests(body)
    .filter((rpc) => rpc.method === 'tools/call' && typeof rpc.params?.name === 'string')
    .map((rpc) => ({
      ...(rpc.id !== undefined ? { id: rpc.id } : {}),
      tool: rpc.params!.name!,
    }));
}

function includesMethod(body: unknown, method: string): boolean {
  return jsonRpcRequests(body).some((rpc) => rpc.method === method);
}

function responseHasError(value: unknown, id: ToolCall['id']): boolean {
  const responses = Array.isArray(value) ? value : [value];
  return responses.some((entry) => {
    if (entry == null || typeof entry !== 'object') return false;
    const rpc = entry as Record<string, unknown>;
    return (id === undefined || rpc.id === id) && rpc.error != null;
  });
}

function nestedRecordCount(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string') {
      try {
        return nestedRecordCount(JSON.parse(value));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  const object = value as Record<string, unknown>;
  for (const key of ['records', 'items', 'list', 'data', 'rows']) {
    if (Array.isArray(object[key])) return object[key].length;
    if (object[key] != null && typeof object[key] === 'object') {
      const count = nestedRecordCount(object[key]);
      if (count != null) return count;
    }
  }
  for (const key of ['total', 'totalCount', 'count']) {
    if (typeof object[key] === 'number' && Number.isFinite(object[key])) return object[key] as number;
  }
  if (Array.isArray(object.content)) {
    for (const content of object.content) {
      if (content != null && typeof content === 'object') {
        const count = nestedRecordCount((content as Record<string, unknown>).text);
        if (count != null) return count;
      }
    }
  }
  if (object.result != null) return nestedRecordCount(object.result);
  return undefined;
}

function filterToolsBody(text: string, actor: VerifiedActor, contentType: string): string {
  if (actor.allTools) return text;
  if (contentType.includes('text/event-stream')) {
    return text
      .split(/\r?\n/)
      .map((line) => {
        if (!line.startsWith('data:')) return line;
        try {
          const parsed = JSON.parse(line.slice(5).trim()) as unknown;
          return `data: ${JSON.stringify(filterToolsResult(parsed, actor))}`;
        } catch {
          return line;
        }
      })
      .join('\n');
  }
  try {
    return JSON.stringify(filterToolsResult(JSON.parse(text) as unknown, actor));
  } catch {
    return text;
  }
}

function month(createdAt: Date): string {
  return createdAt.toISOString().slice(0, 7);
}

function auditFor(
  actor: VerifiedActor,
  call: ToolCall,
  input: {
    requestId: string;
    allowed: boolean;
    success: boolean;
    status: number;
    elapsedMs: number;
    returnRecordCount?: number;
    errorCode?: string;
  },
): CallAudit {
  const createdAt = new Date();
  const permissionGroup = permissionGroupForTool(call.tool);
  return {
    requestId: input.requestId,
    ...(call.id !== undefined ? { rpcId: call.id } : {}),
    userId: actor.userId,
    email: actor.email,
    role: actor.role,
    departments: actor.departments,
    ...(actor.conversationId ? { conversationId: actor.conversationId } : {}),
    ...(actor.messageId ? { messageId: actor.messageId } : {}),
    ...(actor.agentId ? { agentId: actor.agentId } : {}),
    tool: call.tool,
    ...(permissionGroup ? { permissionGroup } : {}),
    allowed: input.allowed,
    success: input.success,
    upstreamStatus: input.status,
    elapsedMs: input.elapsedMs,
    ...(input.returnRecordCount != null ? { returnRecordCount: input.returnRecordCount } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    createdAt,
    month: month(createdAt),
  };
}

export async function proxyMcp(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  actor: VerifiedActor;
  upstream: SellerSpriteClient;
  audits: AuditRecorder;
}): Promise<void> {
  const { request, reply, actor, upstream, audits } = input;
  const method = request.method as 'GET' | 'POST' | 'DELETE';
  const calls = method === 'POST' ? toolCalls(request.body) : [];
  const requestId = randomUUID();
  const started = Date.now();
  if (!canUseServer(actor)) {
    if (calls.length > 0) {
      await audits.recordAudits(
        calls.map((call) =>
          auditFor(actor, call, {
            requestId,
            allowed: false,
            success: false,
            status: 403,
            elapsedMs: Date.now() - started,
            errorCode: 'sellersprite_not_authorized',
          }),
        ),
      );
    }
    reply.code(403).send({ error: { code: 'sellersprite_not_authorized', message: 'SellerSprite access is not authorized' } });
    return;
  }

  const denied = calls.filter((call) => !canUseTool(actor, call.tool));
  if (denied.length > 0) {
    await audits.recordAudits(
      denied.map((call) =>
        auditFor(actor, call, {
          requestId,
          allowed: false,
          success: false,
          status: 403,
          elapsedMs: Date.now() - started,
          errorCode: 'tool_not_authorized',
        }),
      ),
    );
    reply.code(403).send({
      jsonrpc: '2.0',
      id: denied[0]?.id ?? null,
      error: { code: -32003, message: 'SellerSprite tool is not authorized' },
    });
    return;
  }

  const decisions = await Promise.all(
    calls.map(async (call) => ({
      call,
      decision: await audits.consumeToolRateLimit(actor.userId, call.tool),
    })),
  );
  const limited = decisions.find(({ decision }) => !decision.allowed);
  if (limited) {
    reply.header('retry-after', String(limited.decision.retryAfterSeconds));
    reply.header('x-ratelimit-limit', String(limited.decision.limit));
    reply.header('x-ratelimit-remaining', String(limited.decision.remaining));
    await audits.recordAudits([
      auditFor(actor, limited.call, {
        requestId,
        allowed: true,
        success: false,
        status: 429,
        elapsedMs: Date.now() - started,
        errorCode: 'tool_rate_limited',
      }),
    ]);
    reply.code(429).send({
      jsonrpc: '2.0',
      id: limited.call.id ?? null,
      error: { code: -32029, message: 'SellerSprite tool rate limit exceeded' },
    });
    return;
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) abort();
  });

  let status = 502;
  let responseValue: unknown;
  let returnRecordCount: number | undefined;
  let errorCode: string | undefined;
  try {
    const upstreamResponse = await upstream.relay({
      method,
      headers: request.headers,
      ...(method === 'POST' ? { body: JSON.stringify(request.body) } : {}),
      signal: controller.signal,
    });
    status = upstreamResponse.status;
    for (const [name, value] of Object.entries(responseHeaders(upstreamResponse))) {
      reply.header(name, value);
    }
    reply.header('x-sellersprite-gateway-request-id', requestId);
    reply.code(status);

    const contentType = upstreamResponse.headers.get('content-type') ?? 'application/json';
    const shouldFilterTools = method === 'POST' && includesMethod(request.body, 'tools/list');
    if (shouldFilterTools || calls.length > 0 || upstreamResponse.body == null) {
      const text = await upstreamResponse.text();
      const filteredBody = shouldFilterTools ? filterToolsBody(text, actor, contentType) : text;
      const body =
        calls.length > 0
          ? structureToolCallBody({
              text: filteredBody,
              contentType,
              calls,
              provider: 'sellersprite',
              requestId,
              elapsedMs: Date.now() - started,
            })
          : filteredBody;
      if (!contentType.includes('text/event-stream')) {
        try {
          responseValue = JSON.parse(body) as unknown;
          returnRecordCount = nestedRecordCount(responseValue);
        } catch {
          responseValue = undefined;
        }
      }
      reply.send(body);
      return;
    }

    reply.hijack();
    reply.raw.statusCode = upstreamResponse.status;
    for (const [name, value] of Object.entries(responseHeaders(upstreamResponse))) {
      reply.raw.setHeader(name, value);
    }
    reply.raw.setHeader('x-sellersprite-gateway-request-id', requestId);
    await pipeline(Readable.fromWeb(upstreamResponse.body as never), reply.raw);
  } catch (error) {
    if (controller.signal.aborted) {
      status = 499;
      errorCode = 'client_closed_request';
      if (!reply.sent) reply.code(499).send({ error: { code: errorCode, message: 'Request cancelled' } });
      return;
    }
    errorCode = 'sellersprite_upstream_failed';
    request.log.warn({ requestId, errorCode }, 'SellerSprite upstream request failed');
    if (!reply.sent) {
      reply.code(502).send({ error: { code: errorCode, message: 'SellerSprite is currently unavailable' } });
    }
  } finally {
    request.raw.removeListener('aborted', abort);
    if (calls.length > 0) {
      const elapsedMs = Date.now() - started;
      await audits
        .recordAudits(
          calls.map((call) =>
            auditFor(actor, call, {
              requestId,
              allowed: true,
              success: status >= 200 && status < 300 && !responseHasError(responseValue, call.id),
              status,
              elapsedMs,
              ...(returnRecordCount != null ? { returnRecordCount } : {}),
              ...(errorCode ? { errorCode } : {}),
            }),
          ),
        )
        .catch(() => undefined);
    }
  }
}

export const testing = {
  toolCalls,
  nestedRecordCount,
  filterToolsBody,
};
