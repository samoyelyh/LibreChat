export type EcommerceProvider = 'lingxing' | 'sellersprite';
export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date';
export type ChartType = 'line' | 'bar' | 'pie' | 'scatter';
export type CellValue = string | number | boolean | null;

export interface EcommerceToolResult {
  success: boolean;
  provider: EcommerceProvider;
  toolName: string;
  requestId: string;
  rows?: Array<Record<string, CellValue>>;
  columns?: Array<{ key: string; title: string; type?: ColumnType }>;
  metrics?: Array<{ label: string; value: string | number; unit?: string }>;
  chartSuggestions?: Array<{
    type: ChartType;
    title: string;
    xField?: string;
    yFields?: string[];
  }>;
  elapsedMs: number;
  error?: { code: string; message: string };
}

interface ToolCallRef {
  id?: string | number | null;
  tool: string;
}

type JsonObject = Record<string, unknown>;

const ROW_KEYS = ['rows', 'records', 'items', 'list'];
const NESTED_KEYS = ['data', 'result', 'payload'];
const METRIC_KEY =
  /(total|count|sales|revenue|profit|amount|rate|ratio|percent|average|avg|price)/i;
const DATE_KEY = /(date|time|day|week|month|year|日期|时间|月份|年份)/i;
const PERCENT_KEY = /(rate|ratio|percent|ctr|cvr|acos|roas|占比|率$)/i;
const CURRENCY_KEY =
  /(price|sales|revenue|profit|amount|cost|spend|fee|价格|销售额|利润|成本|费用)/i;

function asObject(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function parseText(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function resultPayload(result: JsonObject): unknown {
  if (result.structuredContent != null) return result.structuredContent;
  if (!Array.isArray(result.content)) return result;

  const values = result.content
    .map((part) => asObject(part))
    .filter((part): part is JsonObject => part != null && part.type === 'text')
    .map((part) => (typeof part.text === 'string' ? parseText(part.text) : null))
    .filter((value) => value != null && value !== '');
  if (values.length === 1) return values[0];
  if (values.length > 1) return values;
  return result;
}

function cell(value: unknown): CellValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function row(value: unknown): Record<string, CellValue> {
  const object = asObject(value);
  if (!object) return { value: cell(value) };
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, cell(entry)]));
}

function findRows(value: unknown, depth = 0): Array<Record<string, CellValue>> {
  if (depth > 6) return [];
  if (typeof value === 'string') {
    const parsed = parseText(value);
    return parsed === value ? [{ result: value }] : findRows(parsed, depth + 1);
  }
  if (Array.isArray(value)) return value.map(row);
  const object = asObject(value);
  if (!object) return value == null ? [] : [row(value)];

  for (const key of ROW_KEYS) {
    if (Array.isArray(object[key])) return object[key].map(row);
  }
  for (const key of NESTED_KEYS) {
    if (object[key] != null) {
      const nested = findRows(object[key], depth + 1);
      if (nested.length > 0) return nested;
    }
  }

  const scalarEntries = Object.entries(object).filter(([, entry]) => {
    return entry === null || ['string', 'number', 'boolean'].includes(typeof entry);
  });
  return scalarEntries.length > 0 ? [row(Object.fromEntries(scalarEntries))] : [];
}

function inferColumnType(key: string, values: CellValue[]): ColumnType {
  if (DATE_KEY.test(key)) return 'date';
  if (PERCENT_KEY.test(key)) return 'percent';
  if (CURRENCY_KEY.test(key)) return 'currency';
  const present = values.filter((value) => value !== null && value !== '');
  return present.length > 0 && present.every((value) => typeof value === 'number')
    ? 'number'
    : 'text';
}

function columns(rows: Array<Record<string, CellValue>>) {
  const keys = [...new Set(rows.flatMap((entry) => Object.keys(entry)))];
  return keys.map((key) => ({
    key,
    title: key,
    type: inferColumnType(
      key,
      rows.map((entry) => entry[key] ?? null),
    ),
  }));
}

function metricObjects(value: unknown): JsonObject[] {
  const root = asObject(value);
  if (!root) return [];
  return [
    root,
    ...NESTED_KEYS.map((key) => asObject(root[key])).filter(
      (entry): entry is JsonObject => entry != null,
    ),
  ];
}

function metrics(value: unknown, rowCount: number) {
  const found = new Map<string, string | number>();
  for (const object of metricObjects(value)) {
    for (const [key, entry] of Object.entries(object)) {
      if (
        METRIC_KEY.test(key) &&
        (typeof entry === 'number' || typeof entry === 'string') &&
        String(entry).length <= 80
      ) {
        found.set(key, entry);
      }
    }
  }
  if (rowCount > 1 && !found.has('rowCount')) found.set('rowCount', rowCount);
  return [...found.entries()].slice(0, 12).map(([label, value]) => ({ label, value }));
}

