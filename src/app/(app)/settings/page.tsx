import type { Metadata } from "next";
import { Settings } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { Notice, PageHeader, cardClass } from "@/components/ui";
import { getMyBusiness } from "@/lib/business";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import SettingsForm from "@/app/(app)/settings/SettingsForm";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "settings")) {
    return <AccessDenied />;
  }

  const business = await getMyBusiness();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Business details used across the app, receipts and reports."
      />

      {!business ? (
        <Notice kind="error">
          No business is linked to your account, so settings cannot be shown.
        </Notice>
      ) : (
        <section className={cardClass}>
          <h2 className="text-base font-bold text-ink">Business details</h2>
          <p className="mb-5 mt-1 text-sm text-ink-muted">
            The business name appears in the sidebar and the browser tab.
          </p>
          <SettingsForm
            defaults={{
              name: business.name ?? "",
              legal_name: business.legal_name ?? "",
              currency_code: business.currency_code ?? "PKR",
              tax_label: business.tax_label ?? "",
              tax_rate:
                business.tax_rate === null || business.tax_rate === undefined
                  ? ""
                  : String(business.tax_rate),
              phone: business.phone ?? "",
              email: business.email ?? "",
              address: business.address ?? "",
            }}
          />
        </section>
      )}
    </div>
  );
}
