import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { createClient } from "@/lib/supabase/server";
import { getMyPermissions } from "@/lib/permissions";
import { NewModelForm } from "@/app/(app)/catalog/CatalogForms";

export const metadata: Metadata = {
  title: "Naya model",
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
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Catalog par wapas
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Naya model</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Model banane ke baad uske storage/RAM variants aur colors add
            karein.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <NewModelForm brands={brands} />
      </div>
    </div>
  );
}