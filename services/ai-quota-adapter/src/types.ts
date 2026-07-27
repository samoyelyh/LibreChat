export type CredentialStatus = 'pending' | 'active' | 'disabled' | 'error' | 'revoked';

export interface AiGatewayAccountMapping {
  librechatUserId: string;
  librechatEmail: string;
  newApiUserId: string;
  newApiUsername: string;
  newApiTokenId?: string;
  encryptedToken: string;
  encryptedManagementToken?: string;
  tokenFingerprint: string;
  tokenHash: string;
  gatewayGroup: string;
  credentialStatus: CredentialStatus;
  allowedModels: string[];
  quotaPolicyId?: string;
  librechatRole?: string;
  departments?: string[];
  provisionedBy?: 'manual' | 'automatic';
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
  newApiTokenId?: string;
  tokenFingerprint: string;
  gatewayGroup: string;
  credentialStatus: CredentialStatus;
  allowedModels: string[];
  quotaPolicyId?: string;
  librechatRole?: string;
  departments?: string[];
  provisionedBy?: 'manual' | 'automatic';
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt?: Date;
  lastError?: string;
}

export interface LibreChatIdentity {
  userId: string;
  email: string;
  name: string | null;
  username: string | null;
  role: string;
  departments: string[];
  admin: boolean;
}

export type PolicyScope = 'default' | 'role' | 'department' | 'user';

export interface QuotaPolicy {
  policyId: string;
  name: string;
  scope: PolicyScope;
  scopeValue: string;
  priority: number;
  quota: number;
  gatewayGroup: string;
  allowedModels: string[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyInput {
  name: string;
  scope: PolicyScope;
  scopeValue: string;
  priority: number;
  quota: number;
  gatewayGroup: string;
  allowedModels: string[];
  enabled: boolean;
}

export interface ProvisioningAudit {
  requestId: string;
  actorUserId: string;
  targetUserId: string;
  action:
    | 'account_provision'
    | 'policy_upsert'
    | 'policy_apply'
    | 'account_revoke'
    | 'account_restore';
  reason: string;
  policyId?: string;
  previousQuota?: number;
  nextQuota?: number;
  modelCount?: number;
  createdAt: Date;
}

export interface AccountSummary {
  identity: LibreChatIdentity;
  mapping: SafeMapping | null;
  effectivePolicy: QuotaPolicy;
  balance: {
    totalGranted: number;
    totalUsed: number;
    totalAvailable: number;
    unlimitedQuota: boolean;
    expiresAt: number;
    unit: 'new_api_quota';
    authoritativeSource: 'new_api';
  } | null;
}

export interface NewApiUser {
  id: number;
  username: string;
  display_name?: string;
  role: number;
  status: number;
  group: string;
  quota: number;
  used_quota: number;
}

export interface NewApiToken {
  id: number;
  name: string;
  status: number;
  expired_time: number;
  remain_quota: number;
  unlimited_quota: boolean;
  model_limits_enabled: boolean;
  model_limits: string;
  group: string;
  cross_group_retry: boolean;
  allow_ips?: string | null;
}

export interface ProvisionedNewApiAccount {
  user: NewApiUser;
  token: NewApiToken;
  runtimeToken: string;
  managementToken: string;
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
