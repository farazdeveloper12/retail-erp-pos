import type { Metadata } from "next";
import { HandCoins } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, PageHeader } from "@/components/ui";
import { getMyBusiness } from "@/lib/business";
import { todayIn } from "@/lib/dashboard";
import { timeZoneOf } from "@/lib/region";
import { getMyPermissions } from "@/lib/permissions";
import { PERMISSION_TRADE_IN } from "@/lib/trade-in";
import BuyFromCustomerForm from "@/app/(app)/purchases/from-customers/new/BuyFromCustomerForm";
import { loadPurchaseCatalog } from "@/app/(app)/purchases/new/actions";

export const metadata: Metadata = {
  title: "Buy from customer",
};

export default async function BuyFromCustomerPage() {
  const permissions = await getMyPermissions();
  if (!permissions.includes(PERMISSION_TRADE_IN)) return <AccessDenied />;
  const [business, catalog] = await Promise.all([getMyBusiness(), loadPurchaseCatalog()]);
  // Today in Pakistan time, like every other date in the app
  const today = todayIn(timeZoneOf(business));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/purchases/from-customers">Bought from customers</BackLink>
        <PageHeader
          icon={HandCoins}
          title="Buy from customer"
          description="Buy a used phone from a customer. It goes into stock as Used."
        />
      </div>
      <BuyFromCustomerForm
        currency={business?.currency_code || "PKR"}
        region={business?.region ?? "PK"}
        today={today}
        initialBrands={catalog.ok ? catalog.brands : null}
      />
    </div>
  );
}
