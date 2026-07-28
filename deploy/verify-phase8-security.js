const mongoose = require('mongoose');
const { signedHeaders } = require('/app/deploy/gateway-signing.js');

const gateways = {
  sellersprite: {
    url: 'http://sellersprite-mcp-gateway:4200/mcp',
    secret: process.env.SELLERSPRITE_MCP_INTERNAL_KEY,
  },
  lingxing: {
    url: 'http://lingxing-mcp-gateway:4300/mcp',
    secret: process.env.LINGXING_MCP_INTERNAL_KEY,
  },
};
const adapter = {
  url: 'http://ai-quota-adapter:4100/v1/chat/completions',
  secret: process.env.AI_ADAPTER_INTERNAL_KEY,
};

function actorHeaders(user) {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'X-LibreChat-User-ID': String(user._id),
    'X-LibreChat-User-Email': user.email,
    'X-LibreChat-User-Role': user.role,
  };
}

async function signedPost(gateway, user, body, options = {}) {
  const bodyText = JSON.stringify(body);
  const headers = signedHeaders({
    secret: gateway.secret,
    url: gateway.url,
    method: 'POST',
    body: bodyText,
    headers: actorHeaders(user),
    ...options,
  });
  return {
    headers,
    response: await fetch(gateway.url, { method: 'POST', headers, body: bodyText }),
    bodyText,
  };
}

async function requireUnsignedDenied(gateway) {
  const response = await fetch(gateway.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
  });
  const text = await response.text();
  if (response.status !== 401 || !text.includes('missing_request_signature')) {
    throw new Error(`Unsigned request was not denied by ${gateway.url}`);
  }
}

async function verifySecurityCollections(database) {
  const requiredIndexes = ['nonce_ttl', 'rate_limit_ttl', 'security_audit_ttl'];
  const collections = await database.listCollections().toArray();
  const collectionNames = new Set(collections.map((value) => value.name));
  for (const name of ['gateway_request_nonces', 'gateway_rate_limits', 'gateway_security_audits']) {
    if (!collectionNames.has(name)) throw new Error(`Missing security collection ${name}`);
  }
  const indexes = new Set(
    (
      await Promise.all([
        database.collection('gateway_request_nonces').indexes(),
        database.collection('gateway_rate_limits').indexes(),
        database.collection('gateway_security_audits').indexes(),
      ])
    )
      .flat()
      .map((index) => index.name),
  );
  for (const name of requiredIndexes) {
    if (!indexes.has(name)) throw new Error(`Missing security index ${name}`);
  }
}

