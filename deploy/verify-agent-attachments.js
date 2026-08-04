const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const XLSX = require('xlsx');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const baseUrl = 'http://127.0.0.1:3080';
const marker = `WODA_ATTACHMENT_OK_${Date.now()}`;
const agentIds = (process.env.TEST_AGENT_IDS ??
  'agent_woda-amazon-market-analysis,agent_woda-cross-border-integrated-diagnosis')
  .split(',')
  .map((agentId) => agentId.trim())
  .filter(Boolean);
const testUserId = process.env.TEST_USER_ID;

function browserHeaders(token, headers = {}) {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    ...headers,
  };
}

function createWorkbook() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Verification marker', 'Expected response'],
    [marker, marker],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attachment Test');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

function localFilePath(filepath) {
  if (!filepath?.startsWith('/uploads/')) {
    return null;
  }
  const root = path.resolve('/app/uploads');
  const resolved = path.resolve('/app', ...filepath.split('/').filter(Boolean));
  return resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

async function uploadAttachment({ token, agentId, workbook }) {
  const fileId = crypto.randomUUID();
  const form = new FormData();
  form.append('endpoint', 'agents');
  form.append('agent_id', agentId);
  form.append('message_file', 'true');
  form.append('file_id', fileId);
  form.append(
    'file',
    new Blob([workbook], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'attachment-verification.xlsx',
  );

  const response = await fetch(`${baseUrl}/api/files`, {
    method: 'POST',
    headers: browserHeaders(token),
    body: form,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`upload for ${agentId} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const result = JSON.parse(body);
  const stored = await models.File.findOne({ file_id: result.file_id ?? fileId }).lean();
  if (!stored) {
    throw new Error(`upload for ${agentId} did not create a file record`);
  }
  if (stored.source !== 'local' || stored.textFormat !== 'text' || !stored.text?.includes(marker)) {
    throw new Error(`upload for ${agentId} did not preserve and extract the workbook`);
  }
  return stored;
}

async function waitForReply(conversationId) {
  const deadline = Date.now() + 120_000;
  let reply;
  while (Date.now() < deadline) {
    reply = await models.Message.findOne({ conversationId, isCreatedByUser: false })
      .sort({ createdAt: -1 })
      .lean();
    const output = JSON.stringify({ text: reply?.text, content: reply?.content });
    if (reply?.error) {
      throw new Error(`Agent response failed: ${output.slice(0, 300)}`);
    }
    if (output.includes(marker)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Agent response timed out without the workbook marker: ${JSON.stringify({ text: reply?.text, content: reply?.content }).slice(0, 300)}`,
  );
}

async function verifyAgent({ token, agentId, workbook, cleanup }) {
  const stored = await uploadAttachment({ token, agentId, workbook });
  cleanup.files.push(stored);

  const messageId = crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/agents/chat/agents`, {
    method: 'POST',
    headers: browserHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      text: '读取附件中 Expected response 列的值，只回复该值，不要调用任何工具。',
      sender: 'User',
      isCreatedByUser: true,
      parentMessageId: '00000000-0000-0000-0000-000000000000',
      messageId,
      responseMessageId: `${messageId}_`,
      conversationId: null,
      endpoint: 'agents',
      agent_id: agentId,
      files: [
        {
          file_id: stored.file_id,
          filepath: stored.filepath,
          type: stored.type,
        },
      ],
      isRegenerate: false,
      isContinued: false,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`chat for ${agentId} returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  const start = JSON.parse(body);
  const conversationId = start.streamId ?? start.conversationId;
  if (!conversationId) {
    throw new Error(`chat for ${agentId} returned no stream id`);
  }
  cleanup.conversationIds.push(conversationId);
  await waitForReply(conversationId);
  console.log(`AGENT_ATTACHMENT_OK agent=${agentId} source=local textFormat=text`);
}

async function cleanupArtifacts(cleanup) {
  if (cleanup.conversationIds.length > 0) {
    await Promise.all([
      models.Conversation.deleteMany({ conversationId: { $in: cleanup.conversationIds } }),
      models.Message.deleteMany({ conversationId: { $in: cleanup.conversationIds } }),
    ]).catch(() => undefined);
  }
  if (cleanup.files.length > 0) {
    await models.File.deleteMany({ file_id: { $in: cleanup.files.map((file) => file.file_id) } }).catch(
      () => undefined,
    );
    await Promise.all(
      cleanup.files.map((file) => {
        const filepath = localFilePath(file.filepath);
        return filepath ? fs.unlink(filepath).catch(() => undefined) : undefined;
      }),
    );
  }
}

(async () => {
  const cleanup = { files: [], conversationIds: [] };
  try {
    await connect();
    const user = testUserId
      ? await models.User.findById(testUserId)
      : await models.User.findOne({ role: SystemRoles.USER }).sort({ _id: -1 });
    if (!user) {
      throw new Error('A USER account is required for attachment verification');
    }
    const token = await db.generateToken(user, 5 * 60 * 1000);
    const workbook = createWorkbook();
    for (const agentId of agentIds) {
      await verifyAgent({ token, agentId, workbook, cleanup });
    }
  } catch (error) {
    console.error(`AGENT_ATTACHMENT_ERROR ${error.message}`);
    process.exitCode = 1;
  } finally {
    await cleanupArtifacts(cleanup);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }
})();
