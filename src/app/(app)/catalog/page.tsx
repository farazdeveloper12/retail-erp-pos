import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import AccessDenied from "@/components/AccessDenied";
import { createClient } from "@/lib/supabase/server";
import { canViewPage, getMyPermissions } from "@/lib/permissions";
import {
  PRODUCT_TYPE_LABELS,
  UUID_PATTERN,
  formatVariant,
} from "@/lib/catalog";
import { AddBrandForm } from "@/app/(app)/catalog/CatalogForms";

export const metadata: Metadata = {
  title: "Product Catalog",
};

type ModelRow = {
  id: string;
  name: string;
  product_type: string;
  is_active: boolean;
  brands: { name: string } | null;
  model_variants: { storage_gb: number; ram_gb: number | null; is_active: boolean }[];
  model_colors: { is_active: boolean }[];
};

const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950";

const PAGE_SIZE = 200;

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string; type?: string }>;
}) {
  const permissions = await getMyPermissions();
  if (!canViewPage(permissions, "catalog")) {
    return <AccessDenied />;
  }
  const canManage = permissions.includes("catalog.manage");

  const { q = "", brand = "", type = "" } = await searchParams;
  const supabase = await createClient();

  const { data: brandData } = await supabase
    .from("brands")
    .select("id, name")
    .order("name");
  const brands = (brandData ?? []) as { id: string; name: string }[];

  let query = supabase
    .from("product_models")
    .select(
      "id, name, product_type, is_active, brands(name), model_variants(storage_gb, ram_gb, is_active), model_colors(is_active)"
    )
    .order("name")
    .limit(PAGE_SIZE);

  const cleaned = q.replace(/[%_,()\\*]/g, " ").trim();
  if (cleaned) query = query.ilike("name", `%${cleaned}%`);
  if (UUID_PATTERN.test(brand)) query = query.eq("brand_id", brand);
  if (type === "phone" || type === "smartwatch") {
    query = query.eq("product_type", type);
  }

  const { data, error } = await query;
  const models = (data ?? []) as unknown as ModelRow[];
  const filtering = Boolean(cleaned || UUID_PATTERN.test(brand) || type);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <BookOpen className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Product Catalog</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Phone models ki searchable list.
            </p>
          </div>
        </div>
        {canManage && (
          <Link
            href="/catalog/new"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Naya model
          </Link>
        )}
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="min-w-[180px] flex-1">
          <label htmlFor="q" className="mb-1 block text-xs font-medium">
            Model ka naam
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={q}
            placeholder="Search..."
            className={inputClass + " w-full"}
          />
        </div>
        <div>
          <label htmlFor="brand" className="mb-1 block text-xs font-medium">
            Brand
          </label>
          <select id="brand" name="brand" defaultValue={brand} className={inputClass}>
            <option value="">Sab brands</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="type" className="mb-1 block text-xs font-medium">
            Type
          </label>
          <select id="type" name="type" defaultValue={type} className={inputClass}>
            <option value="">Sab</option>
            <option value="phone">Phone</option>
            <option value="smartwatch">Smartwatch</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Dhoondhein
        </button>
        {filtering && (
          <Link
            href="/catalog"
            className="py-2 text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            Saaf karein
          </Link>
        )}
      </form>

      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200"
        >
          Catalog nahi mil saka: {error.message}
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {filtering
            ? "Is search se koi model nahi mila."
            : "Catalog abhi khali hai. Models ka verified data Phase 6B mein aayega, ya aap Naya model se khud add kar sakte hain."}
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {models.length} model
            {models.length === PAGE_SIZE &&
              ` (sirf pehle ${PAGE_SIZE} dikhaye gaye hain, search se chhota karein)`}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Brand</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Variants</th>
                  <th className="px-4 py-3 font-medium">Colors</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {models.map((model) => {
                  const variants = model.model_variants
                    .filter((v) => v.is_active)
                    .sort(
                      (a, b) =>
                        a.storage_gb - b.storage_gb ||
                        (a.ram_gb ?? 0) - (b.ram_gb ?? 0)
                    );
                  const shown = variants
                    .slice(0, 3)
                    .map((v) => formatVariant(v.storage_gb, v.ram_gb))
                    .join(", ");
                  const extra =
                    variants.length > 3 ? ` +${variants.length - 3}` : "";
                  const variantText = variants.length ? shown + extra : "—";
                  const colorCount = model.model_colors.filter(
                    (c) => c.is_active
                  ).length;

                  return (
                    <tr
                      key={model.id}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                    >
                      <td className="px-4 py-3">{model.brands?.name ?? "—"}</td>
                      <td className="px-4 py-3 font-medium">{model.name}</td>
                      <td className="px-4 py-3">
                        {PRODUCT_TYPE_LABELS[model.product_type] ??
                          model.product_type}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                        {variantText}
                      </td>
                      <td className="px-4 py-3">{colorCount || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium " +
                            (model.is_active
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300")
                          }
                        >
                          {model.is_active ? "Active" : "Band"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/catalog/model?id=${model.id}`}
                          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Dekhein
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canManage && (
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer text-sm font-semibold">
            Naya brand add karein
          </summary>
          <div className="mt-4">
            <AddBrandForm />
          </div>
        </details>
      )}
    </div>
  );
}