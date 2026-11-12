import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import BalancePill from "@/components/BalancePill";
import PeriodSelector from "@/components/PeriodSelector";
import { Notice, PageHeader, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { centsToPlain, formatMoney, toCents } from "@/lib/money";
import { fetchDashboard, formatDay, resolvePeriod, todayInKarachi } from "@/lib/dashboard";
import ReportActions from "@/app/(app)/reports/ReportActions";

export const metadata: Metadata = {
  title: "Reports",
};

const ZERO = BigInt(0);

type BalanceRow = { id: string; name: string; phone: string | null; balance: bigint };

const tableHead =
  "border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted print:bg-transparent";

function EmptyLine({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "reports")) {
    return <AccessDenied />;
  }

  const period = resolvePeriod(await searchParams);
  const today = todayInKarachi();
  const supabase = await createClient();

  const [{ data, error }, business, { data: customerBalances }] = await Promise.all([
    fetchDashboard(supabase, period.from, period.to),
    getMyBusiness(),
    supabase.from("customer_balances").select("customer_id, balance").gt("balance", 0),
  ]);
  const currency = business?.currency_code || "PKR";
  const money = (value: bigint | null) => formatMoney(value, currency);
  const financial = data?.financial === true;
  const showSuppliers = financial || permissions.includes("purchases.view");

  // Customers who owe us
  const owedRows = ((customerBalances ?? []) as { customer_id: string; balance: unknown }[])
    .map((row) => ({ id: row.customer_id, balance: toCents(row.balance) ?? ZERO }))
    .filter((row) => row.balance > ZERO);
  const customers: BalanceRow[] = [];
  if (owedRows.length > 0) {
    const { data: customerData } = await supabase
      .from("customers")
      .select("id, name, phone")
      .in(
        "id",
        owedRows.map((r) => r.id)
      );
    const byId = new Map(
      ((customerData ?? []) as { id: string; name: string; phone: string | null }[]).map((c) => [c.id, c])
    );
    for (const row of owedRows) {
      const customer = byId.get(row.id);
      customers.push({
        id: row.id,
        name: customer?.name ?? "Customer",
        phone: customer?.phone ?? null,
        balance: row.balance,
      });
    }
    customers.sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1));
  }

  // Suppliers we still have to pay
  const suppliers: BalanceRow[] = [];
  if (showSuppliers) {
    const { data: supplierBalances } = await supabase
      .from("supplier_balances")
      .select("supplier_id, balance")
      .gt("balance", 0);
    const dueRows = ((supplierBalances ?? []) as { supplier_id: string; balance: unknown }[])
      .map((row) => ({ id: row.supplier_id, balance: toCents(row.balance) ?? ZERO }))
      .filter((row) => row.balance > ZERO);
    if (dueRows.length > 0) {
      const { data: supplierData } = await supabase
        .from("suppliers")
        .select("id, name")
        .in(
          "id",
          dueRows.map((r) => r.id)
        );
      const byId = new Map(((supplierData ?? []) as { id: string; name: string }[]).map((s) => [s.id, s]));
      for (const row of dueRows) {
        suppliers.push({
          id: row.id,
          name: byId.get(row.id)?.name ?? "Supplier",
          phone: null,
          balance: row.balance,
        });
      }
      suppliers.sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1));
    }
  }

  const daily = data?.daily ?? [];
  const totalInvoices = daily.reduce((sum, d) => sum + d.salesCount, 0);
  const totalSales = daily.reduce<bigint>((sum, d) => sum + d.salesTotal, ZERO);
  const totalProfit = daily.reduce<bigint>((sum, d) => sum + (d.profit ?? ZERO), ZERO);
  const totalExpenses = data?.expensesByCategory.reduce<bigint>((s, r) => s + r.amount, ZERO) ?? ZERO;

  // CSV for the daily sales table (plain numbers, no separators)
  const csvRows: string[][] = [
    financial ? ["Date", "Invoices", "Sales total", "Profit"] : ["Date", "Invoices", "Sales total"],
    ...daily.map((d) => {
      const row = [d.day, String(d.salesCount), centsToPlain(d.salesTotal)];
      if (financial) row.push(centsToPlain(d.profit ?? ZERO));
      return row;
    }),
    financial
      ? ["Total", String(totalInvoices), centsToPlain(totalSales), centsToPlain(totalProfit)]
      : ["Total", String(totalInvoices), centsToPlain(totalSales)],
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <PageHeader icon={BarChart3} title="Reports" description={period.label} />
        <PeriodSelector basePath="/reports" period={period} today={today} />
      </div>

      {error || !data ? (
        <Notice kind="error">
          {error ?? "The report could not be loaded."} Please try again or ask the owner for access.
        </Notice>
      ) : (
        <>
          <ReportActions csvRows={csvRows} fileName={`sales-by-day-${period.from}-to-${period.to}.csv`} />

          {/* Print header */}
          <p className="hidden text-sm print:block">
            {business?.name ?? "Report"} · {period.label}
          </p>

          {/* Sales by day */}
          <section className={cardClass + " print:border-0 print:p-0 print:shadow-none"}>
            <h2 className="mb-3 text-base font-bold text-ink">Sales by day</h2>
            {daily.length === 0 ? (
              <EmptyLine>No sales in this period.</EmptyLine>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className={tableHead}>
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2 text-right">Invoices</th>
                      <th className="px-4 py-2 text-right">Sales total</th>
                      {financial && <th className="px-4 py-2 text-right">Profit</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map((d) => (
                      <tr key={d.day} className="border-b border-line">
                        <td className="whitespace-nowrap px-4 py-2 text-ink">{formatDay(d.day)}</td>
                        <td className="px-4 py-2 text-right text-ink">{d.salesCount}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-right text-ink">{money(d.salesTotal)}</td>
                        {financial && (
                          <td className="whitespace-nowrap px-4 py-2 text-right text-ink">{money(d.profit)}</td>
                        )}
                      </tr>
                    ))}
                    <tr className="font-bold text-ink">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right">{totalInvoices}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right">{money(totalSales)}</td>
                      {financial && <td className="whitespace-nowrap px-4 py-2 text-right">{money(totalProfit)}</td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top selling items */}
            <section className={cardClass + " print:border-0 print:p-0 print:shadow-none"}>
              <h2 className="mb-3 text-base font-bold text-ink">Top selling items</h2>
              {data.topItems.length === 0 ? (
                <EmptyLine>No sales in this period.</EmptyLine>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className={tableHead}>
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topItems.map((item, index) => (
                      <tr key={index} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-ink">{item.description}</td>
                        <td className="px-3 py-2 text-right text-ink">{item.qty}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-ink">{money(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Expenses and totals (financial only) */}
            {financial && (
              <section className={cardClass + " print:border-0 print:p-0 print:shadow-none"}>
                <h2 className="mb-3 text-base font-bold text-ink">Expenses by category</h2>
                {data.expensesByCategory.length === 0 ? (
                  <EmptyLine>No expenses in this period.</EmptyLine>
                ) : (
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {data.expensesByCategory.map((row) => (
                        <tr key={row.category} className="border-b border-line">
                          <td className="px-3 py-2 text-ink-muted">{row.category}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-ink">{money(row.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold text-ink">
                        <td className="px-3 py-2">Total expenses</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{money(totalExpenses)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
                  {[
                    ["Sales", money(data.salesTotal)],
                    ["Profit on sales", money(data.profit)],
                    ["Expenses", money(data.expensesTotal)],
                    [
                      "Profit after expenses",
                      money(
                        data.profit !== null && data.expensesTotal !== null
                          ? data.profit - data.expensesTotal
                          : null
                      ),
                    ],
                    ["Purchases", money(data.purchasesTotal)],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="font-semibold text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Customers who owe us */}
            <section className={cardClass + " print:border-0 print:p-0 print:shadow-none"}>
              <h2 className="mb-3 text-base font-bold text-ink">Customers who owe us</h2>
              {customers.length === 0 ? (
                <EmptyLine>No customer owes money right now.</EmptyLine>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className={tableHead}>
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Phone</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr key={c.id} className="relative border-b border-line last:border-0 hover:bg-surface-muted">
                        <td className="px-3 py-2 font-semibold text-ink">
                          <Link
                            href={`/customers/${c.id}`}
                            className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                          >
                            {c.name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{c.phone ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <BalancePill value={c.balance} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* Suppliers we still have to pay */}
            {showSuppliers && (
              <section className={cardClass + " print:border-0 print:p-0 print:shadow-none"}>
                <h2 className="mb-3 text-base font-bold text-ink">Suppliers we are owed to pay</h2>
                {suppliers.length === 0 ? (
                  <EmptyLine>We do not owe any supplier right now.</EmptyLine>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className={tableHead}>
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.map((s) => (
                        <tr key={s.id} className="relative border-b border-line last:border-0 hover:bg-surface-muted">
                          <td className="px-3 py-2 font-semibold text-ink">
                            <Link
                              href={`/suppliers/${s.id}`}
                              className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                            >
                              {s.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <BalancePill value={s.balance} currency={currency} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
