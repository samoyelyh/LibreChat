import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticateInternalRequest, authenticateUserJwt } from './auth.js';
import type { AdapterConfig } from './config.js';
import type {
  AccountServiceContract,
  AccountStore,
  AuditStore,
  NewApiClientContract,
  RequestLimiter,
} from './contracts.js';
import { mappedToken } from './mapping.js';
import { AdapterError, UpstreamError } from './errors.js';
import { filterModels } from './new-api.js';
import { proxyCompletion } from './proxy.js';
import type { InternalActor, NewApiLog } from './types.js';

export type AppServices = {
  mappings: AccountStore;
  audits: AuditStore;
  newApi: NewApiClientContract;
  limiter: RequestLimiter;
  accounts: AccountServiceContract;
};

const usageQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) });
const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(300) });
const policySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scope: z.enum(['default', 'role', 'department', 'user']),
  scopeValue: z.string().trim().max(100),
  priority: z.coerce.number().int().min(0).max(10000).default(0),
  quota: z.coerce.number().int().min(0).max(2_000_000_000),
  gatewayGroup: z.string().trim().min(1).max(64),
  allowedModels: z.array(z.string().trim().min(1).max(200)).min(1).max(500),
  enabled: z.boolean().default(true),
  reason: z.string().trim().min(3).max(300),
});

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
                '*.encryptedManagementToken',
                '*.managementToken',
                '*.adminToken',
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
    const mapping = await services.accounts.ensure(actor);
    const response = await services.newApi.listModels(mappedToken(mapping, config.encryptionKey));
    return filterModels(response, mapping.allowedModels);
  });

  for (const path of ['/v1/chat/completions', '/v1/completions', '/v1/responses', '/v1/embeddings']) {
    app.post(path, async (request, reply) => {
      const actor = authenticateInternalRequest(request, config.internalKey);
      await services.accounts.ensure(actor);
      await proxyCompletion(request, reply, actor, path, config, services);
    });
  }

  app.get('/api/user/balance', async (request) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    const summary = await services.accounts.summary(actor);
    if (!summary.mapping || !summary.balance) {
      throw new AdapterError(503, 'ai_account_unavailable', 'AI account is unavailable');
    }
    return {
      success: true,
      data: {
        newApiUserId: summary.mapping.newApiUserId,
        newApiUsername: summary.mapping.newApiUsername,
        gatewayGroup: summary.mapping.gatewayGroup,
        tokenFingerprint: summary.mapping.tokenFingerprint,
        allowedModels: summary.mapping.allowedModels,
        departments: summary.identity.departments,
        role: summary.identity.role,
        effectivePolicy: summary.effectivePolicy,
        ...summary.balance,
      },
    };
  });

  app.get('/api/user/summary', async (request) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    return { success: true, data: await services.accounts.summary(actor) };
  });

  app.get('/api/user/usage', async (request) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    const mapping = await services.accounts.ensure(actor);
    const query = usageQuerySchema.parse(request.query);
    const logs = await services.newApi.tokenLogs(mappedToken(mapping, config.encryptionKey));
    return { success: true, data: logs.slice(0, query.limit).map(sanitizeLog) };
  });

  const requireAdmin = async (request: FastifyRequest) => {
    const actor = await authenticateUserJwt(request, config.jwtSecret);
    const identity = await services.mappings.identity(actor.userId);
    if (
      !identity ||
      identity.email !== actor.email.toLowerCase() ||
      identity.admin !== true
    ) {
      throw new AdapterError(403, 'admin_required', 'Administrator access is required');
    }
    return actor;
  };

  app.get('/api/admin/users', async (request) => {
    await requireAdmin(request);
    const query = adminUsersQuerySchema.parse(request.query);
    return {
      success: true,
      data: await services.accounts.adminUsers(query.q, query.limit),
    };
  });

  app.get('/api/admin/policies', async (request) => {
    await requireAdmin(request);
    return { success: true, data: await services.accounts.listPolicies() };
  });

  app.get('/api/admin/catalog', async (request) => {
    await requireAdmin(request);
    const [models, groups] = await Promise.all([
      services.accounts.modelCatalog(),
      services.accounts.gatewayGroups(),
    ]);
    return { success: true, data: { models, groups } };
  });

  app.put('/api/admin/policies', async (request) => {
    const actor = await requireAdmin(request);
    const input = policySchema.parse(request.body);
    const { reason, ...policy } = input;
    return {
      success: true,
      data: await services.accounts.upsertPolicy(policy, actor.userId, reason),
    };
  });

  const adminUserAction = async (
    request: FastifyRequest<{ Params: { userId: string } }>,
    action: (
      userId: string,
      actorUserId: string,
      reason: string,
    ) => Promise<unknown>,
  ) => {
    const actor = await requireAdmin(request);
    const { userId } = request.params;
    const { reason } = reasonSchema.parse(request.body);
    return { success: true, data: await action(userId, actor.userId, reason) };
  };

  app.post<{ Params: { userId: string } }>('/api/admin/users/:userId/apply', async (request) =>
    adminUserAction(request, services.accounts.applyUserPolicy.bind(services.accounts)),
  );
  app.post<{ Params: { userId: string } }>('/api/admin/users/:userId/revoke', async (request) =>
    adminUserAction(request, services.accounts.revoke.bind(services.accounts)),
  );
  app.post<{ Params: { userId: string } }>('/api/admin/users/:userId/restore', async (request) =>
    adminUserAction(request, services.accounts.restore.bind(services.accounts)),
  );

  app.addHook('onClose', async () => {
    await Promise.allSettled([services.mappings.close(), services.limiter.close()]);
  });
  return app;
}
