import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { FileX, ReceiptText, RotateCcw, ShieldCheck } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, cardClass, secondaryButtonClass } from "@/components/ui";
import { formatSalesReturnNo } from "@/lib/returns";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { centsToPlain, formatMoney, toCents } from "@/lib/money";
import {
  formatDateTime,
  formatDateWith,
  formatInvoiceNo,
  formatWarranty,
  paymentMethodLabel,
  toWhatsAppNumber,
} from "@/lib/format";
import InvoiceActions from "@/app/(app)/sales/[id]/InvoiceActions";
import ReceivePayment from "@/app/(app)/sales/[id]/ReceivePayment";
import { cancelSale } from "@/app/(app)/sales/[id]/actions";
import CancelDocument from "@/components/CancelDocument";

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
  vat_rate: number | string | null;
  vat_amount: number | string | null;
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

// English label, followed by the Arabic one on bilingual invoices
function Label({ en, ar, bilingual }: { en: string; ar: string; bilingual: boolean }): ReactNode {
  if (!bilingual) return en;
  return (
    <>
      {en}{" "}
      <span dir="rtl" lang="ar" className="font-arabic">
        {ar}
      </span>
    </>
  );
}

// "5.00" -> "5", "7.50" -> "7.5"
function formatRate(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : "0";
}

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
      "id, invoice_no, created_at, customer_id, customer_name, customer_phone, subtotal, discount, total, paid_amount, payment_method, warranty_terms, notes, status, vat_rate, vat_amount, voided_at, void_reason, returned_total, refunded_total, return_credit"
    )
    .eq("id", id)
    .maybeSingle();
  const sale = saleData as
    | (SaleRow & {
        voided_at: string | null;
        void_reason: string | null;
        returned_total: number | string | null;
        refunded_total: number | string | null;
        return_credit: number | string | null;
      })
    | null;
  if (!sale) return <NotFound />;

  const canReturn = permissions.includes("returns.manage");
  const [{ data: itemData }, { data: paymentData }, business, { data: returnData }, { data: customerData }] =
    await Promise.all([
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
    canReturn || permissions.includes("sales.view_all")
      ? supabase
          .from("sales_returns")
          .select("id, return_no, return_date, total, refund_amount, vat_amount")
          .eq("sale_id", id)
          .order("return_no")
      : Promise.resolve({ data: [] }),
    // The customer's TRN is printed on tax invoices
    sale.customer_id
      ? supabase.from("customers").select("trn").eq("id", sale.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const items = (itemData ?? []) as SaleItemRow[];
  const payments = (paymentData ?? []) as PaymentRow[];
  const returns = (returnData ?? []) as {
    id: string;
    return_no: number;
    return_date: string;
    total: number | string;
    refund_amount: number | string;
    vat_amount: number | string | null;
  }[];
  const customerTrn = (customerData as { trn: string | null } | null)?.trn?.trim() || null;

  const currency = business?.currency_code || "PKR";
  const shopName = business?.name || "Retail workspace";
  const invoiceNo = formatInvoiceNo(sale.invoice_no);
  const date = formatDateWith(sale.created_at, business?.date_format ?? "medium", true);
  const customerName = sale.customer_name?.trim() || "Walk-in customer";

  // Invoice options from Settings
  const showLogo = Boolean(business?.invoice_show_logo && business.logo_url);
  const showPhone = business?.invoice_show_customer_phone ?? true;
  const showWarranty = business?.invoice_show_warranty ?? true;
  const showMethod = business?.invoice_show_payment_method ?? true;
  const footerText = business?.invoice_footer?.trim() || "Thank you for your purchase.";

  const cancelled = sale.status === "void";
  const total = toCents(sale.total) ?? ZERO;
  // paid_amount also holds return credits; show money actually paid
  const returnCredit = toCents(sale.return_credit) ?? ZERO;
  const returned = toCents(sale.returned_total) ?? ZERO;
  const refunded = toCents(sale.refunded_total) ?? ZERO;
  const paid = (toCents(sale.paid_amount) ?? ZERO) - returnCredit;
  // A cancelled invoice owes nothing; everything paid was refunded
  const remaining = cancelled ? ZERO : total - paid - returnCredit;
  // An invoice with returns cannot be cancelled as a whole
  const canCancel = !cancelled && returned === ZERO && permissions.includes("returns.manage");
  const fullyReturned = returned >= total && total > ZERO;

  // VAT is inclusive: the total already contains it. The rate is the one
  // saved with the sale, so older invoices stay plain invoices.
  const isTaxInvoice = Number(sale.vat_rate ?? 0) > 0;
  const bilingual = business?.invoice_language === "en_ar";
  const vatRate = formatRate(sale.vat_rate);
  const vatAmount = toCents(sale.vat_amount) ?? ZERO;
  const amountBeforeVat = total - vatAmount;
  const vatReversed = returns.reduce((sum, r) => sum + (toCents(r.vat_amount) ?? ZERO), ZERO);
  const sellerTrn = business?.trn?.trim() || null;
  const nameAr = bilingual ? business?.name_ar?.trim() || null : null;
  const addressAr = bilingual ? business?.address_ar?.trim() || null : null;

  // Cash, Bank, or both when the payments used both
  const methods = new Set(payments.map((p) => p.method).filter(Boolean));
  const methodLabel =
    methods.has("cash") && methods.has("bank")
      ? "Cash and Bank"
      : methods.size === 1
        ? paymentMethodLabel([...methods][0])
        : paymentMethodLabel(sale.payment_method);

  const canReceive =
    !cancelled && remaining > ZERO && hasAny(permissions, ["sales.create", "customers.manage"]);

  // Plain English WhatsApp message
  const lines = [
    shopName,
    ...(isTaxInvoice && sellerTrn ? [`TRN: ${sellerTrn}`] : []),
    `${isTaxInvoice ? "Tax invoice" : "Invoice"} ${invoiceNo}${cancelled ? " (CANCELLED)" : ""}`,
    `Date: ${date}`,
    `Customer: ${customerName}`,
    "",
    "Items:",
    ...items.map(
      (item) =>
        `- ${item.description ?? "Item"} x ${item.quantity ?? 1}: ${formatMoney(item.line_total, currency)}`
    ),
    "",
    ...(isTaxInvoice
      ? [
          `Amount before VAT: ${formatMoney(amountBeforeVat, currency)}`,
          `VAT ${vatRate}%: ${formatMoney(vatAmount, currency)}`,
        ]
      : []),
    `Total${isTaxInvoice ? " (incl. VAT)" : ""}: ${formatMoney(total, currency)}`,
    ...(returned > ZERO
      ? [`Returned: ${formatMoney(returned, currency)}`, `Refunded: ${formatMoney(refunded, currency)}`]
      : []),
    `Paid: ${formatMoney(paid, currency)}`,
    `Remaining: ${formatMoney(remaining, currency)}`,
  ];
  if (sale.warranty_terms?.trim()) lines.push("", `Warranty: ${sale.warranty_terms.trim()}`);
  lines.push("", footerText);
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

      <InvoiceActions
        saleId={sale.id}
        whatsappUrl={whatsappUrl}
        autoPrint={print === "1"}
        defaultPaper={business?.invoice_paper ?? "a4"}
        extraActions={
          <>
            {canReturn && !cancelled && !fullyReturned && (
              <Link href={`/returns/sales/new?sale=${sale.id}`} className={secondaryButtonClass}>
                <RotateCcw className="h-4 w-4" />
                Return items
              </Link>
            )}
            {canReturn && !cancelled && sale.invoice_no !== null && (
              <Link
                href={`/returns?tab=warranty&q=${encodeURIComponent(formatInvoiceNo(sale.invoice_no))}`}
                className={secondaryButtonClass}
              >
                <ShieldCheck className="h-4 w-4" />
                Warranty
              </Link>
            )}
            {canCancel ? (
              <CancelDocument
                id={sale.id}
                buttonLabel="Cancel invoice"
                explanation={`This puts the items back in stock and records a refund of ${formatMoney(paid, currency)} paid by the customer.`}
                keepLabel="Keep invoice"
                action={cancelSale}
              />
            ) : null}
          </>
        }
      >
        <article
          className={
            "relative mx-auto overflow-hidden rounded-card border bg-white p-5 shadow-soft sm:p-8 " +
            `${LINE} ${INK} ` +
            "print:rounded-none print:border-0 print:p-0 print:shadow-none " +
            "group-data-[paper=thermal]:max-w-[80mm] group-data-[paper=thermal]:p-3 group-data-[paper=thermal]:text-[11px]"
          }
        >
          {cancelled && (
            <>
              {/* Faint watermark behind the content; printed too */}
              <p
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none text-center text-6xl font-black tracking-[0.3em] text-[#c2410c]/10 group-data-[paper=thermal]:text-3xl"
              >
                CANCELLED
              </p>
              <div className="relative mb-4 rounded-2xl border-2 border-[#c2410c] px-4 py-3 text-center text-[#c2410c]">
                <p className="text-lg font-black tracking-widest group-data-[paper=thermal]:text-sm">CANCELLED</p>
                <p className="text-xs">
                  Cancelled on {formatDateTime(sale.voided_at)}
                  {sale.void_reason?.trim() ? ` · Reason: ${sale.void_reason.trim()}` : ""}
                </p>
              </div>
            </>
          )}

          {/* Header */}
          <header
            className={
              `flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE} ` +
              "group-data-[paper=thermal]:block group-data-[paper=thermal]:text-center"
            }
          >
            <div className="flex min-w-0 items-start gap-3 group-data-[paper=thermal]:block">
              {showLogo && (
                // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
                <img
                  src={business!.logo_url!}
                  alt=""
                  className="h-16 w-16 shrink-0 object-contain group-data-[paper=thermal]:mx-auto group-data-[paper=thermal]:mb-1 group-data-[paper=thermal]:h-10 group-data-[paper=thermal]:w-10"
                />
              )}
              <div className="min-w-0">
              <p className="text-xl font-bold group-data-[paper=thermal]:text-sm">{shopName}</p>
              {business?.legal_name && business.legal_name !== shopName && (
                <p className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                  {business.legal_name}
                </p>
              )}
              {nameAr && (
                <p dir="rtl" lang="ar" className="font-arabic text-lg font-bold group-data-[paper=thermal]:text-sm">
                  {nameAr}
                </p>
              )}
              {contact.map((value) => (
                <p key={value} className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                  {value}
                </p>
              ))}
              {addressAr && (
                <p dir="rtl" lang="ar" className={`font-arabic text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                  {addressAr}
                </p>
              )}
              {isTaxInvoice && sellerTrn && (
                <p className="text-sm font-semibold group-data-[paper=thermal]:text-[10px]">
                  <Label en="TRN" ar="الرقم الضريبي" bilingual={bilingual} />:{" "}
                  <span className="font-mono">{sellerTrn}</span>
                </p>
              )}
              </div>
            </div>
            <div className="text-right group-data-[paper=thermal]:mt-2 group-data-[paper=thermal]:text-center">
              <p className="text-2xl font-bold tracking-widest group-data-[paper=thermal]:text-sm">
                {isTaxInvoice ? "TAX INVOICE" : "INVOICE"}
              </p>
              {(isTaxInvoice || bilingual) && (
                <p dir="rtl" lang="ar" className="font-arabic text-xl font-bold group-data-[paper=thermal]:text-sm">
                  {isTaxInvoice ? "فاتورة ضريبية" : "فاتورة"}
                </p>
              )}
              <p className="text-sm">
                <span className={MUTED}>
                  <Label en="Invoice no." ar="رقم الفاتورة" bilingual={bilingual} />:
                </span>{" "}
                <span className="font-mono font-semibold">{invoiceNo}</span>
              </p>
              <p className={`text-sm ${MUTED} group-data-[paper=thermal]:text-[10px]`}>
                <Label en="Date" ar="التاريخ" bilingual={bilingual} />: {date}
              </p>
            </div>
          </header>

          {/* Customer */}
          <section className="py-4 group-data-[paper=thermal]:py-2">
            <p className={`text-xs font-semibold uppercase tracking-wide ${MUTED}`}>
              <Label en="Bill to" ar="العميل" bilingual={bilingual} />
            </p>
            <p className="font-semibold">{customerName}</p>
            {showPhone && sale.customer_phone && <p className={`text-sm ${MUTED}`}>{sale.customer_phone}</p>}
            {isTaxInvoice && customerTrn && (
              <p className="text-sm">
                <Label en="Customer TRN" ar="الرقم الضريبي للعميل" bilingual={bilingual} />:{" "}
                <span className="font-mono">{customerTrn}</span>
              </p>
            )}
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
                  {showWarranty && <th className="py-2 pl-3">Warranty</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={index} className={`border-b align-top ${LINE}`}>
                    <td className="py-2.5 pr-3">
                      <p className="font-semibold">{item.description ?? "Item"}</p>
                      {item.item_type === "unstocked" && item.imei && (
                        <p className={`text-xs ${MUTED}`}>
                          IMEI/Serial <span className="font-mono">{item.imei}</span>
                        </p>
                      )}
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
                    {showWarranty && (
                      <td className="whitespace-nowrap py-2.5 pl-3">{formatWarranty(item.warranty_days)}</td>
                    )}
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
                {item.item_type === "unstocked" && item.imei && (
                  <p className="font-mono text-[10px]">IMEI/Serial {item.imei}</p>
                )}
                <div className="flex justify-between">
                  <span>
                    {item.quantity ?? 1} x {formatMoney(item.unit_price, currency)}
                    {toCents(item.discount) ? ` - ${formatMoney(item.discount, currency)}` : ""}
                  </span>
                  <span className="font-semibold">{formatMoney(item.line_total, currency)}</span>
                </div>
                {showWarranty && <p className="text-[10px]">Warranty: {formatWarranty(item.warranty_days)}</p>}
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
              {isTaxInvoice && (
                <>
                  <div className={`flex justify-between gap-4 border-t pt-1 ${LINE}`}>
                    <dt className={MUTED}>
                      <Label en="Amount before VAT" ar="المبلغ قبل الضريبة" bilingual={bilingual} />
                    </dt>
                    <dd className="whitespace-nowrap">{formatMoney(amountBeforeVat, currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className={MUTED}>
                      <Label en={`VAT ${vatRate}%`} ar={`ضريبة القيمة المضافة ${vatRate}%`} bilingual={bilingual} />
                    </dt>
                    <dd className="whitespace-nowrap">{formatMoney(vatAmount, currency)}</dd>
                  </div>
                </>
              )}
              <div className={`flex justify-between gap-4 border-t pt-1 text-base font-bold ${LINE} group-data-[paper=thermal]:text-xs`}>
                <dt>
                  {isTaxInvoice ? (
                    <Label en="Total incl. VAT" ar="الإجمالي شامل الضريبة" bilingual={bilingual} />
                  ) : (
                    <Label en="Grand total" ar="الإجمالي" bilingual={bilingual} />
                  )}
                </dt>
                <dd className="whitespace-nowrap">{formatMoney(total, currency)}</dd>
              </div>
              {returned > ZERO && (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className={MUTED}>Returned</dt>
                    <dd>-{formatMoney(returned, currency)}</dd>
                  </div>
                  {isTaxInvoice && vatReversed > ZERO && (
                    <div className="flex justify-between gap-4">
                      <dt className={MUTED}>VAT reversed on returns</dt>
                      <dd>-{formatMoney(vatReversed, currency)}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className={MUTED}>Refunded</dt>
                    <dd>{formatMoney(refunded, currency)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between gap-4">
                <dt className={MUTED}>Paid</dt>
                <dd>{formatMoney(paid, currency)}</dd>
              </div>
              <div className="flex justify-between gap-4 font-semibold">
                <dt>Remaining</dt>
                <dd>{formatMoney(remaining, currency)}</dd>
              </div>
              {showMethod && (
                <div className="flex justify-between gap-4">
                  <dt className={MUTED}>Payment method</dt>
                  <dd>{methodLabel}</dd>
                </div>
              )}
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
            <p className="mt-2 whitespace-pre-line text-sm font-semibold group-data-[paper=thermal]:text-[11px]">
              {footerText}
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

      {returns.length > 0 && (
        <section className={cardClass + " print:hidden"}>
          <div className="mb-3 flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-accent" />
            <h2 className="text-base font-bold text-ink">Returns</h2>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {returns.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/returns/sales/${r.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm hover:bg-surface-muted"
                >
                  <span className="font-semibold text-ink">
                    {formatSalesReturnNo(r.return_no)}{" "}
                    <span className="font-normal text-ink-muted">
                      · {formatDateWith(r.return_date, business?.date_format ?? "medium")}
                    </span>
                  </span>
                  <span className="text-ink">
                    {formatMoney(r.total, currency)}
                    <span className="text-xs text-ink-muted"> · refund {formatMoney(r.refund_amount, currency)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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
