const admin = db.getSiblingDB('admin');
if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) {
  throw new Error('MongoDB root authentication failed');
}

const databaseName = process.env.SELLERSPRITE_MCP_DB || 'sellersprite_mcp_gateway';
const username = process.env.SELLERSPRITE_MCP_DB_USERNAME;
const password = process.env.SELLERSPRITE_MCP_DB_PASSWORD;
if (!username || !password) throw new Error('SellerSprite gateway MongoDB credentials are required');

const gatewayDb = db.getSiblingDB(databaseName);
const roles = [
  { role: 'readWrite', db: databaseName },
  { role: 'read', db: 'LibreChat' },
];
const existing = gatewayDb.getUser(username);
if (existing) {
  gatewayDb.updateUser(username, { pwd: password, roles });
} else {
  gatewayDb.createUser({ user: username, pwd: password, roles });
}
print('SELLERSPRITE_MONGO_USER_OK');
