import type { Metadata } from "next";
import Link from "next/link";
import { FileX } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import PrintButton from "@/components/PrintButton";
import { BackLink, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatMoney, toCents } from "@/lib/money";
import { formatDateWith, formatInvoiceNo, type DateFormat } from "@/lib/format";
import { formatSalesReturnNo } from "@/lib/returns";

export const metadata: Metadata = {
  title: "Sales return",
};

type ReturnRow = {
  id: string;
  return_no: number;
  return_date: string;
  reason: string;
  notes: string | null;
  total: number | string;
  credit_amount: number | string;
  refund_amount: number | string;
  vat_rate: number | string | null;
  vat_amount: number | string | null;
  created_at: string;
  sale_id: string;
  sale: { invoice_no: number; customer_name: string | null; customer_phone: string | null } | null;
  account: { name: string } | null;
};

type ItemRow = {
  id: string;
  description: string;
  imei: string | null;
  quantity: number;
  line_total: number | string;
  restock: boolean;
};

const INK = "text-[#1f2a2a]";
const MUTED = "text-[#5b6b6b]";
const LINE = "border-[#ece6d8]";

export default async function SalesReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "returns")) return <AccessDenied />;
  const { id } = await params;

  const notFound = (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/returns?tab=sales">Returns</BackLink>
      <EmptyState icon={FileX} title="Return not found" text="This return does not exist or you do not have access to it." />
    </div>
  );
  if (!UUID_PATTERN.test(id)) return notFound;

  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_returns")
    .select(
      "id, return_no, return_date, reason, notes, total, credit_amount, refund_amount, vat_rate, vat_amount, created_at, sale_id, sale:sales(invoice_no, customer_name, customer_phone), account:finance_accounts(name)"
    )
    .eq("id", id)
    .maybeSingle();
  const ret = data as unknown as ReturnRow | null;
  if (!ret) return notFound;

  const [{ data: itemData }, business] = await Promise.all([
    supabase
      .from("sales_return_items")
      .select("id, description, imei, quantity, line_total, restock")
      .eq("return_id", id)
      .order("description"),
    getMyBusiness(),
  ]);
  const items = (itemData ?? []) as ItemRow[];
  const currency = business?.currency_code || "PKR";
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;
  const showLogo = Boolean(business?.invoice_show_logo && business?.logo_url);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <BackLink href="/returns?tab=sales">Returns</BackLink>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/sales/${ret.sale_id}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink"
          >
            Open invoice
          </Link>
          <PrintButton />
        </div>
      </div>

      <article className={`rounded-card border bg-white p-6 shadow-soft sm:p-8 print:border-0 print:p-0 print:shadow-none ${LINE} ${INK}`}>
        <header className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE}`}>
          <div className="flex items-start gap-3">
            {showLogo && (
              // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
              <img src={business!.logo_url!} alt="" className="h-14 w-14 object-contain" />
            )}
            <div>
              <p className="text-xl font-bold">{business?.name || "Retail workspace"}</p>
              {business?.phone && <p className={`text-sm ${MUTED}`}>{business.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tracking-widest">RETURN</p>
            <p className="font-mono text-sm font-semibold">{formatSalesReturnNo(ret.return_no)}</p>
            <p className={`text-sm ${MUTED}`}>{formatDateWith(ret.return_date, dateFormat)}</p>
          </div>
        </header>

        <section className={`grid gap-2 border-b py-4 text-sm sm:grid-cols-2 ${LINE}`}>
          <p>
            <span className={MUTED}>Invoice: </span>
            <span className="font-semibold">{formatInvoiceNo(ret.sale?.invoice_no)}</span>
          </p>
          <p>
            <span className={MUTED}>Customer: </span>
            <span className="font-semibold">{ret.sale?.customer_name || "Walk-in customer"}</span>
          </p>
          <p className="sm:col-span-2">
            <span className={MUTED}>Reason: </span>
            {ret.reason}
            {ret.notes ? ` · ${ret.notes}` : ""}
          </p>
        </section>

        <table className="mt-4 w-full text-left text-sm">
          <thead className={`border-b text-xs font-semibold uppercase tracking-wide ${LINE} ${MUTED}`}>
            <tr>
              <th className="py-2 pr-3">Item</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="py-2 pl-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={`border-b align-top ${LINE}`}>
                <td className="py-2 pr-3">
                  <p className="font-semibold">{item.description}</p>
                  <p className={`text-xs ${MUTED}`}>
                    {item.imei ? `IMEI ${item.imei} · ` : ""}
                    {item.restock ? "Back in stock" : "Written off"}
                  </p>
                </td>
                <td className="px-2 py-2 text-right">{item.quantity}</td>
                <td className="py-2 pl-2 text-right font-semibold">{formatMoney(item.line_total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-4 font-bold">
            <dt>Value returned</dt>
            <dd>{formatMoney(ret.total, currency)}</dd>
          </div>
          {Number(ret.vat_rate ?? 0) > 0 && (
            <>
              <div className="flex justify-between gap-4">
                <dt className={MUTED}>Value before VAT</dt>
                <dd>{formatMoney((toCents(ret.total) ?? BigInt(0)) - (toCents(ret.vat_amount) ?? BigInt(0)), currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className={MUTED}>VAT reversed ({String(Number(Number(ret.vat_rate).toFixed(2)))}%)</dt>
                <dd>{formatMoney(ret.vat_amount, currency)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>Taken off the amount owed</dt>
            <dd>{formatMoney(ret.credit_amount, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>Refunded</dt>
            <dd>{formatMoney(ret.refund_amount, currency)}</dd>
          </div>
          {Number(ret.refund_amount) > 0 && ret.account && (
            <div className="flex justify-between gap-4">
              <dt className={MUTED}>Paid from</dt>
              <dd>{ret.account.name}</dd>
            </div>
          )}
        </dl>

        <footer className={`mt-8 grid grid-cols-2 gap-6 border-t pt-6 text-xs ${LINE} ${MUTED}`}>
          <p className="border-t border-dashed border-[#5b6b6b] pt-1">Customer signature</p>
          <p className="border-t border-dashed border-[#5b6b6b] pt-1">Shop signature</p>
        </footer>
      </article>
    </div>
  );
}
