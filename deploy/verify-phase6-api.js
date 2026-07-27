const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');
const { AGENT_DEFINITIONS } = require('/app/deploy/phase6-tool-catalog.js');

const baseUrl = 'http://127.0.0.1:3080';
const skillNames = AGENT_DEFINITIONS.map((definition) => definition.skillName);
const agentIds = AGENT_DEFINITIONS.map((definition) => definition.id);

async function request(token, route) {
  return fetch(`${baseUrl}${route}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    },
  });
}

function listData(body, key) {
  if (Array.isArray(body)) return body;
  return body[key] ?? body.data ?? [];
}

(async () => {
  try {
    await connect();
    const { User } = models;
    const viewer = await User.findOne({ role: SystemRoles.USER }).sort({ _id: 1 });
    if (!viewer) throw new Error('A USER account is required for API verification');
    const viewerToken = await db.generateToken(viewer, 5 * 60 * 1000);

    const skillsResponse = await request(viewerToken, '/api/skills?limit=100');
    if (!skillsResponse.ok) {
      throw new Error(`Viewer skill list returned HTTP ${skillsResponse.status}`);
    }
    const skills = listData(await skillsResponse.json(), 'skills');
    const managedSkills = skills.filter((skill) => skillNames.includes(skill.name));
    if (managedSkills.length !== skillNames.length) {
      throw new Error(`Viewer sees ${managedSkills.length}/${skillNames.length} Phase 6 skills`);
    }
    for (const summary of managedSkills) {
      if (summary.executionOnly !== true || Object.hasOwn(summary, 'body')) {
        throw new Error(`Unsafe skill summary for "${summary.name}"`);
      }
      const detailResponse = await request(viewerToken, `/api/skills/${summary._id}`);
      if (!detailResponse.ok) {
        throw new Error(`Viewer skill detail returned HTTP ${detailResponse.status}`);
      }
      const detail = await detailResponse.json();
      if (
        detail.bodyRedacted !== true ||
        detail.body !== '' ||
        detail.frontmatter !== undefined ||
        detail.sourceMetadata !== undefined
      ) {
        throw new Error(`Viewer detail for "${summary.name}" exposes restricted fields`);
      }
    }

    const agentsResponse = await request(viewerToken, '/api/agents?limit=100');
    if (!agentsResponse.ok) {
      throw new Error(`Viewer agent list returned HTTP ${agentsResponse.status}`);
    }
    const agents = listData(await agentsResponse.json(), 'agents');
    const managedAgents = agents.filter((agent) => agentIds.includes(agent.id));
    if (managedAgents.length !== agentIds.length) {
      throw new Error(`Viewer sees ${managedAgents.length}/${agentIds.length} Phase 6 agents`);
    }

    console.log(
      `PHASE6_API_OK viewerSkills=${managedSkills.length} viewerAgents=${managedAgents.length} redaction=ok`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE6_API_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
