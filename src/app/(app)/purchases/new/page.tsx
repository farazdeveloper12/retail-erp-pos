import type { Metadata } from "next";
import { PackagePlus } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, Notice, PageHeader } from "@/components/ui";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { loadPurchaseCatalog } from "@/app/(app)/purchases/new/actions";
import PurchaseEntry from "@/app/(app)/purchases/new/PurchaseEntry";

export const metadata: Metadata = {
  title: "New purchase",
};

// Today's date in Pakistan time, as YYYY-MM-DD
function todayInKarachi() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function NewPurchasePage() {
  const permissions = await getMyPermissions();
  if (!permissions.includes("purchases.manage")) {
    return <AccessDenied />;
  }

  const [catalog, business] = await Promise.all([
    loadPurchaseCatalog(),
    getMyBusiness(),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/purchases">Back to purchases</BackLink>
        <PageHeader
          icon={PackagePlus}
          title="New purchase"
          description="Enter stock from a supplier. Press Enter to move to the next cell and Ctrl + Enter to save."
        />
      </div>

      {!catalog.ok && (
        <Notice kind="error">
          {catalog.error ?? "The catalog could not be loaded."} You can still add
          accessories.
        </Notice>
      )}

      <PurchaseEntry
        initialBrands={catalog.brands}
        canAddModels={permissions.includes("catalog.manage")}
        canCreateProducts={hasAny(permissions, ["catalog.create", "catalog.manage"])}
        currency={business?.currency_code || "PKR"}
        today={todayInKarachi()}
      />
    </div>
  );
}
