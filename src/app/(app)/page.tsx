import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  Boxes,
  CircleDollarSign,
  Headphones,
  Landmark,
  PackagePlus,
  Receipt,
  ReceiptText,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Trophy,
  TriangleAlert,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import BalancePill from "@/components/BalancePill";
import PeriodSelector from "@/components/PeriodSelector";
import DailyChart from "@/components/charts/DailyChart";
import EmptyLineChart from "@/components/charts/EmptyLineChart";
import { Notice, Pill, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_LOW_STOCK_THRESHOLD, getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney, toCents } from "@/lib/money";
import { formatInvoiceNo } from "@/lib/format";
import { fetchDashboard, fillDays, resolvePeriod, todayInKarachi } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "Dashboard",
};

type Tone = "peach" | "lavender" | "aqua" | "mint";

const TONES: Record<Tone, { card: string; chip: string }> = {
  peach: { card: "bg-peach", chip: "bg-surface/70 text-coral" },
  lavender: { card: "bg-lavender", chip: "bg-surface/70 text-purple" },
  aqua: { card: "bg-aqua", chip: "bg-surface/70 text-accent" },
  mint: { card: "bg-mint", chip: "bg-surface/70 text-ink" },
};

function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone: Tone;
}) {
  const style = TONES[tone];
  return (
    <div className={"flex flex-col gap-3 rounded-card p-4 sm:p-5 " + style.card}>
      <span className={"flex h-9 w-9 items-center justify-center rounded-xl " + style.chip}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="break-words text-xl font-bold leading-tight text-ink sm:text-2xl">{value}</p>
        <p className="mt-1.5 text-sm font-medium text-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
    </div>
  );
}

