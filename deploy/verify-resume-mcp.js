const mongoose = require('mongoose');
const { signedHeaders } = require('/app/deploy/gateway-signing.js');

const url = 'http://resume-mcp-gateway:4400/mcp';
const secret = process.env.RESUME_MCP_INTERNAL_KEY;
const readTools = new Set([
  'parse_resume',
  'get_candidate',
  'search_candidates',
  'get_candidate_missing_fields',
  'generate_followup',
  'list_parsing_templates',
]);
const writeTools = ['update_candidate_fields', 'record_candidate_reply'];

function headers(user) {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2025-06-18',
    'X-LibreChat-User-ID': String(user._id),
    'X-LibreChat-User-Email': user.email,
    'X-LibreChat-User-Role': user.role,
  };
}

async function post(user, body) {
  const text = JSON.stringify(body);
  return fetch(url, {
    method: 'POST',
    headers: signedHeaders({
      secret,
      url,
      method: 'POST',
      body: text,
      headers: headers(user),
    }),
    body: text,
  });
}

function payload(text) {
  const line = text.split(/\r?\n/).find((value) => value.startsWith('data:'));
  return JSON.parse(line ? line.slice(5).trim() : text);
}

(async () => {
  try {
    if (!secret) throw new Error('RESUME_MCP_INTERNAL_KEY is missing');
    await mongoose.connect(process.env.MONGO_URI);
    const users = mongoose.connection.db.collection('users');
    const groups = mongoose.connection.db.collection('groups');
    const admin = await users.findOne({ role: 'ADMIN' });
    const operationsGroup = await groups.findOne({ name: '运营部', source: 'local' });
    const operationsIds = operationsGroup?.memberIds ?? [];
    const objectIds = operationsIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const operations = await users.findOne({
      $or: [{ _id: { $in: objectIds } }, { idOnTheSource: { $in: operationsIds } }],
    });
    if (!admin || !operations) throw new Error('ADMIN and operations verification users are required');

    const initialize = {
      jsonrpc: '2.0',
      id: 'resume-init',
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'woda-resume-verifier', version: '1.0.0' },
      },
    };
    const allowed = await post(admin, initialize);
    if (!allowed.ok) throw new Error(`ADMIN initialize returned HTTP ${allowed.status}`);
    await allowed.arrayBuffer();

    const denied = await post(operations, initialize);
    await denied.arrayBuffer();
    if (denied.status !== 403) throw new Error(`Operations initialize returned HTTP ${denied.status}`);

    const listed = await post(admin, {
      jsonrpc: '2.0',
      id: 'resume-tools',
      method: 'tools/list',
      params: {},
    });
    const listedPayload = payload(await listed.text());
    const tools = (listedPayload.result?.tools ?? []).map((tool) => tool.name);
    if (!listed.ok || tools.length !== readTools.size || tools.some((tool) => !readTools.has(tool))) {
      throw new Error(`Filtered tool catalog is invalid: HTTP ${listed.status}, count=${tools.length}`);
    }

    const safeRead = await post(admin, {
      jsonrpc: '2.0',
      id: 'resume-safe-read',
      method: 'tools/call',
      params: { name: 'list_parsing_templates', arguments: {} },
    });
    const safeReadPayload = payload(await safeRead.text());
    if (!safeRead.ok || safeReadPayload.error) {
      throw new Error(`Safe read tool failed: HTTP ${safeRead.status}`);
    }

    for (const tool of writeTools) {
      const response = await post(admin, {
        jsonrpc: '2.0',
        id: `deny-${tool}`,
        method: 'tools/call',
        params: { name: tool, arguments: {} },
      });
      await response.arrayBuffer();
      if (response.status !== 403) throw new Error(`${tool} was not denied`);
    }

    console.log('RESUME_MCP_OK reads=6 live_read=passed writes=denied operations=denied');
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`RESUME_MCP_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
