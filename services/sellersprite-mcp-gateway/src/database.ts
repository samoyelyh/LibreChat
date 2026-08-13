import { createHash } from 'node:crypto';
import {
  MongoClient,
  MongoServerError,
  ObjectId,
  type Collection,
  type WithId,
} from 'mongodb';
import { authorizeIdentity } from './policy.js';
import type {
  ActorHeaders,
  CallAudit,
  CredentialState,
  GatewayConfig,
  RateLimitDecision,
  SafeStatus,
  SecurityAudit,
  VerifiedActor,
} from './types.js';

interface LibreChatUser {
  _id: ObjectId;
  email: string;
  role: string;
  idOnTheSource?: string;
}

interface LibreChatGroup {
  name: string;
  memberIds: string[];
}

interface NonceDocument {
  _id: string;
  expiresAt: Date;
}

interface RateLimitDocument {
  _id: string;
  count: number;
  expiresAt: Date;
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function fingerprintLast4(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(-4);
}

export class MongoStores {
  private readonly client: MongoClient;
  private readonly users: Collection<LibreChatUser>;
  private readonly groups: Collection<LibreChatGroup>;
  private readonly audits: Collection<CallAudit>;
  private readonly states: Collection<CredentialState>;
  private readonly nonces: Collection<NonceDocument>;
  private readonly rateLimits: Collection<RateLimitDocument>;
  private readonly securityAudits: Collection<SecurityAudit>;

