import { formatMoney } from "@/lib/money";

type Row = { day: string; salesTotal: bigint; profit: bigint | null };

const WIDTH = 600;
const HEIGHT = 200;
const TOP_GAP = 12;

function shortDay(day: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

// Display only: cents to a plain number for drawing
function toNumber(cents: bigint) {
  return Number(cents) / 100;
}

// Daily sales as bars and (optionally) daily profit as a line. Plain SVG.
export default function DailyChart({
  rows,
  currency,
  showProfit,
}: {
  rows: Row[];
  currency: string;
  showProfit: boolean;
}) {
  const sales = rows.map((r) => toNumber(r.salesTotal));
  const profits = rows.map((r) => (r.profit === null ? 0 : toNumber(r.profit)));
  const max = Math.max(1, ...sales, ...(showProfit ? profits : []));
  const min = Math.min(0, ...(showProfit ? profits : []));
  const span = max - min || 1;
  const y = (value: number) => TOP_GAP + (HEIGHT - TOP_GAP) * (1 - (value - min) / span);
  const zeroY = y(0);

  const slot = WIDTH / Math.max(rows.length, 1);
  const barWidth = Math.max(1, slot * 0.6);
  const center = (i: number) => slot * i + slot / 2;
  const profitPoints = profits.map((p, i) => `${center(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");

  // A few date labels so they stay readable on phones
  const labelIndexes =
    rows.length <= 7
      ? rows.map((_, i) => i)
      : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];

  return (
    <figure className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" aria-hidden="true" />
          Sales
        </span>
        {showProfit && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-purple" aria-hidden="true" />
            Profit
          </span>
        )}
      </div>
      <div className="h-48 sm:h-56">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={showProfit ? "Daily sales and profit" : "Daily sales"}
          className="h-full w-full overflow-visible"
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1={0}
              x2={WIDTH}
              y1={TOP_GAP + (HEIGHT - TOP_GAP) * ratio}
              y2={TOP_GAP + (HEIGHT - TOP_GAP) * ratio}
              className="stroke-line"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={0}
            x2={WIDTH}
            y1={zeroY}
            y2={zeroY}
            className="stroke-line-strong"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
          {rows.map((row, i) => {
            const top = y(sales[i]);
            return (
              <rect
                key={row.day}
                x={center(i) - barWidth / 2}
                y={Math.min(top, zeroY)}
                width={barWidth}
                height={Math.abs(zeroY - top)}
                rx={2}
                className="fill-accent"
              >
                <title>
                  {`${shortDay(row.day)}: ${formatMoney(row.salesTotal, currency)}${
                    showProfit && row.profit !== null ? `, profit ${formatMoney(row.profit, currency)}` : ""
                  }`}
                </title>
              </rect>
            );
          })}
          {showProfit && rows.length > 1 && (
            <polyline
              points={profitPoints}
              className="fill-none stroke-purple"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <div className="relative mt-2 h-4 text-[11px] font-medium text-ink-muted sm:text-xs">
        {labelIndexes.map((i) => (
          <span
            key={i}
            className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
            style={{ left: `${(center(i) / WIDTH) * 100}%` }}
          >
            {shortDay(rows[i].day)}
          </span>
        ))}
      </div>
    </figure>
  );
}
