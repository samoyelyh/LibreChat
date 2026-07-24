const mongoose = require('mongoose');

const gatewayUrl = 'http://lingxing-mcp-gateway:4300/mcp';
const internalKey = process.env.LINGXING_MCP_INTERNAL_KEY;
if (!internalKey) throw new Error('LINGXING_MCP_INTERNAL_KEY is required');

async function request(user, body) {
  return fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2025-06-18',
      'X-MCP-Gateway-Key': internalKey,
      'X-LibreChat-User-ID': String(user._id),
      'X-LibreChat-User-Email': user.email,
      'X-LibreChat-User-Role': user.role,
    },
    body: JSON.stringify(body),
  });
}

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const admin = await db.collection('users').findOne({ role: 'ADMIN' });
    if (!admin) throw new Error('System administrator is missing');

    const write = await request(admin, {
      jsonrpc: '2.0',
      id: 'phase4-write-denied',
      method: 'tools/call',
      params: { name: 'create_erp_keyword', arguments: {} },
    });
    const writeBody = await write.text();
    if (write.status !== 403 || !writeBody.includes('领星工具未授权')) {
      throw new Error(`Write tool policy failed: HTTP ${write.status}`);
    }

    const mismatch = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-MCP-Gateway-Key': internalKey,
        'X-LibreChat-User-ID': String(admin._id),
        'X-LibreChat-User-Email': `mismatch-${admin.email}`,
        'X-LibreChat-User-Role': admin.role,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    if (mismatch.status !== 403) throw new Error(`Actor mismatch was not denied: ${mismatch.status}`);

    const gatewayDb = mongoose.connection.client.db(
      process.env.LINGXING_MCP_DB || 'lingxing_mcp_gateway',
    );
    const credentials = await gatewayDb.collection('lingxing_credentials').find({}).toArray();
    for (const credential of credentials) {
      const serialized = JSON.stringify(credential);
      if (
        credential.key ||
        credential.apiKey ||
        credential.secretKey ||
        (credential.secret &&
          (credential.secret.algorithm !== 'aes-256-gcm' ||
            !credential.secret.iv ||
            !credential.secret.tag ||
            !credential.secret.ciphertext))
      ) {
        throw new Error(`Unsafe credential document detected for ${credential._id}`);
      }
      if (serialized.includes('X-Mcp-Key')) {
        throw new Error(`Credential label leaked into stored data for ${credential._id}`);
      }
    }

    console.log(
      `PHASE4_ACTOR_SECURITY_OK write=denied mismatch=denied encrypted_credentials=${credentials.length}`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE4_ACTOR_SECURITY_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
