const express = require('express');
const bcrypt = require('bcryptjs');
const { createAdminUsersHandlers } = require('@librechat/api');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { getAppConfig } = require('~/server/services/Config');
const { requireJwtAuth } = require('~/server/middleware');
const db = require('~/models');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);
const requireReadUsers = requireCapability(SystemCapabilities.READ_USERS);
const requireManageUsers = requireCapability(SystemCapabilities.MANAGE_USERS);
const requireManageRoles = requireCapability(SystemCapabilities.MANAGE_ROLES);
const requireManageGroups = requireCapability(SystemCapabilities.MANAGE_GROUPS);

const handlers = createAdminUsersHandlers({
  findUsers: db.findUsers,
  countUsers: db.countUsers,
  findUser: db.findUser,
  createUser: async (data) => {
    const appConfig = await getAppConfig();
    return db.createUser(data, appConfig.balance, true, true);
  },
  hashPassword: (password) => bcrypt.hash(password, 10),
  getRoleByName: db.getRoleByName,
  findGroupById: db.findGroupById,
  addUserToGroup: db.addUserToGroup,
  minPasswordLength: parseInt(process.env.MIN_PASSWORD_LENGTH, 10) || 8,
  deleteUserById: db.deleteUserById,
  deleteConfig: db.deleteConfig,
  deleteAclEntries: db.deleteAclEntries,
});

router.use(requireJwtAuth, requireAdminAccess);

router.get('/', requireReadUsers, handlers.listUsers);
router.post('/', requireManageUsers, requireManageRoles, requireManageGroups, handlers.createUser);
router.get('/search', requireReadUsers, handlers.searchUsers);
// router.delete('/:id', requireManageUsers, handlers.deleteUser);

module.exports = router;
