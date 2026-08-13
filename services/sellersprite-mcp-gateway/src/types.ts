export type PermissionGroup =
  | 'sellersprite_asin'
  | 'sellersprite_keyword'
  | 'sellersprite_market'
  | 'sellersprite_review'
  | 'resume_read';

export type GatewayProfile = 'sellersprite' | 'resume';

export interface GatewayConfig {
  profile: GatewayProfile;
  host: string;
  port: number;
  internalKey: string;
  upstreamUrl: string;
  upstreamSecret: string;
  mongoUri: string;
  libreChatDatabase: string;
  gatewayDatabase: string;
  requestTimeoutMs: number;
  auditRetentionDays: number;
  monthlyLimit: number;
  signatureToleranceMs: number;
  requestsPerMinute: number;
  upstreamAuth: 'secret-key' | 'bearer';
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
  permissionGroups: PermissionGroup[];
  exactTools: string[];
  allTools: boolean;
}

export interface CallAudit {
  requestId: string;
  rpcId?: string | number | null;
  userId: string;
  email: string;
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
  returnRecordCount?: number;
  errorCode?: string;
  createdAt: Date;
  month: string;
}

export interface CredentialState {
  _id: 'credential';
  configured: boolean;
  fingerprintLast4: string;
  updatedAt: Date;
  updatedBy: string;
  lastConnectionTestAt?: Date;
  lastConnectionTestOk?: boolean;
  lastConnectionTestMessage?: string;
  lastToolCount?: number;
  lastCallAt?: Date;
}

export interface SafeStatus {
  configured: boolean;
  fingerprintLast4: string;
  updatedAt: Date | null;
  updatedBy: string | null;
  lastConnectionTestAt: Date | null;
  lastConnectionTestOk: boolean | null;
  lastConnectionTestMessage: string | null;
  lastToolCount: number | null;
  lastCallAt: Date | null;
  month: string;
  monthlyCallCount: number;
  monthlyLimit: number | null;
  usageRatio: number | null;
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
}
