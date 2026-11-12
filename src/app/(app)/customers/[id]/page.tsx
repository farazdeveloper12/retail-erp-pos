import type { Metadata } from "next";
import Link from "next/link";
import { FileX, ReceiptText, UserRound } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import BalancePill from "@/components/BalancePill";
import { BackLink, EmptyState, PageHeader, StatusPill, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateTime, formatInvoiceNo } from "@/lib/format";

export const metadata: Metadata = {
  title: "Customer",
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

type SaleRow = {
  id: string;
  invoice_no: number | string | null;
  created_at: string;
  total: number | string | null;
  paid_amount: number | string | null;
};

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/customers">Back to customers</BackLink>
      <EmptyState
        icon={FileX}
        title="Customer not found"
        text="This customer does not exist or you do not have access to it."
      />
    </div>
  );
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "customers")) {
    return <AccessDenied />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return <NotFound />;

  const supabase = await createClient();
  const { data: customerData } = await supabase
    .from("customers")
    .select("id, name, phone, address, notes, is_active")
    .eq("id", id)
    .maybeSingle();
  const customer = customerData as CustomerRow | null;
  if (!customer) return <NotFound />;

  const [{ data: balanceData }, { data: saleData }, business] = await Promise.all([
    supabase.from("customer_balances").select("balance").eq("customer_id", id).maybeSingle(),
    // RLS decides which of this customer's sales the user may see
    supabase
      .from("sales")
      .select("id, invoice_no, created_at, total, paid_amount")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    getMyBusiness(),
  ]);
  const currency = business?.currency_code || "PKR";
  const balance = toCents((balanceData as { balance?: unknown } | null)?.balance ?? 0);
  const sales = ((saleData ?? []) as SaleRow[]).map((sale) => {
    const total = toCents(sale.total);
    const paid = toCents(sale.paid_amount);
    return {
      id: sale.id,
      invoice: formatInvoiceNo(sale.invoice_no),
      date: formatDateTime(sale.created_at),
      total,
      paid,
      remaining: total !== null && paid !== null ? total - paid : null,
    };
  });

  const details: [string, string][] = [
    ["Phone", customer.phone || "—"],
    ["Address", customer.address || "—"],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/customers">Back to customers</BackLink>
        <PageHeader icon={UserRound} title={customer.name} description="Customer details and sales." />
      </div>

      <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={cardClass + " space-y-3"}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-ink">Details</h2>
            <StatusPill active={customer.is_active} />
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface-muted px-4 py-3">
                <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {customer.notes?.trim() && (
            <p className="whitespace-pre-line text-sm text-ink-muted">
              <span className="font-semibold text-ink">Notes: </span>
              {customer.notes}
            </p>
          )}
        </div>
        <div className="flex flex-col justify-center rounded-card bg-peach px-5 py-4">
          <p className="text-sm font-medium text-ink">Balance (they owe)</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatMoney(balance, currency)}</p>
          <p className="mt-1 text-xs text-ink-muted">Open an unpaid invoice below to receive payment.</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-ink">Sales</h2>
        {sales.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No sales yet"
            text="Sales to this customer will appear here."
          />
        ) : (
          <>
            <ul className="space-y-3 md:hidden">
              {sales.map((sale) => (
                <li key={sale.id}>
                  <Link
                    href={`/sales/${sale.id}`}
                    className="block rounded-card border border-line bg-surface p-4 shadow-soft transition active:scale-[0.99] hover:border-line-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-mono text-xs font-semibold text-ink">
                        {sale.invoice}
                        <span className="block font-sans font-normal text-ink-muted">{sale.date}</span>
                      </p>
                      <p className="text-sm font-bold text-ink">{formatMoney(sale.total, currency)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                      <span>
                        Paid <span className="font-semibold text-ink">{formatMoney(sale.paid, currency)}</span>
                      </span>
                      <BalancePill value={sale.remaining} currency={currency} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-5 py-3">Invoice</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => (
                    <tr
                      key={sale.id}
                      className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                    >
                      <td className="px-5 py-3 font-mono text-xs font-semibold text-ink">
                        <Link
                          href={`/sales/${sale.id}`}
                          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                        >
                          {sale.invoice}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-muted">{sale.date}</td>
                      <td className="px-5 py-3 text-right font-semibold text-ink">
                        {formatMoney(sale.total, currency)}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-muted">{formatMoney(sale.paid, currency)}</td>
                      <td className="px-5 py-3 text-right">
                        <BalancePill value={sale.remaining} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
