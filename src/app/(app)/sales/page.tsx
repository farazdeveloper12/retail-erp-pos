import type { Metadata } from "next";
import Link from "next/link";
import { ReceiptText, ShoppingCart } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { EmptyState, Notice, PageHeader, Pill, primaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateTime, formatInvoiceNo } from "@/lib/format";
import { COST_PERMISSION, getSaleProfits, type SaleProfit } from "@/lib/profit";

export const metadata: Metadata = {
  title: "Sales",
};

const LIMIT = 30;
const ZERO = BigInt(0);

type SaleRow = {
  id: string;
  invoice_no: string | number | null;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  total: number | string | null;
  paid_amount: number | string | null;
  status: string | null;
};

type SaleItem = {
  id: string;
  invoice: string;
  date: string;
  customer: string;
  total: bigint | null;
  paid: bigint | null;
  remaining: bigint | null;
  cancelled: boolean;
  // Only for users who may see cost; null for everyone else
  profit: SaleProfit | null;
};

function ProfitValue({ value, currency }: { value: SaleProfit | null; currency: string }) {
  if (!value) return <span className="text-ink-muted">—</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span className={"font-semibold " + (value.netProfit < ZERO ? "text-danger" : "text-ink")}>
        {formatMoney(value.netProfit, currency)}
      </span>
      {value.returnsProfit !== ZERO && <span className="text-xs text-ink-muted">after returns</span>}
      {value.costMissing && <span className="text-xs font-semibold text-coral">cost missing</span>}
    </span>
  );
}

function RemainingPill({ value, currency }: { value: bigint | null; currency: string }) {
  if (value === null) return <span className="text-ink-muted">—</span>;
  if (value > ZERO) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-peach px-2.5 py-1 text-xs font-semibold text-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" />
        {formatMoney(value, currency)}
      </span>
    );
  }
  return <span className="text-ink-muted">{formatMoney(value, currency)}</span>;
}

export default async function SalesPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "sales")) {
    return <AccessDenied />;
  }
  const canCreate = permissions.includes("sales.create");
  const seesProfit = permissions.includes(COST_PERMISSION);

  const supabase = await createClient();
  const business = await getMyBusiness();
  const currency = business?.currency_code || "PKR";

  // Latest first; RLS decides which sales this user may see
  const { data, error } = await supabase
    .from("sales")
    .select("id, invoice_no, created_at, customer_id, customer_name, total, paid_amount, status")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  const rows = (data ?? []) as SaleRow[];
  // Profit (before VAT) is calculated by the database, only for users who may see cost
  const profits = seesProfit ? await getSaleProfits(rows.map((row) => row.id)) : new Map<string, SaleProfit>();

  const timeZone = await getBusinessTimeZone();
  const sales: SaleItem[] = rows.map((row) => {
    const total = toCents(row.total);
    const paid = toCents(row.paid_amount);
    return {
      id: row.id,
      invoice: formatInvoiceNo(row.invoice_no),
      date: formatDateTime(row.created_at, timeZone),
      // customer_name is a snapshot stored on the sale
      customer: row.customer_name?.trim()
        ? row.customer_name
        : row.customer_id
          ? "Customer"
          : "Walk-in customer",
      total,
      paid,
      cancelled: row.status === "void",
      // A cancelled invoice owes nothing
      remaining:
        row.status === "void" ? ZERO : total !== null && paid !== null ? total - paid : null,
      profit: row.status === "void" ? null : profits.get(row.id) ?? null,
    };
  });

  const newButton = canCreate && (
    <Link href="/sales/new" className={primaryButtonClass + " min-h-12 px-6 text-base"}>
      <ShoppingCart className="h-5 w-5" />
      New sale
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={ReceiptText}
        title="Sales"
        description={seesProfit ? "The latest 30 sales. Profit is shown before VAT." : "The latest 30 sales."}
        action={newButton}
      />

      {error ? (
        <Notice kind="error">Could not load sales: {error.message}</Notice>
      ) : sales.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No sales yet"
          text={
            canCreate
              ? "Record your first sale. Scan an IMEI or search an accessory to start."
              : "Sales will appear here once they are recorded."
          }
          action={newButton || undefined}
        />
      ) : (
        <section aria-label="Latest sales" className="space-y-3">
          {/* Phone: cards */}
          <ul className="space-y-3 md:hidden">
            {sales.map((sale) => (
              <li key={sale.id}>
                <Link
                  href={`/sales/${sale.id}`}
                  aria-label={`Open invoice ${sale.invoice}`}
                  className="block rounded-card border border-line bg-surface p-4 shadow-soft transition active:scale-[0.99] hover:border-line-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-mono text-xs font-semibold text-ink-muted">
                      {sale.invoice}
                      {sale.cancelled && <Pill tone="neutral">Cancelled</Pill>}
                    </p>
                    <p className="mt-0.5 truncate font-semibold text-ink">{sale.customer}</p>
                    <p className="text-xs text-ink-muted">{sale.date}</p>
                  </div>
                  <p className="text-right text-sm font-bold text-ink">
                    {formatMoney(sale.total, currency)}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-muted">
                    Paid <span className="font-semibold text-ink">{formatMoney(sale.paid, currency)}</span>
                  </span>
                  <RemainingPill value={sale.remaining} currency={currency} />
                </div>
                {seesProfit && (
                  <div className="mt-2 flex items-start justify-between gap-2 border-t border-line pt-2 text-xs">
                    <span className="text-ink-muted">Profit (before VAT)</span>
                    <ProfitValue value={sale.profit} currency={currency} />
                  </div>
                )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and laptop: table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Paid</th>
                  <th className="px-5 py-3 text-right">Remaining</th>
                  {seesProfit && <th className="px-5 py-3 text-right">Profit</th>}
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr
                    key={sale.id}
                    className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-ink">
                      {/* The link covers the whole row, so one Tab stop opens it */}
                      <Link
                        href={`/sales/${sale.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                      >
                        {sale.invoice}
                      </Link>
                      {sale.cancelled && (
                        <span className="ml-2 align-middle">
                          <Pill tone="neutral">Cancelled</Pill>
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{sale.date}</td>
                    <td className="px-5 py-3 text-ink">{sale.customer}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(sale.total, currency)}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-muted">
                      {formatMoney(sale.paid, currency)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RemainingPill value={sale.remaining} currency={currency} />
                    </td>
                    {seesProfit && (
                      <td className="px-5 py-3 text-right">
                        <ProfitValue value={sale.profit} currency={currency} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
