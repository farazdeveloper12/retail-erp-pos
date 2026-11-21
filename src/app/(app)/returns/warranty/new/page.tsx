import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { BackLink, Notice, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getMyBusiness, getBusinessTimeZone } from "@/lib/business";
import { getMyPermissions } from "@/lib/permissions";
import { UUID_PATTERN } from "@/lib/catalog";
import ClaimForm, { type SoldItem } from "@/app/(app)/returns/warranty/new/ClaimForm";
import { todayIn } from "@/lib/dashboard";

export const metadata: Metadata = {
  title: "New warranty claim",
};

export default async function NewClaimPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const permissions = await getMyPermissions();
  if (!permissions.includes("returns.manage")) return <AccessDenied />;

  const { item } = await searchParams;
  let sold: SoldItem | null = null;
  let error: string | null = null;
  if (item && UUID_PATTERN.test(item)) {
    const supabase = await createClient();
    const { data, error: e } = await supabase.rpc("warranty_lookup", { p_query: item });
    if (e) error = e.message;
    else sold = ((data ?? []) as SoldItem[])[0] ?? null;
    if (!e && !sold) error = "The sold item was not found.";
  }
  const business = await getMyBusiness();

  const timeZone = await getBusinessTimeZone();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackLink href="/returns?tab=warranty">Warranty</BackLink>
      <PageHeader
        icon={ShieldCheck}
        title="Warranty claim"
        description="Record an item a customer brought in under warranty. Find it first on the Warranty page, or enter it by hand."
      />
      {error && <Notice kind="error">{error}</Notice>}
      <ClaimForm sold={sold} today={todayIn(timeZone)} dateFormat={business?.date_format ?? "medium"} />
    </div>
  );
}
