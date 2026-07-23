import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { actorHeaders, hasInternalKey } from './auth.js';
import { proxyMcp } from './proxy.js';
import type { SellerSpriteClient } from './upstream.js';
import type { CallAudit, GatewayConfig, SafeStatus, VerifiedActor } from './types.js';

export interface AppStores {
  ping(): Promise<void>;
  verifyActor(headers: NonNullable<ReturnType<typeof actorHeaders>>): Promise<VerifiedActor | null>;
  recordAudits(audits: CallAudit[]): Promise<void>;
  syncCredential(operator: string): Promise<void>;
  recordConnectionTest(input: {
    ok: boolean;
    message: string;
    toolCount?: number;
  }): Promise<void>;
  status(): Promise<SafeStatus>;
  recentAudits(limit: number): Promise<unknown[]>;
}

export function buildApp(
  config: GatewayConfig,
  stores: AppStores,
  upstream: SellerSpriteClient,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.secret-key',
          'req.headers.x-mcp-gateway-key',
          'headers.secret-key',
          'headers.x-mcp-gateway-key',
          'config.upstreamSecret',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 5 * 1024 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await stores.ping();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  const authenticateInternal = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!hasInternalKey(request, config.internalKey)) {
      return reply.code(401).send({ error: { code: 'invalid_internal_auth', message: 'Unauthorized' } });
    }
  };

  app.register(
    async (routes) => {
      routes.addHook('preHandler', authenticateInternal);
      const handler = async (request: FastifyRequest, reply: FastifyReply) => {
        const headers = actorHeaders(request);
        if (!headers) {
          return reply.code(401).send({ error: { code: 'missing_actor', message: 'Unauthorized' } });
        }
        const actor = await stores.verifyActor(headers);
        if (!actor) {
          return reply.code(403).send({ error: { code: 'invalid_actor', message: 'Forbidden' } });
        }
        await proxyMcp({ request, reply, actor, upstream, audits: stores });
      };
      routes.all('/mcp', handler);
    },
    { prefix: '' },
  );

  app.register(
    async (admin) => {
      admin.addHook('preHandler', authenticateInternal);
      admin.get('/status', async () => stores.status());
      admin.get('/audits', async (request) => {
        const query = request.query as { limit?: string };
        return { data: await stores.recentAudits(Number(query.limit || 50)) };
      });
      admin.post('/credential/sync', async (request, reply) => {
        const body = request.body as { operator?: unknown };
        if (typeof body?.operator !== 'string' || body.operator.trim().length < 3) {
          return reply.code(400).send({ error: { code: 'operator_required' } });
        }
        await stores.syncCredential(body.operator.trim());
        return { success: true, status: await stores.status() };
      });
      admin.post('/test', async () => {
        const result = await upstream.connectionTest();
        await stores.recordConnectionTest(result);
        return { ...result, status: await stores.status() };
      });
    },
    { prefix: '/admin' },
  );

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ code: 'gateway_request_failed', requestId: request.id }, 'Gateway request failed');
    reply.code(500).send({ error: { code: 'gateway_request_failed', message: 'Request failed' } });
  });
  return app;
}
