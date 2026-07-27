const mongoose = require('mongoose');
const {
  TOOL_GROUPS,
  lingxingReadTools,
  sellerSpriteTools,
} = require('/app/deploy/phase6-tool-catalog.js');

function parsePayload(text) {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'))
    ?.slice(5)
    .trim();
  return JSON.parse(dataLine || text);
}

function headers(internalKey, user, sessionId, protocolVersion) {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': protocolVersion,
    'X-MCP-Gateway-Key': internalKey,
    'X-LibreChat-User-ID': String(user._id),
    'X-LibreChat-User-Email': user.email,
    'X-LibreChat-User-Role': user.role,
    ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
  };
}

async function listTools({ name, url, internalKey, user }) {
  let sessionId = null;
  let protocolVersion = '2025-06-18';
  try {
    const initialized = await fetch(url, {
      method: 'POST',
      headers: headers(internalKey, user, null, protocolVersion),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `phase6-${name}-initialize`,
        method: 'initialize',
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'woda-phase6-live-tools', version: '1.0.0' },
        },
      }),
    });
    const initializedText = await initialized.text();
    if (!initialized.ok) throw new Error(`${name} initialize HTTP ${initialized.status}`);
    const initializedPayload = parsePayload(initializedText);
    if (initializedPayload.error) throw new Error(`${name} initialize returned MCP error`);
    sessionId = initialized.headers.get('mcp-session-id');
    protocolVersion = initializedPayload.result?.protocolVersion ?? protocolVersion;

    await fetch(url, {
      method: 'POST',
      headers: headers(internalKey, user, sessionId, protocolVersion),
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }).then((response) => response.arrayBuffer());

    const response = await fetch(url, {
      method: 'POST',
      headers: headers(internalKey, user, sessionId, protocolVersion),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `phase6-${name}-tools`,
        method: 'tools/list',
        params: {},
      }),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`${name} tools/list HTTP ${response.status}`);
    const payload = parsePayload(responseText);
    if (payload.error) throw new Error(`${name} tools/list returned MCP error`);
    const tools = payload.result?.tools;
    if (!Array.isArray(tools)) throw new Error(`${name} tools/list returned no tool array`);
    return tools
      .map((tool) => (typeof tool?.name === 'string' ? tool.name : null))
      .filter(Boolean);
  } finally {
    if (sessionId) {
      await fetch(url, {
        method: 'DELETE',
        headers: headers(internalKey, user, sessionId, protocolVersion),
      }).catch(() => undefined);
    }
  }
}

function requireCatalog(name, actual, required) {
  const actualSet = new Set(actual);
  const missing = required.filter((tool) => !actualSet.has(tool));
  if (missing.length > 0) {
    throw new Error(`${name} is missing ${missing.length} catalog tool(s): ${missing.join(', ')}`);
  }
}

(async () => {
  try {
    if (!process.env.SELLERSPRITE_MCP_INTERNAL_KEY || !process.env.LINGXING_MCP_INTERNAL_KEY) {
      throw new Error('MCP internal keys are missing');
    }
    await mongoose.connect(process.env.MONGO_URI);
    const admin = await mongoose.connection.db.collection('users').findOne({ role: 'ADMIN' });
    if (!admin) throw new Error('System administrator is missing');

    const [sellerSprite, lingxing] = await Promise.all([
      listTools({
        name: 'sellersprite',
        url: 'http://sellersprite-mcp-gateway:4200/mcp',
        internalKey: process.env.SELLERSPRITE_MCP_INTERNAL_KEY,
        user: admin,
      }),
      listTools({
        name: 'lingxing',
        url: 'http://lingxing-mcp-gateway:4300/mcp',
        internalKey: process.env.LINGXING_MCP_INTERNAL_KEY,
        user: admin,
      }),
    ]);

    requireCatalog('SellerSprite', sellerSprite, sellerSpriteTools);
    requireCatalog('Lingxing', lingxing, lingxingReadTools);
    const exposedWrites = TOOL_GROUPS.lingxing_write.filter((tool) => lingxing.includes(tool));
    if (exposedWrites.length > 0) {
      throw new Error(`Lingxing write tools exposed by tools/list: ${exposedWrites.join(', ')}`);
    }

    console.log(
      `PHASE6_LIVE_TOOLS_OK sellersprite=${sellerSprite.length} lingxing=${lingxing.length} exposedWrites=0`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE6_LIVE_TOOLS_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
