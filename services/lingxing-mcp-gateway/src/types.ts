export type CredentialStatus = 'active' | 'invalid' | 'revoked' | 'untested';
export type ConfiguredBy = 'self' | 'admin';
export type PermissionGroup =
  | 'lingxing_read_basic'
  | 'lingxing_finance'
  | 'lingxing_ads'
  | 'lingxing_monitor_read'
  | 'lingxing_write';

export interface GatewayConfig {
  host: string;
  port: number;
  internalKey: string;
  jwtSecret: string;
  encryptionKey: Buffer;
  upstreamUrl: string;
  mongoUri: string;
  libreChatDatabase: string;
  gatewayDatabase: string;
  requestTimeoutMs: number;
  auditRetentionDays: number;
  signatureToleranceMs: number;
  requestsPerMinute: number;
  toolIntervalMs: number;
}

export interface ActorHeaders {
  userId: string;
  email: string;
  role: string;
  conversationId?: string;
  messageId?: string;
  agentId?: string;
}

export interface VerifiedActor extends ActorHeaders {
  departments: string[];
  groups: PermissionGroup[];
  admin: boolean;
}

export interface BrowserActor {
  userId: string;
  email: string;
  role: string;
  departments: string[];
  admin: boolean;
}

export interface EncryptedSecret {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface CredentialDocument {
  _id: string;
  userId: string;
  email: string;
  provider: 'lingxing';
  secret?: EncryptedSecret;
  fingerprintLast4: string | null;
  status: CredentialStatus;
  configuredBy: ConfiguredBy;
  configuredByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastUsedAt: Date | null;
  toolCount: number | null;
  revokedAt: Date | null;
}

export interface CredentialStatusView {
  configured: boolean;
  provider: 'lingxing';
  status: CredentialStatus | 'missing';
  configuredBy: ConfiguredBy | null;
  fingerprintLast4: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastUsedAt: Date | null;
  toolCount: number | null;
}

export interface CredentialAudit {
  requestId: string;
  actorUserId: string;
  targetUserId: string;
  action: 'self_set' | 'self_revoke' | 'self_test' | 'admin_set' | 'admin_revoke' | 'admin_test';
  reason: string | null;
  sourceIp: string;
  oldFingerprintLast4: string | null;
  newFingerprintLast4: string | null;
  testOk: boolean | null;
  createdAt: Date;
}

export interface CallAudit {
  requestId: string;
  userId: string;
  role: string;
  departments: string[];
  conversationId?: string;
  messageId?: string;
  agentId?: string;
  tool: string;
  permissionGroup?: PermissionGroup;
  allowed: boolean;
  success: boolean;
  upstreamStatus: number;
  elapsedMs: number;
  errorCode?: string;
  createdAt: Date;
}

export interface ConnectionTestResult {
  ok: boolean;
  code: string;
  message: string;
  toolCount?: number;
}

export interface SecurityAudit {
  requestId: string;
  sourceIp: string;
  method: string;
  path: string;
  outcome: 'denied';
  code: string;
  createdAt: Date;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  window: 'second' | 'minute';
}
