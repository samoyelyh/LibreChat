import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { MongoStores } from './database.js';
import { SellerSpriteClient } from './upstream.js';

const config = loadConfig();
const stores = new MongoStores(config);
await stores.connect();
const app = buildApp(config, stores, new SellerSpriteClient(config));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'Shutting down SellerSprite MCP gateway');
  await app.close();
  await stores.close();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
