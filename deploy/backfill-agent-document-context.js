const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
require('module-alias')({ base: path.resolve('/app/api') });

const connect = require('/app/config/connect');
const { parseDocument } = require('@librechat/api');
const models = require('@librechat/data-schemas').createModels(mongoose);
const { documentParserMimeTypes } = require('librechat-data-provider');

const targetFilename = process.env.TARGET_FILENAME?.trim();
const targetUserId = process.env.TARGET_USER_ID?.trim();

function resolveLocalPath(filepath) {
  if (!filepath?.startsWith('/uploads/')) {
    throw new Error('The selected file is not stored under the local uploads directory');
  }
  const root = path.resolve('/app/uploads');
  const resolved = path.resolve('/app', ...filepath.split('/').filter(Boolean));
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('The selected file resolves outside the local uploads directory');
  }
  return resolved;
}

(async () => {
  try {
    if (!targetFilename) {
      throw new Error('TARGET_FILENAME is required');
    }
    await connect();
    const filter = { filename: targetFilename, source: 'local' };
    if (targetUserId) {
      filter.user = targetUserId;
    }
    const files = await models.File.find(filter);
    if (files.length !== 1) {
      throw new Error(`Expected exactly one matching local file, found ${files.length}`);
    }

    const file = files[0];
    if (!documentParserMimeTypes.some((pattern) => pattern.test(file.type))) {
      throw new Error(`Unsupported historical document type: ${file.type}`);
    }
    if (file.textFormat === 'text' && file.text?.trim()) {
      console.log(`AGENT_DOCUMENT_BACKFILL_SKIPPED file_id=${file.file_id} reason=already_extracted`);
      return;
    }

    const filepath = resolveLocalPath(file.filepath);
    const stat = await fs.stat(filepath);
    const result = await parseDocument({
      file: {
        path: filepath,
        size: stat.size,
        mimetype: file.type,
        originalname: file.filename,
      },
    });
    await models.File.updateOne(
      { _id: file._id },
      { $set: { text: result.text, textFormat: 'text' } },
    );
    console.log(
      `AGENT_DOCUMENT_BACKFILL_OK file_id=${file.file_id} extracted_bytes=${Buffer.byteLength(result.text, 'utf8')}`,
    );
  } catch (error) {
    console.error(`AGENT_DOCUMENT_BACKFILL_ERROR ${error.message}`);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  }
})();
