const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const verifyOnly = process.argv.includes('--verify');
const enabled = process.env.PHASE3_SELLERSPRITE_ENABLED === 'true';
const phase4Enabled = process.env.PHASE4_LINGXING_ENABLED === 'true';
const mcpEnabled = enabled || phase4Enabled;
const allowedCustomRoles = new Set([
  ...(enabled ? ['admin', 'operation', 'advertising'] : []),
  ...(phase4Enabled ? ['admin', 'operation', 'advertising', 'finance'] : []),
]);
const customRoles = ['admin', 'technical', 'operation', 'advertising', 'finance', 'viewer'];
const departments = ['管理层', '技术部', '运营部', '广告组', '财务组', '只读访客'];

const permissionsFor = (use) => ({
  USE: use,
  CREATE: false,
  SHARE: false,
  SHARE_PUBLIC: false,
  CONFIGURE_OBO: false,
});

async function seed() {
  await db.seedDatabase();
  const { Role } = models;
  await Role.updateOne(
    { name: SystemRoles.ADMIN, tenantId: { $exists: false } },
    { $set: { 'permissions.MCP_SERVERS': permissionsFor(mcpEnabled) } },
  );
  await Role.updateOne(
    { name: SystemRoles.USER, tenantId: { $exists: false } },
    { $set: { 'permissions.MCP_SERVERS': permissionsFor(mcpEnabled) } },
  );
  for (const name of customRoles) {
    await Role.updateOne(
      { name, tenantId: { $exists: false } },
      { $set: { 'permissions.MCP_SERVERS': permissionsFor(allowedCustomRoles.has(name)) } },
    );
  }
}

async function verify() {
  const { Role, Group } = models;
  const roles = await Role.find({
    name: { $in: [SystemRoles.ADMIN, SystemRoles.USER, ...customRoles] },
    tenantId: { $exists: false },
  })
    .select('name permissions.MCP_SERVERS')
    .lean();
  const expected = new Map([
    [SystemRoles.ADMIN, mcpEnabled],
    [SystemRoles.USER, mcpEnabled],
    ...customRoles.map((name) => [name, allowedCustomRoles.has(name)]),
  ]);
  if (roles.length !== expected.size) {
    throw new Error(`Expected ${expected.size} roles, found ${roles.length}.`);
  }
  for (const role of roles) {
    const actual = role.permissions?.MCP_SERVERS;
    if (
      Boolean(actual?.USE) !== expected.get(role.name) ||
      actual?.CREATE ||
      actual?.SHARE ||
      actual?.SHARE_PUBLIC ||
      actual?.CONFIGURE_OBO
    ) {
      throw new Error(`MCP permission mismatch for role ${role.name}.`);
    }
  }
  const groupCount = await Group.countDocuments({
    name: { $in: departments },
    source: 'local',
    tenantId: { $exists: false },
  });
  if (groupCount !== departments.length) {
    throw new Error(`Expected ${departments.length} department groups, found ${groupCount}.`);
  }
  console.log(
    `PHASE3_RBAC_OK enabled=${enabled} phase4Enabled=${phase4Enabled} roles=${roles.length} departments=${groupCount}`,
  );
}

(async () => {
  try {
    await connect();
    if (!verifyOnly) await seed();
    await verify();
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE3_RBAC_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
