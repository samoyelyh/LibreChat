import { MongoClient, ObjectId, type Collection } from 'mongodb';
import { decryptSecret, encryptSecret, fingerprintLast4 } from './crypto.js';
import { groupsForIdentity } from './policy.js';
import type {
  ActorHeaders,
  BrowserActor,
  CallAudit,
  ConfiguredBy,
  ConnectionTestResult,
  CredentialAudit,
  CredentialDocument,
  CredentialStatus,
  CredentialStatusView,
  GatewayConfig,
  VerifiedActor,
} from './types.js';

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

export interface UserSummary {
  userId: string;
  email: string;
  name: string | null;
  username: string | null;
  role: string;
  credential: CredentialStatusView;
}

function statusView(value: CredentialDocument | null): CredentialStatusView {
  const configured = value?.secret != null && value.status !== 'revoked';
  return {
    configured,
    provider: 'lingxing',
    status: value?.status ?? 'missing',
    configuredBy: configured ? value?.configuredBy ?? null : null,
    fingerprintLast4: configured ? value?.fingerprintLast4 ?? null : null,
    createdAt: value?.createdAt ?? null,
    updatedAt: value?.updatedAt ?? null,
    lastTestedAt: value?.lastTestedAt ?? null,
    lastTestOk: value?.lastTestOk ?? null,
    lastTestMessage: value?.lastTestMessage ?? null,
    lastUsedAt: value?.lastUsedAt ?? null,
    toolCount: value?.toolCount ?? null,
  };
}

export class MongoStores {
  private readonly client: MongoClient;
  private readonly users: Collection<LibreChatUser>;
  private readonly groups: Collection<LibreChatGroup>;
  private readonly credentials: Collection<CredentialDocument>;
  private readonly credentialAudits: Collection<CredentialAudit>;
  private readonly callAudits: Collection<CallAudit>;

  constructor(private readonly config: GatewayConfig) {
    this.client = new MongoClient(config.mongoUri, {
      appName: 'woda-lingxing-mcp-gateway',
      maxPoolSize: 30,
    });
    const librechat = this.client.db(config.libreChatDatabase);
    const gateway = this.client.db(config.gatewayDatabase);
    this.users = librechat.collection<LibreChatUser>('users');
    this.groups = librechat.collection<LibreChatGroup>('groups');
    this.credentials = gateway.collection<CredentialDocument>('lingxing_credentials');
    this.credentialAudits = gateway.collection<CredentialAudit>('lingxing_credential_audits');
    this.callAudits = gateway.collection<CallAudit>('lingxing_call_audits');
  }

  async connect(): Promise<void> {
    await this.client.connect();
    const ttl = this.config.auditRetentionDays * 86400;
    await Promise.all([
      this.credentials.createIndex({ email: 1 }, { name: 'credential_email' }),
      this.credentials.createIndex({ status: 1, updatedAt: -1 }, { name: 'credential_status' }),
      this.credentialAudits.createIndex(
        { targetUserId: 1, createdAt: -1 },
        { name: 'credential_audit_target_time' },
      ),
      this.credentialAudits.createIndex(
        { createdAt: 1 },
        { name: 'credential_audit_ttl', expireAfterSeconds: ttl },
      ),
      this.callAudits.createIndex({ userId: 1, createdAt: -1 }, { name: 'call_user_time' }),
      this.callAudits.createIndex({ tool: 1, createdAt: -1 }, { name: 'call_tool_time' }),
      this.callAudits.createIndex(
        { createdAt: 1 },
        { name: 'call_audit_ttl', expireAfterSeconds: ttl },
      ),
    ]);
  }

  async ping(): Promise<void> {
    await Promise.all([
      this.client.db(this.config.libreChatDatabase).command({ ping: 1 }),
      this.client.db(this.config.gatewayDatabase).command({ ping: 1 }),
    ]);
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
    return groups.map((group) => group.name);
  }

  async browserActor(userId: string): Promise<BrowserActor | null> {
    const user = await this.userById(userId);
    if (!user || user.banned === true) return null;
    const departments = await this.departments(user);
    return {
      userId: user._id.toHexString(),
      email: user.email,
      role: user.role,
      departments,
      admin: user.role === 'ADMIN' || user.role === 'admin',
    };
  }

  async verifyActor(headers: ActorHeaders): Promise<VerifiedActor | null> {
    const actor = await this.browserActor(headers.userId);
    if (
      !actor ||
      actor.email.toLowerCase() !== headers.email.toLowerCase() ||
      actor.role !== headers.role
    ) {
      return null;
    }
    return {
      ...headers,
      userId: actor.userId,
      departments: actor.departments,
      admin: actor.admin,
      groups: groupsForIdentity(actor.role, actor.departments),
    };
  }

  async credentialStatus(userId: string): Promise<CredentialStatusView> {
    return statusView(await this.credentials.findOne({ _id: userId }));
  }

