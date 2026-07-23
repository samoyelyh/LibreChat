const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

async function requestConversation(userId, conversationId) {
  const token = jwt.sign({ id: userId.toString() }, process.env.JWT_SECRET, { expiresIn: '2m' });
  const response = await fetch(`http://127.0.0.1:3080/api/convos/${conversationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.status;
}

(async () => {
  let conversationId;
  try {
    await connect();
    const { User, Conversation } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).select('_id').lean();
    const regularUser = await User.findOne({ role: { $ne: SystemRoles.ADMIN } })
      .select('_id role')
      .lean();
    if (!admin || !regularUser) {
      throw new Error('Isolation verification requires one ADMIN and one non-admin user.');
    }
    if (regularUser.role === SystemRoles.ADMIN) {
      throw new Error('The second verification user unexpectedly has ADMIN role.');
    }

    conversationId = `phase1-isolation-${crypto.randomUUID()}`;
    await Conversation.create({
      conversationId,
      title: 'Phase 1 isolation verification',
      user: regularUser._id.toString(),
      endpoint: 'openAI',
      model: 'phase1-disabled-fixture',
    });

    const unauthorizedStatus = await requestConversation(admin._id, conversationId);
    const ownerStatus = await requestConversation(regularUser._id, conversationId);
    if (unauthorizedStatus !== 404 || ownerStatus !== 200) {
      throw new Error(
        `Conversation isolation failed: other=${unauthorizedStatus}, owner=${ownerStatus}.`,
      );
    }

    console.log('PHASE1_ISOLATION_OK other=404 owner=200 second_user_role=non_admin');
  } catch (error) {
    console.error(`PHASE1_ISOLATION_ERROR ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (conversationId) {
      // Use the native collection to avoid search-index post hooks keeping this
      // one-shot verifier alive after the HTTP assertions have completed.
      await mongoose.connection
        .collection('conversations')
        .deleteOne({ conversationId })
        .catch(() => undefined);
    }
    await Promise.race([
      mongoose.disconnect().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    // Node's built-in fetch may retain an undici keep-alive socket. This is a
    // one-shot verification process, so exit explicitly after fixture cleanup.
    process.exit(process.exitCode || 0);
  }
})();
