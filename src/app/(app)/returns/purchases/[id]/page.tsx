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
import { formatMoney } from "@/lib/money";
import { formatDateWith, type DateFormat } from "@/lib/format";
import { formatPurchaseNo, formatPurchaseReturnNo } from "@/lib/returns";

export const metadata: Metadata = {
  title: "Purchase return",
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
  purchase_id: string;
  purchase: { purchase_no: number } | null;
  supplier: { name: string } | null;
  account: { name: string } | null;
};

type ItemRow = {
  id: string;
  description: string;
  imei: string | null;
  quantity: number;
  unit_cost: number | string;
  line_total: number | string;
};

const INK = "text-[#0f172a]";
const MUTED = "text-[#475569]";
const LINE = "border-[#e2e8f0]";

export default async function PurchaseReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "returns")) return <AccessDenied />;
  const { id } = await params;

  const notFound = (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/returns?tab=purchases">Returns</BackLink>
      <EmptyState icon={FileX} title="Return not found" text="This return does not exist or you do not have access to it." />
    </div>
  );
  if (!UUID_PATTERN.test(id)) return notFound;

  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_returns")
    .select(
      "id, return_no, return_date, reason, notes, total, credit_amount, refund_amount, purchase_id, purchase:purchases(purchase_no), supplier:suppliers(name), account:finance_accounts(name)"
    )
    .eq("id", id)
    .maybeSingle();
  const ret = data as unknown as ReturnRow | null;
  if (!ret) return notFound;

  const [{ data: itemData }, business] = await Promise.all([
    supabase
      .from("purchase_return_items")
      .select("id, description, imei, quantity, unit_cost, line_total")
      .eq("return_id", id)
      .order("description"),
    getMyBusiness(),
  ]);
  const items = (itemData ?? []) as ItemRow[];
  const currency = business?.currency_code || "PKR";
  const dateFormat = (business?.date_format ?? "medium") as DateFormat;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <BackLink href="/returns?tab=purchases">Returns</BackLink>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/purchases/${ret.purchase_id}`}
            className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-ink"
          >
            Open purchase
          </Link>
          <PrintButton />
        </div>
      </div>

      <article className={`rounded-card border bg-white p-6 shadow-soft sm:p-8 print:border-0 print:p-0 print:shadow-none ${LINE} ${INK}`}>
        <header className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE}`}>
          <div>
            <p className="text-xl font-bold">{business?.name || "Retail workspace"}</p>
            <p className={`text-sm ${MUTED}`}>Return to {ret.supplier?.name ?? "supplier"}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tracking-widest">SUPPLIER RETURN</p>
            <p className="tabular-nums text-sm font-semibold">{formatPurchaseReturnNo(ret.return_no)}</p>
            <p className={`text-sm ${MUTED}`}>{formatDateWith(ret.return_date, dateFormat)}</p>
          </div>
        </header>

        <p className={`border-b py-3 text-sm ${LINE}`}>
          <span className={MUTED}>Purchase </span>
          <span className="font-semibold">{formatPurchaseNo(ret.purchase?.purchase_no)}</span>
          <span className={MUTED}> · Reason: </span>
          {ret.reason}
          {ret.notes ? ` · ${ret.notes}` : ""}
        </p>

        <table className="mt-4 w-full text-left text-sm">
          <thead className={`border-b text-xs font-semibold uppercase tracking-wide ${LINE} ${MUTED}`}>
            <tr>
              <th className="py-2 pr-3">Item</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit cost</th>
              <th className="py-2 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={`border-b align-top ${LINE}`}>
                <td className="py-2 pr-3">
                  <p className="font-semibold">{item.description}</p>
                  {item.imei && <p className={`tabular-nums text-xs ${MUTED}`}>IMEI {item.imei}</p>}
                </td>
                <td className="px-2 py-2 text-right">{item.quantity}</td>
                <td className="px-2 py-2 text-right">{formatMoney(item.unit_cost, currency)}</td>
                <td className="py-2 pl-2 text-right font-semibold">{formatMoney(item.line_total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between gap-4 font-bold">
            <dt>Total returned</dt>
            <dd>{formatMoney(ret.total, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>Taken off the amount owed</dt>
            <dd>{formatMoney(ret.credit_amount, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className={MUTED}>Money received back</dt>
            <dd>{formatMoney(ret.refund_amount, currency)}</dd>
          </div>
          {Number(ret.refund_amount) > 0 && ret.account && (
            <div className="flex justify-between gap-4">
              <dt className={MUTED}>Received into</dt>
              <dd>{ret.account.name}</dd>
            </div>
          )}
        </dl>
      </article>
    </div>
  );
}
