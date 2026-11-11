import type { Metadata } from "next";
import { FileX, ReceiptText } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { centsToPlain, formatMoney, toCents } from "@/lib/money";
import {
  formatDateTime,
  formatInvoiceNo,
  formatWarranty,
  paymentMethodLabel,
  toWhatsAppNumber,
} from "@/lib/format";
import InvoiceActions from "@/app/(app)/sales/[id]/InvoiceActions";
import ReceivePayment from "@/app/(app)/sales/[id]/ReceivePayment";

export const metadata: Metadata = {
  title: "Invoice",
};

type SaleRow = {
  id: string;
  invoice_no: number | string | null;
  created_at: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  subtotal: number | string | null;
  discount: number | string | null;
  total: number | string | null;
  paid_amount: number | string | null;
  payment_method: string | null;
  warranty_terms: string | null;
  notes: string | null;
  status: string | null;
};

type SaleItemRow = {
  item_type: string;
  description: string | null;
  condition: string | null;
  imei: string | null;
  quantity: number | null;
  unit_price: number | string | null;
  discount: number | string | null;
  line_total: number | string | null;
  warranty_days: number | null;
};

type PaymentRow = {
  amount: number | string | null;
  method: string | null;
  kind: string | null;
  created_at: string;
};

const ZERO = BigInt(0);

const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  used: "Used",
  open_box: "Open box",
  refurbished: "Refurbished",
};

// Fixed light colours: the printable area stays white in the dark theme too
const INK = "text-[#1f2a2a]";
const MUTED = "text-[#5b6b6b]";
const LINE = "border-[#ece6d8]";

