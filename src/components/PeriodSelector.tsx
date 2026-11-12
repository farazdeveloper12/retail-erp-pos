import Link from "next/link";
import { CalendarRange } from "lucide-react";
import { inputClass, primaryButtonClass } from "@/components/ui";
import type { Period, PeriodKey } from "@/lib/dashboard";

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

// Segmented period choice kept in the URL, so a refresh keeps it.
export default function PeriodSelector({
  basePath,
  period,
  today,
}: {
  basePath: string;
  period: Period;
  today: string;
}) {
  return (
    <div className="space-y-3 print:hidden">
      <nav
        aria-label="Period"
        className="flex w-full flex-wrap gap-1 rounded-card border border-line bg-surface p-1 shadow-soft sm:inline-flex sm:w-auto"
      >
        {OPTIONS.map((option) => {
          const active = option.key === period.key;
          return (
            <Link
              key={option.key}
              href={`${basePath}?period=${option.key}`}
              aria-current={active ? "true" : undefined}
              className={
                "inline-flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors sm:flex-none " +
                (active ? "bg-pill text-pill-ink" : "text-ink-muted hover:text-ink")
              }
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {period.key === "custom" && (
        <form
          method="get"
          action={basePath}
          className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-soft sm:flex-row sm:items-end"
        >
          <input type="hidden" name="period" value="custom" />
          <label className="flex-1 text-xs font-semibold text-ink-muted">
            From
            <input
              type="date"
              name="from"
              defaultValue={period.from}
              max={today}
              className={inputClass + " mt-1"}
            />
          </label>
          <label className="flex-1 text-xs font-semibold text-ink-muted">
            To
            <input
              type="date"
              name="to"
              defaultValue={period.to}
              max={today}
              className={inputClass + " mt-1"}
            />
          </label>
          <button type="submit" className={primaryButtonClass}>
            <CalendarRange className="h-4 w-4" />
            Apply
          </button>
        </form>
      )}

      {period.error && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-2 text-sm font-medium text-danger">
          {period.error} Showing today instead.
        </p>
      )}
    </div>
  );
}
