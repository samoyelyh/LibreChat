const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const baseUrl = 'http://127.0.0.1:3080';
const agentId = process.env.TEST_AGENT_ID ?? 'agent_woda-cross-border-integrated-diagnosis';
const testUserId = process.env.TEST_USER_ID;

async function request(token, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      ...options.headers,
    },
  });
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function messageText(message) {
  return JSON.stringify({ text: message?.text, content: message?.content });
}

(async () => {
  let conversationId;
  try {
    await connect();
    const { User } = models;
    const user = testUserId
      ? await User.findById(testUserId)
      : await User.findOne({ role: SystemRoles.USER }).sort({ _id: -1 });
    if (!user) throw new Error('A USER account is required for agent chat verification');

    const token = await db.generateToken(user, 5 * 60 * 1000);
    const messageId = crypto.randomUUID();
    const response = await request(token, '/api/agents/chat/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: '这是连接回归测试。请只回复“智能体已连接”，不要调用任何工具。',
        sender: 'User',
        isCreatedByUser: true,
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        messageId,
        responseMessageId: `${messageId}_`,
        conversationId: null,
        endpoint: 'agents',
        agent_id: agentId,
        isRegenerate: false,
        isContinued: false,
      }),
    });
    const startText = await response.text();
    if (!response.ok) {
      throw new Error(`Chat start returned HTTP ${response.status}: ${startText.slice(0, 300)}`);
    }

    const start = JSON.parse(startText);
    conversationId = start.streamId ?? start.conversationId;
    if (!conversationId) throw new Error('Chat start returned no stream id');

    const deadline = Date.now() + 90_000;
    let reply = null;
    while (Date.now() < deadline) {
      reply = await models.Message.findOne({
        conversationId,
        isCreatedByUser: false,
      })
        .sort({ createdAt: -1 })
        .lean();
      const text = messageText(reply);
      if (/missing_model|no model selected|未选择.*模型/i.test(text)) {
        throw new Error('Agent stream still reports a missing model');
      }
      if (reply?.error) throw new Error(`Agent response failed: ${text.slice(0, 300)}`);
      if (text.includes('智能体已连接')) break;
      await delay(500);
    }
    if (!messageText(reply).includes('智能体已连接')) {
      throw new Error('Agent response timed out without the expected content');
    }

    console.log(`AGENT_CHAT_OK agent=${agentId} response=智能体已连接`);
  } catch (error) {
    console.error(`AGENT_CHAT_ERROR ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (conversationId) {
      await Promise.all([
        models.Conversation.deleteMany({ conversationId }),
        models.Message.deleteMany({ conversationId }),
      ]).catch(() => undefined);
    }
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }
})();
