import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, Search, Smartphone } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import {
  BackLink,
  EmptyState,
  Notice,
  PageHeader,
  Pill,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { formatDateWith, formatInvoiceNo } from "@/lib/format";
import { PERMISSION_TRADE_IN, formatCustomerPurchaseNo } from "@/lib/trade-in";

export const metadata: Metadata = {
  title: "Bought from customers",
};

const LIMIT = 200;

type Row = {
  id: string;
  purchase_no: number;
  purchase_date: string;
  seller_name: string;
  seller_phone: string;
  imei: string;
  description: string;
  price: number | string;
  payment_method: string;
  sale_id: string | null;
  phone: { brand_name: string; status: string } | null;
  sale: { invoice_no: number | null } | null;
};

function PaidBy({ row }: { row: Row }) {
  if (row.payment_method === "trade_in") {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <Pill tone="purple">Trade-in</Pill>
        {row.sale_id && (
          <Link href={`/sales/${row.sale_id}`} className="relative z-10 text-xs font-semibold text-accent">
            {formatInvoiceNo(row.sale?.invoice_no)}
          </Link>
        )}
      </span>
    );
  }
  return <Pill tone="neutral">{row.payment_method === "bank" ? "Bank" : "Cash"}</Pill>;
}

export default async function BoughtFromCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!hasAny(permissions, ["purchases.view", "purchases.manage"])) return <AccessDenied />;
  const canBuy = permissions.includes(PERMISSION_TRADE_IN);
  const { q: rawQuery } = await searchParams;
  const q = (rawQuery ?? "").trim().slice(0, 40);

  const supabase = await createClient();
  const business = await getMyBusiness();
  const currency = business?.currency_code || "PKR";
  const dateFormat = business?.date_format ?? "medium";

  let query = supabase
    .from("customer_purchases")
    .select(
      "id, purchase_no, purchase_date, seller_name, seller_phone, imei, description, price, payment_method, sale_id, phone:phone_units(brand_name, status), sale:sales(invoice_no)"
    )
    .order("purchase_date", { ascending: false })
    .order("purchase_no", { ascending: false })
    .limit(LIMIT);
  if (q) {
    const digits = q.replace(/\D/g, "");
    // Digits search the IMEI (and the seller's phone); other text the seller's name
    if (digits.length >= 4 && digits.length === q.replace(/[\s-]/g, "").length) {
      query = query.or(`imei.ilike.%${digits}%,seller_phone.ilike.%${digits}%`);
    } else {
      const safe = q.replace(/[%,()*\\]/g, " ").trim();
      if (safe) query = query.ilike("seller_name", `%${safe}%`);
    }
  }
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const buyButton = canBuy && (
    <Link href="/purchases/from-customers/new" className={primaryButtonClass + " min-h-12 px-6 text-base"}>
      <HandCoins className="h-5 w-5" />
      Buy from customer
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/purchases">Purchases</BackLink>
        <PageHeader
          icon={Smartphone}
          title="Bought from customers"
          description="Used phones bought from customers, on their own or as a trade-in on a sale."
          action={buyButton}
        />
      </div>

      <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="cp-search" className="sr-only">
          Search by IMEI, phone number or seller name
        </label>
        <input
          id="cp-search"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by IMEI, phone number or seller name"
          className={inputClass + " sm:max-w-md"}
        />
        <button type="submit" className={secondaryButtonClass}>
          <Search className="h-4 w-4" />
          Search
        </button>
        {q && (
          <Link href="/purchases/from-customers" className={secondaryButtonClass}>
            Clear
          </Link>
        )}
      </form>

      {error ? (
        <Notice kind="error">Could not load the list: {error.message}</Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title={q ? "Nothing found" : "No phones bought from customers yet"}
          text={
            q
              ? "No phone bought from a customer matches this search."
              : "Phones you buy from customers, and trade-ins taken in the POS, appear here."
          }
          action={!q && buyButton ? buyButton : undefined}
        />
      ) : (
        <section aria-label="Phones bought from customers" className="space-y-3">
          {/* Phone: cards */}
          <ul className="space-y-3 md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/purchases/from-customers/${row.id}`}
                  className="block rounded-card border border-line bg-surface p-4 shadow-soft hover:border-line-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-semibold text-ink-muted">
                        {formatCustomerPurchaseNo(row.purchase_no)} · {formatDateWith(row.purchase_date, dateFormat)}
                      </p>
                      <p className="mt-0.5 truncate font-semibold text-ink">
                        {row.phone?.brand_name ? `${row.phone.brand_name} ` : ""}
                        {row.description}
                      </p>
                      <p className="font-mono text-xs text-ink-muted">IMEI {row.imei}</p>
                      <p className="text-xs text-ink-muted">{row.seller_name}</p>
                    </div>
                    <p className="text-right text-sm font-bold text-ink">{formatMoney(row.price, currency)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {/* Tablet and laptop: table */}
          <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-soft md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-5 py-3">Slip</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">IMEI</th>
                  <th className="px-5 py-3 text-right">Price</th>
                  <th className="px-5 py-3">Paid by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="relative border-b border-line last:border-0 hover:bg-surface-muted focus-within:bg-surface-muted"
                  >
                    <td className="px-5 py-3 font-mono text-xs font-semibold text-ink">
                      <Link
                        href={`/purchases/from-customers/${row.id}`}
                        className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
                      >
                        {formatCustomerPurchaseNo(row.purchase_no)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-ink-muted">
                      {formatDateWith(row.purchase_date, dateFormat)}
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {row.seller_name}
                      <span className="block text-xs text-ink-muted">{row.seller_phone}</span>
                    </td>
                    <td className="px-5 py-3 text-ink">
                      {row.phone?.brand_name ? `${row.phone.brand_name} ` : ""}
                      {row.description}
                      {row.phone?.status === "sold" && <span className="ml-2 text-xs text-ink-muted">(sold)</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-ink">{row.imei}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-ink">
                      {formatMoney(row.price, currency)}
                    </td>
                    <td className="px-5 py-3">
                      <PaidBy row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === LIMIT && (
            <p className="text-xs text-ink-muted">The latest {LIMIT} are shown. Search by IMEI to find older ones.</p>
          )}
        </section>
      )}
    </div>
  );
}
