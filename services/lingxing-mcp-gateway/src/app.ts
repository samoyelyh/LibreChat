import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { actorHeaders, bearerUserId } from './auth.js';
import type { MongoStores } from './database.js';
import { proxyMcp } from './proxy.js';
import { verifySignedRequest } from './security.js';
import type { LingxingClient } from './upstream.js';
import type { BrowserActor, ConfiguredBy, GatewayConfig } from './types.js';

function keyFromBody(body: unknown): string | null {
  if (body == null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).key;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 8 && trimmed.length <= 4096 ? trimmed : null;
}

function reasonFromBody(body: unknown): string | null {
  if (body == null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).reason;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 3 && trimmed.length <= 300 ? trimmed : null;
}

export function buildApp(
  config: GatewayConfig,
  stores: MongoStores,
  upstream: LingxingClient,
) {
  const app = Fastify({
    trustProxy: true,
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.x-mcp-gateway-key',
          'req.headers.x-woda-signature',
          'req.body.key',
          'headers.x-mcp-key',
          'secret',
          '*.secret',
          '*.ciphertext',
        ],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 1024 * 1024,
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

  const requireBrowserActor = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<BrowserActor | undefined> => {
    const userId = bearerUserId(request, config.jwtSecret);
    if (!userId) {
      reply.code(401).send({ error: { code: 'unauthorized', message: '请重新登录' } });
      return;
    }
    const actor = await stores.browserActor(userId);
    if (!actor) {
      reply.code(403).send({ error: { code: 'account_unavailable', message: '账号不可用' } });
      return;
    }
    return actor;
  };

  const targetActor = async (
    userId: string,
    reply: FastifyReply,
  ): Promise<BrowserActor | undefined> => {
    const target = await stores.browserActor(userId);
    if (!target) {
      reply.code(404).send({ error: { code: 'user_not_found', message: '未找到目标用户' } });
      return;
    }
    return target;
  };

  app.register(async (routes) => {
    routes.get('/status', async (request, reply) => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      return { data: await stores.credentialStatus(actor.userId) };
    });
    routes.get('/usage', async (request, reply) => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      return { data: await stores.usage(actor.userId) };
    });
    routes.put('/credential', async (request, reply) => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      const key = keyFromBody(request.body);
      if (!key) {
        return reply.code(400).send({ error: { code: 'invalid_key', message: '请输入有效的领星 MCP 密钥' } });
      }
      const data = await stores.setCredential({
        target: actor,
        secret: key,
        configuredBy: 'self',
        actorUserId: actor.userId,
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason: null,
      });
      return { data };
    });
    routes.post('/test', async (request, reply) => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      const secret = await stores.getCredentialSecret(actor.userId, true);
      if (!secret) {
        return reply.code(409).send({ error: { code: 'credential_required', message: '请先配置领星 MCP 密钥' } });
      }
      const result = await upstream.connectionTest(secret);
      await stores.recordTest({
        targetUserId: actor.userId,
        actorUserId: actor.userId,
        configuredBy: 'self',
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason: null,
        result,
      });
      return reply.code(result.ok ? 200 : 422).send({
        data: { result, status: await stores.credentialStatus(actor.userId) },
      });
    });
    routes.delete('/credential', async (request, reply) => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      const data = await stores.revokeCredential({
        targetUserId: actor.userId,
        actorUserId: actor.userId,
        configuredBy: 'self',
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason: null,
      });
      return { data };
    });
  }, { prefix: '/api/lingxing' });

  app.register(async (routes) => {
    const requireAdmin = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<BrowserActor | undefined> => {
      const actor = await requireBrowserActor(request, reply);
      if (!actor) return;
      if (!actor.admin) {
        reply.code(403).send({ error: { code: 'admin_required', message: '需要管理员权限' } });
        return;
      }
      return actor;
    };
    routes.get('/users', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const query = request.query as { q?: string; limit?: string };
      return {
        data: await stores.adminUsers(
          typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
          Number(query.limit || 20),
        ),
      };
    });
    routes.get('/users/:userId/status', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const { userId } = request.params as { userId: string };
      const target = await targetActor(userId, reply);
      if (!target) return;
      return { data: await stores.credentialStatus(target.userId) };
    });
    routes.put('/users/:userId/credential', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const key = keyFromBody(request.body);
      const reason = reasonFromBody(request.body);
      if (!key || !reason) {
        return reply.code(400).send({
          error: { code: 'key_and_reason_required', message: '密钥和至少 3 个字的操作原因均为必填项' },
        });
      }
      const { userId } = request.params as { userId: string };
      const target = await targetActor(userId, reply);
      if (!target) return;
      const data = await stores.setCredential({
        target,
        secret: key,
        configuredBy: 'admin',
        actorUserId: actor.userId,
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason,
      });
      return { data };
    });
    routes.post('/users/:userId/test', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const reason = reasonFromBody(request.body);
      if (!reason) {
        return reply.code(400).send({ error: { code: 'reason_required', message: '请输入至少 3 个字的操作原因' } });
      }
      const { userId } = request.params as { userId: string };
      const target = await targetActor(userId, reply);
      if (!target) return;
      const secret = await stores.getCredentialSecret(target.userId, true);
      if (!secret) {
        return reply.code(409).send({ error: { code: 'credential_required', message: '目标用户尚未配置密钥' } });
      }
      const result = await upstream.connectionTest(secret);
      await stores.recordTest({
        targetUserId: target.userId,
        actorUserId: actor.userId,
        configuredBy: 'admin',
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason,
        result,
      });
      return reply.code(result.ok ? 200 : 422).send({
        data: { result, status: await stores.credentialStatus(target.userId) },
      });
    });
    routes.delete('/users/:userId/credential', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const reason = reasonFromBody(request.body);
      if (!reason) {
        return reply.code(400).send({ error: { code: 'reason_required', message: '请输入至少 3 个字的操作原因' } });
      }
      const { userId } = request.params as { userId: string };
      const target = await targetActor(userId, reply);
      if (!target) return;
      const data = await stores.revokeCredential({
        targetUserId: target.userId,
        actorUserId: actor.userId,
        configuredBy: 'admin',
        requestId: randomUUID(),
        sourceIp: request.ip,
        reason,
      });
      return { data };
    });
    routes.get('/audits', async (request, reply) => {
      const actor = await requireAdmin(request, reply);
      if (!actor) return;
      const query = request.query as { limit?: string };
      return { data: await stores.recentCredentialAudits(Number(query.limit || 50)) };
    });
  }, { prefix: '/api/lingxing/admin' });

  app.register(async (routes) => {
    routes.addHook('preHandler', async (request, reply) => {
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
    });
    routes.all('/mcp', async (request, reply) => {
      const headers = actorHeaders(request);
      if (!headers) {
        return reply.code(401).send({ error: { code: 'missing_actor', message: 'Unauthorized' } });
      }
      const actor = await stores.verifyActor(headers);
      if (!actor) {
        return reply.code(403).send({ error: { code: 'invalid_actor', message: 'Forbidden' } });
      }
      await proxyMcp({ request, reply, actor, stores, upstream });
    });
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ code: 'lingxing_gateway_request_failed', requestId: request.id }, 'Request failed');
    reply.code(500).send({ error: { code: 'request_failed', message: '请求处理失败' } });
  });
  return app;
}
