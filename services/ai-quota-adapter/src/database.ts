import { MongoClient, type Collection, type WithId } from 'mongodb';
import type { AuditStore, MappingStore } from './contracts.js';
import type { AiGatewayAccountMapping, CallAudit, SafeMapping } from './types.js';

type MappingDocument = AiGatewayAccountMapping;

function toSafe(document: WithId<MappingDocument>): SafeMapping {
  const safe: SafeMapping = {
    id: document._id.toHexString(),
    librechatUserId: document.librechatUserId,
    librechatEmail: document.librechatEmail,
    newApiUserId: document.newApiUserId,
    newApiUsername: document.newApiUsername,
    tokenFingerprint: document.tokenFingerprint,
    gatewayGroup: document.gatewayGroup,
    credentialStatus: document.credentialStatus,
    allowedModels: document.allowedModels,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
  if (document.lastSyncedAt) safe.lastSyncedAt = document.lastSyncedAt;
  if (document.lastError) safe.lastError = document.lastError;
  return safe;
}

export class MongoStores implements MappingStore, AuditStore {
  private readonly client: MongoClient;
  private readonly mappings: Collection<MappingDocument>;
  private readonly audits: Collection<CallAudit>;

  constructor(uri: string, auditRetentionDays: number) {
    this.client = new MongoClient(uri, { appName: 'woda-ai-quota-adapter', maxPoolSize: 20 });
    const db = this.client.db();
    this.mappings = db.collection<MappingDocument>('ai_gateway_account_mappings');
    this.audits = db.collection<CallAudit>('ai_gateway_call_audits');
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
      this.audits.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: this.auditRetentionDays * 86400, name: 'audit_retention_ttl' },
      ),
    ]);
  }

  async ping(): Promise<void> {
    await this.client.db().command({ ping: 1 });
  }

  async findActiveByUserId(userId: string): Promise<AiGatewayAccountMapping | null> {
    return this.mappings.findOne({
      librechatUserId: userId,
      credentialStatus: 'active',
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

  async listSafe(): Promise<SafeMapping[]> {
    const documents = await this.mappings.find({ deletedAt: { $exists: false } }).sort({ createdAt: 1 }).toArray();
    return documents.map(toSafe);
  }

  async record(audit: CallAudit): Promise<void> {
    await this.audits.insertOne(audit);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