function NotFound() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/sales">Back to sales</BackLink>
      <EmptyState
        icon={FileX}
        title="Invoice not found"
        text="This invoice does not exist or you do not have access to it."
      />
    </div>
  );
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "sales")) {
    return <AccessDenied />;
  }

  const { id } = await params;
  const { print } = await searchParams;
  if (!UUID_PATTERN.test(id)) return <NotFound />;

  const supabase = await createClient();
  const { data: saleData } = await supabase
    .from("sales")
    .select(
      "id, invoice_no, created_at, customer_id, customer_name, customer_phone, subtotal, discount, total, paid_amount, payment_method, warranty_terms, notes, status"
    )
    .eq("id", id)
    .maybeSingle();
  const sale = saleData as SaleRow | null;
  if (!sale) return <NotFound />;

  const [{ data: itemData }, { data: paymentData }, business] = await Promise.all([
    supabase
      .from("sale_items")
      .select(
        "item_type, description, condition, imei, quantity, unit_price, discount, line_total, warranty_days"
      )
      .eq("sale_id", id),
    supabase
      .from("sale_payments")
      .select("amount, method, kind, created_at")
      .eq("sale_id", id)
      .order("created_at"),
    getMyBusiness(),
  ]);
  const items = (itemData ?? []) as SaleItemRow[];
  const payments = (paymentData ?? []) as PaymentRow[];

  const currency = business?.currency_code || "PKR";
  const shopName = business?.name || "Retail workspace";
  const invoiceNo = formatInvoiceNo(sale.invoice_no);
  const date = formatDateTime(sale.created_at);
  const customerName = sale.customer_name?.trim() || "Walk-in customer";

  const total = toCents(sale.total) ?? ZERO;
  const paid = toCents(sale.paid_amount) ?? ZERO;
  const remaining = total - paid;

  // Cash, Bank, or both when the payments used both
  const methods = new Set(payments.map((p) => p.method).filter(Boolean));
  const methodLabel =
    methods.has("cash") && methods.has("bank")
      ? "Cash and Bank"
      : methods.size === 1
        ? paymentMethodLabel([...methods][0])
        : paymentMethodLabel(sale.payment_method);

  const canReceive =
    remaining > ZERO && hasAny(permissions, ["sales.create", "customers.manage"]);

  // Plain English WhatsApp message
  const lines = [
    shopName,
    `Invoice ${invoiceNo}`,
    `Date: ${date}`,
    `Customer: ${customerName}`,
    "",
    "Items:",
    ...items.map(
      (item) =>
        `- ${item.description ?? "Item"} x ${item.quantity ?? 1}: ${formatMoney(item.line_total, currency)}`
    ),
    "",
    `Total: ${formatMoney(total, currency)}`,
    `Paid: ${formatMoney(paid, currency)}`,
    `Remaining: ${formatMoney(remaining, currency)}`,
  ];
  if (sale.warranty_terms?.trim()) lines.push("", `Warranty: ${sale.warranty_terms.trim()}`);
  lines.push("", "Thank you for your purchase.");
  const number = toWhatsAppNumber(sale.customer_phone);
  const whatsappUrl = `https://wa.me/${number ?? ""}?text=${encodeURIComponent(lines.join("\n"))}`;

  const contact = [business?.address, business?.phone, business?.email].filter(
    (value): value is string => Boolean(value && value.trim())
  );

  const thermalOnly = "hidden group-data-[paper=thermal]:block";
  const a4Only = "group-data-[paper=thermal]:hidden";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="print:hidden">
        <BackLink href="/sales">Back to sales</BackLink>
      </div>

      <InvoiceActions saleId={sale.id} whatsappUrl={whatsappUrl} autoPrint={print === "1"}>
        <article
          className={
            "mx-auto rounded-card border bg-white p-5 shadow-soft sm:p-8 " +
            `${LINE} ${INK} ` +
            "print:rounded-none print:border-0 print:p-0 print:shadow-none " +
            "group-data-[paper=thermal]:max-w-[80mm] group-data-[paper=thermal]:p-3 group-data-[paper=thermal]:text-[11px]"
          }
        >
          {/* Header */}
          <header
            className={
              `flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE} ` +
              "group-data-[paper=thermal]:block group-data-[paper=thermal]:text-center"
            }
          >
            <div className="min-w-0">
              <p className="text-xl font-bold group-data-[paper=thermal]:text-sm">{shopName}</p>
              {business?.legal_name && business.legal_name !== shopName && (
                <p className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                  {business.legal_name}
                </p>
              )}
              {contact.map((value) => (
                <p key={value} className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                  {value}
                </p>
              ))}
            </div>
            <div className="text-right group-data-[paper=thermal]:mt-2 group-data-[paper=thermal]:text-center">
              <p className="text-2xl font-bold tracking-widest group-data-[paper=thermal]:text-sm">
                INVOICE
              </p>
              <p className="font-mono text-sm font-semibold">{invoiceNo}</p>
              <p className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>{date}</p>
            </div>
          </header>

          {/* Customer */}
          <section className="py-4 group-data-[paper=thermal]:py-2">
            <p className={`text-xs font-semibold uppercase tracking-wide ${MUTED}`}>Bill to</p>
            <p className="font-semibold">{customerName}</p>
            {sale.customer_phone && <p className={`text-sm ${MUTED}`}>{sale.customer_phone}</p>}
          </section>

          {/* Items: A4 table */}
          <div className={"overflow-x-auto " + a4Only}>
            <table className="w-full text-left text-sm">
              <thead className={`border-y text-xs font-semibold uppercase tracking-wide ${LINE} ${MUTED}`}>
                <tr>
                  <th className="py-2 pr-3">Item</th>
                  <th className="px-2 py-2 text-right">Qty</th>
                  <th className="px-2 py-2 text-right">Unit price</th>
                  <th className="px-2 py-2 text-right">Discount</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="py-2 pl-3">Warranty</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index} className={`border-b align-top ${LINE}`}>
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold">{item.description ?? "Item"}</p>
                      {item.item_type === "phone" && (
                        <p className={`text-xs ${MUTED}`}>
                          {item.condition ? `${CONDITION_LABELS[item.condition] ?? item.condition} · ` : ""}
                          {item.imei ? (
                            <>
                              IMEI <span className="font-mono">{item.imei}</span>
                            </>
                          ) : null}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">{item.quantity ?? 1}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      {formatMoney(item.unit_price, currency)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      {formatMoney(item.discount ?? 0, currency)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-semibold">
                      {formatMoney(item.line_total, currency)}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pl-3">{formatWarranty(item.warranty_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Items: compact thermal list */}
          <ul className={`border-y border-dashed py-1 ${LINE} ${thermalOnly}`}>
            {items.map((item, index) => (
              <li key={index} className={`border-b border-dashed py-1 last:border-0 ${LINE}`}>
                <p className="font-semibold">{item.description ?? "Item"}</p>
                {item.item_type === "phone" && item.imei && (
                  <p className="font-mono text-[10px]">IMEI {item.imei}</p>
                )}
                <div className="flex justify-between">
                  <span>
                    {item.quantity ?? 1} x {formatMoney(item.unit_price, currency)}
                    {toCents(item.discount) ? ` - ${formatMoney(item.discount, currency)}` : ""}
                  </span>
                  <span className="font-semibold">{formatMoney(item.line_total, currency)}</span>
                </div>
                <p className="text-[10px]">Warranty: {formatWarranty(item.warranty_days)}</p>
              </li>
            ))}
          </ul>

          {/* Totals */}
          <section className="mt-4 flex justify-end group-data-[paper=thermal]:mt-2 group-data-[paper=thermal]:block">
            <dl className="w-full max-w-xs space-y-1 text-sm group-data-[paper=thermal]:max-w-none group-data-[paper=thermal]:text-[11px]">
              {[
                ["Subtotal", formatMoney(sale.subtotal, currency)],
                ["Discount", formatMoney(sale.discount ?? 0, currency)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className={MUTED}>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
              <div className={`flex justify-between gap-4 border-t pt-1 text-base font-bold ${LINE} group-data-[paper=thermal]:text-xs`}>
                <dt>Grand total</dt>
                <dd>{formatMoney(total, currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className={MUTED}>Paid</dt>
                <dd>{formatMoney(paid, currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <dt>Remaining</dt>
                <dd>{formatMoney(remaining, currency)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className={MUTED}>Payment method</dt>
                <dd>{methodLabel}</dd>
              </div>
            </dl>
          </section>

          {sale.notes?.trim() && (
            <p className={`mt-4 text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
              Notes: {sale.notes}
            </p>
          )}

          {/* Warranty terms and thank you */}
          <footer className={`mt-6 border-t pt-4 text-center ${LINE} group-data-[paper=thermal]:mt-3 group-data-[paper=thermal]:pt-2`}>
            {sale.warranty_terms?.trim() && (
              <p className={`whitespace-pre-line text-xs ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                {sale.warranty_terms}
              </p>
            )}
            <p className="mt-2 text-sm font-semibold group-data-[paper=thermal]:text-[11px]">
              Thank you for your purchase.
            </p>
          </footer>
        </article>
      </InvoiceActions>

      {/* Not printed: receive payment and payment history */}
      {canReceive && (
        <section className={cardClass + " print:hidden"}>
          <ReceivePayment
            key={centsToPlain(remaining)}
            saleId={sale.id}
            remaining={centsToPlain(remaining)}
            currency={currency}
          />
        </section>
      )}

      <section className={cardClass + " print:hidden"}>
        <div className="mb-3 flex items-center gap-2">
          <ReceiptText className="h-5 w-5 text-accent" />
          <h2 className="text-base font-bold text-ink">Payments</h2>
        </div>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface-muted px-4 py-5 text-center text-sm text-ink-muted">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {payments.map((payment, index) => (
              <li key={index} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-ink-muted">{formatDateTime(payment.created_at)}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink">
                    {paymentMethodLabel(payment.method)}
                    {payment.kind === "later" ? " · later" : ""}
                  </span>
                  <span className="font-semibold text-ink">{formatMoney(payment.amount, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
