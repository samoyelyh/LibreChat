import { createCsv, createExcelXml } from '../exportEcommerceResult';
import { parseEcommerceResult } from '../parseEcommerceResult';

const validResult = {
  success: true,
  provider: 'lingxing',
  toolName: 'get_profit_report_msku',
  requestId: 'request-1',
  rows: [
    { date: '2026-07-01', profit: 12.5, sku: '=FORMULA()' },
    { date: '2026-07-02', profit: 18, sku: 'SKU-2' },
  ],
  columns: [
    { key: 'date', title: 'Date', type: 'date' },
    { key: 'profit', title: 'Profit', type: 'currency' },
    { key: 'sku', title: 'SKU', type: 'text' },
  ],
  metrics: [{ label: 'totalProfit', value: 30.5 }],
  chartSuggestions: [
    {
      type: 'line',
      title: 'Profit / Date',
      xField: 'date',
      yFields: ['profit'],
    },
  ],
  elapsedMs: 17,
};

describe('parseEcommerceResult', () => {
  it('accepts the safe declarative protocol', () => {
    expect(parseEcommerceResult(JSON.stringify(validResult))).toMatchObject(validResult);
  });

  it('rejects non-protocol JSON and drops unsafe chart fields', () => {
    expect(parseEcommerceResult('{"rows":[]}')).toBeNull();
    const parsed = parseEcommerceResult(
      JSON.stringify({
        ...validResult,
        chartSuggestions: [
          {
            type: 'javascript',
            title: '<script>alert(1)</script>',
            xField: 'date',
            yFields: ['profit'],
          },
          {
            type: 'line',
            title: 'Unknown field',
            xField: 'date',
            yFields: ['constructor'],
          },
        ],
      }),
    );
    expect(parsed?.chartSuggestions).toBeUndefined();
  });
});

describe('structured exports', () => {
  it('creates CSV and Excel-compatible XML without formula injection', () => {
    const parsed = parseEcommerceResult(JSON.stringify(validResult));
    expect(parsed).not.toBeNull();
    const csv = createCsv(parsed!);
    const excel = createExcelXml(parsed!);
    expect(csv).toContain(`"'=FORMULA()"`);
    expect(excel).toContain('&apos;=FORMULA()');
    expect(excel).toContain('ss:Type="Number">12.5');
    expect(excel).toContain('<Worksheet ss:Name="Data">');
  });
});
