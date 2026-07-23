import type { AiGatewayAccountMapping, CallAudit, SafeMapping, NewApiLog, TokenUsage } from './types.js';

export interface MappingStore {
  ping(): Promise<void>;
  findActiveByUserId(userId: string): Promise<AiGatewayAccountMapping | null>;
  upsert(mapping: Omit<AiGatewayAccountMapping, 'createdAt' | 'updatedAt'>): Promise<SafeMapping>;
  listSafe(): Promise<SafeMapping[]>;
  close(): Promise<void>;
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

export interface RequestLimiter {
  ping(): Promise<void>;
  acquire(userId: string): Promise<() => Promise<void>>;
  close(): Promise<void>;
}
