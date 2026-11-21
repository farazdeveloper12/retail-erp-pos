import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { FileX, ReceiptText, RotateCcw, ShieldCheck, TrendingUp } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, EmptyState, cardClass, secondaryButtonClass } from "@/components/ui";
import { formatSalesReturnNo } from "@/lib/returns";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
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
import { DeleteEntryButton } from "@/components/entries/EntryDialog";
import EntryHistory from "@/components/entries/EntryHistory";
import PaymentActions from "@/components/entries/PaymentActions";
import EditSaleForm from "@/app/(app)/sales/[id]/EditSaleForm";
import { COST_PERMISSION, getSaleProfits } from "@/lib/profit";
import { ptaLabel } from "@/lib/pta";
import { regionOf } from "@/lib/region";

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
  id: string;
  item_type: string;
  description: string | null;
  condition: string | null;
  imei: string | null;
  quantity: number | null;
  unit_price: number | string | null;
  discount: number | string | null;
  line_total: number | string | null;
  warranty_days: number | null;
  pta_status: string | null;
  storage_gb: number | null;
  ram_gb: number | null;
  color_name: string | null;
  unstocked_note: string | null;
};

// "256GB / 8GB RAM · Blue · PTA Approved · IMEI 35… · box pack" for an
// "Item not in stock" line
function unstockedDetails(item: SaleItemRow): { text: string; imei: string | null } {
  const storage = item.storage_gb
    ? item.storage_gb >= 1024 && item.storage_gb % 1024 === 0
      ? `${item.storage_gb / 1024}TB`
      : `${item.storage_gb}GB`
    : null;
  const parts = [
    storage ? (item.ram_gb ? `${storage} / ${item.ram_gb}GB RAM` : storage) : null,
    item.color_name,
    ptaLabel(item.pta_status),
    item.unstocked_note,
  ].filter(Boolean);
  return { text: parts.join(" · "), imei: item.imei };
}

type PaymentRow = {
  id: string;
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

// English label; on bilingual invoices the Arabic label sits on its own
// line below it and never wraps
function Label({ en, ar, bilingual }: { en: string; ar: string; bilingual: boolean }): ReactNode {
  if (!bilingual) return en;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span>{en}</span>
      <span dir="rtl" lang="ar" className="whitespace-nowrap font-arabic text-[0.9em]">
        {ar}
      </span>
    </span>
  );
}

