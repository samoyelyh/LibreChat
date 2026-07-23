export type CredentialStatus = 'pending' | 'active' | 'disabled' | 'error' | 'revoked';

export interface AiGatewayAccountMapping {
  librechatUserId: string;
  librechatEmail: string;
  newApiUserId: string;
  newApiUsername: string;
  encryptedToken: string;
  tokenFingerprint: string;
  tokenHash: string;
  gatewayGroup: string;
  credentialStatus: CredentialStatus;
  allowedModels: string[];
  quotaPolicyId?: string;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date;
  lastError?: string;
  deletedAt?: Date;
}

export interface SafeMapping {
  id: string;
  librechatUserId: string;
  librechatEmail: string;
  newApiUserId: string;
  newApiUsername: string;
  tokenFingerprint: string;
  gatewayGroup: string;
  credentialStatus: CredentialStatus;
  allowedModels: string[];
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date;
  lastError?: string;
}

export interface InternalActor {
  userId: string;
  email: string;
  conversationId?: string;
  messageId?: string;
}

export interface CallAudit {
  requestId: string;
  librechatUserId: string;
  librechatEmail: string;
  conversationId?: string;
  messageId?: string;
  model?: string;
  path: string;
  stream: boolean;
  status: number;
  elapsedMs: number;
  newApiRequestId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorCode?: string;
  createdAt: Date;
}

export interface TokenUsage {
  object: string;
  name: string;
  total_granted: number;
  total_used: number;
  total_available: number;
  unlimited_quota: boolean;
  model_limits: Record<string, unknown>;
  model_limits_enabled: boolean;
  expires_at: number;
}

export interface NewApiLog {
  user_id?: number;
  username?: string;
  token_name?: string;
  model_name?: string;
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  use_time?: number;
  is_stream?: boolean;
  group?: string;
  request_id?: string;
  upstream_request_id?: string;
  created_at?: number;
  type?: number;
  [key: string]: unknown;
}
