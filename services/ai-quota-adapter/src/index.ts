import { buildApp } from './app.js';
import { AccountService } from './accounts.js';
import { loadConfig } from './config.js';
import { MongoStores } from './database.js';
import { RedisRequestLimiter } from './limiter.js';
import { NewApiClient } from './new-api.js';

const config = loadConfig();
const stores = new MongoStores(
  config.mongoUri,
  config.auditRetentionDays,
  config.libreChatDatabase,
  config.adapterDatabase,
);
const limiter = new RedisRequestLimiter(
  config.redisUrl,
  config.requestsPerMinute,
  config.maxConcurrentRequests,
);

await stores.connect();
await limiter.connect();
const newApi = new NewApiClient(
  config.newApiBaseUrl,
  config.requestTimeoutMs,
  config.adminToken,
  config.newApiAdminUserId,
);
const accounts = new AccountService(config, stores, newApi);
await accounts.initialize();
const app = buildApp(config, {
  mappings: stores,
  audits: stores,
  limiter,
  newApi,
  accounts,
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down AI quota adapter');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
