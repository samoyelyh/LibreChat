import { z } from 'zod';
import type { GatewayConfig } from './types.js';

const envSchema = z.object({
  SELLERSPRITE_MCP_GATEWAY_HOST: z.string().default('0.0.0.0'),
  SELLERSPRITE_MCP_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  SELLERSPRITE_MCP_INTERNAL_KEY: z.string().min(32),
  SELLERSPRITE_MCP_URL: z.string().url().refine((value) => value.startsWith('https://')),
  SELLERSPRITE_MCP_SECRET_KEY: z.string().min(8),
  SELLERSPRITE_MCP_MONGO_URI: z.string().min(1),
  SELLERSPRITE_MCP_LIBRECHAT_DB: z.string().default('LibreChat'),
  SELLERSPRITE_MCP_DB: z.string().default('sellersprite_mcp_gateway'),
  SELLERSPRITE_MCP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  SELLERSPRITE_MCP_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  SELLERSPRITE_MCP_MONTHLY_LIMIT: z.coerce.number().int().min(0).default(0),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = envSchema.parse(env);
  const upstream = new URL(parsed.SELLERSPRITE_MCP_URL);
  if (upstream.searchParams.has('secret-key')) {
    throw new Error('SELLERSPRITE_MCP_URL must not contain secret-key in the URL');
  }
  return {
    host: parsed.SELLERSPRITE_MCP_GATEWAY_HOST,
    port: parsed.SELLERSPRITE_MCP_GATEWAY_PORT,
    internalKey: parsed.SELLERSPRITE_MCP_INTERNAL_KEY,
    upstreamUrl: upstream.toString(),
    upstreamSecret: parsed.SELLERSPRITE_MCP_SECRET_KEY,
    mongoUri: parsed.SELLERSPRITE_MCP_MONGO_URI,
    libreChatDatabase: parsed.SELLERSPRITE_MCP_LIBRECHAT_DB,
    gatewayDatabase: parsed.SELLERSPRITE_MCP_DB,
    requestTimeoutMs: parsed.SELLERSPRITE_MCP_TIMEOUT_MS,
    auditRetentionDays: parsed.SELLERSPRITE_MCP_AUDIT_RETENTION_DAYS,
    monthlyLimit: parsed.SELLERSPRITE_MCP_MONTHLY_LIMIT,
  };
}
