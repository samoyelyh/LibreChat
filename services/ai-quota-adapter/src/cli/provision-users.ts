import { AccountService } from '../accounts.js';
import { loadConfig } from '../config.js';
import { MongoStores } from '../database.js';
import { NewApiClient } from '../new-api.js';

const config = loadConfig();
const stores = new MongoStores(
  config.mongoUri,
  config.auditRetentionDays,
  config.libreChatDatabase,
  config.adapterDatabase,
);
await stores.connect();

try {
  const newApi = new NewApiClient(
    config.newApiBaseUrl,
    config.requestTimeoutMs,
    config.adminToken,
    config.newApiAdminUserId,
  );
  const accounts = new AccountService(config, stores, newApi);
  await accounts.initialize();
  const identities = await stores.listIdentities('', 50);
  let active = 0;
  let automatic = 0;
  let manual = 0;
  let synchronized = 0;
  for (const identity of identities) {
    const existing = await stores.findByUserId(identity.userId);
    const mapping = await accounts.ensure(
      { userId: identity.userId, email: identity.email },
      identity.userId,
      'Phase 5 existing-user synchronization',
    );
    if (existing?.provisionedBy === 'automatic') {
      await accounts.applyUserPolicy(
        identity.userId,
        identity.userId,
        'Phase 5 existing-user policy synchronization',
      );
      synchronized += 1;
    }
    active += mapping.credentialStatus === 'active' ? 1 : 0;
    automatic += mapping.provisionedBy === 'automatic' ? 1 : 0;
    manual += mapping.provisionedBy === 'automatic' ? 0 : 1;
  }
  process.stdout.write(
    `${JSON.stringify({
      success: active === identities.length,
      users: identities.length,
      active,
      automatic,
      manual,
      synchronized,
      defaultQuota: config.defaultUserQuota,
      secretsPrinted: false,
    })}\n`,
  );
} finally {
  await stores.close();
}
