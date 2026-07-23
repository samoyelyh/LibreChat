import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticateInternalRequest, authenticateUserJwt } from './auth.js';
import type { AdapterConfig } from './config.js';
import type { AuditStore, MappingStore, NewApiClientContract, RequestLimiter } from './contracts.js';
import { mappedToken, requireMapping } from './mapping.js';
import { AdapterError, UpstreamError } from './errors.js';
import { filterModels } from './new-api.js';
import { proxyCompletion } from './proxy.js';
import type { NewApiLog } from './types.js';

export type AppServices = {
  mappings: MappingStore;
  audits: AuditStore;
  newApi: NewApiClientContract;
  limiter: RequestLimiter;
};

const usageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });

function sanitizeLog(log: NewApiLog): Record<string, unknown> {
  return {
    model: log.model_name ?? '',
    quota: typeof log.quota === 'number' ? log.quota : 0,
    promptTokens: typeof log.prompt_tokens === 'number' ? log.prompt_tokens : 0,
    completionTokens: typeof log.completion_tokens === 'number' ? log.completion_tokens : 0,
    elapsedMs: typeof log.use_time === 'number' ? log.use_time * 1000 : 0,
    stream: log.is_stream === true,
    group: log.group ?? '',
    requestId: log.request_id ?? '',
    upstreamRequestId: log.upstream_request_id ?? '',
    createdAt: typeof log.created_at === 'number' ? new Date(log.created_at * 1000).toISOString() : null,
    type: typeof log.type === 'number' ? log.type : 0,
  };
}

export function buildApp(config: AdapterConfig, services: AppServices): FastifyInstance {
  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.nodeEnv === 'production' ? 'info' : 'debug',
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.x-adapter-internal-key',
                '*.token',
                '*.encryptedToken',
                '*.AI_TOKEN_ENCRYPTION_KEY',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: 2 * 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof UpstreamError && error.upstreamBody) {
      reply.code(error.statusCode);
      if (error.upstreamContentType) reply.header('content-type', error.upstreamContentType);
      return reply.send(Buffer.from(error.upstreamBody));
    }
    if (error instanceof AdapterError) {
      return reply.code(error.statusCode).send({
        error: { type: 'adapter_error', code: error.code, message: error.message },
      });
    }
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: { type: 'invalid_request_error', code: 'invalid_request', message: 'Invalid request' },
      });
    }
    app.log.error({ err: error }, 'Unhandled adapter error');
    return reply.code(500).send({
      error: { type: 'adapter_error', code: 'internal_error', message: 'Internal adapter error' },
    });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'ai-quota-adapter' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await Promise.all([services.mappings.ping(), services.limiter.ping(), services.newApi.status()]);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/v1/models', async (request) => {
    const actor = authenticateInternalRequest(request, config.internalKey);
    const mapping = await requireMapping(services.mappings, actor);
    const response = await services.newApi.listModels(mappedToken(mapping, config.encryptionKey));
    return filterModels(response, mapping.allowedModels);
  });

  for (const path of ['/v1/chat/completions', '/v1/completions', '/v1/responses', '/v1/embeddings']) {
    app.post(path, async (request, reply) => {
      const actor = authenticateInternalRequest(request, config.internalKey);
      await proxyCompletion(request, reply, actor, path, config, services);
    });
  }

  app.get('/api/user/balance', async (request) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    const mapping = await requireMapping(services.mappings, actor);
    const usage = await services.newApi.tokenUsage(mappedToken(mapping, config.encryptionKey));
    return {
      success: true,
      data: {
        newApiUserId: mapping.newApiUserId,
        newApiUsername: mapping.newApiUsername,
        gatewayGroup: mapping.gatewayGroup,
        tokenFingerprint: mapping.tokenFingerprint,
        allowedModels: mapping.allowedModels,
        totalGranted: usage.total_granted,
        totalUsed: usage.total_used,
        totalAvailable: usage.total_available,
        unlimitedQuota: usage.unlimited_quota,
        expiresAt: usage.expires_at,
        unit: 'new_api_quota',
        authoritativeSource: 'new_api',
      },
    };
  });

  app.get('/api/user/usage', async (request) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    const mapping = await requireMapping(services.mappings, actor);
    const query = usageQuerySchema.parse(request.query);
    const logs = await services.newApi.tokenLogs(mappedToken(mapping, config.encryptionKey));
    return { success: true, data: logs.slice(0, query.limit).map(sanitizeLog) };
  });

  app.addHook('onClose', async () => {
    await Promise.allSettled([services.mappings.close(), services.limiter.close()]);
  });
  return app;
}