  async setCredential(input: {
    target: BrowserActor;
    secret: string;
    configuredBy: ConfiguredBy;
    actorUserId: string;
    requestId: string;
    sourceIp: string;
    reason: string | null;
  }): Promise<CredentialStatusView> {
    const now = new Date();
    const existing = await this.credentials.findOne({ _id: input.target.userId });
    const newFingerprint = fingerprintLast4(input.secret);
    const document: CredentialDocument = {
      _id: input.target.userId,
      userId: input.target.userId,
      email: input.target.email,
      provider: 'lingxing',
      secret: encryptSecret(input.secret, this.config.encryptionKey, input.target.userId),
      fingerprintLast4: newFingerprint,
      status: 'untested',
      configuredBy: input.configuredBy,
      configuredByUserId: input.actorUserId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      lastTestedAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      lastUsedAt: null,
      toolCount: null,
      revokedAt: null,
    };
    await this.credentials.replaceOne({ _id: input.target.userId }, document, { upsert: true });
    await this.recordCredentialAudit({
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      targetUserId: input.target.userId,
      action: input.configuredBy === 'self' ? 'self_set' : 'admin_set',
      reason: input.reason,
      sourceIp: input.sourceIp,
      oldFingerprintLast4: existing?.fingerprintLast4 ?? null,
      newFingerprintLast4: newFingerprint,
      testOk: null,
      createdAt: now,
    });
    return statusView(document);
  }

  async revokeCredential(input: {
    targetUserId: string;
    actorUserId: string;
    configuredBy: ConfiguredBy;
    requestId: string;
    sourceIp: string;
    reason: string | null;
  }): Promise<CredentialStatusView> {
    const now = new Date();
    const existing = await this.credentials.findOne({ _id: input.targetUserId });
    if (existing) {
      await this.credentials.updateOne(
        { _id: input.targetUserId },
        {
          $unset: { secret: '' },
          $set: {
            status: 'revoked',
            updatedAt: now,
            revokedAt: now,
            lastTestOk: null,
            lastTestMessage: null,
          },
        },
      );
    }
    await this.recordCredentialAudit({
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.configuredBy === 'self' ? 'self_revoke' : 'admin_revoke',
      reason: input.reason,
      sourceIp: input.sourceIp,
      oldFingerprintLast4: existing?.fingerprintLast4 ?? null,
      newFingerprintLast4: null,
      testOk: null,
      createdAt: now,
    });
    return this.credentialStatus(input.targetUserId);
  }

  async getCredentialSecret(userId: string, allowUntested = false): Promise<string | null> {
    const allowedStatuses: CredentialStatus[] = allowUntested
      ? ['active', 'untested', 'invalid']
      : ['active'];
    const credential = await this.credentials.findOne({
      _id: userId,
      status: { $in: allowedStatuses },
    });
    if (!credential?.secret) return null;
    return decryptSecret(credential.secret, this.config.encryptionKey, userId);
  }

  async recordTest(input: {
    targetUserId: string;
    actorUserId: string;
    configuredBy: ConfiguredBy;
    requestId: string;
    sourceIp: string;
    reason: string | null;
    result: ConnectionTestResult;
  }): Promise<void> {
    const now = new Date();
    const existing = await this.credentials.findOne({ _id: input.targetUserId });
    await this.credentials.updateOne(
      { _id: input.targetUserId },
      {
        $set: {
          status: input.result.ok ? 'active' : 'invalid',
          updatedAt: now,
          lastTestedAt: now,
          lastTestOk: input.result.ok,
          lastTestMessage: input.result.message.slice(0, 200),
          ...(input.result.toolCount != null ? { toolCount: input.result.toolCount } : {}),
        },
      },
    );
    await this.recordCredentialAudit({
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.configuredBy === 'self' ? 'self_test' : 'admin_test',
      reason: input.reason,
      sourceIp: input.sourceIp,
      oldFingerprintLast4: existing?.fingerprintLast4 ?? null,
      newFingerprintLast4: existing?.fingerprintLast4 ?? null,
      testOk: input.result.ok,
      createdAt: now,
    });
  }

  async markUsed(userId: string): Promise<void> {
    await this.credentials.updateOne({ _id: userId }, { $set: { lastUsedAt: new Date() } });
  }

  async recordCallAudits(values: CallAudit[]): Promise<void> {
    if (values.length === 0) return;
    await this.callAudits.insertMany(values, { ordered: false });
  }

  async usage(userId: string): Promise<{ totalCalls: number; last30Days: number }> {
    const since = new Date(Date.now() - 30 * 86400_000);
    const [totalCalls, last30Days] = await Promise.all([
      this.callAudits.countDocuments({ userId, allowed: true }),
      this.callAudits.countDocuments({ userId, allowed: true, createdAt: { $gte: since } }),
    ]);
    return { totalCalls, last30Days };
  }

  async adminUsers(query: string, limit: number): Promise<UserSummary[]> {
    const filter =
      query.length > 0
        ? {
            $or: [
              { email: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
              { name: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
              { username: { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
            ],
          }
        : {};
    const users = await this.users
      .find(filter, { projection: { email: 1, name: 1, username: 1, role: 1 } })
      .sort({ email: 1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .toArray();
    const credentials = await this.credentials
      .find({ _id: { $in: users.map((user) => user._id.toHexString()) } })
      .toArray();
    const byId = new Map(credentials.map((credential) => [credential._id, credential]));
    return users.map((user) => ({
      userId: user._id.toHexString(),
      email: user.email,
      name: user.name ?? null,
      username: user.username ?? null,
      role: user.role,
      credential: statusView(byId.get(user._id.toHexString()) ?? null),
    }));
  }

  async recentCredentialAudits(limit: number): Promise<CredentialAudit[]> {
    return this.credentialAudits
      .find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .toArray();
  }

  private async recordCredentialAudit(value: CredentialAudit): Promise<void> {
    await this.credentialAudits.insertOne(value);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
