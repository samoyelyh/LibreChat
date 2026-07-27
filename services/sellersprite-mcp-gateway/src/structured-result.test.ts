import { describe, expect, it } from 'vitest';
import { structureToolCallBody } from './structured-result.js';

function structure(text: string, contentType = 'application/json') {
  return structureToolCallBody({
    text,
    contentType,
    calls: [{ id: 7, tool: 'market_research' }],
    provider: 'sellersprite',
    requestId: 'request-7',
    elapsedMs: 42,
  });
}

describe('EcommerceToolResult', () => {
  it('normalizes rows, columns, metrics and declarative charts', () => {
    const output = structure(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                data: {
                  total: 2,
                  rows: [
                    { date: '2026-07-01', sales: 10, shareRate: 0.4 },
                    { date: '2026-07-02', sales: 15, shareRate: 0.6 },
                  ],
                },
              }),
            },
          ],
        },
      }),
    );
    const parsed = JSON.parse(output);
    const result = parsed.result.structuredContent;
    expect(result).toMatchObject({
      success: true,
      provider: 'sellersprite',
      toolName: 'market_research',
      requestId: 'request-7',
      elapsedMs: 42,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.columns).toContainEqual({ key: 'date', title: 'date', type: 'date' });
    expect(result.metrics).toContainEqual({ label: 'total', value: 2 });
    expect(result.chartSuggestions[0]).toMatchObject({
      type: 'line',
      xField: 'date',
      yFields: ['sales', 'shareRate'],
    });
    expect(JSON.parse(parsed.result.content[0].text)).toEqual(result);
  });

  it('normalizes an SSE tool event without evaluating content', () => {
    const input =
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"[{\\"keyword\\":\\"shoes\\",\\"sales\\":3}]"}]}}\n\n';
    const output = structure(input, 'text/event-stream');
    expect(output).toContain('"provider":"sellersprite"');
    expect(output).toContain('"toolName":"market_research"');
    expect(output).toContain('"keyword":"shoes"');
  });

  it('represents tool errors without claiming success', () => {
    const output = structure(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        result: { isError: true, content: [{ type: 'text', text: 'upstream rejected request' }] },
      }),
    );
    const parsed = JSON.parse(output);
    expect(parsed.result.structuredContent).toMatchObject({
      success: false,
      error: { code: 'mcp_tool_error', message: 'upstream rejected request' },
    });
  });
});
