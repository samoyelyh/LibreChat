import { z } from 'zod';
import type { GatewayConfig } from './types.js';

const schema = z.object({
  LINGXING_MCP_GATEWAY_HOST: z.string().default('0.0.0.0'),
  LINGXING_MCP_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(4300),
  LINGXING_MCP_INTERNAL_KEY: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  LINGXING_MCP_ENCRYPTION_KEY: z.string().min(1),
  LINGXING_MCP_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith('https://')),
  LINGXING_MCP_MONGO_URI: z.string().min(1),
  LINGXING_MCP_LIBRECHAT_DB: z.string().default('LibreChat'),
  LINGXING_MCP_DB: z.string().default('lingxing_mcp_gateway'),
  LINGXING_MCP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  LINGXING_MCP_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  LINGXING_MCP_SIGNATURE_TOLERANCE_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  LINGXING_MCP_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(60),
  LINGXING_MCP_TOOL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(1100),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const parsed = schema.parse(env);
  const encryptionKey = Buffer.from(parsed.LINGXING_MCP_ENCRYPTION_KEY, 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error('LINGXING_MCP_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return {
    host: parsed.LINGXING_MCP_GATEWAY_HOST,
    port: parsed.LINGXING_MCP_GATEWAY_PORT,
    internalKey: parsed.LINGXING_MCP_INTERNAL_KEY,
    jwtSecret: parsed.JWT_SECRET,
    encryptionKey,
    upstreamUrl: new URL(parsed.LINGXING_MCP_URL).toString(),
    mongoUri: parsed.LINGXING_MCP_MONGO_URI,
    libreChatDatabase: parsed.LINGXING_MCP_LIBRECHAT_DB,
    gatewayDatabase: parsed.LINGXING_MCP_DB,
    requestTimeoutMs: parsed.LINGXING_MCP_TIMEOUT_MS,
    auditRetentionDays: parsed.LINGXING_MCP_AUDIT_RETENTION_DAYS,
    signatureToleranceMs: parsed.LINGXING_MCP_SIGNATURE_TOLERANCE_MS,
    requestsPerMinute: parsed.LINGXING_MCP_REQUESTS_PER_MINUTE,
    toolIntervalMs: parsed.LINGXING_MCP_TOOL_INTERVAL_MS,
  };
}
