import {
  MongoClient,
  MongoServerError,
  ObjectId,
  type Collection,
  type WithId,
} from 'mongodb';
import type { AccountStore, AuditStore } from './contracts.js';
import type {
  AiGatewayAccountMapping,
  CallAudit,
  LibreChatIdentity,
  PolicyInput,
  ProvisioningAudit,
  QuotaPolicy,
  SafeMapping,
  SecurityAudit,
} from './types.js';

type MappingDocument = AiGatewayAccountMapping;

interface LibreChatUser {
  _id: ObjectId;
  email: string;
  name?: string;
  username?: string;
  role: string;
  idOnTheSource?: string;
  banned?: boolean;
}

interface LibreChatGroup {
  name: string;
  memberIds: string[];
}

interface NonceDocument {
  _id: string;
  expiresAt: Date;
}

function toSafe(document: WithId<MappingDocument>): SafeMapping {
  const safe: SafeMapping = {
    id: document._id.toHexString(),
    librechatUserId: document.librechatUserId,
    librechatEmail: document.librechatEmail,
    newApiUserId: document.newApiUserId,
    newApiUsername: document.newApiUsername,
    ...(document.newApiTokenId ? { newApiTokenId: document.newApiTokenId } : {}),
    tokenFingerprint: document.tokenFingerprint,
    gatewayGroup: document.gatewayGroup,
    credentialStatus: document.credentialStatus,
    allowedModels: document.allowedModels,
    ...(document.quotaPolicyId ? { quotaPolicyId: document.quotaPolicyId } : {}),
    ...(document.librechatRole ? { librechatRole: document.librechatRole } : {}),
    ...(document.departments ? { departments: document.departments } : {}),
    ...(document.provisionedBy ? { provisionedBy: document.provisionedBy } : {}),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
  if (document.lastSyncedAt) safe.lastSyncedAt = document.lastSyncedAt;
  if (document.lastError) safe.lastError = document.lastError;
  return safe;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function policyRank(policy: QuotaPolicy): number {
  if (policy.scope === 'user') return 4;
  if (policy.scope === 'department') return 3;
  if (policy.scope === 'role') return 2;
  return 1;
}

export class MongoStores implements AccountStore, AuditStore {
  private readonly client: MongoClient;
  private readonly users: Collection<LibreChatUser>;
  private readonly groups: Collection<LibreChatGroup>;
  private readonly mappings: Collection<MappingDocument>;
  private readonly audits: Collection<CallAudit>;
  private readonly policies: Collection<QuotaPolicy>;
  private readonly provisioningAudits: Collection<ProvisioningAudit>;
  private readonly nonces: Collection<NonceDocument>;
  private readonly securityAudits: Collection<SecurityAudit>;

  constructor(
    uri: string,
    auditRetentionDays: number,
    libreChatDatabase = 'LibreChat',
    adapterDatabase?: string,
  ) {
    this.client = new MongoClient(uri, { appName: 'woda-ai-quota-adapter', maxPoolSize: 20 });
    const gateway = adapterDatabase ? this.client.db(adapterDatabase) : this.client.db();
    const libreChat = this.client.db(libreChatDatabase);
    this.users = libreChat.collection<LibreChatUser>('users');
    this.groups = libreChat.collection<LibreChatGroup>('groups');
    this.mappings = gateway.collection<MappingDocument>('ai_gateway_account_mappings');
    this.audits = gateway.collection<CallAudit>('ai_gateway_call_audits');
    this.policies = gateway.collection<QuotaPolicy>('ai_quota_policies');
    this.provisioningAudits = gateway.collection<ProvisioningAudit>('ai_quota_provisioning_audits');
    this.nonces = gateway.collection<NonceDocument>('adapter_request_nonces');
    this.securityAudits = gateway.collection<SecurityAudit>('adapter_security_audits');
    this.auditRetentionDays = auditRetentionDays;
  }

  private readonly auditRetentionDays: number;

  async connect(): Promise<void> {
    await this.client.connect();
    await Promise.all([
      this.mappings.createIndex({ librechatUserId: 1 }, { unique: true, name: 'uniq_librechat_user' }),
      this.mappings.createIndex({ tokenHash: 1 }, { unique: true, name: 'uniq_gateway_token_hash' }),
      this.mappings.createIndex({ credentialStatus: 1, deletedAt: 1 }, { name: 'mapping_status' }),
      this.audits.createIndex({ librechatUserId: 1, createdAt: -1 }, { name: 'audit_user_time' }),
      this.audits.createIndex({ requestId: 1 }, { unique: true, name: 'uniq_adapter_request' }),
      this.policies.createIndex({ policyId: 1 }, { unique: true, name: 'uniq_policy_id' }),
      this.policies.createIndex(
        { scope: 1, scopeValue: 1, enabled: 1, priority: -1 },
        { name: 'policy_resolution' },
      ),
      this.provisioningAudits.createIndex(
        { targetUserId: 1, createdAt: -1 },
        { name: 'provisioning_target_time' },
      ),
      this.provisioningAudits.createIndex(
        { createdAt: 1 },
        {
          expireAfterSeconds: this.auditRetentionDays * 86400,
          name: 'provisioning_audit_retention_ttl',
        },
      ),
      this.audits.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: this.auditRetentionDays * 86400, name: 'audit_retention_ttl' },
      ),
      this.nonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'nonce_ttl' }),
      this.securityAudits.createIndex(
        { createdAt: 1 },
        {
          expireAfterSeconds: this.auditRetentionDays * 86400,
          name: 'security_audit_retention_ttl',
        },
      ),
      this.securityAudits.createIndex(
        { code: 1, createdAt: -1 },
        { name: 'security_code_time' },
      ),
    ]);
  }

  async consumeNonce(nonce: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.nonces.insertOne({ _id: nonce, expiresAt });
      return true;
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) return false;
      throw error;
    }
  }

  async recordSecurityAudit(audit: SecurityAudit): Promise<void> {
    await this.securityAudits.insertOne(audit);
  }

  async ping(): Promise<void> {
    await Promise.all([
      this.mappings.findOne({}, { projection: { _id: 1 } }),
      this.users.findOne({}, { projection: { _id: 1 } }),
    ]);
  }

  async findActiveByUserId(userId: string): Promise<AiGatewayAccountMapping | null> {
    return this.mappings.findOne({
      librechatUserId: userId,
      credentialStatus: 'active',
      deletedAt: { $exists: false },
    });
  }

  async findByUserId(userId: string): Promise<AiGatewayAccountMapping | null> {
    return this.mappings.findOne({
      librechatUserId: userId,
      deletedAt: { $exists: false },
    });
  }

  async upsert(mapping: Omit<AiGatewayAccountMapping, 'createdAt' | 'updatedAt'>): Promise<SafeMapping> {
    const now = new Date();
    await this.mappings.updateOne(
      { librechatUserId: mapping.librechatUserId },
      {
        $set: { ...mapping, updatedAt: now },
        $setOnInsert: { createdAt: now },
        $unset: { deletedAt: '' },
      },
      { upsert: true },
    );
    const document = await this.mappings.findOne({ librechatUserId: mapping.librechatUserId });
    if (!document) throw new Error('Mapping upsert did not return a document');
    return toSafe(document);
  }

  async setStatus(
    userId: string,
    status: AiGatewayAccountMapping['credentialStatus'],
    error?: string,
  ): Promise<void> {
    const now = new Date();
    await this.mappings.updateOne(
      { librechatUserId: userId },
      {
        $set: {
          credentialStatus: status,
          updatedAt: now,
          ...(error ? { lastError: error.slice(0, 300) } : {}),
        },
        ...(!error ? { $unset: { lastError: '' } } : {}),
      },
    );
  }

  async listSafe(): Promise<SafeMapping[]> {
    const documents = await this.mappings.find({ deletedAt: { $exists: false } }).sort({ createdAt: 1 }).toArray();
    return documents.map(toSafe);
  }

  private async userById(userId: string): Promise<LibreChatUser | null> {
    const objectId = ObjectId.isValid(userId) ? new ObjectId(userId) : null;
    return this.users.findOne({
      $or: [...(objectId ? [{ _id: objectId }] : []), { idOnTheSource: userId }],
    });
  }

  private async departments(user: LibreChatUser): Promise<string[]> {
    const ids = [user._id.toHexString(), user.idOnTheSource].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const groups = await this.groups
      .find({ memberIds: { $in: ids } }, { projection: { name: 1 } })
      .toArray();
    return groups.map((group) => group.name).sort();
  }

  private async toIdentity(user: LibreChatUser): Promise<LibreChatIdentity | null> {
    if (user.banned === true || !user.email) return null;
    return {
      userId: user._id.toHexString(),
      email: user.email.toLowerCase(),
      name: user.name ?? null,
      username: user.username ?? null,
      role: user.role,
      departments: await this.departments(user),
      admin: user.role === 'ADMIN' || user.role === 'admin',
    };
  }

  async identity(userId: string): Promise<LibreChatIdentity | null> {
    const user = await this.userById(userId);
    return user ? this.toIdentity(user) : null;
  }

  async listIdentities(query: string, limit: number): Promise<LibreChatIdentity[]> {
    const filter =
      query.length > 0
        ? {
            $or: [
              { email: { $regex: escaped(query), $options: 'i' } },
              { name: { $regex: escaped(query), $options: 'i' } },
              { username: { $regex: escaped(query), $options: 'i' } },
            ],
          }
        : {};
    const users = await this.users
      .find(filter, {
        projection: { email: 1, name: 1, username: 1, role: 1, idOnTheSource: 1, banned: 1 },
      })
      .sort({ email: 1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .toArray();
    const identities = await Promise.all(users.map((user) => this.toIdentity(user)));
    return identities.filter((identity): identity is LibreChatIdentity => identity != null);
  }

  async ensureDefaultPolicy(defaultModels: string[]): Promise<QuotaPolicy> {
    const now = new Date();
    await this.policies.updateOne(
      { policyId: 'default:*' },
      {
        $setOnInsert: {
          policyId: 'default:*',
          name: 'Default zero-quota policy',
          scope: 'default',
          scopeValue: '*',
          priority: 0,
          quota: 0,
          gatewayGroup: 'default',
          allowedModels: [...new Set(defaultModels)].sort(),
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true },
    );
    const policy = await this.policies.findOne({ policyId: 'default:*' });
    if (!policy) throw new Error('Default quota policy is unavailable');
    return policy;
  }

  async resolvePolicy(identity: LibreChatIdentity): Promise<QuotaPolicy> {
    const policies = await this.policies
      .find({
        enabled: true,
        $or: [
          { scope: 'default', scopeValue: '*' },
          { scope: 'role', scopeValue: identity.role },
          { scope: 'department', scopeValue: { $in: identity.departments } },
          { scope: 'user', scopeValue: identity.userId },
        ],
      })
      .toArray();
    const selected = policies.sort(
      (left, right) =>
        policyRank(right) - policyRank(left) ||
        right.priority - left.priority ||
        right.updatedAt.getTime() - left.updatedAt.getTime(),
    )[0];
    if (!selected) throw new Error('No effective quota policy exists');
    return selected;
  }

  async listPolicies(): Promise<QuotaPolicy[]> {
    return this.policies.find({}).sort({ scope: 1, priority: -1, scopeValue: 1 }).toArray();
  }

  async upsertPolicy(input: PolicyInput): Promise<QuotaPolicy> {
    const policyId = `${input.scope}:${input.scope === 'default' ? '*' : input.scopeValue}`;
    const now = new Date();
    await this.policies.updateOne(
      { policyId },
      {
        $set: {
          ...input,
          policyId,
          scopeValue: input.scope === 'default' ? '*' : input.scopeValue,
          allowedModels: [...new Set(input.allowedModels)].sort(),
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true },
    );
    const policy = await this.policies.findOne({ policyId });
    if (!policy) throw new Error('Quota policy upsert failed');
    return policy;
  }

  async recordProvisioningAudit(audit: ProvisioningAudit): Promise<void> {
    await this.provisioningAudits.insertOne(audit);
  }

  async record(audit: CallAudit): Promise<void> {
    await this.audits.insertOne(audit);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
