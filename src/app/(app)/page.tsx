import type { JSX } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  Headphones,
  Landmark,
  PackagePlus,
  Plus,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import SegmentedToggle from "@/components/SegmentedToggle";
import EmptyLineChart from "@/components/charts/EmptyLineChart";
import CustomersIllustration from "@/components/illustrations/CustomersIllustration";
import ReceiptIllustration from "@/components/illustrations/ReceiptIllustration";
import StockedUpIllustration from "@/components/illustrations/StockedUpIllustration";
import { canViewPage, getMyPermissions } from "@/lib/permissions";

type Tone = "peach" | "lavender" | "aqua" | "mint";

type Kpi = {
  label: string;
  phase: string;
  icon: LucideIcon;
  tone: Tone;
  money: boolean;
  requires?: string; // Card is shown only when the user has this permission
};

type EmptyCard = {
  title: string;
  heading: string;
  text: string;
  phase: string;
  Illustration: (props: { className?: string }) => JSX.Element;
  requires?: string;
};

type QuickAction = {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: Tone | "primary";
  allowed: (permissions: string[]) => boolean;
};

// Tailwind needs full class names, so each tone is spelled out here.
const toneClasses: Record<Tone, { card: string; chip: string }> = {
  peach: { card: "bg-peach", chip: "bg-surface/70 text-coral" },
  lavender: { card: "bg-lavender", chip: "bg-surface/70 text-purple" },
  aqua: { card: "bg-aqua", chip: "bg-surface/70 text-accent" },
  mint: { card: "bg-mint", chip: "bg-surface/70 text-ink" },
};

// The four headline figures in the top row
const headlineKpis: Kpi[] = [
  { label: "Today's Sales", phase: "Phase 8", icon: ShoppingCart, tone: "peach", money: true },
  { label: "Gross Profit", phase: "Phase 12", icon: TrendingUp, tone: "lavender", money: true, requires: "dashboard.financial" },
  { label: "Stock on Hand", phase: "Phase 6", icon: Boxes, tone: "aqua", money: false },
  { label: "Cash and Bank", phase: "Phase 11", icon: Landmark, tone: "mint", money: true, requires: "dashboard.financial" },
];

// All other figures, shown in the collapsed "More figures" section
const moreKpis: Kpi[] = [
  { label: "Today's Purchases", phase: "Phase 7", icon: PackagePlus, tone: "lavender", money: true, requires: "dashboard.financial" },
  { label: "Today's Net Profit", phase: "Phase 12", icon: CircleDollarSign, tone: "mint", money: true, requires: "dashboard.financial" },
  { label: "Monthly Sales", phase: "Phase 8", icon: BarChart3, tone: "peach", money: true },
  { label: "Monthly Profit", phase: "Phase 12", icon: TrendingUp, tone: "lavender", money: true, requires: "dashboard.financial" },
  { label: "Inventory Value", phase: "Phase 6", icon: Boxes, tone: "aqua", money: true, requires: "dashboard.financial" },
  { label: "Phones in Stock", phase: "Phase 6", icon: Smartphone, tone: "mint", money: false },
  { label: "Accessories in Stock", phase: "Phase 6", icon: Headphones, tone: "peach", money: false },
  { label: "Customer Receivables", phase: "Phase 10", icon: Users, tone: "lavender", money: true },
  { label: "Supplier Payables", phase: "Phase 10", icon: ShoppingBag, tone: "aqua", money: true, requires: "dashboard.financial" },
  { label: "Total Expenses", phase: "Phase 11", icon: Receipt, tone: "mint", money: true, requires: "dashboard.financial" },
  { label: "Cash in Hand", phase: "Phase 11", icon: Wallet, tone: "peach", money: true, requires: "dashboard.financial" },
  { label: "Bank Balance", phase: "Phase 11", icon: Landmark, tone: "lavender", money: true, requires: "dashboard.financial" },
];

const emptyCards: EmptyCard[] = [
  {
    title: "Low stock alerts",
    heading: "All stocked up",
    text: "Items running low will show up here.",
    phase: "Phase 6",
    Illustration: StockedUpIllustration,
    requires: "inventory.view",
  },
  {
    title: "Recent sales",
    heading: "No sales yet",
    text: "Your latest sales will appear here.",
    phase: "Phase 8",
    Illustration: ReceiptIllustration,
    requires: "sales.view_own",
  },
  {
    title: "Top customers",
    heading: "No customers yet",
    text: "Your best customers will be listed here.",
    phase: "Phase 10",
    Illustration: CustomersIllustration,
    requires: "customers.view",
  },
];

// Shown in this order; only the first four the user is allowed to use appear.
const quickActions: QuickAction[] = [
  {
    label: "New sale",
    description: "Open the point of sale",
    href: "/sales",
    icon: ShoppingCart,
    tone: "primary",
    allowed: (p) => p.includes("sales.create"),
  },
  {
    label: "Add product",
    description: "Add a model to the catalog",
    href: "/catalog/new",
    icon: Plus,
    tone: "aqua",
    allowed: (p) => p.includes("catalog.manage"),
  },
  {
    label: "New purchase",
    description: "Record stock from a supplier",
    href: "/purchases",
    icon: PackagePlus,
    tone: "peach",
    allowed: (p) => canViewPage(p, "purchases"),
  },
  {
    label: "Product catalog",
    description: "Browse brands and models",
    href: "/catalog",
    icon: BookOpen,
    tone: "mint",
    allowed: (p) => canViewPage(p, "catalog"),
  },
  {
    label: "Users & roles",
    description: "Manage employee access",
    href: "/users",
    icon: UserCog,
    tone: "lavender",
    allowed: (p) => canViewPage(p, "users"),
  },
];

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function KpiValue({ money, size }: { money: boolean; size: "lg" | "md" }) {
  const valueClass =
    size === "lg" ? "text-3xl sm:text-4xl" : "text-2xl";
  return (
    <p className={"font-bold leading-none text-ink " + valueClass}>
      {money && (
        <span className="mr-1.5 align-middle text-sm font-semibold text-ink-muted">
          PKR
        </span>
      )}
      —
    </p>
  );
}

