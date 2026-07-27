import type {
  AccountSummary,
  AiGatewayAccountMapping,
  CallAudit,
  LibreChatIdentity,
  NewApiLog,
  NewApiToken,
  NewApiUser,
  PolicyInput,
  ProvisionedNewApiAccount,
  ProvisioningAudit,
  QuotaPolicy,
  SafeMapping,
  TokenUsage,
} from './types.js';

export interface MappingStore {
  ping(): Promise<void>;
  findByUserId(userId: string): Promise<AiGatewayAccountMapping | null>;
  findActiveByUserId(userId: string): Promise<AiGatewayAccountMapping | null>;
  upsert(mapping: Omit<AiGatewayAccountMapping, 'createdAt' | 'updatedAt'>): Promise<SafeMapping>;
  setStatus(userId: string, status: AiGatewayAccountMapping['credentialStatus'], error?: string): Promise<void>;
  listSafe(): Promise<SafeMapping[]>;
  close(): Promise<void>;
}

export interface AccountStore extends MappingStore {
  identity(userId: string): Promise<LibreChatIdentity | null>;
  listIdentities(query: string, limit: number): Promise<LibreChatIdentity[]>;
  ensureDefaultPolicy(defaultModels: string[]): Promise<QuotaPolicy>;
  resolvePolicy(identity: LibreChatIdentity): Promise<QuotaPolicy>;
  listPolicies(): Promise<QuotaPolicy[]>;
  upsertPolicy(input: PolicyInput): Promise<QuotaPolicy>;
  recordProvisioningAudit(audit: ProvisioningAudit): Promise<void>;
}

export interface AuditStore {
  record(audit: CallAudit): Promise<void>;
}

export interface NewApiClientContract {
  status(): Promise<Record<string, unknown>>;
  listModels(token: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  tokenUsage(token: string, signal?: AbortSignal): Promise<TokenUsage>;
  tokenLogs(token: string, signal?: AbortSignal): Promise<NewApiLog[]>;
  relay(path: string, init: RequestInit, token: string, signal: AbortSignal): Promise<Response>;
}

export interface NewApiProvisioningClient {
  provision(input: {
    username: string;
    displayName: string;
    password: string;
    quota: number;
    group: string;
    allowedModels: string[];
    tokenName: string;
  }): Promise<ProvisionedNewApiAccount>;
  applyPolicy(input: {
    user: NewApiUser;
    token: NewApiToken;
    managementToken: string;
    quota: number;
    group: string;
    allowedModels: string[];
  }): Promise<void>;
  disableUser(userId: number): Promise<void>;
  restoreUser(userId: number): Promise<void>;
  groups(): Promise<string[]>;
}

export interface AccountServiceContract {
  ensure(actor: { userId: string; email: string }, actorUserId?: string, reason?: string): Promise<AiGatewayAccountMapping>;
  summary(actor: { userId: string; email: string }): Promise<AccountSummary>;
  adminUsers(query: string, limit: number): Promise<AccountSummary[]>;
  listPolicies(): Promise<QuotaPolicy[]>;
  upsertPolicy(input: PolicyInput, actorUserId: string, reason: string): Promise<QuotaPolicy>;
  applyUserPolicy(userId: string, actorUserId: string, reason: string): Promise<AccountSummary>;
  revoke(userId: string, actorUserId: string, reason: string): Promise<AccountSummary>;
  restore(userId: string, actorUserId: string, reason: string): Promise<AccountSummary>;
  modelCatalog(): Promise<string[]>;
  gatewayGroups(): Promise<string[]>;
}

export interface RequestLimiter {
  ping(): Promise<void>;
  acquire(userId: string): Promise<() => Promise<void>>;
  close(): Promise<void>;
}
