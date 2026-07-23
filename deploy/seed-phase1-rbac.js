const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { PrincipalType, SystemRoles } = require('librechat-data-provider');

const verifyOnly = process.argv.includes('--verify');
const phase3SellerSpriteEnabled = process.env.PHASE3_SELLERSPRITE_ENABLED === 'true';

const deniedCapabilities = {
  AGENTS: { USE: false, CREATE: false, SHARE: false, SHARE_PUBLIC: false },
  MEMORIES: { USE: false, CREATE: false, UPDATE: false, READ: false, OPT_OUT: false },
  RUN_CODE: { USE: false },
  WEB_SEARCH: { USE: false },
  MARKETPLACE: { USE: false },
  FILE_SEARCH: { USE: false },
  FILE_CITATIONS: { USE: false },
  MCP_SERVERS: {
    USE: false,
    CREATE: false,
    SHARE: false,
    SHARE_PUBLIC: false,
    CONFIGURE_OBO: false,
  },
  REMOTE_AGENTS: { USE: false, CREATE: false, SHARE: false, SHARE_PUBLIC: false },
  SKILLS: { USE: false, CREATE: false, SHARE: false, SHARE_PUBLIC: false },
  SHARED_LINKS: { CREATE: false, SHARE: false, SHARE_PUBLIC: false },
};

const permissions = ({ promptCreate, multiConvo, temporaryChat, peoplePicker, mcpUse = false }) => ({
  ...deniedCapabilities,
  BOOKMARKS: { USE: true },
  PROMPTS: {
    USE: promptCreate,
    CREATE: promptCreate,
    SHARE: false,
    SHARE_PUBLIC: false,
  },
  MULTI_CONVO: { USE: multiConvo },
  TEMPORARY_CHAT: { USE: temporaryChat },
  PEOPLE_PICKER: {
    VIEW_USERS: peoplePicker,
    VIEW_GROUPS: peoplePicker,
    VIEW_ROLES: peoplePicker,
  },
  MCP_SERVERS: {
    USE: mcpUse,
    CREATE: false,
    SHARE: false,
    SHARE_PUBLIC: false,
    CONFIGURE_OBO: false,
  },
});

const roles = [
  {
    name: 'admin',
    description: '业务管理员；可进入管理面板管理角色与部门，高成本、Agent、MCP 与写工具保持关闭。',
    permissions: permissions({
      promptCreate: true,
      multiConvo: true,
      temporaryChat: true,
      peoplePicker: true,
      mcpUse: phase3SellerSpriteEnabled,
    }),
  },
  {
    name: 'technical',
    description: '技术部成员；Phase 1 仅开放基础会话与提示词，不开放 Agent、MCP 或高成本工具。',
    permissions: permissions({
      promptCreate: true,
      multiConvo: true,
      temporaryChat: true,
      peoplePicker: false,
      mcpUse: false,
    }),
  },
  {
    name: 'operation',
    description: '运营部成员；Phase 1 仅开放基础会话与提示词。',
    permissions: permissions({
      promptCreate: true,
      multiConvo: true,
      temporaryChat: true,
      peoplePicker: false,
      mcpUse: phase3SellerSpriteEnabled,
    }),
  },
  {
    name: 'advertising',
    description: '广告组成员；Phase 1 仅开放基础会话与提示词。',
    permissions: permissions({
      promptCreate: true,
      multiConvo: true,
      temporaryChat: true,
      peoplePicker: false,
      mcpUse: phase3SellerSpriteEnabled,
    }),
  },
  {
    name: 'finance',
    description: '财务组成员；Phase 1 仅保留基础只读能力。',
    permissions: permissions({
      promptCreate: false,
      multiConvo: false,
      temporaryChat: false,
      peoplePicker: false,
      mcpUse: false,
    }),
  },
  {
    name: 'viewer',
    description: '只读访客；不开放提示词创建、Agent、MCP、高成本或写工具。',
    permissions: permissions({
      promptCreate: false,
      multiConvo: false,
      temporaryChat: false,
      peoplePicker: false,
      mcpUse: false,
    }),
  },
];

