import { createHmac, randomUUID } from 'node:crypto';
import type { AdapterConfig } from './config.js';
import type {
  AccountServiceContract,
  AccountStore,
  NewApiClientContract,
  NewApiProvisioningClient,
} from './contracts.js';
import { decryptToken, encryptToken, fingerprintToken, hashToken } from './crypto.js';
import { AdapterError } from './errors.js';
import type {
  AccountSummary,
  AiGatewayAccountMapping,
  LibreChatIdentity,
  NewApiToken,
  NewApiUser,
  PolicyInput,
  QuotaPolicy,
  SafeMapping,
} from './types.js';

function safeMapping(mapping: AiGatewayAccountMapping): SafeMapping {
  return {
    id: mapping.librechatUserId,
    librechatUserId: mapping.librechatUserId,
    librechatEmail: mapping.librechatEmail,
    newApiUserId: mapping.newApiUserId,
    newApiUsername: mapping.newApiUsername,
    ...(mapping.newApiTokenId ? { newApiTokenId: mapping.newApiTokenId } : {}),
    tokenFingerprint: mapping.tokenFingerprint,
    gatewayGroup: mapping.gatewayGroup,
    credentialStatus: mapping.credentialStatus,
    allowedModels: mapping.allowedModels,
    ...(mapping.quotaPolicyId ? { quotaPolicyId: mapping.quotaPolicyId } : {}),
    ...(mapping.librechatRole ? { librechatRole: mapping.librechatRole } : {}),
    ...(mapping.departments ? { departments: mapping.departments } : {}),
    ...(mapping.provisionedBy ? { provisionedBy: mapping.provisionedBy } : {}),
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
    ...(mapping.lastSyncedAt ? { lastSyncedAt: mapping.lastSyncedAt } : {}),
    ...(mapping.lastError ? { lastError: mapping.lastError } : {}),
  };
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))].sort();
}

function managedUsername(userId: string): string {
  return `woda_${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-15)}`;
}

function managedTokenName(userId: string): string {
  return `woda-${userId.replace(/[^a-zA-Z0-9]/g, '').slice(-20)}`;
}

function managedPassword(userId: string, secret: string): string {
  const value = createHmac('sha256', secret)
    .update(`woda-new-api-user:v1:${userId}`)
    .digest('base64url');
  return `${value.slice(0, 16)}aA1!`;
}

function mappingInput(
  mapping: AiGatewayAccountMapping,
): Omit<AiGatewayAccountMapping, 'createdAt' | 'updatedAt'> {
  const {
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...input
  } = mapping;
  return input;
}

export class AccountService implements AccountServiceContract {
  private readonly pending = new Map<string, Promise<AiGatewayAccountMapping>>();

  constructor(
    private readonly config: AdapterConfig,
    private readonly store: AccountStore,
    private readonly newApi: NewApiClientContract & NewApiProvisioningClient,
  ) {}

  async initialize(): Promise<void> {
    await this.store.ensureDefaultPolicy(this.config.defaultAllowedModels);
  }

  private async verifiedIdentity(actor: { userId: string; email: string }): Promise<LibreChatIdentity> {
    const identity = await this.store.identity(actor.userId);
    if (!identity) {
      throw new AdapterError(403, 'librechat_account_unavailable', 'LibreChat account is unavailable');
    }
    if (identity.email !== actor.email.toLowerCase()) {
      throw new AdapterError(403, 'user_mapping_mismatch', 'AI account identity does not match');
    }
    return identity;
  }

