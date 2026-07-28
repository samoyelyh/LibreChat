const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn() },
}));
jest.mock('sharp');
jest.mock('../images/resize');
jest.mock('~/models', () => ({
  updateUser: jest.fn(),
  updateFile: jest.fn(),
}));

const { logger } = require('@librechat/data-schemas');
const { updateFile } = require('~/models');
const { prepareImagesLocal } = require('./images');

describe('prepareImagesLocal', () => {
  let publicPath;
  let req;

  beforeEach(() => {
    jest.clearAllMocks();
    publicPath = fs.mkdtempSync(path.join(os.tmpdir(), 'librechat-images-'));
    req = {
      user: { id: 'user-1' },
      config: {
        paths: {
          publicPath,
          imageOutput: path.join(publicPath, 'images'),
        },
      },
    };
  });

  afterEach(() => {
    fs.rmSync(publicPath, { recursive: true, force: true });
  });

  it('returns the encoded image when the local file exists', async () => {
    const imagePath = path.join(publicPath, 'images', 'user-1', 'available.png');
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from('available-image'));
    const file = { file_id: 'file-1', filepath: '/images/user-1/available.png' };
    updateFile.mockResolvedValue(file);

    await expect(prepareImagesLocal(req, file)).resolves.toEqual([
      file,
      Buffer.from('available-image').toString('base64'),
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips a missing historical image while preserving its metadata', async () => {
    const file = { file_id: 'file-2', filepath: '/images/user-1/missing.png' };
    updateFile.mockResolvedValue(file);

    await expect(prepareImagesLocal(req, file)).resolves.toEqual([file, null]);
    expect(logger.warn).toHaveBeenCalledWith('[Files] Missing local image attachment skipped', {
      fileId: 'file-2',
      userId: 'user-1',
    });
  });

  it('does not suppress local file errors other than a missing file', async () => {
    const file = { file_id: 'file-3', filepath: '/images/user-1' };
    updateFile.mockResolvedValue(file);

    await expect(prepareImagesLocal(req, file)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
