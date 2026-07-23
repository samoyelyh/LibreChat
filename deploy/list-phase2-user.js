const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const models = require('@librechat/data-schemas').createModels(mongoose);
const { SystemRoles } = require('librechat-data-provider');

(async () => {
  try {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is unavailable');
    await mongoose.connect(process.env.MONGO_URI, { bufferCommands: false });
    const user = await models.User.findOne({ role: { $ne: SystemRoles.ADMIN } })
      .sort({ createdAt: 1, _id: 1 })
      .select('_id email')
      .lean();
    if (!user?.email) throw new Error('No non-admin LibreChat user exists');
    process.stdout.write(`${JSON.stringify({ id: user._id.toString(), email: user.email.toLowerCase() })}\n`);
    await mongoose.disconnect();
  } catch (error) {
    process.stderr.write(`PHASE2_USER_ERROR ${error.message}\n`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  }
})();
