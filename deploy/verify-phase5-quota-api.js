const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const db = require('/app/api/models');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

const baseUrl = 'http://nginx';

async function request(token, route, options = {}) {
  return fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      ...options.headers,
    },
  });
}

async function json(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return body;
}

(async () => {
  try {
    await connect();
    const { User } = models;
    const admin = await User.findOne({ role: SystemRoles.ADMIN }).sort({ _id: 1 });
    const ordinary = await User.findOne({ role: SystemRoles.USER }).sort({ _id: 1 });
    if (!admin || !ordinary) {
      throw new Error('Both ADMIN and USER accounts are required for quota verification');
    }
    const [adminToken, userToken] = await Promise.all([
      db.generateToken(admin, 5 * 60 * 1000),
      db.generateToken(ordinary, 5 * 60 * 1000),
    ]);

    const denied = await request(userToken, '/api/ai-quota/admin/users');
    if (denied.status !== 403) {
      throw new Error(`Ordinary USER admin request returned HTTP ${denied.status}`);
    }

    const summaryBody = await json(
      await request(userToken, '/api/ai-quota/summary'),
      'User quota summary',
    );
    const summary = summaryBody.data;
    if (
      !summary?.mapping ||
      summary.mapping.credentialStatus !== 'active' ||
      summary.balance?.totalGranted !== 0 ||
      summary.balance?.totalAvailable !== 0
    ) {
      throw new Error('New user does not have an active zero-quota personal account');
    }

    const adminUsersBody = await json(
      await request(adminToken, '/api/ai-quota/admin/users?limit=50'),
      'Admin quota users',
    );
    const users = adminUsersBody.data ?? [];
    const target = users.find((item) => item.identity?.userId === ordinary._id.toString());
    if (!target?.mapping) {
      throw new Error('Provisioned ordinary user is missing from the administration list');
    }
    const serialized = JSON.stringify(adminUsersBody);
    if (
      serialized.includes('encryptedToken') ||
      serialized.includes('encryptedManagementToken') ||
      serialized.includes('managementToken') ||
      serialized.includes('runtimeToken')
    ) {
      throw new Error('Quota administration response exposes credential material');
    }

    const reason = 'Phase 5 zero-quota idempotency verification';
    const policyResponse = await request(adminToken, '/api/ai-quota/admin/policies', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Phase 5 verified zero-quota user policy',
        scope: 'user',
        scopeValue: ordinary._id.toString(),
        priority: 1000,
        quota: 0,
        gatewayGroup: 'default',
        allowedModels: ['kimi-k2'],
        enabled: true,
        reason,
      }),
    });
    await json(policyResponse, 'Zero-quota policy update');

    for (let index = 0; index < 2; index += 1) {
      const applyResponse = await request(
        adminToken,
        `/api/ai-quota/admin/users/${ordinary._id}/apply`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      );
      const applyBody = await json(applyResponse, 'Zero-quota policy apply');
      if (
        applyBody.data?.balance?.totalGranted !== 0 ||
        applyBody.data?.mapping?.allowedModels?.join(',') !== 'kimi-k2'
      ) {
        throw new Error('Applied user policy is not zero-quota and model-restricted');
      }
    }

    console.log(
      `PHASE5_QUOTA_API_OK user=${ordinary._id} quota=0 model=kimi-k2 adminDenied=true secretsRedacted=true`,
    );
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error(`PHASE5_QUOTA_API_ERROR ${error.message}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
