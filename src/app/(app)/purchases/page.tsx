import type { Metadata } from "next";
import Link from "next/link";
import { PackagePlus, ReceiptText } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { EmptyState, Notice, PageHeader, primaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { formatMoney, toCents } from "@/lib/money";

export const metadata: Metadata = {
  title: "Purchases",
};

const LIMIT = 30;

type PurchaseRow = Record<string, unknown>;

type ListItem = {
  id: string;
  number: string;
  date: string | null;
  supplier: string;
  total: bigint | null;
  paid: bigint | null;
  balance: bigint | null;
};

// Reads the first of several possible column names, so the list keeps
// working if a column is named slightly differently.
function pick(row: PurchaseRow, names: string[]): unknown {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) return row[name];
  }
  return null;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00+05:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Karachi",
  }).format(date);
}

export default async function PurchasesPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "purchases")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("purchases.manage");

  const supabase = await createClient();
  const business = await getMyBusiness();
  const currency = business?.currency_code || "PKR";

  // Latest first. Falls back to an unordered read if created_at is missing.
  let { data, error } = await supabase
    .from("purchases")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(LIMIT);
  if (error) {
    ({ data, error } = await supabase.from("purchases").select("*").limit(LIMIT));
  }
  const rows = (data ?? []) as PurchaseRow[];

  // Supplier names in one extra query
  const supplierIds = [
    ...new Set(
      rows
        .map((row) => row.supplier_id)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  const supplierNames = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", supplierIds);
    for (const s of (suppliers ?? []) as { id: string; name: string }[]) {
      supplierNames.set(s.id, s.name);
    }
  }

  const items: ListItem[] = rows.map((row) => {
    const total = toCents(pick(row, ["total", "total_amount", "grand_total"]));
    const paid = toCents(pick(row, ["paid_amount", "paid", "amount_paid"]));
    const number = pick(row, ["purchase_no", "number"]);
    const date = pick(row, ["purchase_date", "created_at"]);
    return {
      id: String(row.id),
      number: number === null ? "—" : String(number),
      date: typeof date === "string" ? date : null,
      supplier:
        typeof row.supplier_id === "string"
          ? supplierNames.get(row.supplier_id) ?? "Unknown supplier"
          : "—",
      total,
      paid,
      balance: total !== null && paid !== null ? total - paid : null,
    };
  });

  const newButton = canManage && (
    <Link href="/purchases/new" className={primaryButtonClass + " min-h-12 px-6 text-base"}>
      <PackagePlus className="h-5 w-5" />
      New purchase
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        icon={ReceiptText}
        title="Purchases"
        description="Stock bought from suppliers. The latest 30 purchases are shown."
        action={newButton}
      />

      {error ? (
        <Notice kind="error">Could not load purchases: {error.message}</Notice>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No purchases yet"
          text={
            canManage
              ? "Record your first purchase to add phones and accessories to stock."
              : "Purchases will appear here once they are recorded."
          }
          action={newButton || undefined}
        />
      ) : (
        <section aria-label="Latest purchases" className="space-y-3">
          {/* Phone: cards */}
          <ul className="space-y-3 md:hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className="rounded-card border border-line bg-surface p-4 shadow-soft"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-muted">
                      No. {item.number} · {formatDate(item.date)}
                    </p>
                    <p className="mt-0.5 truncate font-semibold text-ink">{item.supplier}</p>
                  </div>
                  <p className="text-right text-sm font-bold text-ink">
                    {formatMoney(item.total, currency)}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-2xl bg-mint px-3 py-2">
                    <span className="block text-ink-muted">Paid</span>
                    <span className="font-semibold text-ink">{formatMoney(item.paid, currency)}</span>
                  </div>
                  <div className="rounded-2xl bg-peach px-3 py-2">
                    <span className="block text-ink-muted">Balance</span>
                    <span className="font-semibold text-ink">
                      {formatMoney(item.balance, currency)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {/* Tablet and laptop: table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">No.</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Supplier</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Paid</th>
                  <th className="px-5 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 font-semibold text-ink">{item.number}</td>
                    <td className="px-5 py-3 text-ink-muted">{formatDate(item.date)}</td>
                    <td className="px-5 py-3 text-ink">{item.supplier}</td>
                    <td className="px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(item.total, currency)}
                    </td>
                    <td className="px-5 py-3 text-right text-ink-muted">
                      {formatMoney(item.paid, currency)}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(item.balance, currency)}
                    </td>
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
