import type { Metadata } from "next";
import Link from "next/link";
import { FileX } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import PrintButton from "@/components/PrintButton";
import { BackLink, EmptyState, secondaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";
import { formatDateWith, formatInvoiceNo } from "@/lib/format";
import { formatCustomerPurchaseNo, gradeLabel } from "@/lib/trade-in";
import AutoPrint from "@/app/(app)/purchases/from-customers/AutoPrint";

export const metadata: Metadata = {
  title: "Purchase slip",
};

type SlipRow = {
  id: string;
  purchase_no: number;
  purchase_date: string;
  seller_name: string;
  seller_phone: string;
  seller_id_number: string | null;
  imei: string;
  description: string;
  grade: string;
  condition_notes: string | null;
  price: number | string;
  payment_method: string;
  sale_id: string | null;
  phone: { brand_name: string; model_name: string; storage_gb: number; color_name: string | null } | null;
  sale: { invoice_no: number | null } | null;
};

// Fixed light colours: the printable area stays white in the dark theme too
const INK = "text-[#1f2a2a]";
const MUTED = "text-[#5b6b6b]";
const LINE = "border-[#ece6d8]";

const METHOD_LABELS: Record<string, string> = { cash: "Cash", bank: "Bank", trade_in: "Trade-in on a sale" };

export default async function CustomerPurchaseSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!hasAny(permissions, ["purchases.view", "purchases.manage"])) return <AccessDenied />;
  const { id } = await params;
  const { print } = await searchParams;

  const notFound = (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackLink href="/purchases/from-customers">Bought from customers</BackLink>
      <EmptyState icon={FileX} title="Slip not found" text="This slip does not exist or you do not have access to it." />
    </div>
  );
  if (!UUID_PATTERN.test(id)) return notFound;

  const supabase = await createClient();
  const [{ data }, business] = await Promise.all([
    supabase
      .from("customer_purchases")
      .select(
        "id, purchase_no, purchase_date, seller_name, seller_phone, seller_id_number, imei, description, grade, condition_notes, price, payment_method, sale_id, phone:phone_units(brand_name, model_name, storage_gb, color_name), sale:sales(invoice_no)"
      )
      .eq("id", id)
      .maybeSingle(),
    getMyBusiness(),
  ]);
  const slip = data as unknown as SlipRow | null;
  if (!slip) return notFound;

  const currency = business?.currency_code || "PKR";
  const shopName = business?.name || "Retail workspace";
  const bilingual = business?.invoice_language === "en_ar";
  const phoneName = slip.phone ? `${slip.phone.brand_name} ${slip.description}` : slip.description;
  const contact = [business?.address, business?.phone].filter((v): v is string => Boolean(v && v.trim()));

  const rows: [string, string][] = [
    ["Seller", slip.seller_name],
    ["Phone number", slip.seller_phone],
    ["CNIC / Emirates ID", slip.seller_id_number || "—"],
    ["Phone", phoneName],
    ["IMEI", slip.imei],
    ["Condition", gradeLabel(slip.grade) + (slip.condition_notes ? ` · ${slip.condition_notes}` : "")],
    ["Paid by", METHOD_LABELS[slip.payment_method] ?? slip.payment_method],
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <AutoPrint enabled={print === "1"} />
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <BackLink href="/purchases/from-customers">Bought from customers</BackLink>
        <div className="flex flex-wrap gap-2">
          {slip.sale_id && (
            <Link href={`/sales/${slip.sale_id}`} className={secondaryButtonClass}>
              Open invoice {formatInvoiceNo(slip.sale?.invoice_no)}
            </Link>
          )}
          <PrintButton label="Print slip" />
        </div>
      </div>

      <article
        className={`rounded-card border bg-white p-6 shadow-soft sm:p-8 print:border-0 print:p-0 print:shadow-none ${LINE} ${INK}`}
      >
        <header className={`flex flex-wrap items-start justify-between gap-4 border-b pb-4 ${LINE}`}>
          <div className="min-w-0">
            <p className="text-xl font-bold">{shopName}</p>
            {bilingual && business?.name_ar && (
              <p dir="rtl" lang="ar" className="font-arabic text-lg font-bold">
                {business.name_ar}
              </p>
            )}
            {contact.map((value) => (
              <p key={value} className={`text-sm ${MUTED}`}>
                {value}
              </p>
            ))}
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tracking-widest">PURCHASE SLIP</p>
            {bilingual && (
              <p dir="rtl" lang="ar" className="font-arabic text-lg font-bold">
                إيصال شراء
              </p>
            )}
            <p className="font-mono text-sm font-semibold">{formatCustomerPurchaseNo(slip.purchase_no)}</p>
            <p className={`text-sm ${MUTED}`}>{formatDateWith(slip.purchase_date, business?.date_format ?? "medium")}</p>
          </div>
        </header>

        <p className="mt-4 text-sm">Used phone bought from the customer below.</p>

        <dl className={`mt-4 divide-y divide-[#ece6d8] rounded-2xl border ${LINE}`}>
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-2 px-4 py-2.5 text-sm">
              <dt className={MUTED}>{label}</dt>
              <dd className={"text-right font-semibold" + (label === "IMEI" ? " font-mono" : "")}>{value}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-2 px-4 py-3 text-base font-bold">
            <dt>{slip.payment_method === "trade_in" ? "Trade-in value" : "Amount paid"}</dt>
            <dd>{formatMoney(slip.price, currency)}</dd>
          </div>
        </dl>

        <p className={`mt-6 text-xs ${MUTED}`}>
          The seller confirms that they own this phone, that it is not stolen or under any claim, and that they sell it
          to {shopName} for the amount above.
        </p>

        <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
          <div className={`border-t pt-2 ${LINE}`}>Seller signature</div>
          <div className={`border-t pt-2 ${LINE}`}>For {shopName}</div>
        </div>
      </article>
    </div>
  );
}
