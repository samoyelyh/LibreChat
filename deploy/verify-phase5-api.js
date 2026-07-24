const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const baseUrl = 'http://127.0.0.1:3080';
const skillNames = ['amazon-fba-capacity-expansion', 'amazon-listing-competitor-research'];
const agentIds = ['woda-amazon-fba-capacity-expansion', 'woda-amazon-listing-competitor-research'];

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

function findSkillList(body) {
  if (Array.isArray(body)) {
    return body;
  }
  return body.skills ?? body.data ?? [];
}

(async () => {
  try {
    await connect();
    const { User } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).sort({ _id: 1 });
    const viewer = await User.findOne({ role: SystemRoles.USER }).sort({ _id: 1 });
    if (!admin || !viewer) {
      throw new Error('Both ADMIN and USER accounts are required for API verification');
    }
    const [adminToken, viewerToken] = await Promise.all([
      db.generateToken(admin, 5 * 60 * 1000),
      db.generateToken(viewer, 5 * 60 * 1000),
    ]);

    const listResponse = await request(viewerToken, '/api/skills?limit=100');
    if (!listResponse.ok) {
      throw new Error(`Viewer skill list returned HTTP ${listResponse.status}`);
    }
    const listedSkills = findSkillList(await listResponse.json());
    const managedSkills = listedSkills.filter((skill) => skillNames.includes(skill.name));
    if (managedSkills.length !== skillNames.length) {
      throw new Error(`Viewer sees ${managedSkills.length}/${skillNames.length} managed skills`);
    }

    for (const summary of managedSkills) {
      if (summary.executionOnly !== true || Object.hasOwn(summary, 'body')) {
        throw new Error(`Unsafe skill summary for "${summary.name}"`);
      }
      const [viewerDetailResponse, viewerFilesResponse, viewerBodyResponse, adminDetailResponse] =
        await Promise.all([
          request(viewerToken, `/api/skills/${summary._id}`),
          request(viewerToken, `/api/skills/${summary._id}/files`),
          request(viewerToken, `/api/skills/${summary._id}/files/SKILL.md`),
          request(adminToken, `/api/skills/${summary._id}`),
        ]);
      if (!viewerDetailResponse.ok) {
        throw new Error(
          `Viewer detail for "${summary.name}" returned HTTP ${viewerDetailResponse.status}`,
        );
      }
      const viewerDetail = await viewerDetailResponse.json();
      if (
        viewerDetail.executionOnly !== true ||
        viewerDetail.bodyRedacted !== true ||
        viewerDetail.body !== '' ||
        viewerDetail.frontmatter !== undefined ||
        viewerDetail.sourceMetadata !== undefined
      ) {
        throw new Error(`Viewer detail for "${summary.name}" exposes restricted fields`);
      }
      const viewerPatchResponse = await request(viewerToken, `/api/skills/${summary._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: viewerDetail.version,
          executionOnly: false,
        }),
      });
      if (viewerPatchResponse.status !== 403) {
        throw new Error(`Viewer can change execution-only protection for "${summary.name}"`);
      }
      if (viewerFilesResponse.status !== 403 || viewerBodyResponse.status !== 403) {
        throw new Error(`Viewer file access for "${summary.name}" is not denied`);
      }
      if (!adminDetailResponse.ok) {
        throw new Error(
          `Admin detail for "${summary.name}" returned HTTP ${adminDetailResponse.status}`,
        );
      }
      const adminDetail = await adminDetailResponse.json();
      if (!adminDetail.body || adminDetail.bodyRedacted === true) {
        throw new Error(`Admin detail for "${summary.name}" is unexpectedly redacted`);
      }
    }

    const agentsResponse = await request(viewerToken, '/api/agents?limit=100');
    if (!agentsResponse.ok) {
      throw new Error(`Viewer agent list returned HTTP ${agentsResponse.status}`);
    }
    const agentsBody = await agentsResponse.json();
    const agents = Array.isArray(agentsBody) ? agentsBody : (agentsBody.data ?? []);
    const managedAgents = agents.filter((agent) => agentIds.includes(agent.id));
    if (managedAgents.length !== agentIds.length) {
      throw new Error(`Viewer sees ${managedAgents.length}/${agentIds.length} managed agents`);
    }

    console.log(
      `PHASE5_API_OK viewerSkills=${managedSkills.length} viewerAgents=${managedAgents.length} redaction=ok`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE5_API_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
