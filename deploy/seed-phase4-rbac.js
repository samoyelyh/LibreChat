const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const verifyOnly = process.argv.includes('--verify');
const enabled = process.env.PHASE4_LINGXING_ENABLED === 'true';
const allowedCustomRoles = new Set(enabled ? ['admin', 'operation', 'advertising', 'finance'] : []);
const customRoles = ['admin', 'technical', 'operation', 'advertising', 'finance', 'viewer'];

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
    { $set: { 'permissions.MCP_SERVERS': permissionsFor(enabled) } },
  );
  await Role.updateOne(
    { name: SystemRoles.USER, tenantId: { $exists: false } },
    { $set: { 'permissions.MCP_SERVERS': permissionsFor(false) } },
  );
  for (const name of customRoles) {
    await Role.updateOne(
      { name, tenantId: { $exists: false } },
      { $set: { 'permissions.MCP_SERVERS': permissionsFor(allowedCustomRoles.has(name)) } },
    );
  }
}

async function verify() {
  const { Role } = models;
  const roles = await Role.find({
    name: { $in: [SystemRoles.ADMIN, SystemRoles.USER, ...customRoles] },
    tenantId: { $exists: false },
  })
    .select('name permissions.MCP_SERVERS')
    .lean();
  const expected = new Map([
    [SystemRoles.ADMIN, enabled],
    [SystemRoles.USER, false],
    ...customRoles.map((name) => [name, allowedCustomRoles.has(name)]),
  ]);
  if (roles.length !== expected.size) throw new Error(`Expected ${expected.size} roles, found ${roles.length}`);
  for (const role of roles) {
    const actual = role.permissions?.MCP_SERVERS;
    if (
      Boolean(actual?.USE) !== expected.get(role.name) ||
      actual?.CREATE ||
      actual?.SHARE ||
      actual?.SHARE_PUBLIC ||
      actual?.CONFIGURE_OBO
    ) {
      throw new Error(`MCP permission mismatch for role ${role.name}`);
    }
  }
  console.log(`PHASE4_RBAC_OK enabled=${enabled} roles=${roles.length}`);
}

(async () => {
  try {
    await connect();
    if (!verifyOnly) await seed();
    await verify();
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE4_RBAC_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
