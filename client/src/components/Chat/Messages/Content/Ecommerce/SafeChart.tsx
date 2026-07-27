import type { EcommerceCellValue, EcommerceChartSuggestion, EcommerceToolResult } from './types';

const COLORS = ['#2563eb', '#7c3aed', '#059669', '#ea580c'];
const WIDTH = 640;
const HEIGHT = 240;
const LEFT = 48;
const TOP = 16;
const RIGHT = 20;
const BOTTOM = 36;

function number(value: EcommerceCellValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function range(values: number[]): { min: number; max: number } {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  return min === max ? { min, max: min + 1 } : { min, max };
}

function point(index: number, count: number, value: number, domain: { min: number; max: number }) {
  const plotWidth = WIDTH - LEFT - RIGHT;
  const plotHeight = HEIGHT - TOP - BOTTOM;
  return {
    x: LEFT + (index * plotWidth) / Math.max(1, count - 1),
    y: TOP + ((domain.max - value) * plotHeight) / (domain.max - domain.min),
  };
}

function label(value: EcommerceCellValue | undefined): string {
  const text = value == null ? '' : String(value);
  return text.length > 18 ? `${text.slice(0, 17)}…` : text;
}

function CartesianChart({
  chart,
  rows,
}: {
  chart: EcommerceChartSuggestion;
  rows: NonNullable<EcommerceToolResult['rows']>;
}) {
  const yFields = chart.yFields ?? [];
  const values = rows.flatMap((row) =>
    yFields.map((field) => number(row[field])).filter((value): value is number => value != null),
  );
  if (values.length === 0) return null;
  const domain = range(values);

  return (
    <svg role="img" aria-label={chart.title} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
      {[0, 0.5, 1].map((ratio) => {
        const y = TOP + ratio * (HEIGHT - TOP - BOTTOM);
        return (
          <line
            key={ratio}
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={y}
            y2={y}
            stroke="currentColor"
            className="text-border-light"
          />
        );
      })}
      {chart.type === 'bar' &&
        rows.slice(0, 40).map((row, index) => {
          const value = number(row[yFields[0] ?? '']);
          if (value == null) return null;
          const current = point(index, Math.max(rows.length, 2), value, domain);
          const baseline = point(index, Math.max(rows.length, 2), 0, domain);
          const barWidth = Math.max(3, (WIDTH - LEFT - RIGHT) / Math.max(rows.length, 2) - 4);
          return (
            <rect
              key={index}
              x={current.x - barWidth / 2}
              y={Math.min(current.y, baseline.y)}
              width={barWidth}
              height={Math.max(1, Math.abs(baseline.y - current.y))}
              rx={2}
              fill={COLORS[0]}
            />
          );
        })}
      {chart.type === 'line' &&
        yFields.map((field, fieldIndex) => {
          const points = rows
            .map((row, index) => {
              const value = number(row[field]);
              return value == null ? null : point(index, rows.length, value, domain);
            })
            .filter((value): value is { x: number; y: number } => value != null);
          return points.length > 1 ? (
            <polyline
              key={field}
              points={points.map(({ x, y }) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={COLORS[fieldIndex % COLORS.length]}
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null;
        })}
      {chart.type === 'scatter' &&
        rows.slice(0, 200).map((row, index) => {
          const xValue = number(row[chart.xField ?? '']) ?? index;
          const yValue = number(row[yFields[0] ?? '']);
          if (yValue == null) return null;
          const xValues = rows.map(
            (entry, rowIndex) => number(entry[chart.xField ?? '']) ?? rowIndex,
          );
          const xDomain = range(xValues);
          const x =
            LEFT + ((xValue - xDomain.min) * (WIDTH - LEFT - RIGHT)) / (xDomain.max - xDomain.min);
          const y = point(index, rows.length, yValue, domain).y;
          return <circle key={index} cx={x} cy={y} r={4} fill={COLORS[0]} opacity={0.75} />;
        })}
      <text x={LEFT} y={HEIGHT - 10} className="fill-text-secondary text-[11px]">
        {label(rows[0]?.[chart.xField ?? ''])}
      </text>
      <text
        x={WIDTH - RIGHT}
        y={HEIGHT - 10}
        textAnchor="end"
        className="fill-text-secondary text-[11px]"
      >
        {label(rows[rows.length - 1]?.[chart.xField ?? ''])}
      </text>
    </svg>
  );
}

function polar(center: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: center + radius * Math.cos(radians), y: center + radius * Math.sin(radians) };
}

function arcPath(center: number, radius: number, start: number, end: number): string {
  const startPoint = polar(center, radius, end);
  const endPoint = polar(center, radius, start);
  const largeArc = end - start <= 180 ? 0 : 1;
  return `M ${center} ${center} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y} Z`;
}

function PieChart({
  chart,
  rows,
}: {
  chart: EcommerceChartSuggestion;
  rows: NonNullable<EcommerceToolResult['rows']>;
}) {
  const field = chart.yFields?.[0] ?? '';
  const slices = rows
    .slice(0, 12)
    .map((row) => ({
      name: label(row[chart.xField ?? '']),
      value: Math.max(0, number(row[field]) ?? 0),
    }))
    .filter((slice) => slice.value > 0);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return null;
  let angle = 0;
  return (
    <svg role="img" aria-label={chart.title} viewBox="0 0 420 240" className="w-full">
      {slices.map((slice, index) => {
        const start = angle;
        angle += (slice.value / total) * 360;
        return (
          <path
            key={`${slice.name}-${index}`}
            d={arcPath(120, 88, start, Math.min(angle, 359.999))}
            fill={COLORS[index % COLORS.length]}
          />
        );
      })}
      {slices.map((slice, index) => (
        <g key={`${slice.name}-legend-${index}`} transform={`translate(230 ${28 + index * 18})`}>
          <rect width="10" height="10" rx="2" fill={COLORS[index % COLORS.length]} />
          <text x="16" y="9" className="fill-text-secondary text-[11px]">
            {slice.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function SafeChart({
  chart,
  rows,
}: {
  chart: EcommerceChartSuggestion;
  rows: NonNullable<EcommerceToolResult['rows']>;
}) {
  return (
    <div className="rounded-lg border border-border-light bg-surface-primary p-3">
      <h4 className="mb-2 text-sm font-medium text-text-primary">{chart.title}</h4>
      {chart.type === 'pie' ? (
        <PieChart chart={chart} rows={rows} />
      ) : (
        <CartesianChart chart={chart} rows={rows} />
      )}
    </div>
  );
}
