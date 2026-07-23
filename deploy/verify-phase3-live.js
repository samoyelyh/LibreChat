const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const gatewayUrl = 'http://sellersprite-mcp-gateway:4200/mcp';
const internalKey = process.env.SELLERSPRITE_MCP_INTERNAL_KEY;
if (!internalKey) throw new Error('SELLERSPRITE_MCP_INTERNAL_KEY is missing');

function parseMcp(text) {
  const dataLine = text
    .split(/\r?\n/)
    .find((line) => line.startsWith('data:'))
    ?.slice(5)
    .trim();
  return JSON.parse(dataLine || text);
}

(async () => {
  let sessionId;
  let protocolVersion = '2025-06-18';
  try {
    await connect();
    const { User } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).select('_id email role').lean();
    if (!admin) throw new Error('System ADMIN user is required');
    const baseHeaders = {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      'X-MCP-Gateway-Key': internalKey,
      'X-LibreChat-User-ID': admin._id.toString(),
      'X-LibreChat-User-Email': admin.email,
      'X-LibreChat-User-Role': admin.role,
      'X-LibreChat-Conversation-ID': 'phase3-live-acceptance',
      'X-LibreChat-Message-ID': 'phase3-live-acceptance',
    };
    const post = async (body) => {
      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'MCP-Protocol-Version': protocolVersion,
          ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
        },
        body: JSON.stringify(body),
      });
      sessionId ||= response.headers.get('mcp-session-id');
      const text = await response.text();
      if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
      return text ? parseMcp(text) : null;
    };

    const initialized = await post({
      jsonrpc: '2.0',
      id: 'phase3-live-initialize',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'woda-phase3-live-acceptance', version: '1.0.0' },
      },
    });
    if (initialized?.error) throw new Error('Initialize returned an MCP error');
    if (typeof initialized?.result?.protocolVersion === 'string') {
      protocolVersion = initialized.result.protocolVersion;
    }
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

    const list = await post({
      jsonrpc: '2.0',
      id: 'phase3-live-tools',
      method: 'tools/list',
      params: {},
    });
    const tools = Array.isArray(list?.result?.tools) ? list.result.tools : [];
    const safeTool = tools.find((tool) => tool?.name === 'trademark_country_list');
    if (!safeTool) throw new Error('Safe acceptance tool trademark_country_list is unavailable');

    const result = await post({
      jsonrpc: '2.0',
      id: 'phase3-live-call',
      method: 'tools/call',
      params: { name: safeTool.name, arguments: {} },
    });
    if (result?.error || result?.result?.isError === true) {
      throw new Error('Safe acceptance tool returned an MCP error');
    }

    if (sessionId) {
      await fetch(gatewayUrl, {
        method: 'DELETE',
        headers: {
          ...baseHeaders,
          'MCP-Protocol-Version': protocolVersion,
          'MCP-Session-Id': sessionId,
        },
      }).then((response) => response.arrayBuffer());
    }
    console.log('PHASE3_LIVE_CALL_OK tool=trademark_country_list');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE3_LIVE_CALL_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