  private async provision(
    identity: LibreChatIdentity,
    actorUserId: string,
    reason: string,
  ): Promise<AiGatewayAccountMapping> {
    const policy = await this.store.resolvePolicy(identity);
    const username = managedUsername(identity.userId);
    const account = await this.newApi.provision({
      username,
      displayName: `Woda-${identity.userId.slice(-12)}`.slice(0, 20),
      password: managedPassword(identity.userId, this.config.encryptionKey),
      quota: policy.quota,
      group: policy.gatewayGroup,
      allowedModels: uniqueModels(policy.allowedModels),
      tokenName: managedTokenName(identity.userId),
    });
    const mapping = await this.store.upsert({
      librechatUserId: identity.userId,
      librechatEmail: identity.email,
      newApiUserId: String(account.user.id),
      newApiUsername: account.user.username,
      newApiTokenId: String(account.token.id),
      encryptedToken: encryptToken(account.runtimeToken, this.config.encryptionKey),
      encryptedManagementToken: encryptToken(
        account.managementToken,
        this.config.encryptionKey,
      ),
      tokenFingerprint: fingerprintToken(account.runtimeToken),
      tokenHash: hashToken(account.runtimeToken),
      gatewayGroup: policy.gatewayGroup,
      credentialStatus: 'active',
      allowedModels: uniqueModels(policy.allowedModels),
      quotaPolicyId: policy.policyId,
      librechatRole: identity.role,
      departments: identity.departments,
      provisionedBy: 'automatic',
      lastSyncedAt: new Date(),
    });
    await this.store.recordProvisioningAudit({
      requestId: randomUUID(),
      actorUserId,
      targetUserId: identity.userId,
      action: 'account_provision',
      reason,
      policyId: policy.policyId,
      nextQuota: policy.quota,
      modelCount: policy.allowedModels.length,
      createdAt: new Date(),
    });
    const persisted = await this.store.findActiveByUserId(identity.userId);
    if (!persisted) {
      throw new AdapterError(
        500,
        'mapping_persistence_failed',
        `AI account mapping ${mapping.id} was not persisted`,
      );
    }
    return persisted;
  }

  async ensure(
    actor: { userId: string; email: string },
    actorUserId = actor.userId,
    reason = 'Automatic account provisioning',
  ): Promise<AiGatewayAccountMapping> {
    const existing = await this.store.findByUserId(actor.userId);
    if (existing?.credentialStatus === 'revoked') {
      throw new AdapterError(403, 'ai_account_revoked', 'AI account is revoked');
    }
    if (existing?.credentialStatus === 'active') {
      if (existing.librechatEmail.toLowerCase() !== actor.email.toLowerCase()) {
        throw new AdapterError(403, 'user_mapping_mismatch', 'AI account mapping does not match');
      }
      return existing;
    }
    const inflight = this.pending.get(actor.userId);
    if (inflight) return inflight;
    const operation = this.verifiedIdentity(actor)
      .then((identity) => this.provision(identity, actorUserId, reason))
      .finally(() => this.pending.delete(actor.userId));
    this.pending.set(actor.userId, operation);
    return operation;
  }

  private async summaryFor(
    identity: LibreChatIdentity,
    includeBalance: boolean,
  ): Promise<AccountSummary> {
    const [mapping, policy] = await Promise.all([
      this.store.findByUserId(identity.userId),
      this.store.resolvePolicy(identity),
    ]);
    let balance: AccountSummary['balance'] = null;
    if (includeBalance && mapping?.credentialStatus === 'active') {
      const usage = await this.newApi.tokenUsage(
        decryptToken(mapping.encryptedToken, this.config.encryptionKey),
      );
      balance = {
        totalGranted: usage.total_granted,
        totalUsed: usage.total_used,
        totalAvailable: usage.total_available,
        unlimitedQuota: usage.unlimited_quota,
        expiresAt: usage.expires_at,
        unit: 'new_api_quota',
        authoritativeSource: 'new_api',
      };
    }
    return {
      identity,
      mapping: mapping ? safeMapping(mapping) : null,
      effectivePolicy: policy,
      balance,
    };
  }

  async summary(actor: { userId: string; email: string }): Promise<AccountSummary> {
    const identity = await this.verifiedIdentity(actor);
    await this.ensure(actor);
    return this.summaryFor(identity, true);
  }

  async adminUsers(query: string, limit: number): Promise<AccountSummary[]> {
    const identities = await this.store.listIdentities(query, limit);
    return Promise.all(identities.map((identity) => this.summaryFor(identity, false)));
  }

  async listPolicies(): Promise<QuotaPolicy[]> {
    return this.store.listPolicies();
  }

  async upsertPolicy(
    input: PolicyInput,
    actorUserId: string,
    reason: string,
  ): Promise<QuotaPolicy> {
    const policy = await this.store.upsertPolicy({ ...input, allowedModels: uniqueModels(input.allowedModels) });
    await this.store.recordProvisioningAudit({
      requestId: randomUUID(),
      actorUserId,
      targetUserId: input.scope === 'user' ? input.scopeValue : '*',
      action: 'policy_upsert',
      reason,
      policyId: policy.policyId,
      nextQuota: policy.quota,
      modelCount: policy.allowedModels.length,
      createdAt: new Date(),
    });
    return policy;
  }

