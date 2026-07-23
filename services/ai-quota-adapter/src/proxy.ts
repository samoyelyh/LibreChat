import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AdapterConfig } from './config.js';
import type { AuditStore, MappingStore, NewApiClientContract, RequestLimiter } from './contracts.js';
import { AdapterError } from './errors.js';
import { mappedToken, requireMapping } from './mapping.js';
import type { InternalActor } from './types.js';

const requestBodySchema = z.object({
  model: z.string().min(1),
  stream: z.boolean().optional(),
}).loose();

const responseHeaders = [
  'content-type',
  'cache-control',
  'x-request-id',
  'x-oneapi-request-id',
  'openai-processing-ms',
];

function applyResponseHeaders(reply: FastifyReply, upstream: Response, requestId: string): void {
  for (const name of responseHeaders) {
    const value = upstream.headers.get(name);
    if (value) reply.header(name, value);
  }
  reply.header('x-ai-adapter-request-id', requestId);
}

function usageFromBytes(bytes: Uint8Array): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const result: { promptTokens?: number; completionTokens?: number; totalTokens?: number } = {};
    if (typeof parsed.usage?.prompt_tokens === 'number') result.promptTokens = parsed.usage.prompt_tokens;
    if (typeof parsed.usage?.completion_tokens === 'number') result.completionTokens = parsed.usage.completion_tokens;
    if (typeof parsed.usage?.total_tokens === 'number') result.totalTokens = parsed.usage.total_tokens;
    return result;
  } catch {
    return {};
  }
}

export type ProxyServices = {
  mappings: MappingStore;
  audits: AuditStore;
  newApi: NewApiClientContract;
  limiter: RequestLimiter;
};

export async function proxyCompletion(
  request: FastifyRequest,
  reply: FastifyReply,
  actor: InternalActor,
  path: string,
  config: AdapterConfig,
  services: ProxyServices,
): Promise<void> {
  const body = requestBodySchema.parse(request.body);
  const mapping = await requireMapping(services.mappings, actor);
  if (!mapping.allowedModels.includes(body.model)) {
    throw new AdapterError(403, 'model_not_allowed', 'The selected model is not allowed');
  }

  const release = await services.limiter.acquire(actor.userId);
  const requestId = randomUUID();
  const started = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.raw.once('aborted', abort);
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) abort();
  });

  let status = 500;
  let upstreamRequestId: string | undefined;
  let usage: ReturnType<typeof usageFromBytes> = {};
  let errorCode: string | undefined;
  try {
    const upstream = await services.newApi.relay(
      path,
      {
        method: 'POST',
        headers: {
          Accept: body.stream ? 'text/event-stream' : 'application/json',
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
        body: JSON.stringify(request.body),
      },
      mappedToken(mapping, config.encryptionKey),
      controller.signal,
    );
    status = upstream.status;
    upstreamRequestId =
      upstream.headers.get('x-request-id') ?? upstream.headers.get('x-oneapi-request-id') ?? undefined;
    applyResponseHeaders(reply, upstream, requestId);
    reply.code(upstream.status);

    if (body.stream === true && upstream.body) {
      reply.hijack();
      reply.raw.statusCode = upstream.status;
      await pipeline(Readable.fromWeb(upstream.body as never), reply.raw);
      return;
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer());
    usage = usageFromBytes(bytes);
    reply.send(Buffer.from(bytes));
  } catch (error) {
    if (controller.signal.aborted) {
      status = 499;
      errorCode = 'client_closed_request';
      if (!reply.sent) reply.code(499).send({ error: { code: errorCode, message: 'Request cancelled' } });
      return;
    }
    errorCode = error instanceof AdapterError ? error.code : 'adapter_proxy_failed';
    throw error;
  } finally {
    request.raw.removeListener('aborted', abort);
    await release().catch(() => undefined);
    const audit = {
      requestId,
      librechatUserId: actor.userId,
      librechatEmail: actor.email,
      model: body.model,
      path,
      stream: body.stream === true,
      status,
      elapsedMs: Date.now() - started,
      createdAt: new Date(),
      ...usage,
      ...(actor.conversationId ? { conversationId: actor.conversationId } : {}),
      ...(actor.messageId ? { messageId: actor.messageId } : {}),
      ...(upstreamRequestId ? { newApiRequestId: upstreamRequestId } : {}),
      ...(errorCode ? { errorCode } : {}),
    };
    await services.audits.record(audit).catch(() => undefined);
  }
}
