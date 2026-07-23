import { loadConfig } from '../config.js';
import { encryptToken, fingerprintToken, hashToken } from '../crypto.js';
import { MongoStores } from '../database.js';
import { modelIds, NewApiClient } from '../new-api.js';
import { parseArgs, readSecretFromStdin, requiredArg } from './shared.js';

const config = loadConfig();
const args = parseArgs(process.argv.slice(2));
const token = await readSecretFromStdin();
const stores = new MongoStores(config.mongoUri, config.auditRetentionDays);
await stores.connect();

try {
  const newApi = new NewApiClient(config.newApiBaseUrl, config.requestTimeoutMs);
  const [modelsResponse, usage, logs] = await Promise.all([
    newApi.listModels(token),
    newApi.tokenUsage(token),
    newApi.tokenLogs(token),
  ]);
  const availableModels = new Set(modelIds(modelsResponse));
  const allowedModels = args.get('--allow-model') ?? [];
  if (allowedModels.length === 0) throw new Error('At least one --allow-model is required');
  const unavailable = allowedModels.filter((model) => !availableModels.has(model));
  if (unavailable.length > 0) throw new Error(`Token cannot access configured models: ${unavailable.join(', ')}`);

  const identityLog = logs.find((log) => typeof log.user_id === 'number' && typeof log.username === 'string');
  const newApiUserId = args.get('--new-api-user-id')?.[0] ?? identityLog?.user_id?.toString();
  const newApiUsername = args.get('--new-api-username')?.[0] ?? identityLog?.username;
  if (!newApiUserId || !newApiUsername) {
    throw new Error('New API identity could not be derived; provide --new-api-user-id and --new-api-username');
  }
  const gatewayGroup = args.get('--gateway-group')?.[0] ?? identityLog?.group ?? 'default';
  const safe = await stores.upsert({
    librechatUserId: requiredArg(args, '--librechat-user-id'),
    librechatEmail: requiredArg(args, '--librechat-email').toLowerCase(),
    newApiUserId,
    newApiUsername,
    encryptedToken: encryptToken(token, config.encryptionKey),
    tokenFingerprint: fingerprintToken(token),
    tokenHash: hashToken(token),
    gatewayGroup,
    credentialStatus: 'active',
    allowedModels: [...new Set(allowedModels)].sort(),
    lastSyncedAt: new Date(),
  });
  process.stdout.write(
    `${JSON.stringify({
      success: true,
      mapping: safe,
      balance: {
        totalGranted: usage.total_granted,
        totalUsed: usage.total_used,
        totalAvailable: usage.total_available,
      },
      upstreamModelCount: availableModels.size,
    })}\n`,
  );
} finally {
  await stores.close();
}
