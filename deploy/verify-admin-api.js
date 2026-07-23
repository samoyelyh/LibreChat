const path = require('path');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const requiredDisabled = [
  ['memories'],
  ['runCode'],
  ['webSearch'],
  ['agents', 'use'],
  ['remoteAgents', 'use'],
  ['skills'],
  ['sharedLinks'],
];
const phase3SellerSpriteEnabled = process.env.PHASE3_SELLERSPRITE_ENABLED === 'true';

const readPath = (value, keys) => keys.reduce((current, key) => current?.[key], value);

(async () => {
  try {
    await connect();
    const admin = await models.User.findOne({ role: SystemRoles.ADMIN }).select('_id').lean();
    if (!admin) {
      throw new Error('System ADMIN user is missing.');
    }

    const token = jwt.sign({ id: admin._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: '2m',
    });
    const request = async (route) =>
      fetch(`http://127.0.0.1:3080${route}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

    const routes = [
      '/api/admin/users',
      '/api/admin/roles',
      '/api/admin/groups',
      '/api/admin/config/base',
    ];
    for (const route of routes) {
      const response = await request(route);
      if (response.status !== 200) {
        throw new Error(`${route} returned HTTP ${response.status}.`);
      }
      await response.arrayBuffer();
    }

    const configResponse = await request('/api/config');
    if (configResponse.status !== 200) {
      throw new Error(`/api/config returned HTTP ${configResponse.status}.`);
    }
    const config = await configResponse.json();
    for (const keys of requiredDisabled) {
      if (readPath(config.interface, keys) !== false) {
        throw new Error(`Runtime feature gate interface.${keys.join('.')} is not false.`);
      }
    }
    const mcpUse = readPath(config.interface, ['mcpServers', 'use']);
    if (!phase3SellerSpriteEnabled && mcpUse !== false) {
      throw new Error('Phase 1 requires interface.mcpServers.use=false.');
    }
    console.log(
      `PHASE1_ADMIN_API_OK users=200 roles=200 groups=200 config=200 phase3_role_scoped=${phase3SellerSpriteEnabled}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(`PHASE1_ADMIN_API_ERROR ${error.message}`);
    process.exit(1);
  }
})();
