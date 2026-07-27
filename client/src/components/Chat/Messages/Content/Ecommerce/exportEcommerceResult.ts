import type { EcommerceCellValue, EcommerceToolResult } from './types';

function safeText(value: EcommerceCellValue): string {
  const text = value == null ? '' : String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: EcommerceCellValue): string {
  return `"${safeText(value).replaceAll('"', '""')}"`;
}

function xmlText(value: EcommerceCellValue): string {
  const escaped = safeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
  return [...escaped]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('');
}

export function createCsv(result: EcommerceToolResult): string {
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const header = columns.map((column) => csvCell(column.title)).join(',');
  const body = rows.map((row) =>
    columns.map((column) => csvCell(row[column.key] ?? null)).join(','),
  );
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

export function createExcelXml(result: EcommerceToolResult): string {
  const columns = result.columns ?? [];
  const rows = result.rows ?? [];
  const excelRows = [
    columns.map((column) => `<Cell><Data ss:Type="String">${xmlText(column.title)}</Data></Cell>`),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = row[column.key] ?? null;
        const isNumber = typeof value === 'number' && Number.isFinite(value);
        return `<Cell><Data ss:Type="${isNumber ? 'Number' : 'String'}">${xmlText(value)}</Data></Cell>`;
      }),
    ),
  ]
    .map((cells) => `<Row>${cells.join('')}</Row>`)
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Data"><Table>${excelRows}</Table></Worksheet>
</Workbook>`;
}

function safeFilename(value: string): string {
  const withoutControls = [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('');
  return withoutControls.replace(/[<>:"/\\|?*]/g, '-').slice(0, 100) || 'data';
}

function download(content: string, mimeType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(result: EcommerceToolResult): void {
  download(
    createCsv(result),
    'text/csv;charset=utf-8',
    `${safeFilename(result.toolName)}-${safeFilename(result.requestId)}.csv`,
  );
}

export function downloadExcel(result: EcommerceToolResult): void {
  download(
    createExcelXml(result),
    'application/vnd.ms-excel;charset=utf-8',
    `${safeFilename(result.toolName)}-${safeFilename(result.requestId)}.xls`,
  );
}
