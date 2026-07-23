import { loadConfig } from '../config.js';
import { MongoStores } from '../database.js';

const config = loadConfig();
if (!config.runBillableTests) throw new Error('Set RUN_BILLABLE_PHASE2_TESTS=true for the one-time live test');
const stores = new MongoStores(config.mongoUri, config.auditRetentionDays);
await stores.connect();
try {
  const mappings = await stores.listSafe();
  const mapping = mappings.find((item) => item.credentialStatus === 'active');
  if (!mapping) throw new Error('No active mapping is available');
  const model = mapping.allowedModels.includes(config.testModel) ? config.testModel : mapping.allowedModels[0];
  if (!model) throw new Error('The active mapping has no allowed model');
  const headers = {
    'Content-Type': 'application/json',
    'X-Adapter-Internal-Key': config.internalKey,
    'X-LibreChat-User-ID': mapping.librechatUserId,
    'X-LibreChat-User-Email': mapping.librechatEmail,
  };
  const base = `http://127.0.0.1:${config.port}`;
  const modelsResponse = await fetch(`${base}/v1/models`, { headers });
  if (!modelsResponse.ok) throw new Error(`Adapter model list failed: HTTP ${modelsResponse.status}`);
  const models = (await modelsResponse.json()) as { data?: Array<{ id?: string }> };
  if (!models.data?.some((item) => item.id === model)) throw new Error('Mapped test model is missing');

  const nonStream = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply only: OK' }], max_tokens: 4 }),
  });
  if (!nonStream.ok) throw new Error(`Non-stream request failed: HTTP ${nonStream.status}`);
  const nonStreamJson = (await nonStream.json()) as { choices?: unknown[] };
  if (!Array.isArray(nonStreamJson.choices)) throw new Error('Non-stream response has no choices');

  const stream = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply only: OK' }],
      max_tokens: 4,
      stream: true,
    }),
  });
  const streamText = await stream.text();
  if (!stream.ok || !streamText.includes('data:') || !streamText.includes('[DONE]')) {
    throw new Error(`SSE contract failed: HTTP ${stream.status}`);
  }
  process.stdout.write(
    `${JSON.stringify({ success: true, model, models: models.data.length, nonStream: 200, sse: 200 })}\n`,
  );
} finally {
  await stores.close();
}
