import type { ServerRequest } from '~/types';
import { resolveFileContextTokenLimit } from './context';

describe('resolveFileContextTokenLimit', () => {
  const req = {
    body: { fileTokenLimit: 100_000 },
    config: {},
  } as ServerRequest;

  test('keeps the configured per-file limit for one file when it fits the shared budget', () => {
    expect(
      resolveFileContextTokenLimit({ req, maxContextTokens: 380_000, fileCount: 1 }),
    ).toBe(100_000);
  });

  test('shares a capped budget across several large files', () => {
    expect(
      resolveFileContextTokenLimit({ req, maxContextTokens: 380_000, fileCount: 5 }),
    ).toBe(24_000);
  });

  test('uses forty percent of a smaller model context', () => {
    expect(
      resolveFileContextTokenLimit({ req, maxContextTokens: 200_000, fileCount: 4 }),
    ).toBe(20_000);
  });

  test('falls back to the absolute total budget when model context is unknown', () => {
    expect(resolveFileContextTokenLimit({ req, fileCount: 3 })).toBe(40_000);
  });

  test('does not raise a deliberately smaller configured limit', () => {
    const smallReq = {
      body: { fileTokenLimit: 500 },
      config: {},
    } as ServerRequest;
    expect(
      resolveFileContextTokenLimit({ req: smallReq, maxContextTokens: 380_000, fileCount: 10 }),
    ).toBe(500);
  });
});
