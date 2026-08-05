const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');
const { signedHeaders } = require('/app/deploy/gateway-signing.js');

const gatewayUrl = 'http://sellersprite-mcp-gateway:4200/mcp';
const internalKey = process.env.SELLERSPRITE_MCP_INTERNAL_KEY;
if (!internalKey) throw new Error('SELLERSPRITE_MCP_INTERNAL_KEY is missing');

const headersFor = (user) => ({
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
  'X-LibreChat-User-ID': user._id.toString(),
  'X-LibreChat-User-Email': user.email,
  'X-LibreChat-User-Role': user.role,
});

const signedRequest = (user, body) => {
  const bodyText = JSON.stringify(body);
  return fetch(gatewayUrl, {
    method: 'POST',
    headers: signedHeaders({
      secret: internalKey,
      url: gatewayUrl,
      method: 'POST',
      body: bodyText,
      headers: headersFor(user),
    }),
    body: bodyText,
  });
};

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
    const { User, Group } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).select('_id email role').lean();
    const operations = await Group.findOne({ name: '运营部', source: 'local' })
      .select('memberIds')
      .lean();
    const users = await User.find({ role: SystemRoles.USER }).select('_id email role idOnTheSource').lean();
    const operationMembers = new Set(operations?.memberIds ?? []);
    const ordinary = users.find(
      (user) =>
        operationMembers.has(user._id.toString()) ||
        (user.idOnTheSource && operationMembers.has(user.idOnTheSource)),
    );
    if (!admin || !ordinary) {
      throw new Error('Both ADMIN and an operations-department USER account are required');
    }

    const allowed = await signedRequest(admin, initialize);
    await allowed.arrayBuffer();
    if (!allowed.ok) throw new Error(`ADMIN initialize returned HTTP ${allowed.status}`);

    const ordinaryAllowed = await signedRequest(ordinary, initialize);
    await ordinaryAllowed.arrayBuffer();
    if (!ordinaryAllowed.ok) {
      throw new Error(`Operations USER initialize returned HTTP ${ordinaryAllowed.status}`);
    }

    console.log('PHASE3_ACTOR_AUTH_OK admin=allowed operations_user=allowed');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE3_ACTOR_AUTH_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