const groups = [
  ['管理层', '业务管理与平台治理部门。'],
  ['技术部', '平台技术与集成部门。'],
  ['运营部', '跨境电商运营部门。'],
  ['广告组', '广告投放与优化部门。'],
  ['财务组', '财务与成本核算部门。'],
  ['只读访客', '仅查看已授权内容的访客部门。'],
];

const adminCapabilities = [
  'access:admin',
  'read:users',
  'manage:groups',
  'manage:roles',
  'read:configs',
  'read:usage',
  'read:audit_log',
];

async function seed() {
  await db.seedDatabase();
  const { Role, Group, User } = models;

  for (const role of roles) {
    await Role.updateOne(
      { name: role.name, tenantId: { $exists: false } },
      { $set: role, $unset: { tenantId: '' } },
      { upsert: true },
    );
  }

  const now = new Date();
  for (const [name, description] of groups) {
    await Group.updateOne(
      { name, source: 'local', tenantId: { $exists: false } },
      {
        $set: { description, updatedAt: now },
        $setOnInsert: { name, source: 'local', memberIds: [], createdAt: now },
        $unset: { tenantId: '' },
      },
      { upsert: true },
    );
  }

  const systemAdmin = await User.findOne({ role: SystemRoles.ADMIN }).sort({ _id: 1 }).lean();
  if (!systemAdmin) {
    throw new Error('No system ADMIN user exists. Run the official create-user CLI first.');
  }

  const adminMemberId = systemAdmin.idOnTheSource || systemAdmin._id.toString();
  await Group.updateOne(
    { name: '管理层', source: 'local', tenantId: { $exists: false } },
    { $addToSet: { memberIds: adminMemberId } },
  );

  for (const capability of adminCapabilities) {
    await db.grantCapability({
      principalType: PrincipalType.ROLE,
      principalId: 'admin',
      capability,
      grantedBy: systemAdmin._id,
    });
  }
}

async function verify() {
  const { Role, Group, User, SystemGrant } = models;
  const roleNames = roles.map(({ name }) => name);
  const groupNames = groups.map(([name]) => name);
  const foundRoles = await Role.find({ name: { $in: roleNames }, tenantId: { $exists: false } })
    .select('name permissions')
    .lean();
  const foundGroups = await Group.find({
    name: { $in: groupNames },
    source: 'local',
    tenantId: { $exists: false },
  })
    .select('name memberIds')
    .lean();
  const systemAdmin = await User.findOne({ role: SystemRoles.ADMIN }).select('_id').lean();
  const grants = await SystemGrant.find({
    principalType: PrincipalType.ROLE,
    principalId: 'admin',
    capability: { $in: adminCapabilities },
    tenantId: { $exists: false },
  }).lean();

  if (foundRoles.length !== roles.length) {
    throw new Error(`Expected ${roles.length} custom roles, found ${foundRoles.length}.`);
  }
  if (foundGroups.length !== groups.length) {
    throw new Error(`Expected ${groups.length} local groups, found ${foundGroups.length}.`);
  }
  if (!systemAdmin) {
    throw new Error('System ADMIN user is missing.');
  }
  if (grants.length !== adminCapabilities.length) {
    throw new Error(`Expected ${adminCapabilities.length} admin grants, found ${grants.length}.`);
  }

  const expectedMcpRoles = new Set(
    phase3SellerSpriteEnabled ? ['admin', 'operation', 'advertising'] : [],
  );
  for (const role of foundRoles) {
    if (role.permissions?.AGENTS?.USE) {
      throw new Error(`Agent permission unexpectedly enabled for role ${role.name}.`);
    }
    if (Boolean(role.permissions?.MCP_SERVERS?.USE) !== expectedMcpRoles.has(role.name)) {
      throw new Error(`SellerSprite MCP permission mismatch for role ${role.name}.`);
    }
  }

  console.log(`PHASE1_RBAC_OK roles=${foundRoles.length} groups=${foundGroups.length} grants=${grants.length}`);
}

(async () => {
  try {
    await connect();
    if (!verifyOnly) {
      await seed();
    }
    await verify();
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE1_RBAC_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
