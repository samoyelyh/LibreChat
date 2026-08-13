import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  SELLERSPRITE_MCP_PROFILE: 'sellersprite',
  SELLERSPRITE_MCP_INTERNAL_KEY: 'i'.repeat(32),
  SELLERSPRITE_MCP_URL: 'https://mcp.sellersprite.com/mcp',
  SELLERSPRITE_MCP_SECRET_KEY: 'secret-value',
  SELLERSPRITE_MCP_MONGO_URI: 'mongodb://example',
};

describe('gateway configuration', () => {
  it('accepts a server-side secret header configuration', () => {
    const config = loadConfig(base);
    expect(config.upstreamUrl).toBe('https://mcp.sellersprite.com/mcp');
    expect(config.upstreamSecret).toBe('secret-value');
  });

  it('rejects URL-based secrets', () => {
    expect(() =>
      loadConfig({
        ...base,
        SELLERSPRITE_MCP_URL: 'https://mcp.sellersprite.com/mcp?secret-key=leak',
      }),
    ).toThrow('must not contain secret-key');
  });

  it('rejects non-TLS upstream URLs', () => {
    expect(() =>
      loadConfig({ ...base, SELLERSPRITE_MCP_URL: 'http://mcp.sellersprite.com/mcp' }),
    ).toThrow();
  });

  it('allows a private HTTP upstream only for the resume profile', () => {
    const config = loadConfig({
      ...base,
      SELLERSPRITE_MCP_PROFILE: 'resume',
      SELLERSPRITE_MCP_URL: 'http://192.168.0.27:10099/mcp',
    });
    expect(config.profile).toBe('resume');
    expect(config.upstreamAuth).toBe('bearer');
  });

  it('rejects a public HTTP upstream for the resume profile', () => {
    expect(() =>
      loadConfig({
        ...base,
        SELLERSPRITE_MCP_PROFILE: 'resume',
        SELLERSPRITE_MCP_URL: 'http://example.com/mcp',
      }),
    ).toThrow('must use HTTPS');
  });
});
