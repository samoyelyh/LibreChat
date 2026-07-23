import { describe, expect, it } from 'vitest';
import { normalizedUrl } from '../src/new-api.js';

describe('New API URL normalization', () => {
  it('retains the configured v1 prefix for OpenAI-compatible routes', () => {
    expect(normalizedUrl('https://api.aso8ty.com/v1', '/v1/models')).toBe(
      'https://api.aso8ty.com/v1/models',
    );
    expect(normalizedUrl('https://api.aso8ty.com/v1/', '/v1/chat/completions')).toBe(
      'https://api.aso8ty.com/v1/chat/completions',
    );
  });

  it('resolves New API management routes from the origin', () => {
    expect(normalizedUrl('https://api.aso8ty.com/v1', '/api/usage/token')).toBe(
      'https://api.aso8ty.com/api/usage/token',
    );
  });
});