  private async syncManagedMapping(
    identity: LibreChatIdentity,
    mapping: AiGatewayAccountMapping,
    policy: QuotaPolicy,
  ): Promise<void> {
    if (!mapping.encryptedManagementToken || !mapping.newApiTokenId) {
      throw new AdapterError(
        409,
        'legacy_mapping_read_only',
        'This legacy mapping must be rotated before policy synchronization',
      );
    }
    const user: NewApiUser = {
      id: Number(mapping.newApiUserId),
      username: mapping.newApiUsername,
      role: 1,
      status: 1,
      group: mapping.gatewayGroup,
      quota: 0,
      used_quota: 0,
    };
    const token: NewApiToken = {
      id: Number(mapping.newApiTokenId),
      name: managedTokenName(identity.userId),
      status: 1,
      expired_time: -1,
      remain_quota: 0,
      unlimited_quota: false,
      model_limits_enabled: true,
      model_limits: mapping.allowedModels.join(','),
      group: mapping.gatewayGroup,
      cross_group_retry: false,
    };
    await this.newApi.applyPolicy({
      user,
      token,
      managementToken: decryptToken(
        mapping.encryptedManagementToken,
        this.config.encryptionKey,
      ),
      quota: policy.quota,
      group: policy.gatewayGroup,
      allowedModels: uniqueModels(policy.allowedModels),
    });
    await this.store.upsert(
      mappingInput({
        ...mapping,
        gatewayGroup: policy.gatewayGroup,
        allowedModels: uniqueModels(policy.allowedModels),
        quotaPolicyId: policy.policyId,
        librechatRole: identity.role,
        departments: identity.departments,
        lastSyncedAt: new Date(),
      }),
    );
  }

  async applyUserPolicy(
    userId: string,
    actorUserId: string,
    reason: string,
  ): Promise<AccountSummary> {
    const identity = await this.store.identity(userId);
    if (!identity) throw new AdapterError(404, 'user_not_found', 'LibreChat user was not found');
    const mapping = await this.ensure(
      { userId: identity.userId, email: identity.email },
      actorUserId,
      reason,
    );
    const policy = await this.store.resolvePolicy(identity);
    await this.syncManagedMapping(identity, mapping, policy);
    await this.store.recordProvisioningAudit({
      requestId: randomUUID(),
      actorUserId,
      targetUserId: identity.userId,
      action: 'policy_apply',
      reason,
      policyId: policy.policyId,
      nextQuota: policy.quota,
      modelCount: policy.allowedModels.length,
      createdAt: new Date(),
    });
    return this.summaryFor(identity, true);
  }

  async revoke(
    userId: string,
    actorUserId: string,
    reason: string,
  ): Promise<AccountSummary> {
    const identity = await this.store.identity(userId);
    const mapping = await this.store.findByUserId(userId);
    if (!identity || !mapping) {
      throw new AdapterError(404, 'ai_account_not_found', 'AI account was not found');
    }
    await this.newApi.disableUser(Number(mapping.newApiUserId));
    await this.store.setStatus(userId, 'revoked');
    await this.store.recordProvisioningAudit({
      requestId: randomUUID(),
      actorUserId,
      targetUserId: userId,
      action: 'account_revoke',
      reason,
      createdAt: new Date(),
    });
    return this.summaryFor(identity, false);
  }

  async restore(
    userId: string,
    actorUserId: string,
    reason: string,
  ): Promise<AccountSummary> {
    const identity = await this.store.identity(userId);
    const mapping = await this.store.findByUserId(userId);
    if (!identity || !mapping) {
      throw new AdapterError(404, 'ai_account_not_found', 'AI account was not found');
    }
    await this.newApi.restoreUser(Number(mapping.newApiUserId));
    await this.store.setStatus(userId, 'active');
    await this.store.recordProvisioningAudit({
      requestId: randomUUID(),
      actorUserId,
      targetUserId: userId,
      action: 'account_restore',
      reason,
      createdAt: new Date(),
    });
    if (mapping.encryptedManagementToken && mapping.newApiTokenId) {
      const policy = await this.store.resolvePolicy(identity);
      await this.syncManagedMapping(identity, { ...mapping, credentialStatus: 'active' }, policy);
    }
    return this.summaryFor(identity, true);
  }

  async modelCatalog(): Promise<string[]> {
    const [mappings, policies] = await Promise.all([
      this.store.listSafe(),
      this.store.listPolicies(),
    ]);
    return uniqueModels([
      ...this.config.defaultAllowedModels,
      ...mappings.flatMap((mapping) => mapping.allowedModels),
      ...policies.flatMap((policy) => policy.allowedModels),
    ]);
  }

  async gatewayGroups(): Promise<string[]> {
    return this.newApi.groups();
  }
}
