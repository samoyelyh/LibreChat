import { loadConfig } from '../config.js';
import { MongoStores } from '../database.js';

const config = loadConfig();
const stores = new MongoStores(config.mongoUri, config.auditRetentionDays);
await stores.connect();
try {
  const mappings = await stores.listSafe();
  process.stdout.write(`${JSON.stringify({ success: true, count: mappings.length, mappings })}\n`);
} finally {
  await stores.close();
}
