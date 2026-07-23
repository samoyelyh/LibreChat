import { createHash } from 'node:crypto';
import { MongoClient, ObjectId, type Collection, type WithId } from 'mongodb';
import { authorizeIdentity } from './policy.js';
import type {
  ActorHeaders,
  CallAudit,
  CredentialState,
  GatewayConfig,
  SafeStatus,
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
    ]);
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
      ...authorizeIdentity({ role: user.role, departments }),
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
