async function migrateAgentReferences(models, oldId, newId) {
  const { Action, Agent, Conversation, Message, Preset, User } = models;

  await Promise.all([
    Conversation.updateMany({ agent_id: oldId }, { $set: { agent_id: newId } }),
    Message.updateMany({ endpoint: 'agents', model: oldId }, { $set: { model: newId } }),
    Preset.updateMany({ agent_id: oldId }, { $set: { agent_id: newId } }),
    Action.updateMany({ agent_id: oldId }, { $set: { agent_id: newId } }),
    User.updateMany(
      { 'favorites.agentId': oldId },
      { $set: { 'favorites.$[favorite].agentId': newId } },
      { arrayFilters: [{ 'favorite.agentId': oldId }] },
    ),
    Agent.updateMany(
      { agent_ids: oldId },
      { $set: { 'agent_ids.$[agentId]': newId } },
      { arrayFilters: [{ agentId: oldId }] },
    ),
    Agent.updateMany(
      { 'subagents.agent_ids': oldId },
      { $set: { 'subagents.agent_ids.$[agentId]': newId } },
      { arrayFilters: [{ agentId: oldId }] },
    ),
    Agent.updateMany(
      { 'edges.to': oldId },
      { $set: { 'edges.$[edge].to': newId } },
      { arrayFilters: [{ 'edge.to': oldId }] },
    ),
  ]);
}

async function migrateManagedAgent({ models, oldIds, newId }) {
  if (!newId.startsWith('agent_')) {
    throw new Error(`Managed agent id must start with "agent_": ${newId}`);
  }

  const { Agent } = models;
  const existing = await Agent.findOne({ id: newId }).lean();
  if (existing) {
    for (const oldId of oldIds ?? []) {
      await migrateAgentReferences(models, oldId, newId);
    }
    return existing;
  }

  const legacyAgent = await Agent.findOne({ id: { $in: oldIds ?? [] } }).lean();
  if (!legacyAgent) {
    return null;
  }

  const oldId = legacyAgent.id;
  const result = await Agent.updateOne({ _id: legacyAgent._id }, { $set: { id: newId } });
  if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
    throw new Error(`Could not migrate managed agent "${oldId}" to "${newId}"`);
  }

  for (const legacyId of oldIds ?? [oldId]) {
    await migrateAgentReferences(models, legacyId, newId);
  }
  return Agent.findOne({ _id: legacyAgent._id }).lean();
}

module.exports = { migrateManagedAgent };
