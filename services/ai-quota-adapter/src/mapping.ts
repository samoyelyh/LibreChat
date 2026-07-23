import type { MappingStore } from './contracts.js';
import { decryptToken } from './crypto.js';
import { AdapterError } from './errors.js';
import type { AiGatewayAccountMapping, InternalActor } from './types.js';

export async function requireMapping(
  store: MappingStore,
  actor: InternalActor,
): Promise<AiGatewayAccountMapping> {
  const mapping = await store.findActiveByUserId(actor.userId);
  if (!mapping) throw new AdapterError(403, 'ai_account_not_provisioned', 'AI account is not provisioned');
  if (mapping.librechatEmail.toLowerCase() !== actor.email.toLowerCase()) {
    throw new AdapterError(403, 'user_mapping_mismatch', 'AI account mapping does not match the current user');
  }
  return mapping;
}

export function mappedToken(mapping: AiGatewayAccountMapping, encryptionKey: string): string {
  try {
    return decryptToken(mapping.encryptedToken, encryptionKey);
  } catch {
    throw new AdapterError(503, 'credential_decryption_failed', 'AI credential is unavailable');
  }
}
