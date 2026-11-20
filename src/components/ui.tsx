import Link from "next/link";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// Shared look for cards, forms and buttons. Presentational only.

export const cardClass =
  "rounded-card border border-line bg-surface p-5 shadow-soft sm:p-6";

export const inputClass =
  "min-h-11 w-full rounded-2xl border border-line-strong bg-surface px-4 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15";

export const labelClass = "mb-1.5 block text-sm font-semibold text-ink";

export const primaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink shadow-soft transition hover:bg-accent-strong disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-surface-muted disabled:opacity-60";

export const dangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-coral px-5 py-2.5 text-sm font-semibold text-pill-ink shadow-soft transition hover:brightness-95 disabled:opacity-60";

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
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-soft">
            <Icon className="h-6 w-6" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{title}</h1>
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

const pillTones: Record<PillTone, { pill: string; dot: string }> = {
  purple: { pill: "bg-lavender text-ink", dot: "bg-purple" },
  teal: { pill: "bg-aqua text-ink", dot: "bg-accent" },
  amber: { pill: "bg-amber/20 text-ink", dot: "bg-amber" },
  mint: { pill: "bg-mint text-ink", dot: "bg-accent" },
  coral: { pill: "bg-peach text-ink", dot: "bg-coral" },
  neutral: { pill: "bg-surface-muted text-ink-muted border border-line", dot: "bg-ink-muted" },
};

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  const style = pillTones[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold " +
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
        "rounded-2xl px-4 py-3 text-sm font-medium " +
        (kind === "error" ? "bg-danger-soft text-danger" : "bg-mint text-ink")
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
      <div className="relative mx-auto h-20 w-20">
        <div className="absolute inset-0 rounded-full bg-aqua" />
        <div className="absolute inset-3 flex items-center justify-center rounded-2xl border-2 border-ink bg-surface">
          <Icon className="h-6 w-6 text-accent" />
        </div>
      </div>
      <p className="mt-4 text-base font-bold text-ink">{title}</p>
      {text && <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
