export type EcommerceProvider = 'lingxing' | 'sellersprite';
export type EcommerceColumnType = 'text' | 'number' | 'currency' | 'percent' | 'date';
export type EcommerceChartType = 'line' | 'bar' | 'pie' | 'scatter';
export type EcommerceCellValue = string | number | boolean | null;

export interface EcommerceColumn {
  key: string;
  title: string;
  type?: EcommerceColumnType;
}

export interface EcommerceMetric {
  label: string;
  value: string | number;
  unit?: string;
}

export interface EcommerceChartSuggestion {
  type: EcommerceChartType;
  title: string;
  xField?: string;
  yFields?: string[];
}

export interface EcommerceToolResult {
  success: boolean;
  provider: EcommerceProvider;
  toolName: string;
  requestId: string;
  rows?: Array<Record<string, EcommerceCellValue>>;
  columns?: EcommerceColumn[];
  metrics?: EcommerceMetric[];
  chartSuggestions?: EcommerceChartSuggestion[];
  elapsedMs: number;
  error?: { code: string; message: string };
}
