import { jwtVerify } from 'jose';
import type { FastifyRequest } from 'fastify';
import { AdapterError } from './errors.js';
import { verifySignedRequest } from './security.js';
import type { InternalActor } from './types.js';

function header(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function validResolvedValue(value: string): boolean {
  return value.length > 0 && !value.includes('{{') && !value.includes('}}');
}

export function authenticateInternalRequest(
  request: FastifyRequest,
  internalKey: string,
  toleranceMs: number,
): { actor: InternalActor; nonce: string; expiresAt: Date } {
  const signature = verifySignedRequest(request, internalKey, toleranceMs);
  if (!signature.ok) {
    throw new AdapterError(401, signature.code, 'Invalid adapter request signature');
  }
  const userId = header(request, 'x-librechat-user-id').trim();
  const email = header(request, 'x-librechat-user-email').trim().toLowerCase();
  if (!validResolvedValue(userId) || !validResolvedValue(email)) {
    throw new AdapterError(401, 'missing_user_context', 'Resolved LibreChat user context is required');
  }
  const actor: InternalActor = { userId, email };
  const conversationId = header(request, 'x-librechat-conversation-id').trim();
  const messageId = header(request, 'x-librechat-message-id').trim();
  if (validResolvedValue(conversationId)) actor.conversationId = conversationId;
  if (validResolvedValue(messageId)) actor.messageId = messageId;
  return { actor, nonce: signature.nonce, expiresAt: signature.expiresAt };
}

export async function authenticateUserJwt(request: FastifyRequest, jwtSecret: string): Promise<InternalActor> {
  const authorization = header(request, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AdapterError(401, 'missing_user_token', 'Authentication required');
  try {
    const { payload } = await jwtVerify(match[1], new TextEncoder().encode(jwtSecret), {
      algorithms: ['HS256'],
    });
    if (typeof payload.id !== 'string' || typeof payload.email !== 'string') {
      throw new Error('Missing user claims');
    }
    return { userId: payload.id, email: payload.email.toLowerCase() };
  } catch {
    throw new AdapterError(401, 'invalid_user_token', 'Authentication required');
  }
}
