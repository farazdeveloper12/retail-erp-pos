import type { Metadata } from "next";
import { RotateCcw, Search } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, Notice, PageHeader, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import SalesReturnForm, { type ReturnableSale } from "@/app/(app)/returns/sales/new/SalesReturnForm";
import { todayIn } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "New sales return",
};

export default async function NewSalesReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ sale?: string; invoice?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!permissions.includes("returns.manage")) {
    return <AccessDenied />;
  }

  const { sale, invoice } = await searchParams;
  const saleId = sale && UUID_PATTERN.test(sale) ? sale : null;
  const invoiceText = (invoice ?? "").trim().slice(0, 20);

  let found: ReturnableSale | null = null;
  let error: string | null = null;
  if (saleId || invoiceText) {
    const supabase = await createClient();
    const { data, error: e } = await supabase.rpc("get_sale_for_return", {
      p_payload: saleId ? { sale_id: saleId } : { invoice_no: invoiceText },
    });
    if (e) error = e.message;
    else if (!data) error = "No invoice with this number was found.";
    else found = data as ReturnableSale;
  }
  const business = await getMyBusiness();

  const timeZone = await getBusinessTimeZone();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/returns?tab=sales">Returns</BackLink>
      <PageHeader
        icon={RotateCcw}
        title="Sales return"
        description="A customer brings items back. The value first reduces what the customer still owes; the rest is refunded."
      />

      <form method="get" className={cardClass + " space-y-2"}>
        <label htmlFor="invoice" className={labelClass}>
          Invoice number
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="invoice"
            name="invoice"
            type="search"
            maxLength={20}
            defaultValue={found ? "" : invoiceText}
            placeholder="For example INV-000042 or 42"
            className={inputClass}
          />
          <button type="submit" className={primaryButtonClass}>
            <Search className="h-4 w-4" />
            Find invoice
          </button>
        </div>
      </form>

      {error && <Notice kind="error">{error}</Notice>}
      {found && found.sale.status !== "completed" && (
        <Notice kind="error">This invoice is cancelled, so nothing can be returned.</Notice>
      )}
      {found && found.sale.status === "completed" && (
        <SalesReturnForm
          key={found.sale.id}
          data={found}
          today={todayIn(timeZone)}
          currency={business?.currency_code || "PKR"}
          dateFormat={business?.date_format ?? "medium"}
        />
      )}
    </div>
  );
}
