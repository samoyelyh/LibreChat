import { describe, expect, it } from 'vitest';
import { authorizeIdentity } from './policy.js';
import { testing } from './proxy.js';
import type { VerifiedActor } from './types.js';

const advertising: VerifiedActor = {
  userId: '507f1f77bcf86cd799439011',
  email: 'ads@example.com',
  role: 'advertising',
  departments: ['广告组'],
  ...authorizeIdentity({ role: 'advertising', departments: ['广告组'] }),
};

describe('MCP proxy transformations', () => {
  it('extracts tools/call without logging arguments', () => {
    const calls = testing.toolCalls({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'traffic_keyword', arguments: { asin: 'B000TEST' } },
    });
    expect(calls).toEqual([{ id: 7, tool: 'traffic_keyword' }]);
    expect(JSON.stringify(calls)).not.toContain('B000TEST');
  });

  it('filters an SSE tools/list event', () => {
    const input =
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"traffic_keyword"},{"name":"review"}]}}\n\n';
    const output = testing.filterToolsBody(input, advertising, 'text/event-stream');
    expect(output).toContain('traffic_keyword');
    expect(output).not.toContain('"review"');
  });

  it('extracts record counts without retaining response bodies', () => {
    expect(testing.nestedRecordCount({ result: { content: [{ text: '{"data":[1,2,3]}' }] } })).toBe(
      3,
    );
    expect(testing.nestedRecordCount({ result: { data: { total: 19 } } })).toBe(19);
  });
});
