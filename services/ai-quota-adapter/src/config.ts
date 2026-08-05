import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  AI_ADAPTER_HOST: z.string().default('0.0.0.0'),
  AI_ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  AI_ADAPTER_INTERNAL_KEY: z.string().min(32),
  AI_TOKEN_ENCRYPTION_KEY: z.string().min(43),
  AI_GATEWAY_ADMIN_TOKEN: z.string().min(16),
  JWT_SECRET: z.string().min(32),
  MONGO_URI: z.string().min(1),
  AI_ADAPTER_LIBRECHAT_DB: z.string().default('LibreChat'),
  AI_ADAPTER_DB_NAME: z.string().default('ai_quota_adapter'),
  REDIS_URL: z.string().min(1),
  NEW_API_BASE_URL: z.url(),
  NEW_API_ADMIN_USER_ID: z.coerce.number().int().positive(),
  NEW_API_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  AI_ADAPTER_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(30),
  AI_ADAPTER_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(100).default(2),
  AI_ADAPTER_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  AI_ADAPTER_SIGNATURE_TOLERANCE_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(300000)
    .default(30000),
  AI_DEFAULT_USER_QUOTA: z.coerce.number().int().min(0).default(0),
  AI_DEFAULT_ALLOWED_MODELS: z.string().default('gpt-5.6-sol'),
  AI_ADAPTER_TEST_MODEL: z.string().min(1).default('gpt-5.6-sol'),
  RUN_BILLABLE_PHASE2_TESTS: z.enum(['true', 'false']).default('false'),
});

export type AdapterConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  internalKey: string;
  encryptionKey: string;
  adminToken: string;
  jwtSecret: string;
  mongoUri: string;
  libreChatDatabase: string;
  adapterDatabase: string;
  redisUrl: string;
  newApiBaseUrl: string;
  newApiAdminUserId: number;
  requestTimeoutMs: number;
  requestsPerMinute: number;
  maxConcurrentRequests: number;
  auditRetentionDays: number;
  signatureToleranceMs: number;
  defaultUserQuota: number;
  defaultAllowedModels: string[];
  testModel: string;
  runBillableTests: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AdapterConfig {
  const parsed = envSchema.parse(env);
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.AI_ADAPTER_HOST,
    port: parsed.AI_ADAPTER_PORT,
    internalKey: parsed.AI_ADAPTER_INTERNAL_KEY,
    encryptionKey: parsed.AI_TOKEN_ENCRYPTION_KEY,
    adminToken: parsed.AI_GATEWAY_ADMIN_TOKEN,
    jwtSecret: parsed.JWT_SECRET,
    mongoUri: parsed.MONGO_URI,
    libreChatDatabase: parsed.AI_ADAPTER_LIBRECHAT_DB,
    adapterDatabase: parsed.AI_ADAPTER_DB_NAME,
    redisUrl: parsed.REDIS_URL,
    newApiBaseUrl: parsed.NEW_API_BASE_URL.replace(/\/+$/, ''),
    newApiAdminUserId: parsed.NEW_API_ADMIN_USER_ID,
    requestTimeoutMs: parsed.NEW_API_REQUEST_TIMEOUT_MS,
    requestsPerMinute: parsed.AI_ADAPTER_REQUESTS_PER_MINUTE,
    maxConcurrentRequests: parsed.AI_ADAPTER_MAX_CONCURRENT_REQUESTS,
    auditRetentionDays: parsed.AI_ADAPTER_AUDIT_RETENTION_DAYS,
    signatureToleranceMs: parsed.AI_ADAPTER_SIGNATURE_TOLERANCE_MS,
    defaultUserQuota: parsed.AI_DEFAULT_USER_QUOTA,
    defaultAllowedModels: [...new Set(
      parsed.AI_DEFAULT_ALLOWED_MODELS.split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    )].sort(),
    testModel: parsed.AI_ADAPTER_TEST_MODEL,
    runBillableTests: parsed.RUN_BILLABLE_PHASE2_TESTS === 'true',
  };
}
