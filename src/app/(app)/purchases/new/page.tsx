import type { Metadata } from "next";
import { PackagePlus } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, Notice, PageHeader } from "@/components/ui";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { getMyPermissions, hasAny } from "@/lib/permissions";
import { loadPurchaseCatalog } from "@/app/(app)/purchases/new/actions";
import PurchaseEntry from "@/app/(app)/purchases/new/PurchaseEntry";
import { todayIn } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "New purchase",
};

export default async function NewPurchasePage() {
  const permissions = await getMyPermissions();
  if (!permissions.includes("purchases.manage")) {
    return <AccessDenied />;
  }

  const [catalog, business] = await Promise.all([
    loadPurchaseCatalog(),
    getMyBusiness(),
  ]);

  const timeZone = await getBusinessTimeZone();
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
        region={business?.region ?? "PK"}
        today={todayIn(timeZone)}
      />
    </div>
  );
}
