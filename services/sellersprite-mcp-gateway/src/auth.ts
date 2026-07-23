import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ActorHeaders } from './types.js';

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hasInternalKey(request: FastifyRequest, expected: string): boolean {
  return safeEqual(header(request, 'x-mcp-gateway-key'), expected);
}

export function actorHeaders(request: FastifyRequest): ActorHeaders | null {
  const userId = header(request, 'x-librechat-user-id').trim();
  const email = header(request, 'x-librechat-user-email').trim();
  const role = header(request, 'x-librechat-user-role').trim();
  if (!userId || !email || !role) return null;
  const optional = (name: string): string | undefined => {
    const value = header(request, name).trim();
    return value.length > 0 ? value : undefined;
  };
  const conversationId = optional('x-librechat-conversation-id');
  const messageId = optional('x-librechat-message-id');
  const agentId = optional('x-librechat-agent-id');
  return {
    userId,
    email,
    role,
    ...(conversationId ? { conversationId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(agentId ? { agentId } : {}),
  };
}
