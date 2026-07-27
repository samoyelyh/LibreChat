import { CheckCircle2, Database, Download, XCircle } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { downloadCsv, downloadExcel } from './exportEcommerceResult';
import SafeChart from './SafeChart';
import type { EcommerceCellValue, EcommerceToolResult } from './types';

const MAX_VISIBLE_ROWS = 500;
const EXCEL_LABEL = 'Excel';

function display(value: EcommerceCellValue | undefined): string {
  return value == null ? '' : String(value);
}

export default function EcommerceResult({ result }: { result: EcommerceToolResult }) {
  const localize = useLocalize();
  const source = result.provider === 'lingxing' ? 'LingXing ERP' : 'SellerSprite';
  const rows = result.rows ?? [];
  const columns = result.columns ?? [];
  const canExport = rows.length > 0 && columns.length > 0;
  const elapsed = new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: 'millisecond',
    unitDisplay: 'short',
  }).format(result.elapsedMs);

  return (
    <section className="space-y-3" data-testid="ecommerce-tool-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs text-text-secondary">
          <Database className="size-4 shrink-0" aria-hidden="true" />
          <span className="rounded-full bg-surface-tertiary px-2 py-0.5 font-medium">{source}</span>
          <span className="truncate font-mono">{result.toolName}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{elapsed}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{result.requestId.slice(0, 8)}</span>
          {result.success ? (
            <CheckCircle2 className="size-4 text-green-600" aria-hidden="true" />
          ) : (
            <XCircle className="size-4 text-red-600" aria-hidden="true" />
          )}
        </div>
        {canExport && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary hover:bg-surface-tertiary"
              aria-label={`${localize('com_ui_download')} CSV`}
              onClick={() => downloadCsv(result)}
            >
              <Download className="size-3.5" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border-light bg-surface-primary px-2 py-1 text-xs text-text-primary hover:bg-surface-tertiary"
              aria-label={`${localize('com_ui_download')} ${EXCEL_LABEL}`}
              onClick={() => downloadExcel(result)}
            >
              <Download className="size-3.5" aria-hidden="true" />
              {EXCEL_LABEL}
            </button>
          </div>
        )}
      </div>

      {result.error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 font-mono text-xs text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {result.error.code}: {result.error.message}
        </div>
      )}

      {result.metrics && result.metrics.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {result.metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border-light bg-surface-primary p-3"
            >
              <div className="truncate text-xs text-text-secondary">{metric.label}</div>
              <div className="mt-1 break-words text-lg font-semibold text-text-primary">
                {metric.value}
                {metric.unit ? (
                  <span className="ml-1 text-xs font-normal text-text-secondary">
                    {metric.unit}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {result.chartSuggestions && rows.length > 1 && (
        <div className="grid gap-3 xl:grid-cols-2">
          {result.chartSuggestions.map((chart, index) => (
            <SafeChart key={`${chart.type}-${chart.title}-${index}`} chart={chart} rows={rows} />
          ))}
        </div>
      )}

      {rows.length > 0 && columns.length > 0 && (
        <div className="overflow-auto rounded-lg border border-border-light bg-surface-primary">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">{result.toolName}</caption>
            <thead className="sticky top-0 bg-surface-tertiary text-text-secondary">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className="whitespace-nowrap px-3 py-2 font-medium"
                  >
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, MAX_VISIBLE_ROWS).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-border-light align-top">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="max-w-[360px] whitespace-pre-wrap break-words px-3 py-2"
                    >
                      {display(row[column.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > MAX_VISIBLE_ROWS && (
            <div className="border-t border-border-light px-3 py-2 text-xs text-text-secondary">
              {MAX_VISIBLE_ROWS} / {rows.length}
            </div>
          )}
        </div>
      )}

      <details className="rounded-lg border border-border-light bg-surface-primary">
        <summary className="cursor-pointer px-3 py-2 text-xs text-text-secondary">
          {localize('com_ui_details')}
        </summary>
        <pre className="max-h-[320px] overflow-auto border-t border-border-light p-3 text-xs">
          <code className="hljs language-json !whitespace-pre-wrap !break-words">
            {JSON.stringify(result, null, 2)}
          </code>
        </pre>
      </details>
    </section>
  );
}