  constructor(private readonly config: GatewayConfig) {
    this.client = new MongoClient(config.mongoUri, {
      appName: 'woda-sellersprite-mcp-gateway',
      maxPoolSize: 20,
    });
    const librechat = this.client.db(config.libreChatDatabase);
    const gateway = this.client.db(config.gatewayDatabase);
    this.users = librechat.collection<LibreChatUser>('users');
    this.groups = librechat.collection<LibreChatGroup>('groups');
    this.audits = gateway.collection<CallAudit>('sellersprite_call_audits');
    this.states = gateway.collection<CredentialState>('sellersprite_admin_state');
    this.nonces = gateway.collection<NonceDocument>('gateway_request_nonces');
    this.rateLimits = gateway.collection<RateLimitDocument>('gateway_rate_limits');
    this.securityAudits = gateway.collection<SecurityAudit>('gateway_security_audits');
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await Promise.all([
      this.audits.createIndex({ userId: 1, createdAt: -1 }, { name: 'audit_user_time' }),
      this.audits.createIndex({ month: 1, createdAt: -1 }, { name: 'audit_month_time' }),
      this.audits.createIndex({ tool: 1, createdAt: -1 }, { name: 'audit_tool_time' }),
      this.audits.createIndex({ requestId: 1 }, { name: 'audit_request' }),
      this.audits.createIndex(
        { createdAt: 1 },
        {
          expireAfterSeconds: this.config.auditRetentionDays * 86400,
          name: 'audit_retention_ttl',
        },
      ),
      this.nonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'nonce_ttl' }),
      this.rateLimits.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'rate_limit_ttl' },
      ),
      this.securityAudits.createIndex(
        { createdAt: 1 },
        {
          expireAfterSeconds: this.config.auditRetentionDays * 86400,
          name: 'security_audit_ttl',
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

  async consumeToolRateLimit(
    userId: string,
    tool: string,
    now = new Date(),
  ): Promise<RateLimitDecision> {
    const bucketStart = Math.floor(now.getTime() / 60000) * 60000;
    const expiresAt = new Date(bucketStart + 120000);
    const id = `${userId}:${tool}:${bucketStart}`;
    let document: WithId<RateLimitDocument> | null;
    try {
      document = await this.rateLimits.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
        { upsert: true, returnDocument: 'after' },
      );
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      document = await this.rateLimits.findOneAndUpdate(
        { _id: id },
        { $inc: { count: 1 } },
        { returnDocument: 'after' },
      );
    }
    const count = document?.count ?? 1;
    return {
      allowed: count <= this.config.requestsPerMinute,
      limit: this.config.requestsPerMinute,
      remaining: Math.max(0, this.config.requestsPerMinute - count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucketStart + 60000 - now.getTime()) / 1000)),
    };
  }

  async ping(): Promise<void> {
    await Promise.all([
      this.client.db(this.config.libreChatDatabase).command({ ping: 1 }),
      this.client.db(this.config.gatewayDatabase).command({ ping: 1 }),
    ]);
  }

  async verifyActor(headers: ActorHeaders): Promise<VerifiedActor | null> {
    const id = ObjectId.isValid(headers.userId) ? new ObjectId(headers.userId) : null;
    const user = await this.users.findOne({
      $or: [...(id ? [{ _id: id }] : []), { idOnTheSource: headers.userId }],
    });
    if (
      !user ||
      user.email.toLowerCase() !== headers.email.toLowerCase() ||
      user.role !== headers.role
    ) {
      return null;
    }
    const memberIds = [user._id.toHexString(), user.idOnTheSource].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
    const groups = await this.groups
      .find({ memberIds: { $in: memberIds } }, { projection: { name: 1 } })
      .toArray();
    const departments = groups.map((group) => group.name);
    return {
      ...headers,
      departments,
      ...authorizeIdentity({ role: user.role, departments, profile: this.config.profile }),
    };
  }

  async recordAudits(audits: CallAudit[]): Promise<void> {
    if (audits.length === 0) return;
    await this.audits.insertMany(audits, { ordered: false });
    const lastCallAt = audits.reduce(
      (latest, audit) => (audit.createdAt > latest ? audit.createdAt : latest),
      audits[0]!.createdAt,
    );
    await this.states.updateOne(
      { _id: 'credential' },
      { $set: { lastCallAt } },
      { upsert: true },
    );
  }

  async syncCredential(operator: string): Promise<void> {
    const now = new Date();
    await this.states.updateOne(
      { _id: 'credential' },
      {
        $set: {
          configured: true,
          fingerprintLast4: fingerprintLast4(this.config.upstreamSecret),
          updatedAt: now,
          updatedBy: operator,
        },
      },
      { upsert: true },
    );
  }

  async recordConnectionTest(input: {
    ok: boolean;
    message: string;
    toolCount?: number;
  }): Promise<void> {
    const update: Record<string, unknown> = {
      lastConnectionTestAt: new Date(),
      lastConnectionTestOk: input.ok,
      lastConnectionTestMessage: input.message.slice(0, 240),
    };
    if (input.toolCount != null) update.lastToolCount = input.toolCount;
    await this.states.updateOne({ _id: 'credential' }, { $set: update }, { upsert: true });
  }

  async status(now = new Date()): Promise<SafeStatus> {
    const month = currentMonth(now);
    const [state, monthlyCallCount] = await Promise.all([
      this.states.findOne({ _id: 'credential' }),
      this.audits.countDocuments({ month }),
    ]);
    const monthlyLimit = this.config.monthlyLimit > 0 ? this.config.monthlyLimit : null;
    return {
      configured:
        state?.configured === true &&
        state.fingerprintLast4 === fingerprintLast4(this.config.upstreamSecret),
      fingerprintLast4: state?.fingerprintLast4 ?? fingerprintLast4(this.config.upstreamSecret),
      updatedAt: state?.updatedAt ?? null,
      updatedBy: state?.updatedBy ?? null,
      lastConnectionTestAt: state?.lastConnectionTestAt ?? null,
      lastConnectionTestOk: state?.lastConnectionTestOk ?? null,
      lastConnectionTestMessage: state?.lastConnectionTestMessage ?? null,
      lastToolCount: state?.lastToolCount ?? null,
      lastCallAt: state?.lastCallAt ?? null,
      month,
      monthlyCallCount,
      monthlyLimit,
      usageRatio: monthlyLimit == null ? null : monthlyCallCount / monthlyLimit,
    };
  }

  async recentAudits(limit: number): Promise<Array<WithId<CallAudit>>> {
    return this.audits
      .find({}, { projection: { email: 0 } })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 200))
      .toArray();
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
