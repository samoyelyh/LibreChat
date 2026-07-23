const admin = db.getSiblingDB('admin');
if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) {
  throw new Error('MongoDB root authentication failed');
}

const databaseName = process.env.AI_ADAPTER_DB_NAME || 'ai_quota_adapter';
const username = process.env.AI_ADAPTER_DB_USERNAME;
const password = process.env.AI_ADAPTER_DB_PASSWORD;
if (!username || !password) throw new Error('Adapter MongoDB credentials are required');

const adapterDb = db.getSiblingDB(databaseName);
const role = { role: 'readWrite', db: databaseName };
const existing = adapterDb.getUser(username);
if (existing) {
  adapterDb.updateUser(username, { pwd: password, roles: [role] });
} else {
  adapterDb.createUser({ user: username, pwd: password, roles: [role] });
}
print('AI_ADAPTER_MONGO_USER_OK');
