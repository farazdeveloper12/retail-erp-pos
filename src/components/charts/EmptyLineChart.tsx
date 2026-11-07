type EmptyLineChartProps = {
  /** X-axis labels, for example the days of the week. */
  labels: string[];
  /**
   * Optional real values, one per label. When missing or empty, the chart
   * shows a dashed placeholder line and the empty message instead.
   */
  values?: number[];
  emptyMessage?: string;
  ariaLabel: string;
  className?: string;
};

// Drawing area in SVG units. The SVG stretches to fill its box.
const WIDTH = 600;
const HEIGHT = 200;
const TOP_GAP = 16;
const GRID_LINES = [0.25, 0.5, 0.75];

// Gentle wave used only as a visual placeholder, never as data.
const PLACEHOLDER_PATH =
  "M0 150 C 60 140, 100 160, 170 132 S 280 112, 340 118 S 460 92, 520 80 S 580 70, 600 66";

function toPoints(values: number[]) {
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  return values.map((value, index) => {
    const x = values.length > 1 ? index * step : WIDTH / 2;
    const y = HEIGHT - (value / max) * (HEIGHT - TOP_GAP);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
}

export default function EmptyLineChart({
  labels,
  values,
  emptyMessage = "No data yet.",
  ariaLabel,
  className = "",
}: EmptyLineChartProps) {
  const hasData = Array.isArray(values) && values.length > 0;
  const points = hasData ? toPoints(values) : [];

  return (
    <figure className={"w-full " + className}>
      <div className="relative h-48 sm:h-56">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel}
          className="h-full w-full overflow-visible"
        >
          {/* Horizontal grid lines */}
          {GRID_LINES.map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={WIDTH}
              y1={HEIGHT * ratio}
              y2={HEIGHT * ratio}
              className="stroke-line"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Axis lines */}
          <line
            x1={0}
            x2={0}
            y1={0}
            y2={HEIGHT}
            className="stroke-line-strong"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={0}
            x2={WIDTH}
            y1={HEIGHT}
            y2={HEIGHT}
            className="stroke-line-strong"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />

          {hasData ? (
            <>
              <polygon
                points={`0,${HEIGHT} ${points.join(" ")} ${WIDTH},${HEIGHT}`}
                className="fill-accent-soft"
              />
              <polyline
                points={points.join(" ")}
                className="fill-none stroke-accent"
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <path
              d={PLACEHOLDER_PATH}
              className="fill-none stroke-ink-muted/50"
              strokeWidth={2}
              strokeDasharray="6 8"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
            <p className="rounded-full border border-line bg-surface/90 px-4 py-2 text-center text-xs font-medium text-ink-muted shadow-soft sm:text-sm">
              {emptyMessage}
            </p>
          </div>
        )}
      </div>

      {/* Day labels under the chart */}
      <div className="mt-2 flex justify-between text-[11px] font-medium text-ink-muted sm:text-xs">
        {labels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </figure>
  );
}
