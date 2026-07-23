import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  AI_ADAPTER_HOST: z.string().default('0.0.0.0'),
  AI_ADAPTER_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  AI_ADAPTER_INTERNAL_KEY: z.string().min(32),
  AI_TOKEN_ENCRYPTION_KEY: z.string().min(43),
  JWT_SECRET: z.string().min(32),
  MONGO_URI: z.string().min(1),
  REDIS_URL: z.string().min(1),
  NEW_API_BASE_URL: z.url(),
  NEW_API_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  AI_ADAPTER_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10000).default(30),
  AI_ADAPTER_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(100).default(2),
  AI_ADAPTER_AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  AI_ADAPTER_TEST_MODEL: z.string().min(1).default('kimi-k2'),
  RUN_BILLABLE_PHASE2_TESTS: z.enum(['true', 'false']).default('false'),
});

export type AdapterConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  internalKey: string;
  encryptionKey: string;
  jwtSecret: string;
  mongoUri: string;
  redisUrl: string;
  newApiBaseUrl: string;
  requestTimeoutMs: number;
  requestsPerMinute: number;
  maxConcurrentRequests: number;
  auditRetentionDays: number;
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
    jwtSecret: parsed.JWT_SECRET,
    mongoUri: parsed.MONGO_URI,
    redisUrl: parsed.REDIS_URL,
    newApiBaseUrl: parsed.NEW_API_BASE_URL.replace(/\/+$/, ''),
    requestTimeoutMs: parsed.NEW_API_REQUEST_TIMEOUT_MS,
    requestsPerMinute: parsed.AI_ADAPTER_REQUESTS_PER_MINUTE,
    maxConcurrentRequests: parsed.AI_ADAPTER_MAX_CONCURRENT_REQUESTS,
    auditRetentionDays: parsed.AI_ADAPTER_AUDIT_RETENTION_DAYS,
    testModel: parsed.AI_ADAPTER_TEST_MODEL,
    runBillableTests: parsed.RUN_BILLABLE_PHASE2_TESTS === 'true',
  };
}
