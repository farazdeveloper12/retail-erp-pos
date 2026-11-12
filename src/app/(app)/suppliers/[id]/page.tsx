import type { Metadata } from "next";
import Link from "next/link";
import { FileX, ReceiptText, Truck } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import BalancePill from "@/components/BalancePill";
import { BackLink, EmptyState, PageHeader, StatusPill, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatMoney, toCents } from "@/lib/money";

export const metadata: Metadata = {
  title: "Supplier",
};

type SupplierRow = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

type PurchaseRow = {
  id: string;
  purchase_no: number | string | null;
  purchase_date: string | null;
  total: number | string | null;
  paid_amount: number | string | null;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Asia/Karachi" }).format(
    date
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/suppliers">Back to suppliers</BackLink>
      <EmptyState
        icon={FileX}
        title="Supplier not found"
        text="This supplier does not exist or you do not have access to it."
      />
    </div>
  );
}

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "suppliers")) {
    return <AccessDenied />;
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return <NotFound />;

  const supabase = await createClient();
  const { data: supplierData } = await supabase
    .from("suppliers")
    .select("id, name, phone, address, notes, is_active")
    .eq("id", id)
    .maybeSingle();
  const supplier = supplierData as SupplierRow | null;
  if (!supplier) return <NotFound />;

  const [{ data: balanceData }, { data: purchaseData }, business] = await Promise.all([
    supabase.from("supplier_balances").select("balance").eq("supplier_id", id).maybeSingle(),
    supabase
      .from("purchases")
      .select("id, purchase_no, purchase_date, total, paid_amount")
      .eq("supplier_id", id)
      .order("purchase_date", { ascending: false })
      .order("purchase_no", { ascending: false })
      .limit(100),
    getMyBusiness(),
  ]);
  const currency = business?.currency_code || "PKR";
  const balance = toCents((balanceData as { balance?: unknown } | null)?.balance ?? 0);
  const purchases = (purchaseData ?? []) as PurchaseRow[];

  const rows = purchases.map((p) => {
    const total = toCents(p.total);
    // paid_amount already includes later supplier payments
    const paid = toCents(p.paid_amount);
    return {
      id: p.id,
      number: p.purchase_no === null ? "—" : String(p.purchase_no),
      date: formatDate(p.purchase_date),
      total,
      paid,
      balance: total !== null && paid !== null ? total - paid : null,
    };
  });

  const details: [string, string][] = [
    ["Phone", supplier.phone || "—"],
    ["Address", supplier.address || "—"],
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/suppliers">Back to suppliers</BackLink>
        <PageHeader icon={Truck} title={supplier.name} description="Supplier details and purchases." />
      </div>

      <section className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className={cardClass + " space-y-3"}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-ink">Details</h2>
            <StatusPill active={supplier.is_active} />
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-surface-muted px-4 py-3">
                <dt className="text-xs font-semibold text-ink-muted">{label}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {supplier.notes?.trim() && (
            <p className="whitespace-pre-line text-sm text-ink-muted">
              <span className="font-semibold text-ink">Notes: </span>
              {supplier.notes}
            </p>
          )}
        </div>
        <div className="flex flex-col justify-center rounded-card bg-peach px-5 py-4">
          <p className="text-sm font-medium text-ink">Balance (we owe)</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatMoney(balance, currency)}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-ink">Purchases</h2>
        {rows.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No purchases yet"
            text="Purchases from this supplier will appear here."
          />
        ) : (
          <>
            <ul className="space-y-3 md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/purchases/${row.id}`}
                    className="block rounded-card border border-line bg-surface p-4 shadow-soft transition active:scale-[0.99] hover:border-line-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/20"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">
                        No. {row.number}
                        <span className="block text-xs font-normal text-ink-muted">{row.date}</span>
                      </p>
                      <p className="text-sm font-bold text-ink">{formatMoney(row.total, currency)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                      <span>
                        Paid <span className="font-semibold text-ink">{formatMoney(row.paid, currency)}</span>
                      </span>
                      <BalancePill value={row.balance} currency={currency} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-5 py-3">No.</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Paid</th>
                    <th className="px-5 py-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                    >
                      <td className="px-5 py-3 font-semibold text-ink">
                        <Link
                          href={`/purchases/${row.id}`}
                          className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                        >
                          {row.number}
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-ink-muted">{row.date}</td>
                      <td className="px-5 py-3 text-right font-semibold text-ink">
                        {formatMoney(row.total, currency)}
                      </td>
                      <td className="px-5 py-3 text-right text-ink-muted">{formatMoney(row.paid, currency)}</td>
                      <td className="px-5 py-3 text-right">
                        <BalancePill value={row.balance} currency={currency} />
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