// One line under an item: condition, IMEI, PTA or the "Item not in stock" details
function itemDetail(item: SaleItemRow): string | null {
  if (item.item_type === "phone") {
    const parts = [
      item.condition ? (CONDITION_LABELS[item.condition] ?? item.condition) : null,
      item.imei ? `IMEI ${item.imei}` : null,
      ptaLabel(item.pta_status),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (item.item_type === "unstocked") {
    const { text, imei } = unstockedDetails(item);
    const parts = [text || null, imei ? `IMEI/Serial ${imei}` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

type TotalRow = { key: string; label: ReactNode; detail?: string; value: string; tone?: "strong" | "grand" };

// The VAT part inside an amount that includes VAT, rounded to the cent
// (display only; the saved VAT comes from the database)
function vatInside(amount: bigint, rate: unknown): bigint {
  const rate100 = BigInt(Math.round(Number(rate ?? 0) * 100));
  if (rate100 <= ZERO || amount <= ZERO) return ZERO;
  const divisor = BigInt(10000) + rate100;
  return (BigInt(2) * amount * rate100 + divisor) / (BigInt(2) * divisor);
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
      "id, invoice_no, created_at, customer_id, customer_name, customer_phone, subtotal, discount, total, paid_amount, payment_method, warranty_terms, notes, status, vat_rate, vat_amount, voided_at, void_reason, returned_total, refunded_total, return_credit, trade_in_credit"
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
        trade_in_credit: number | string | null;
      })
    | null;
  if (!sale) return <NotFound />;

  const canReturn = permissions.includes("returns.manage");
  const [
    { data: itemData },
    { data: paymentData },
    business,
    { data: returnData },
    { data: customerData },
    { data: tradeInData },
  ] = await Promise.all([
    supabase
      .from("sale_items")
      .select(
        "id, item_type, description, condition, imei, quantity, unit_price, discount, line_total, warranty_days, pta_status, storage_gb, ram_gb, color_name, unstocked_note"
      )
      .eq("sale_id", id),
    supabase
      .from("sale_payments")
      .select("id, amount, method, kind, created_at")
      .eq("sale_id", id)
      .is("deleted_at", null)
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
    // The traded-in phone (visible to purchase users; others see the amount only)
    supabase
      .from("customer_purchases")
      .select("id, purchase_no, description, imei, price, phone:phone_units(brand_name)")
      .eq("sale_id", id)
      .maybeSingle(),
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
  const tradeInRow = tradeInData as unknown as {
    id: string;
    purchase_no: number;
    description: string;
    imei: string;
    price: number | string;
    phone: { brand_name: string } | null;
  } | null;

  // Cost and profit: only for users who may see cost, never printed
  const seesProfit = permissions.includes(COST_PERMISSION);
  const [lineCostResult, saleProfits] = seesProfit
    ? await Promise.all([supabase.rpc("get_sale_line_costs", { p_sale_id: id }), getSaleProfits([id])])
    : [null, null];
  const lineCosts = new Map(
    ((lineCostResult?.data ?? []) as { sale_item_id: string; unit_cost: number | string; cost_missing: boolean }[]).map(
      (row) => [row.sale_item_id, { unitCost: toCents(row.unit_cost) ?? ZERO, missing: row.cost_missing === true }]
    )
  );
  const saleProfit = saleProfits?.get(id) ?? null;

  const currency = business?.currency_code || "PKR";
  const shopName = business?.name || "Retail workspace";
  const invoiceNo = formatInvoiceNo(sale.invoice_no);
  const timeZone = await getBusinessTimeZone();
  const date = formatDateWith(sale.created_at, business?.date_format ?? "medium", true, timeZone);
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
  // A trade-in pays part of the invoice like a credit; it is not money received
  const tradeInCredit = toCents(sale.trade_in_credit) ?? ZERO;
  const tradeInLabel = tradeInRow
    ? `${tradeInRow.phone?.brand_name ? `${tradeInRow.phone.brand_name} ` : ""}${tradeInRow.description}`
    : "Old phone";
  const paid = (toCents(sale.paid_amount) ?? ZERO) - returnCredit - tradeInCredit;
  // A cancelled invoice owes nothing; everything paid was refunded
  const remaining = cancelled ? ZERO : total - paid - returnCredit - tradeInCredit;
  // An invoice with returns or a trade-in cannot be cancelled as a whole
  const canCancel =
    !cancelled && returned === ZERO && tradeInCredit === ZERO && permissions.includes("returns.manage");
  const fullyReturned = returned >= total && total > ZERO;
  // Edit and delete (with a reason; logged). Tax invoices: use a return.
  const canEditEntries = permissions.includes("entries.edit");
  const canDeleteEntries = permissions.includes("entries.delete");

  // VAT is inclusive: the total already contains it. The rate is the one
  // saved with the sale, so older invoices stay plain invoices.
  const isTaxInvoice = Number(sale.vat_rate ?? 0) > 0;
  // Arabic only for UAE businesses that chose English + Arabic
  const bilingual = regionOf(business) === "AE" && business?.invoice_language === "en_ar";
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

  // Short WhatsApp message; the invoice itself goes as a PDF
  const whatsappMessage = [
    `${shopName}: ${isTaxInvoice ? "tax invoice" : "invoice"} ${invoiceNo}${cancelled ? " (CANCELLED)" : ""}`,
    `Date: ${date}`,
    `Total: ${formatMoney(total, currency)}`,
    ...(remaining > ZERO ? [`Balance due: ${formatMoney(remaining, currency)}`] : []),
    footerText.split("\n")[0],
  ].join("\n");
  const whatsappNumber = toWhatsAppNumber(sale.customer_phone, regionOf(business));

  const discountTotal = toCents(sale.discount) ?? ZERO;
  const lineDiscounts = items.some((item) => (toCents(item.discount) ?? ZERO) > ZERO);
  const status = cancelled
    ? "Cancelled"
    : remaining <= ZERO
      ? "Paid"
      : paid > ZERO || tradeInCredit > ZERO || returnCredit > ZERO
        ? "Partly paid"
        : "Unpaid";
  const statusTone =
    status === "Paid"
      ? "bg-[#dff3e7] text-[#17603a]"
      : status === "Cancelled"
        ? "bg-[#fde4d8] text-[#9a3412]"
        : "bg-[#fdf0cf] text-[#7a5500]";

  const totalRows: TotalRow[] = [
    { key: "subtotal", label: <Label en="Subtotal" ar="المجموع الفرعي" bilingual={bilingual} />, value: formatMoney(sale.subtotal, currency) },
    ...(discountTotal > ZERO
      ? [{ key: "discount", label: <Label en="Discount" ar="الخصم" bilingual={bilingual} />, value: `-${formatMoney(discountTotal, currency)}` }]
      : []),
    ...(isTaxInvoice
      ? [
          {
            key: "before-vat",
            label: <Label en="Amount before VAT" ar="المبلغ قبل الضريبة" bilingual={bilingual} />,
            value: formatMoney(amountBeforeVat, currency),
          },
          {
            key: "vat",
            // The rate is shown once, in the English label only
            label: <Label en={`VAT (${vatRate}%)`} ar="ضريبة القيمة المضافة" bilingual={bilingual} />,
            value: formatMoney(vatAmount, currency),
          },
        ]
      : []),
    {
      key: "total",
      label: isTaxInvoice ? (
        <Label en="Total incl. VAT" ar="الإجمالي شامل الضريبة" bilingual={bilingual} />
      ) : (
        <Label en="Total" ar="الإجمالي" bilingual={bilingual} />
      ),
      value: formatMoney(total, currency),
      tone: "grand",
    },
    ...(tradeInCredit > ZERO
      ? [
          {
            key: "trade-in",
            label: <Label en="Trade-in" ar="استبدال" bilingual={bilingual} />,
            detail: `${tradeInLabel}${tradeInRow?.imei ? ` · IMEI ${tradeInRow.imei}` : ""}`,
            value: `-${formatMoney(tradeInCredit, currency)}`,
          },
        ]
      : []),
    ...(returned > ZERO
      ? [
          { key: "returned", label: <Label en="Returned" ar="المرتجع" bilingual={bilingual} />, value: `-${formatMoney(returned, currency)}` },
          ...(isTaxInvoice && vatReversed > ZERO
            ? [{ key: "vat-reversed", label: "VAT reversed on returns", value: `-${formatMoney(vatReversed, currency)}` }]
            : []),
          { key: "refunded", label: <Label en="Refunded" ar="المسترد" bilingual={bilingual} />, value: formatMoney(refunded, currency) },
        ]
      : []),
    { key: "paid", label: <Label en="Paid" ar="المدفوع" bilingual={bilingual} />, value: formatMoney(paid, currency) },
    {
      key: "remaining",
      label: <Label en="Balance due" ar="المبلغ المتبقي" bilingual={bilingual} />,
      value: formatMoney(remaining, currency),
      tone: "strong",
    },
  ];

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
        whatsapp={{ phone: whatsappNumber, message: whatsappMessage, fileName: `Invoice ${invoiceNo}` }}
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
            {canEditEntries && !cancelled && returned === ZERO && Number(sale.vat_rate ?? 0) === 0 && (
              <EditSaleForm
                saleId={sale.id}
                currency={currency}
                discount={centsToPlain(toCents(sale.discount) ?? ZERO)}
                notes={sale.notes ?? ""}
                lines={items.map((item) => ({
                  id: item.id,
                  item_type: item.item_type,
                  description: item.description ?? "Item",
                  quantity: item.quantity ?? 1,
                  unit_price: centsToPlain(toCents(item.unit_price) ?? ZERO),
                  discount: toCents(item.discount) ? centsToPlain(toCents(item.discount) ?? ZERO) : "",
                  unit_cost:
                    item.item_type === "unstocked" && lineCosts.has(item.id)
                      ? centsToPlain(lineCosts.get(item.id)!.unitCost)
                      : null,
                }))}
              />
            )}
            {canDeleteEntries && Number(sale.vat_rate ?? 0) === 0 && returned === ZERO && tradeInCredit === ZERO && (
              <DeleteEntryButton
                type="sale"
                id={sale.id}
                label={`invoice ${invoiceNo}`}
                explanation="The invoice is removed from lists and totals. Phones and accessories go back into stock and the customer's payments are refunded in Cash/Bank."
                afterHref="/sales"
              />
            )}
            {(canEditEntries || canDeleteEntries) && Number(sale.vat_rate ?? 0) > 0 && !cancelled && (
              <span className="self-center text-xs text-ink-muted">Tax invoice: use a return instead of edit or delete.</span>
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
          id="invoice-document"
          className={
            "relative mx-auto overflow-hidden rounded-card border border-t-8 border-t-[#1f2a2a] bg-white p-6 shadow-soft sm:p-10 " +
            `${LINE} ${INK} ` +
            "print:rounded-none print:border-0 print:border-t-8 print:p-0 print:pt-4 print:shadow-none " +
            "group-data-[paper=thermal]:max-w-[80mm] group-data-[paper=thermal]:border-t group-data-[paper=thermal]:p-3 " +
            "group-data-[paper=thermal]:text-[11px] print:group-data-[paper=thermal]:border-t-0"
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
              <div className="relative mb-5 rounded-xl border-2 border-[#c2410c] px-4 py-3 text-center text-[#c2410c]">
                <p className="text-lg font-black tracking-widest group-data-[paper=thermal]:text-sm">CANCELLED</p>
                <p className="text-xs">
                  Cancelled on {formatDateTime(sale.voided_at, timeZone)}
                  {sale.void_reason?.trim() ? ` · Reason: ${sale.void_reason.trim()}` : ""}
                </p>
              </div>
            </>
          )}

          {/* ===== A4 layout ===== */}
          <div className={a4Only}>
            <header className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex min-w-0 items-start gap-4">
                {showLogo && (
                  // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
                  <img src={business!.logo_url!} alt="" className="h-16 w-16 shrink-0 rounded-lg object-contain" />
                )}
                <div className="min-w-0 space-y-0.5">
                  <p className="text-2xl font-extrabold tracking-tight">{shopName}</p>
                  {business?.legal_name && business.legal_name !== shopName && (
                    <p className={`text-sm ${MUTED}`}>{business.legal_name}</p>
                  )}
                  {nameAr && (
                    <p dir="rtl" lang="ar" className="font-arabic text-lg font-bold">
                      {nameAr}
                    </p>
                  )}
                  {contact.map((value) => (
                    <p key={value} className={`text-sm ${MUTED}`}>
                      {value}
                    </p>
                  ))}
                  {addressAr && (
                    <p dir="rtl" lang="ar" className={`font-arabic text-sm ${MUTED}`}>
                      {addressAr}
                    </p>
                  )}
                  {isTaxInvoice && sellerTrn && (
                    <p className="pt-1 text-sm">
                      <span className={MUTED}>TRN </span>
                      <span className="font-mono font-semibold">{sellerTrn}</span>
                    </p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-black uppercase tracking-[0.15em]">
                  {isTaxInvoice ? "Tax invoice" : "Invoice"}
                </p>
                {bilingual && (
                  <p dir="rtl" lang="ar" className="font-arabic text-xl font-bold">
                    {isTaxInvoice ? "فاتورة ضريبية" : "فاتورة"}
                  </p>
                )}
                <dl className="mt-3 grid grid-cols-[auto_auto] justify-end gap-x-5 gap-y-1.5 text-sm">
                  <dt className={MUTED}>
                    <Label en="Invoice no." ar="رقم الفاتورة" bilingual={bilingual} />
                  </dt>
                  <dd className="font-mono font-semibold">{invoiceNo}</dd>
                  <dt className={MUTED}>
                    <Label en="Date" ar="التاريخ" bilingual={bilingual} />
                  </dt>
                  <dd className="whitespace-nowrap font-semibold">{date}</dd>
                  <dt className={MUTED}>Status</dt>
                  <dd>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${statusTone}`}>
                      {status}
                    </span>
                  </dd>
                </dl>
              </div>
            </header>

            {/* Customer and payment */}
            <section className="mt-8 flex flex-wrap gap-4 *:min-w-[220px] *:flex-1">
              <div className="rounded-xl bg-[#f7f5f0] p-4">
                <p className={`text-[11px] font-bold uppercase tracking-wider ${MUTED}`}>
                  <Label en="Bill to" ar="العميل" bilingual={bilingual} />
                </p>
                <p className="mt-1 text-base font-bold">{customerName}</p>
                {showPhone && sale.customer_phone && <p className={`text-sm ${MUTED}`}>{sale.customer_phone}</p>}
                {isTaxInvoice && customerTrn && (
                  <p className="text-sm">
                    <span className={MUTED}>TRN </span>
                    <span className="font-mono">{customerTrn}</span>
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-[#f7f5f0] p-4">
                <p className={`text-[11px] font-bold uppercase tracking-wider ${MUTED}`}>
                  <Label en="Amount due" ar="المبلغ المستحق" bilingual={bilingual} />
                </p>
                <p className="mt-1 text-2xl font-black">{formatMoney(remaining, currency)}</p>
                <p className={`text-sm ${MUTED}`}>
                  Total {formatMoney(total, currency)}
                  {showMethod && paid > ZERO ? ` · Paid by ${methodLabel}` : ""}
                </p>
              </div>
            </section>

            {/* Items */}
            <table className="mt-8 w-full text-left text-sm">
              <thead>
                <tr className={`bg-[#1f2a2a] text-[11px] font-bold uppercase tracking-wider text-white`}>
                  <th className="rounded-l-lg py-2.5 pl-3 pr-2">#</th>
                  <th className="px-2 py-2.5">
                    <Label en="Item" ar="الصنف" bilingual={bilingual} />
                  </th>
                  <th className="px-2 py-2.5 text-right">
                    <Label en="Qty" ar="الكمية" bilingual={bilingual} />
                  </th>
                  <th className="px-2 py-2.5 text-right">
                    <Label en="Price" ar="السعر" bilingual={bilingual} />
                  </th>
                  {lineDiscounts && (
                    <th className="px-2 py-2.5 text-right">
                      <Label en="Discount" ar="الخصم" bilingual={bilingual} />
                    </th>
                  )}
                  <th className="rounded-r-lg py-2.5 pl-2 pr-3 text-right">
                    <Label en="Amount" ar="المبلغ" bilingual={bilingual} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const detail = itemDetail(item);
                  return (
                    <tr key={item.id} className={`break-inside-avoid border-b align-top ${LINE}`}>
                      <td className={`py-3 pl-3 pr-2 ${MUTED}`}>{index + 1}</td>
                      <td className="px-2 py-3">
                        <p className="font-semibold">{item.description ?? "Item"}</p>
                        {detail && <p className={`text-xs ${MUTED}`}>{detail}</p>}
                        {showWarranty && (
                          <p className={`text-xs ${MUTED}`}>Warranty: {formatWarranty(item.warranty_days)}</p>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">{item.quantity ?? 1}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-right">{formatMoney(item.unit_price, currency)}</td>
                      {lineDiscounts && (
                        <td className="whitespace-nowrap px-2 py-3 text-right">
                          {(toCents(item.discount) ?? ZERO) > ZERO ? `-${formatMoney(item.discount, currency)}` : "—"}
                        </td>
                      )}
                      <td className="whitespace-nowrap py-3 pl-2 pr-3 text-right font-semibold">
                        {formatMoney(item.line_total, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Notes and totals */}
            <section className="mt-6 flex flex-wrap items-start justify-between gap-6 break-inside-avoid">
              <div className="min-w-[220px] flex-1 space-y-3 text-sm">
                {sale.notes?.trim() && (
                  <div>
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${MUTED}`}>Notes</p>
                    <p className="whitespace-pre-line">{sale.notes}</p>
                  </div>
                )}
                {sale.warranty_terms?.trim() && (
                  <div>
                    <p className={`text-[11px] font-bold uppercase tracking-wider ${MUTED}`}>Warranty terms</p>
                    <p className={`whitespace-pre-line text-xs ${MUTED}`}>{sale.warranty_terms}</p>
                  </div>
                )}
              </div>
              <dl className="ml-auto w-full max-w-[320px] space-y-1.5 text-sm">
                {totalRows.map((row) => (
                  <div
                    key={row.key}
                    className={
                      "flex items-center justify-between gap-4 " +
                      (row.tone === "grand"
                        ? "my-2 rounded-lg bg-[#1f2a2a] px-3 py-2.5 text-base font-bold text-white"
                        : row.tone === "strong"
                          ? `border-t pt-2 font-bold ${LINE}`
                          : "")
                    }
                  >
                    <dt className={row.tone ? "" : MUTED}>
                      {row.label}
                      {row.detail && <span className="block text-xs">{row.detail}</span>}
                    </dt>
                    <dd className="whitespace-nowrap text-right">{row.value}</dd>
                  </div>
                ))}
                {showMethod && (
                  <div className="flex justify-between gap-4 text-xs">
                    <dt className={MUTED}>Payment method</dt>
                    <dd>{methodLabel}</dd>
                  </div>
                )}
              </dl>
            </section>

            <footer className={`mt-10 border-t pt-4 text-center ${LINE}`}>
              <p className="whitespace-pre-line text-sm font-semibold">{footerText}</p>
              <p className={`mt-1 text-xs ${MUTED}`}>
                {shopName} · {invoiceNo}
              </p>
            </footer>
          </div>

          {/* ===== Small receipt (80 mm) ===== */}
          <div className={thermalOnly}>
            <header className="text-center">
              {showLogo && (
                // eslint-disable-next-line @next/next/no-img-element -- the logo lives in Supabase Storage
                <img src={business!.logo_url!} alt="" className="mx-auto mb-1 h-10 w-10 object-contain" />
              )}
              <p className="text-sm font-extrabold">{shopName}</p>
              {nameAr && (
                <p dir="rtl" lang="ar" className="font-arabic text-sm font-bold">
                  {nameAr}
                </p>
              )}
              {contact.map((value) => (
                <p key={value} className="text-[10px]">
                  {value}
                </p>
              ))}
              {isTaxInvoice && sellerTrn && <p className="text-[10px] font-semibold">TRN {sellerTrn}</p>}
              <p className="mt-2 text-xs font-black uppercase tracking-[0.2em]">
                {isTaxInvoice ? "Tax invoice" : "Receipt"}
              </p>
              {bilingual && (
                <p dir="rtl" lang="ar" className="font-arabic text-xs font-bold">
                  {isTaxInvoice ? "فاتورة ضريبية" : "فاتورة"}
                </p>
              )}
            </header>

            <dl className="mt-2 space-y-0.5 border-t border-dashed border-[#1f2a2a]/40 pt-1.5">
              {[
                ["No.", invoiceNo],
                ["Date", date],
                ["Customer", customerName],
                ...(showPhone && sale.customer_phone ? [["Phone", sale.customer_phone]] : []),
                ...(isTaxInvoice && customerTrn ? [["Customer TRN", customerTrn]] : []),
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-2">
                  <dt>{label}</dt>
                  <dd className="text-right font-semibold">{value}</dd>
                </div>
              ))}
            </dl>

            <ul className="mt-1.5 border-t border-dashed border-[#1f2a2a]/40">
              {items.map((item) => {
                const detail = itemDetail(item);
                return (
                  <li key={item.id} className="border-b border-dashed border-[#1f2a2a]/20 py-1">
                    <p className="font-semibold">{item.description ?? "Item"}</p>
                    {detail && <p className="text-[10px]">{detail}</p>}
                    <div className="flex justify-between gap-2">
                      <span>
                        {item.quantity ?? 1} x {formatMoney(item.unit_price, currency)}
                        {(toCents(item.discount) ?? ZERO) > ZERO ? ` - ${formatMoney(item.discount, currency)}` : ""}
                      </span>
                      <span className="font-semibold">{formatMoney(item.line_total, currency)}</span>
                    </div>
                    {showWarranty && <p className="text-[10px]">Warranty: {formatWarranty(item.warranty_days)}</p>}
                  </li>
                );
              })}
            </ul>

            <dl className="mt-1.5 space-y-0.5">
              {totalRows.map((row) => (
                <div
                  key={row.key}
                  className={
                    "flex items-center justify-between gap-2 " +
                    (row.tone === "grand"
                      ? "my-1 border-y-2 border-double border-[#1f2a2a] py-1 text-xs font-black"
                      : row.tone === "strong"
                        ? "font-bold"
                        : "")
                  }
                >
                  <dt>
                    {row.label}
                    {row.detail && <span className="block text-[10px]">{row.detail}</span>}
                  </dt>
                  <dd className="whitespace-nowrap text-right">{row.value}</dd>
                </div>
              ))}
              {showMethod && (
                <div className="flex justify-between gap-2">
                  <dt>Payment</dt>
                  <dd>{methodLabel}</dd>
                </div>
              )}
            </dl>

            {sale.notes?.trim() && <p className="mt-1.5 text-[10px]">Notes: {sale.notes}</p>}
            <footer className="mt-2 border-t border-dashed border-[#1f2a2a]/40 pt-1.5 text-center">
              {sale.warranty_terms?.trim() && <p className="whitespace-pre-line text-[10px]">{sale.warranty_terms}</p>}
              <p className="mt-1 whitespace-pre-line font-semibold">{footerText}</p>
            </footer>
          </div>
        </article>
      </InvoiceActions>

      {/* Not printed: cost and profit, only for users who may see cost */}
      {seesProfit && saleProfit && (
        <section className={cardClass + " print:hidden"} aria-label="Cost and profit">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <TrendingUp className="h-5 w-5 text-accent" />
            <h2 className="text-base font-bold text-ink">Cost and profit</h2>
            <span className="text-xs text-ink-muted">
              Before VAT. Only visible to you, never printed.
            </span>
          </div>
          {cancelled ? (
            <p className="text-sm text-ink-muted">This invoice is cancelled, so it has no profit.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-line bg-surface-muted text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    <tr>
                      <th className="py-2 pr-3">Item</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Amount</th>
                      {isTaxInvoice && <th className="px-2 py-2 text-right">Before VAT</th>}
                      <th className="px-2 py-2 text-right">Cost</th>
                      <th className="py-2 pl-2 text-right">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const line = toCents(item.line_total) ?? ZERO;
                      const beforeVat = line - (isTaxInvoice ? vatInside(line, sale.vat_rate) : ZERO);
                      const cost = lineCosts.get(item.id);
                      const lineCost = cost ? cost.unitCost * BigInt(item.quantity ?? 1) : null;
                      const lineProfit = lineCost === null ? null : beforeVat - lineCost;
                      return (
                        <tr key={item.id} className="border-b border-line align-top last:border-0">
                          <td className="py-2 pr-3 text-ink">
                            {item.description ?? "Item"}
                            {(!cost || cost.missing) && (
                              <span className="ml-2 text-xs font-semibold text-coral">cost missing</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right text-ink">{item.quantity ?? 1}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-right text-ink">
                            {formatMoney(line, currency)}
                          </td>
                          {isTaxInvoice && (
                            <td className="whitespace-nowrap px-2 py-2 text-right text-ink">
                              {formatMoney(beforeVat, currency)}
                            </td>
                          )}
                          <td className="whitespace-nowrap px-2 py-2 text-right text-ink">
                            {lineCost === null ? "—" : formatMoney(lineCost, currency)}
                          </td>
                          <td
                            className={
                              "whitespace-nowrap py-2 pl-2 text-right font-semibold " +
                              (lineProfit !== null && lineProfit < ZERO ? "text-danger" : "text-ink")
                            }
                          >
                            {lineProfit === null ? "—" : formatMoney(lineProfit, currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <dl className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Sales {isTaxInvoice ? "before VAT" : "total"}</dt>
                  <dd className="text-ink">{formatMoney(total - vatAmount, currency)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Cost of all lines</dt>
                  <dd className="text-ink">-{formatMoney(saleProfit.costTotal, currency)}</dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-1 font-bold">
                  <dt className="text-ink">Profit</dt>
                  <dd className={saleProfit.profit < ZERO ? "text-danger" : "text-ink"}>
                    {formatMoney(saleProfit.profit, currency)}
                  </dd>
                </div>
                {saleProfit.returnsProfit !== ZERO && (
                  <>
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-muted">Reversed by returns</dt>
                      <dd className="text-ink">-{formatMoney(saleProfit.returnsProfit, currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-4 font-bold">
                      <dt className="text-ink">Profit after returns</dt>
                      <dd className={saleProfit.netProfit < ZERO ? "text-danger" : "text-ink"}>
                        {formatMoney(saleProfit.netProfit, currency)}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
              {(toCents(sale.discount) ?? ZERO) > ZERO && (
                <p className="mt-2 text-xs text-ink-muted">
                  Line profits are before the invoice discount; the total profit includes it.
                </p>
              )}
              {saleProfit.costMissing && (
                <p className="mt-2 text-xs font-semibold text-coral">
                  A line has no known cost, so the profit may be too high.
                </p>
              )}
            </>
          )}
        </section>
      )}

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
            {payments.map((payment) => (
              <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span className="text-ink-muted">{formatDateTime(payment.created_at, timeZone)}</span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-ink">
                    {paymentMethodLabel(payment.method)}
                    {payment.kind === "later" ? " · later" : ""}
                  </span>
                  <span className="font-semibold text-ink">{formatMoney(payment.amount, currency)}</span>
                  {!cancelled && (canEditEntries || canDeleteEntries) && (
                    <PaymentActions
                      kind="customer"
                      paymentId={payment.id}
                      amount={centsToPlain(toCents(payment.amount) ?? ZERO)}
                      method={payment.method ?? "cash"}
                      currency={currency}
                      canEdit={canEditEntries}
                      canDelete={canDeleteEntries}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <EntryHistory types={["sale"]} id={sale.id} />
    </div>
  );
}