function chartSuggestions(
  rows: Array<Record<string, CellValue>>,
  defs: ReturnType<typeof columns>,
): EcommerceToolResult['chartSuggestions'] {
  if (rows.length < 2) return undefined;
  const numeric = defs.filter((column) =>
    rows.some((entry) => typeof entry[column.key] === 'number'),
  );
  const date = defs.find((column) => column.type === 'date');
  const category = defs.find(
    (column) => column.type === 'text' && rows.some((entry) => entry[column.key] != null),
  );
  const suggestions: NonNullable<EcommerceToolResult['chartSuggestions']> = [];

  if (date && numeric.length > 0) {
    suggestions.push({
      type: 'line',
      title: `${numeric[0]!.title} / ${date.title}`,
      xField: date.key,
      yFields: numeric.slice(0, 3).map((column) => column.key),
    });
  } else if (category && numeric.length > 0) {
    suggestions.push({
      type: 'bar',
      title: `${numeric[0]!.title} / ${category.title}`,
      xField: category.key,
      yFields: [numeric[0]!.key],
    });
  }

  if (category && numeric.length > 0 && rows.length <= 12 && PERCENT_KEY.test(numeric[0]!.key)) {
    suggestions.push({
      type: 'pie',
      title: `${numeric[0]!.title} / ${category.title}`,
      xField: category.key,
      yFields: [numeric[0]!.key],
    });
  } else if (numeric.length >= 2) {
    suggestions.push({
      type: 'scatter',
      title: `${numeric[1]!.title} / ${numeric[0]!.title}`,
      xField: numeric[0]!.key,
      yFields: [numeric[1]!.key],
    });
  }
  return suggestions.length > 0 ? suggestions.slice(0, 2) : undefined;
}

function errorFromResult(result: JsonObject): EcommerceToolResult['error'] {
  if (result.isError !== true) return undefined;
  const payload = resultPayload(result);
  const message = typeof payload === 'string' ? payload : 'The upstream MCP tool reported an error';
  return { code: 'mcp_tool_error', message: message.slice(0, 1000) };
}

function buildResult(input: {
  result: JsonObject;
  call: ToolCallRef;
  provider: EcommerceProvider;
  requestId: string;
  elapsedMs: number;
}): EcommerceToolResult {
  const payload = resultPayload(input.result);
  const dataRows = findRows(payload);
  const dataColumns = columns(dataRows);
  const dataMetrics = metrics(payload, dataRows.length);
  const dataCharts = chartSuggestions(dataRows, dataColumns);
  const error = errorFromResult(input.result);
  return {
    success: error == null,
    provider: input.provider,
    toolName: input.call.tool,
    requestId: input.requestId,
    ...(dataRows.length > 0 ? { rows: dataRows, columns: dataColumns } : {}),
    ...(dataMetrics.length > 0 ? { metrics: dataMetrics } : {}),
    ...(dataCharts ? { chartSuggestions: dataCharts } : {}),
    elapsedMs: input.elapsedMs,
    ...(error ? { error } : {}),
  };
}

function sameId(left: ToolCallRef['id'], right: unknown): boolean {
  return left === undefined || left === right;
}

function transformResponse(
  value: unknown,
  calls: ToolCallRef[],
  provider: EcommerceProvider,
  requestId: string,
  elapsedMs: number,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => transformResponse(entry, calls, provider, requestId, elapsedMs));
  }
  const response = asObject(value);
  const result = asObject(response?.result);
  if (!response || !result) return value;
  const call = calls.find((entry) => sameId(entry.id, response.id));
  if (!call) return value;

  const structured = buildResult({ result, call, provider, requestId, elapsedMs });
  const nonTextContent = Array.isArray(result.content)
    ? result.content.filter((part) => asObject(part)?.type !== 'text')
    : [];
  return {
    ...response,
    result: {
      ...result,
      structuredContent: structured,
      content: [{ type: 'text', text: JSON.stringify(structured) }, ...nonTextContent],
    },
  };
}

export function structureToolCallBody(input: {
  text: string;
  contentType: string;
  calls: ToolCallRef[];
  provider: EcommerceProvider;
  requestId: string;
  elapsedMs: number;
}): string {
  if (input.calls.length === 0) return input.text;
  const transform = (text: string): string => {
    try {
      return JSON.stringify(
        transformResponse(
          JSON.parse(text) as unknown,
          input.calls,
          input.provider,
          input.requestId,
          input.elapsedMs,
        ),
      );
    } catch {
      return text;
    }
  };
  if (!input.contentType.includes('text/event-stream')) return transform(input.text);
  return input.text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith('data:')) return line;
      const data = line.slice(5).trim();
      return data && data !== '[DONE]' ? `data: ${transform(data)}` : line;
    })
    .join('\n');
}
