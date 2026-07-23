const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const gatewayUrl = 'http://sellersprite-mcp-gateway:4200/mcp';
const internalKey = process.env.SELLERSPRITE_MCP_INTERNAL_KEY;
if (!internalKey) throw new Error('SELLERSPRITE_MCP_INTERNAL_KEY is missing');

const headersFor = (user) => ({
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
  'X-MCP-Gateway-Key': internalKey,
  'X-LibreChat-User-ID': user._id.toString(),
  'X-LibreChat-User-Email': user.email,
  'X-LibreChat-User-Role': user.role,
});

const initialize = {
  jsonrpc: '2.0',
  id: 'phase3-actor-check',
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'phase3-actor-check', version: '1.0.0' },
  },
};

(async () => {
  try {
    await connect();
    const { User } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).select('_id email role').lean();
    const ordinary = await User.findOne({ role: SystemRoles.USER }).select('_id email role').lean();
    if (!admin || !ordinary) throw new Error('Both ADMIN and ordinary USER accounts are required');

    const allowed = await fetch(gatewayUrl, {
      method: 'POST',
      headers: headersFor(admin),
      body: JSON.stringify(initialize),
    });
    await allowed.arrayBuffer();
    if (!allowed.ok) throw new Error(`ADMIN initialize returned HTTP ${allowed.status}`);

    const denied = await fetch(gatewayUrl, {
      method: 'POST',
      headers: headersFor(ordinary),
      body: JSON.stringify(initialize),
    });
    await denied.arrayBuffer();
    if (denied.status !== 403) throw new Error(`USER initialize returned HTTP ${denied.status}`);

    console.log('PHASE3_ACTOR_AUTH_OK admin=allowed ordinary_user=denied');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE3_ACTOR_AUTH_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
