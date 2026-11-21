import type { Metadata } from "next";
import { PackageMinus, Search } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, Notice, PageHeader, cardClass, inputClass, labelClass, primaryButtonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import PurchaseReturnForm, {
  type ReturnablePurchase,
} from "@/app/(app)/returns/purchases/new/PurchaseReturnForm";
import { todayIn } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "Return to supplier",
};

export default async function NewPurchaseReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ purchase?: string; no?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!permissions.includes("purchases.manage")) {
    return <AccessDenied />;
  }

  const { purchase, no } = await searchParams;
  const purchaseId = purchase && UUID_PATTERN.test(purchase) ? purchase : null;
  const noText = (no ?? "").trim().slice(0, 20);

  let found: ReturnablePurchase | null = null;
  let error: string | null = null;
  if (purchaseId || noText) {
    const supabase = await createClient();
    const { data, error: e } = await supabase.rpc("get_purchase_for_return", {
      p_payload: purchaseId ? { purchase_id: purchaseId } : { purchase_no: noText },
    });
    if (e) error = e.message;
    else if (!data) error = "No purchase with this number was found.";
    else found = data as ReturnablePurchase;
  }
  const business = await getMyBusiness();

  const timeZone = await getBusinessTimeZone();
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <BackLink href="/returns?tab=purchases">Returns</BackLink>
      <PageHeader
        icon={PackageMinus}
        title="Return to supplier"
        description="Items go back to the supplier. Their cost first reduces what you still owe the supplier; the rest is money you get back."
      />

      <form method="get" className={cardClass + " space-y-2"}>
        <label htmlFor="no" className={labelClass}>
          Purchase number
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="no"
            name="no"
            type="search"
            maxLength={20}
            defaultValue={found ? "" : noText}
            placeholder="For example 12"
            className={inputClass}
          />
          <button type="submit" className={primaryButtonClass}>
            <Search className="h-4 w-4" />
            Find purchase
          </button>
        </div>
      </form>

      {error && <Notice kind="error">{error}</Notice>}
      {found && found.purchase.status !== "completed" && (
        <Notice kind="error">This purchase is cancelled, so nothing can be returned.</Notice>
      )}
      {found && found.purchase.status === "completed" && (
        <PurchaseReturnForm
          key={found.purchase.id}
          data={found}
          today={todayIn(timeZone)}
          currency={business?.currency_code || "PKR"}
          dateFormat={business?.date_format ?? "medium"}
        />
      )}
    </div>
  );
}
