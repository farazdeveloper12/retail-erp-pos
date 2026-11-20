import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared look for cards, forms and buttons. Presentational only.

// White (dark: slate) card with a thin border and a soft shadow
export const cardClass =
  "rounded-card border border-line bg-surface p-4 shadow-soft sm:p-6";

// text-base on phones stops iOS from zooming into the field
export const inputClass =
  "min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-base text-ink outline-none transition placeholder:text-ink-muted/55 focus:border-accent focus:ring-4 focus:ring-accent/15 disabled:bg-surface-muted sm:text-sm";

export const labelClass = "mb-1.5 block text-sm font-semibold text-ink";

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:opacity-55";

// Main action of a screen: solid teal
export const primaryButtonClass = `${buttonBase} bg-accent text-accent-ink shadow-sm hover:bg-accent-strong`;

// Other actions: white (dark: slate) with a border
export const secondaryButtonClass = `${buttonBase} border border-line-strong bg-surface text-ink hover:border-accent/50 hover:bg-surface-muted`;

// Destructive actions: solid red
export const dangerButtonClass = `${buttonBase} bg-danger text-white shadow-sm hover:brightness-95 dark:text-[#1a0b0b]`;

export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Icon className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description && (
            <div className="mt-0.5 text-sm text-ink-muted">{description}</div>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full pr-3 text-sm font-semibold text-accent hover:text-accent-strong"
    >
      <ArrowLeft className="h-4 w-4" />
      {children}
    </Link>
  );
}

type PillTone = "purple" | "teal" | "amber" | "mint" | "coral" | "neutral";

// Status badges: soft tint with readable coloured text.
// mint = good / active, coral = owed / problem, amber = waiting.
const pillTones: Record<PillTone, { pill: string; dot: string }> = {
  purple: { pill: "bg-lavender text-purple", dot: "bg-purple" },
  teal: { pill: "bg-accent-soft text-pill-ink", dot: "bg-accent" },
  amber: { pill: "bg-amber/15 text-amber", dot: "bg-amber" },
  mint: { pill: "bg-success-soft text-success", dot: "bg-success" },
  coral: { pill: "bg-danger-soft text-danger", dot: "bg-danger" },
  neutral: { pill: "bg-surface-muted text-ink-muted border border-line", dot: "bg-ink-muted" },
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  const style = pillTones[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold " +
        style.pill
      }
    >
      <span className={"h-1.5 w-1.5 rounded-full " + style.dot} aria-hidden="true" />
      {children}
    </span>
  );
}

const roleTone: Record<string, PillTone> = {
  owner: "purple",
  manager: "teal",
  sales: "amber",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  sales: "Sales Employee",
};

export function RolePill({ role }: { role: string }) {
  return <Pill tone={roleTone[role] ?? "neutral"}>{ROLE_LABELS[role] ?? role}</Pill>;
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <Pill tone={active ? "mint" : "coral"}>{active ? "Active" : "Inactive"}</Pill>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: "error" | "success";
  children: ReactNode;
}) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        "rounded-xl border px-4 py-3 text-sm font-medium " +
        (kind === "error"
          ? "border-danger/25 bg-danger-soft text-danger"
          : "border-success/25 bg-success-soft text-success")
      }
    >
      {children}
    </p>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft">
        <Icon className="h-6 w-6 text-accent" />
      </div>
      <p className="mt-4 text-base font-bold text-ink">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// Tables: header row, dividers and hover, the same on every list
export const tableWrapClass = "overflow-x-auto rounded-card border border-line bg-surface shadow-soft";
export const tableClass = "w-full text-left text-sm";
export const tableHeadClass =
  "border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const tableRowClass = "border-b border-line last:border-0 transition-colors hover:bg-surface-muted";
