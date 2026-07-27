import type {
  EcommerceCellValue,
  EcommerceChartSuggestion,
  EcommerceColumn,
  EcommerceColumnType,
  EcommerceMetric,
  EcommerceToolResult,
} from './types';

type JsonObject = Record<string, unknown>;

const COLUMN_TYPES = new Set<EcommerceColumnType>([
  'text',
  'number',
  'currency',
  'percent',
  'date',
]);
const CHART_TYPES = new Set(['line', 'bar', 'pie', 'scatter']);

function object(value: unknown): JsonObject | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function shortString(value: unknown, max = 500): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;
}

function cell(value: unknown): EcommerceCellValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  return undefined;
}

function rows(value: unknown): EcommerceToolResult['rows'] {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, 20_000).map((entry) => {
    const source = object(entry);
    if (!source) return {};
    const safe: Record<string, EcommerceCellValue> = {};
    for (const [key, item] of Object.entries(source).slice(0, 100)) {
      const parsed = cell(item);
      if (parsed !== undefined) safe[key.slice(0, 200)] = parsed;
    }
    return safe;
  });
}

function columns(value: unknown): EcommerceColumn[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const safe = value.slice(0, 100).flatMap((entry) => {
    const source = object(entry);
    const key = shortString(source?.key, 200);
    const title = shortString(source?.title, 200);
    if (!key || !title) return [];
    const type = COLUMN_TYPES.has(source?.type as EcommerceColumnType)
      ? (source?.type as EcommerceColumnType)
      : undefined;
    return [{ key, title, ...(type ? { type } : {}) }];
  });
  return safe.length > 0 ? safe : undefined;
}

function metrics(value: unknown): EcommerceMetric[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const safe = value.slice(0, 24).flatMap((entry) => {
    const source = object(entry);
    const label = shortString(source?.label, 200);
    const metricValue = source?.value;
    if (
      !label ||
      !(
        typeof metricValue === 'string' ||
        (typeof metricValue === 'number' && Number.isFinite(metricValue))
      )
    ) {
      return [];
    }
    const unit = shortString(source?.unit, 50);
    return [{ label, value: metricValue, ...(unit ? { unit } : {}) }];
  });
  return safe.length > 0 ? safe : undefined;
}

function charts(
  value: unknown,
  allowedFields: Set<string>,
): EcommerceChartSuggestion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const safe = value.slice(0, 8).flatMap((entry) => {
    const source = object(entry);
    if (!source) return [];
    const title = shortString(source.title, 300);
    const type = source.type;
    if (!title || typeof type !== 'string' || !CHART_TYPES.has(type)) return [];
    const xField = shortString(source.xField, 200);
    const yFields = Array.isArray(source.yFields)
      ? source.yFields
          .filter((field): field is string => typeof field === 'string' && allowedFields.has(field))
          .slice(0, 4)
      : [];
    if (!xField || !allowedFields.has(xField) || yFields.length === 0) return [];
    return [
      {
        type: type as EcommerceChartSuggestion['type'],
        title,
        xField,
        yFields,
      },
    ];
  });
  return safe.length > 0 ? safe : undefined;
}

export function parseEcommerceResult(text: string): EcommerceToolResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const source = object(parsed);
  if (
    !source ||
    typeof source.success !== 'boolean' ||
    (source.provider !== 'lingxing' && source.provider !== 'sellersprite') ||
    typeof source.elapsedMs !== 'number' ||
    !Number.isFinite(source.elapsedMs)
  ) {
    return null;
  }
  const toolName = shortString(source.toolName, 300);
  const requestId = shortString(source.requestId, 300);
  if (!toolName || !requestId) return null;

  const safeRows = rows(source.rows);
  const safeColumns = columns(source.columns);
  const allowedFields = new Set(safeColumns?.map((column) => column.key) ?? []);
  const safeMetrics = metrics(source.metrics);
  const safeCharts = charts(source.chartSuggestions, allowedFields);
  const errorObject = object(source.error);
  const errorCode = shortString(errorObject?.code, 200);
  const errorMessage = shortString(errorObject?.message, 1000);

  return {
    success: source.success,
    provider: source.provider,
    toolName,
    requestId,
    ...(safeRows ? { rows: safeRows } : {}),
    ...(safeColumns ? { columns: safeColumns } : {}),
    ...(safeMetrics ? { metrics: safeMetrics } : {}),
    ...(safeCharts ? { chartSuggestions: safeCharts } : {}),
    elapsedMs: Math.max(0, source.elapsedMs),
    ...(errorCode && errorMessage ? { error: { code: errorCode, message: errorMessage } } : {}),
  };
}
