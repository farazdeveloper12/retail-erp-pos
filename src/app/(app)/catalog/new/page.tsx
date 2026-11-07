import type { Metadata } from "next";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, PageHeader, cardClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { NewModelForm } from "@/app/(app)/catalog/CatalogForms";
import { PackagePlus } from "lucide-react";

export const metadata: Metadata = {
  title: "New model",
};

export default async function NewModelPage() {
  const permissions = await getMyPermissions();
  if (!permissions.includes("catalog.manage")) {
    return <AccessDenied />;
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("brands")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  const brands = (data ?? []) as { id: string; name: string }[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-3">
        <BackLink href="/catalog">Back to catalog</BackLink>
        <PageHeader
          icon={PackagePlus}
          title="New model"
          description="After creating the model, add its storage/RAM variants and colors."
        />
      </div>

      <div className={cardClass}>
        <NewModelForm brands={brands} />
      </div>
    </div>
  );
}
