import { SignJWT } from 'jose';
import { loadConfig } from '../config.js';
import { MongoStores } from '../database.js';
import { createSignedHeaders } from '../security.js';

const config = loadConfig();
const stores = new MongoStores(config.mongoUri, config.auditRetentionDays);
await stores.connect();
try {
  const mappings = await stores.listSafe();
  const mapping = mappings.find((item) => item.credentialStatus === 'active');
  if (!mapping) throw new Error('No active mapping is available');

  const base = `http://127.0.0.1:${config.port}`;
  const actorHeaders = {
    'X-LibreChat-User-ID': mapping.librechatUserId,
    'X-LibreChat-User-Email': mapping.librechatEmail,
  };
  const internalHeaders = createSignedHeaders({
    secret: config.internalKey,
    url: `${base}/v1/models`,
    method: 'GET',
    actorHeaders,
  });
  const modelsResponse = await fetch(`${base}/v1/models`, { headers: internalHeaders });
  if (!modelsResponse.ok) throw new Error(`Adapter model list failed: HTTP ${modelsResponse.status}`);
  const models = (await modelsResponse.json()) as { data?: Array<{ id?: string }> };
  const modelIds = (models.data ?? []).map(({ id }) => id).filter((id): id is string => Boolean(id));
  if (mapping.allowedModels.some((model) => !modelIds.includes(model))) {
    throw new Error('One or more mapped models are missing from the filtered model list');
  }

  const jwt = await new SignJWT({ id: mapping.librechatUserId, email: mapping.librechatEmail })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(config.jwtSecret));
  const balanceResponse = await fetch(`${base}/api/user/balance`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!balanceResponse.ok) throw new Error(`Adapter balance failed: HTTP ${balanceResponse.status}`);
  const balance = (await balanceResponse.json()) as { success?: boolean; data?: { totalAvailable?: number } };
  if (!balance.success || typeof balance.data?.totalAvailable !== 'number') {
    throw new Error('Adapter balance contract is invalid');
  }

  process.stdout.write(
    `${JSON.stringify({ success: true, mappings: mappings.length, models: modelIds.length, balance: 'available' })}\n`,
  );
} finally {
  await stores.close();
}