type RecentSale = {
  id: string;
  invoice_no: number | string | null;
  customer_name: string | null;
  customer_id: string | null;
  total: number | string | null;
  paid_amount: number | string | null;
  status: string | null;
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "")) {
    return <AccessDenied />;
  }

  const period = resolvePeriod(await searchParams);
  const today = todayInKarachi();
  const supabase = await createClient();
  const canSeeSales = canViewPage(permissions, "sales");

  const [{ data, error }, business, recentResult] = await Promise.all([
    fetchDashboard(supabase, period.from, period.to),
    getMyBusiness(),
    canSeeSales
      ? supabase
          .from("sales")
          .select("id, invoice_no, customer_name, customer_id, total, paid_amount, status")
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: null, error: null }),
  ]);
  const currency = business?.currency_code || "PKR";
  const money = (value: bigint | null) => formatMoney(value, currency);

  const recentSales =
    canSeeSales && !recentResult.error ? ((recentResult.data ?? []) as RecentSale[]) : null;

  const quickActions = [
    { label: "New sale", href: "/sales/new", icon: ShoppingCart, show: permissions.includes("sales.create"), primary: true },
    { label: "New purchase", href: "/purchases/new", icon: PackagePlus, show: permissions.includes("purchases.manage"), primary: false },
    { label: "Add expense", href: "/expenses", icon: Receipt, show: permissions.includes("expenses.manage"), primary: false },
  ].filter((a) => a.show);

  const days = data ? fillDays(period, data.daily, data.financial) : [];
  const hasSales = data ? data.daily.some((d) => d.salesTotal > BigInt(0) || d.salesCount > 0) : false;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">Dashboard</h1>
          <p className="mt-1 text-sm text-ink-muted">{period.label}</p>
        </div>
        <PeriodSelector basePath="/" period={period} today={today} />
      </div>

      {error || !data ? (
        <Notice kind="error">
          {error ?? "The dashboard could not be loaded."} Please try again or ask the owner for access.
        </Notice>
      ) : (
        <>
          {/* Headline figures */}
          <section aria-label="Key figures" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard
              label="Sales"
              value={money(data.salesTotal)}
              hint={`${data.salesCount} ${data.salesCount === 1 ? "invoice" : "invoices"}`}
              icon={ShoppingCart}
              tone="peach"
            />
            <KpiCard label="Cash received on sales" value={money(data.salesPaid)} icon={Banknote} tone="mint" />
            <KpiCard label="Customers owe us" value={money(data.receivable)} hint="All time" icon={Users} tone="lavender" />
            {data.financial && (
              <>
                <KpiCard label="Profit" value={money(data.profit)} hint="On sales in this period" icon={TrendingUp} tone="aqua" />
                <KpiCard label="Expenses" value={money(data.expensesTotal)} icon={Receipt} tone="peach" />
                <KpiCard
                  label="Profit after expenses"
                  value={money(
                    data.profit !== null && data.expensesTotal !== null
                      ? data.profit - data.expensesTotal
                      : null
                  )}
                  hint="Profit minus expenses"
                  icon={CircleDollarSign}
                  tone="mint"
                />
                <KpiCard label="Purchases" value={money(data.purchasesTotal)} icon={ShoppingBag} tone="lavender" />
                <KpiCard label="Suppliers we owe" value={money(data.payable)} hint="All time" icon={Truck} tone="aqua" />
              </>
            )}
          </section>

          {data.financial && (
            <section aria-label="Cash and stock value" className="space-y-2">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
                <KpiCard label="Cash in hand" value={money(data.cashBalance)} icon={Wallet} tone="mint" />
                <KpiCard label="Bank & wallets" value={money(data.bankBalance)} icon={Landmark} tone="aqua" />
                <KpiCard label="Stock value" value={money(data.stockValue)} hint="At cost" icon={Boxes} tone="peach" />
              </div>
              <p className="text-xs text-ink-muted">
                Cash and bank balances are calculated from the entries recorded in this app.
              </p>
            </section>
          )}

          {/* Stock */}
          <section aria-label="Stock" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <KpiCard label="Phones in stock" value={String(data.phonesInStock)} icon={Smartphone} tone="lavender" />
            <KpiCard label="Accessory units" value={String(data.accessoryUnits)} icon={Headphones} tone="mint" />
            {(() => {
              const lowStockCard = (
                <>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-peach text-coral">
                    <TriangleAlert className="h-4 w-4" />
                  </span>
                  <div>
                    {data.lowStockCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-peach px-3 py-1 text-sm font-bold text-ink">
                        <span className="h-2 w-2 rounded-full bg-coral" aria-hidden="true" />
                        {data.lowStockCount}
                      </span>
                    ) : (
                      <p className="text-xl font-bold text-ink sm:text-2xl">0</p>
                    )}
                    <p className="mt-1.5 text-sm font-medium text-ink">Low stock items</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Accessories with {business?.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD} or fewer left
                    </p>
                  </div>
                </>
              );
              const boxClass =
                "col-span-2 flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-soft sm:p-5 lg:col-span-1";
              // Opens the low stock list on the Inventory page when the user may see it
              return canViewPage(permissions, "inventory") ? (
                <Link
                  href="/inventory?tab=accessories&filter=low"
                  className={
                    boxClass +
                    " transition hover:border-line-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                  }
                >
                  {lowStockCard}
                </Link>
              ) : (
                <div className={boxClass}>{lowStockCard}</div>
              );
            })()}
          </section>

          {/* Chart and quick actions */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section
              className={
                cardClass + " " + (quickActions.length > 0 ? "lg:col-span-2" : "lg:col-span-3")
              }
            >
              <h2 className="mb-4 text-base font-bold text-ink">
                {data.financial ? "Daily sales and profit" : "Daily sales"}
              </h2>
              {hasSales ? (
                <DailyChart rows={days} currency={currency} showProfit={data.financial} />
              ) : (
                <EmptyLineChart
                  labels={
                    days.length <= 7
                      ? days.map((d) => d.day.slice(8))
                      : [days[0]?.day.slice(5) ?? "", days[days.length - 1]?.day.slice(5) ?? ""]
                  }
                  ariaLabel="No sales in this period"
                  emptyMessage="No sales in this period yet."
                />
              )}
            </section>

            {quickActions.length > 0 && (
              <section className={cardClass}>
                <h2 className="mb-4 text-base font-bold text-ink">Quick actions</h2>
                <div className="flex flex-col gap-3">
                  {quickActions.map((action) => (
                    <Link
                      key={action.href}
                      href={action.href}
                      className={
                        "group flex min-h-14 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition " +
                        (action.primary
                          ? "bg-accent text-accent-ink hover:bg-accent-strong"
                          : "bg-surface-muted text-ink hover:bg-aqua")
                      }
                    >
                      <action.icon className="h-5 w-5" />
                      <span className="flex-1">{action.label}</span>
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Lists */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className={cardClass}>
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-5 w-5 text-accent" />
                <h2 className="text-base font-bold text-ink">Top selling items</h2>
              </div>
              {data.topItems.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
                  No sales in this period yet.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.topItems.map((item, index) => (
                    <li key={index} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{item.description}</span>
                        <span className="text-xs text-ink-muted">Qty {item.qty}</span>
                      </span>
                      <span className="shrink-0 font-semibold text-ink">{money(item.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.financial && (
              <section className={cardClass}>
                <div className="mb-3 flex items-center gap-2">
                  <Receipt className="h-5 w-5 text-accent" />
                  <h2 className="text-base font-bold text-ink">Expenses by category</h2>
                </div>
                {data.expensesByCategory.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
                    No expenses in this period.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {data.expensesByCategory.map((row) => (
                      <li key={row.category} className="flex justify-between gap-3 py-2 text-sm">
                        <span className="truncate text-ink-muted">{row.category}</span>
                        <span className="font-semibold text-ink">{money(row.amount)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {recentSales && (
              <section className={cardClass}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <ReceiptText className="h-5 w-5 text-accent" />
                    <h2 className="text-base font-bold text-ink">Recent sales</h2>
                  </div>
                  <Link href="/sales" className="text-xs font-semibold text-accent hover:text-accent-strong">
                    View all
                  </Link>
                </div>
                {recentSales.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
                    No sales yet.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {recentSales.map((sale) => {
                      const total = toCents(sale.total);
                      const paid = toCents(sale.paid_amount);
                      const cancelled = sale.status === "void";
                      return (
                        <li key={sale.id}>
                          <Link
                            href={`/sales/${sale.id}`}
                            className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                          >
                            <span className="min-w-0">
                              <span className="flex items-center gap-2 font-mono text-xs font-semibold text-ink">
                                {formatInvoiceNo(sale.invoice_no)}
                                {cancelled && (
                                  <span className="font-sans">
                                    <Pill tone="neutral">Cancelled</Pill>
                                  </span>
                                )}
                              </span>
                              <span className="block truncate text-xs text-ink-muted">
                                {sale.customer_name?.trim() ||
                                  (sale.customer_id ? "Customer" : "Walk-in customer")}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span className="font-semibold text-ink">{money(total)}</span>
                              {!cancelled && total !== null && paid !== null && total - paid > BigInt(0) && (
                                <BalancePill value={total - paid} currency={currency} />
                              )}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
