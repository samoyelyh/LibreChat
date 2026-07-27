import { describe, expect, it } from 'vitest';
import { structureToolCallBody } from './structured-result.js';

describe('EcommerceToolResult', () => {
  it('normalizes LingXing rows and source metadata', () => {
    const output = structureToolCallBody({
      text: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                data: [
                  { sku: 'SKU-1', profit: 12.5 },
                  { sku: 'SKU-2', profit: 7.5 },
                ],
              }),
            },
          ],
        },
      }),
      contentType: 'application/json',
      calls: [{ id: 9, tool: 'get_profit_report_msku' }],
      provider: 'lingxing',
      requestId: 'request-9',
      elapsedMs: 31,
    });
    const parsed = JSON.parse(output);
    expect(parsed.result.structuredContent).toMatchObject({
      success: true,
      provider: 'lingxing',
      toolName: 'get_profit_report_msku',
      requestId: 'request-9',
      elapsedMs: 31,
    });
    expect(parsed.result.structuredContent.rows).toHaveLength(2);
    expect(parsed.result.structuredContent.columns).toContainEqual({
      key: 'profit',
      title: 'profit',
      type: 'currency',
    });
  });
});
