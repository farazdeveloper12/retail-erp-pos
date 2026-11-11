import type { Metadata } from "next";
import { ShoppingCart } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, PageHeader } from "@/components/ui";
import { getMyBusiness } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import SaleEntry from "@/app/(app)/sales/new/SaleEntry";

export const metadata: Metadata = {
  title: "New sale",
};

export default async function NewSalePage() {
  const permissions = await getMyPermissions();
  if (!permissions.includes("sales.create")) {
    return <AccessDenied />;
  }
  const business = await getMyBusiness();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/sales">Back to sales</BackLink>
        <PageHeader
          icon={ShoppingCart}
          title="New sale"
          description="Scan or search items, press Enter to move between fields and Ctrl + Enter to save."
        />
      </div>
      <SaleEntry
        currency={business?.currency_code || "PKR"}
        seesCost={permissions.includes("inventory.view_cost")}
      />
    </div>
  );
}