(async () => {
  try {
    if (!gateways.sellersprite.secret || !gateways.lingxing.secret || !adapter.secret) {
      throw new Error('Internal signing secrets are missing');
    }
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const admin = await db.collection('users').findOne({ role: 'ADMIN', banned: { $ne: true } });
    const ordinary = await db.collection('users').findOne({
      role: { $ne: 'ADMIN' },
      banned: { $ne: true },
    });
    if (!admin || !ordinary) throw new Error('ADMIN and ordinary users are required');

    await Promise.all(Object.values(gateways).map(requireUnsignedDenied));
    const unsignedAdapter = await fetch(adapter.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"phase8-no-upstream","messages":[]}',
    });
    if (
      unsignedAdapter.status !== 401 ||
      !(await unsignedAdapter.text()).includes('missing_request_signature')
    ) {
      throw new Error('Unsigned AI Adapter request was not denied');
    }

    const writeBody = {
      jsonrpc: '2.0',
      id: 'phase8-write-denied',
      method: 'tools/call',
      params: { name: 'create_erp_keyword', arguments: {} },
    };
    const signedWrite = await signedPost(gateways.lingxing, admin, writeBody);
    const signedWriteText = await signedWrite.response.text();
    if (signedWrite.response.status !== 403 || !signedWriteText.includes('工具未授权')) {
      throw new Error(`Valid signed LingXing write denial failed: ${signedWrite.response.status}`);
    }
    const replay = await fetch(gateways.lingxing.url, {
      method: 'POST',
      headers: signedWrite.headers,
      body: signedWrite.bodyText,
    });
    const replayText = await replay.text();
    if (replay.status !== 401 || !replayText.includes('replayed_request')) {
      throw new Error(`Replay was not denied: ${replay.status}`);
    }

    const stale = await signedPost(gateways.sellersprite, ordinary, {
      jsonrpc: '2.0',
      id: 'phase8-stale',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'phase8-security', version: '1.0.0' },
      },
    }, { now: Date.now() - 120000 });
    const staleText = await stale.response.text();
    if (stale.response.status !== 401 || !staleText.includes('stale_request_signature')) {
      throw new Error(`Stale signature was not denied: ${stale.response.status}`);
    }

    const invalid = await signedPost(gateways.sellersprite, ordinary, {
      jsonrpc: '2.0',
      id: 'phase8-invalid',
      method: 'tools/list',
      params: {},
    });
    invalid.headers['X-Woda-Signature'] = '0'.repeat(64);
    const invalidResponse = await fetch(gateways.sellersprite.url, {
      method: 'POST',
      headers: invalid.headers,
      body: invalid.bodyText,
    });
    const invalidText = await invalidResponse.text();
    if (invalidResponse.status !== 401 || !invalidText.includes('invalid_request_signature')) {
      throw new Error(`Invalid signature was not denied: ${invalidResponse.status}`);
    }

    const adapterBody = JSON.stringify({ model: 'phase8-no-upstream', messages: [] });
    const adapterHeaders = signedHeaders({
      secret: adapter.secret,
      url: adapter.url,
      method: 'POST',
      body: adapterBody,
      headers: {
        'Content-Type': 'application/json',
        'X-LibreChat-User-ID': String(admin._id),
        'X-LibreChat-User-Email': `mismatch-${admin.email}`,
      },
    });
    const adapterDenied = await fetch(adapter.url, {
      method: 'POST',
      headers: adapterHeaders,
      body: adapterBody,
    });
    if (adapterDenied.status !== 403) {
      throw new Error(`Signed mismatched AI actor was not denied: ${adapterDenied.status}`);
    }
    const adapterReplay = await fetch(adapter.url, {
      method: 'POST',
      headers: adapterHeaders,
      body: adapterBody,
    });
    if (
      adapterReplay.status !== 401 ||
      !(await adapterReplay.text()).includes('replayed_request')
    ) {
      throw new Error(`AI Adapter replay was not denied: ${adapterReplay.status}`);
    }

    const lingxingDb = mongoose.connection.client.db(
      process.env.LINGXING_MCP_DB || 'lingxing_mcp_gateway',
    );
    const sellerDb = mongoose.connection.client.db(
      process.env.SELLERSPRITE_MCP_DB || 'sellersprite_mcp_gateway',
    );
    const adapterDb = mongoose.connection.client.db(
      process.env.AI_ADAPTER_DB_NAME || 'ai_quota_adapter',
    );
    await Promise.all([
      verifySecurityCollections(lingxingDb),
      verifySecurityCollections(sellerDb),
    ]);
    const adapterCollections = new Set(
      (await adapterDb.listCollections().toArray()).map((value) => value.name),
    );
    for (const name of ['adapter_request_nonces', 'adapter_security_audits']) {
      if (!adapterCollections.has(name)) {
        throw new Error(`Missing adapter security collection ${name}`);
      }
    }
    const adapterIndexes = new Set(
      (
        await Promise.all([
          adapterDb.collection('adapter_request_nonces').indexes(),
          adapterDb.collection('adapter_security_audits').indexes(),
        ])
      )
        .flat()
        .map((index) => index.name),
    );
    for (const name of ['nonce_ttl', 'security_audit_retention_ttl']) {
      if (!adapterIndexes.has(name)) throw new Error(`Missing adapter security index ${name}`);
    }

    const credentials = await lingxingDb.collection('lingxing_credentials').find({}).toArray();
    for (const credential of credentials) {
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
        throw new Error(`Unsafe LingXing credential ${credential._id}`);
      }
    }

    const securityAudits = await Promise.all([
      lingxingDb.collection('gateway_security_audits').countDocuments({
        code: { $in: ['missing_request_signature', 'replayed_request'] },
      }),
      sellerDb.collection('gateway_security_audits').countDocuments({
        code: { $in: ['missing_request_signature', 'stale_request_signature', 'invalid_request_signature'] },
      }),
      adapterDb.collection('adapter_security_audits').countDocuments({
        code: { $in: ['missing_request_signature', 'replayed_request'] },
      }),
    ]);
    if (securityAudits.some((count) => count < 2)) {
      throw new Error(`Security audit coverage is incomplete: ${securityAudits.join(',')}`);
    }

    console.log(
      `PHASE8_SECURITY_OK unsigned=denied replay=denied stale=denied invalid=denied encrypted_credentials=${credentials.length}`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE8_SECURITY_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
