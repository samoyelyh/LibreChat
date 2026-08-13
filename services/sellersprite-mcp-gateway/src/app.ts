import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { actorHeaders } from './auth.js';
import { proxyMcp } from './proxy.js';
import { verifySignedRequest } from './security.js';
import type { SellerSpriteClient } from './upstream.js';
import type {
  CallAudit,
  GatewayConfig,
  RateLimitDecision,
  SafeStatus,
  SecurityAudit,
  VerifiedActor,
} from './types.js';

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
  consumeNonce(nonce: string, expiresAt: Date): Promise<boolean>;
  recordSecurityAudit(audit: SecurityAudit): Promise<void>;
  consumeToolRateLimit(userId: string, tool: string): Promise<RateLimitDecision>;
}

export function buildApp(
  config: GatewayConfig,
  stores: AppStores,
  upstream: SellerSpriteClient,
): FastifyInstance {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.secret-key',
          'req.headers.x-mcp-gateway-key',
          'headers.authorization',
          'headers.secret-key',
          'headers.x-mcp-gateway-key',
          'req.headers.x-woda-signature',
          'headers.x-woda-signature',
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
    const result = verifySignedRequest(
      request,
      config.internalKey,
      config.signatureToleranceMs,
    );
    const deny = async (code: string) => {
      await stores
        .recordSecurityAudit({
          requestId: request.id,
          sourceIp: request.ip,
          method: request.method,
          path: request.url.split('?')[0] ?? request.url,
          outcome: 'denied',
          code,
          createdAt: new Date(),
        })
        .catch(() => undefined);
      return reply.code(401).send({ error: { code, message: 'Unauthorized' } });
    };
    if (!result.ok) {
      return deny(result.code);
    }
    if (!(await stores.consumeNonce(result.nonce, result.expiresAt))) {
      return deny('replayed_request');
    }
    reply.header('x-woda-security-request-id', request.id);
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
        await proxyMcp({
          request,
          reply,
          actor,
          profile: config.profile,
          upstream,
          audits: stores,
        });
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