export default async function DashboardPage() {
  const permissions = await getMyPermissions();

  if (!canViewPage(permissions, "")) {
    return <AccessDenied />;
  }

  const allowed = (item: { requires?: string }) =>
    !item.requires || permissions.includes(item.requires);

  const visibleHeadline = headlineKpis.filter(allowed);
  const visibleMore = moreKpis.filter(allowed);
  const visibleEmptyCards = emptyCards.filter(allowed);
  const visibleActions = quickActions
    .filter((a) => a.allowed(permissions))
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">Dashboard</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Figures appear as each module goes live.
        </p>
      </div>

      {/* Top row: headline figures */}
      {visibleHeadline.length > 0 && (
        <section
          aria-label="Key figures"
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          {visibleHeadline.map((kpi) => {
            const tone = toneClasses[kpi.tone];
            return (
              <div
                key={kpi.label}
                className={"flex flex-col gap-4 rounded-card p-4 sm:p-5 " + tone.card}
              >
                <span
                  className={
                    "flex h-9 w-9 items-center justify-center rounded-xl " +
                    tone.chip
                  }
                >
                  <kpi.icon className="h-4 w-4" />
                </span>
                <div>
                  <KpiValue money={kpi.money} size="lg" />
                  <p className="mt-2 text-sm font-medium text-ink">
                    {kpi.label}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Live in {kpi.phase}
                  </p>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Middle row: sales chart and quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="sales-overview"
          className={
            "rounded-card border border-line bg-surface p-5 shadow-soft " +
            (visibleActions.length > 0 ? "lg:col-span-2" : "lg:col-span-3")
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="sales-overview" className="text-base font-bold text-ink">
                Sales overview
              </h2>
              <p className="text-xs text-ink-muted">Sales this week</p>
            </div>
            <SegmentedToggle
              options={["Week", "Month"]}
              ariaLabel="Chart period"
            />
          </div>
          <EmptyLineChart
            labels={WEEK_DAYS}
            ariaLabel="Sales overview chart. No sales recorded yet."
            emptyMessage="No sales yet. Your chart fills in as you sell."
          />
        </section>

        {visibleActions.length > 0 && (
          <section
            aria-labelledby="quick-actions"
            className="rounded-card border border-line bg-surface p-5 shadow-soft"
          >
            <h2 id="quick-actions" className="mb-4 text-base font-bold text-ink">
              Quick actions
            </h2>
            <div className="flex flex-col gap-3">
              {visibleActions.map((action) => {
                const primary = action.tone === "primary";
                const bg = primary
                  ? "bg-accent text-accent-ink hover:bg-accent-strong"
                  : toneClasses[action.tone as Tone].card +
                    " text-ink hover:brightness-[0.97]";
                return (
                  <Link
                    key={action.href}
                    href={action.href}
                    className={
                      "group flex min-h-14 items-center gap-3 rounded-2xl px-4 py-3 transition " +
                      bg
                    }
                  >
                    <span
                      className={
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl " +
                        (primary ? "bg-white/20" : "bg-surface/70")
                      }
                    >
                      <action.icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">
                        {action.label}
                      </span>
                      <span
                        className={
                          "block text-xs " +
                          (primary ? "opacity-85" : "text-ink-muted")
                        }
                      >
                        {action.description}
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Bottom row: friendly empty states */}
      {visibleEmptyCards.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleEmptyCards.map((card) => (
            <section
              key={card.title}
              className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-soft"
            >
              <h2 className="text-base font-bold text-ink">{card.title}</h2>
              <div className="flex flex-1 flex-col items-center justify-center py-6 text-center">
                <card.Illustration className="h-24 w-24" />
                <p className="mt-4 text-sm font-semibold text-ink">
                  {card.heading}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{card.text}</p>
                <p className="mt-3 rounded-full bg-surface-muted px-3 py-1 text-[11px] font-medium text-ink-muted">
                  Live in {card.phase}
                </p>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Other figures, collapsed by default */}
      {visibleMore.length > 0 && (
        <details className="group rounded-card border border-line bg-surface shadow-soft">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-base font-bold text-ink">
                More figures
              </span>
              <span className="block text-xs text-ink-muted">
                {visibleMore.length} more figures
              </span>
            </span>
            <ChevronDown className="h-5 w-5 text-ink-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 md:grid-cols-3 xl:grid-cols-4">
            {visibleMore.map((kpi) => {
              const tone = toneClasses[kpi.tone];
              return (
                <div key={kpi.label} className={"rounded-2xl p-4 " + tone.card}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-ink">{kpi.label}</p>
                    <span
                      className={
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                        tone.chip
                      }
                    >
                      <kpi.icon className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-3">
                    <KpiValue money={kpi.money} size="md" />
                  </div>
                  <p className="mt-2 text-xs text-ink-muted">
                    Live in {kpi.phase}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
